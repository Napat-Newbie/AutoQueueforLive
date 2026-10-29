// tests/harness/sandbox.js
// Runs the REAL index.js in a throw-away copy of the app, with every outside service mocked.
//
//   * NEVER runs in the repo directory: db.js writes data.sqlite next to itself, so we copy the runtime
//     files into a temp dir (fresh empty database every run).
//   * node_modules: taken from AQ_TEST_NODE_MODULES, or <repo>/node_modules (run `npm install` once).
//   * Outside world is replaced by tests/harness/preload.js + tests/harness/mock-universe.js.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { MockUniverse } = require('./mock-universe');

const REPO = path.resolve(__dirname, '..', '..');
// Source of the app under test. Default: this checkout. Set AQ_TEST_APP_ROOT to another checkout/export (e.g. the previous release) to run the same tests against it.
const APP = process.env.AQ_TEST_APP_ROOT ? path.resolve(process.env.AQ_TEST_APP_ROOT) : REPO;
const CHANNEL_SECRET = 'test-channel-secret';

function resolveNodeModules() {
    const candidates = [process.env.AQ_TEST_NODE_MODULES, path.join(REPO, 'node_modules')].filter(Boolean);
    for (const c of candidates) if (fs.existsSync(path.join(c, 'express'))) return c;
    throw new Error('node_modules not found. Run `npm install` in the repo root, or set AQ_TEST_NODE_MODULES.');
}

function copyDir(from, to, skip = () => false) {
    fs.mkdirSync(to, { recursive: true });
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, e.name);
        if (skip(src, e)) continue;
        const dst = path.join(to, e.name);
        if (e.isDirectory()) copyDir(src, dst, skip);
        else fs.copyFileSync(src, dst);
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
        s.on('error', reject);
    });
}

function httpJson(method, url, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const req = http.request(url, { method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                let json = null;
                try { json = JSON.parse(buf.toString('utf8')); } catch (e) { /* not json */ }
                resolve({ status: res.statusCode, json, buffer: buf, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

class Sandbox {
    constructor() { this.mock = new MockUniverse(); this.child = null; this.dir = null; this.port = null; this.output = ''; this._db = null; }

    static async start(extraEnv = {}) {
        const sb = new Sandbox();
        await sb.mock.start();
        sb.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-sandbox-'));
        // runtime files only (same set pack_update.js ships) - never the repo's data/.env
        for (const f of ['index.js', 'db.js', 'keep_awake.js', 'package.json']) fs.copyFileSync(path.join(APP, f), path.join(sb.dir, f));
        copyDir(path.join(APP, 'sentinel'), path.join(sb.dir, 'sentinel'), (s) => path.basename(s) === 'proposals.json');
        copyDir(path.join(APP, 'templates'), path.join(sb.dir, 'templates'));
        copyDir(path.join(APP, 'public'), path.join(sb.dir, 'public'), (s, e) => e.isDirectory() && ['manual_images', 'uploads'].includes(e.name));
        fs.mkdirSync(path.join(sb.dir, 'public', 'uploads'), { recursive: true });

        sb.port = await freePort();
        sb.base = `http://127.0.0.1:${sb.port}`;
        const env = {
            ...process.env,
            NODE_PATH: resolveNodeModules(),
            NODE_NO_WARNINGS: '1',
            PORT: String(sb.port),
            AQ_NO_SUPERVISOR: '1',
            AQ_TEST_MOCK_URL: sb.mock.url,
            LINE_CHANNEL_SECRET: CHANNEL_SECRET,
            LINE_ACCESS_TOKEN: 'test-line-token',
            SLIP_PROVIDER: 'slipok',
            SLIPOK_API_KEY: 'test-key',
            SLIPOK_BRANCH_ID: '1',
            DISCORD_WEBHOOK_URL: '',
            ...extraEnv,
        };
        sb.child = spawn(process.execPath, ['-r', path.join(__dirname, 'preload.js'), 'index.js'], { cwd: sb.dir, env, windowsHide: true });
        sb.child.stdout.on('data', d => { sb.output += d; });
        sb.child.stderr.on('data', d => { sb.output += d; });
        sb.exited = false;
        sb.child.on('exit', () => { sb.exited = true; });
        await sb.waitFor(async () => { try { return (await sb.get('/api/health')).status === 200; } catch (e) { return false; } }, 20000, 'server did not become healthy');
        return sb;
    }

    async stop() {
        if (this.child && !this.exited) {
            this.child.kill();
            await new Promise(r => { const t = setTimeout(r, 3000); this.child.on('exit', () => { clearTimeout(t); r(); }); });
        }
        try { this._db && this._db.close(); this._wdb && this._wdb.close(); } catch (e) { /* ignore */ }
        await this.mock.stop();
        try { fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* tmp dir, best effort */ }
    }

    // ---- HTTP -------------------------------------------------------------------------
    get(p) { return httpJson('GET', this.base + p); }
    post(p, body) { return httpJson('POST', this.base + p, body === undefined ? {} : body); }

    /** Send LINE webhook events with a valid x-line-signature, exactly like LINE does. */
    webhook(events, { signature } = {}) {
        const body = JSON.stringify({ destination: 'Utest', events });
        const sig = signature !== undefined ? signature : crypto.createHmac('sha256', CHANNEL_SECRET).update(body).digest('base64');
        return httpJson('POST', this.base + '/webhook', body, { 'x-line-signature': sig });
    }

    /** A customer sends a slip image. `key` ties the image to the scripted SlipOK answer. */
    sendSlip(userId, messageId, key) {
        this.mock.lineMessage(messageId, key);
        return this.webhook([{ type: 'message', replyToken: `rt-${messageId}`, source: { type: 'user', userId }, message: { type: 'image', id: messageId } }]);
    }

    // ---- DB (read-only view of the sandbox database) ----------------------------------
    sql(query, ...params) {
        if (!this._db) this._db = new DatabaseSync(path.join(this.dir, 'data.sqlite'), { readOnly: true });
        return this._db.prepare(query).all(...params);
    }
    slips() { return this.sql('SELECT id, line_id, line_name, amount, draws, status, session_id, trans_date, trans_ref, qr_payload FROM slips ORDER BY id'); }
    /** Write a test fixture straight into the sandbox database (separate connection, WAL-safe). */
    exec(query, ...params) {
        if (!this._wdb) { this._wdb = new DatabaseSync(path.join(this.dir, 'data.sqlite')); this._wdb.exec('PRAGMA busy_timeout = 5000'); }
        return this._wdb.prepare(query).run(...params);
    }
    /** Insert a slip row as if it had been received earlier (fixtures for old/odd data). */
    insertSlip({ line_id = 'Ufixture', name = 'Fixture', amount = 0, draws = 0, session_id = null, trans_date, trans_time = '10:00:00', trans_ref = null, status = 'waiting', qr_payload = null }) {
        return this.exec('INSERT INTO slips (amount, draws, line_id, sender_name, line_name, session_id, trans_date, trans_time, trans_ref, qr_payload, status) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            amount, draws, line_id, name, name, session_id, trans_date, trans_time, trans_ref, qr_payload || ((trans_ref || 'x') + '|'), status).lastInsertRowid;
    }
    /** Calls the app made that the mock universe did not script (the cloudflared download at start-up is expected noise). */
    unexpectedCalls() { return this.mock.unexpected.filter(u => !/github\.com\/cloudflare\/cloudflared/.test(u)); }

    /** Load a dependency (e.g. exceljs) from the same node_modules the app uses. */
    requireDep(name) { return require(require.resolve(name, { paths: [resolveNodeModules()] })); }

    // ---- misc -------------------------------------------------------------------------
    async waitFor(fn, timeoutMs = 8000, message = 'condition not met') {
        const t0 = Date.now();
        for (;;) {
            let v;
            try { v = await fn(); } catch (e) { v = false; }
            if (v) return v;
            if (Date.now() - t0 > timeoutMs) throw new Error(`${message} (waited ${timeoutMs} ms)\n--- server output (tail) ---\n${this.output.slice(-1500)}`);
            await new Promise(r => setTimeout(r, 80));
        }
    }
    /** Wait until the webhook finished processing slip rows >= n. */
    waitForSlips(n) { return this.waitFor(() => this.slips().length >= n, 8000, `expected ${n} slip row(s)`); }

    async configure({ prices = 'A:100,B:200', shipping = 40, threshold = 3, merchant = 'TestShop' } = {}) {
        const r = await this.post('/api/config', { newPrices: prices, newShipping: shipping, newThreshold: threshold, newMerchantName: merchant });
        if (r.status !== 200) throw new Error('config failed: ' + r.status);
    }
    async stats() { return (await this.get('/api/stats/today')).json; }
    async startLive() { const r = await this.post('/api/live_session/start'); if (!r.json || !r.json.success) throw new Error('start live failed'); return r.json; }
    async endLive(body = {}) { const r = await this.post('/api/live_session/end', body); if (!r.json || !r.json.success) throw new Error('end live failed'); return r.json; }
}

/** YYYYMMDD of today (+offsetDays) in Bangkok time, the same format as slips.trans_date. */
function bkkDate(offsetDays = 0) {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Fresh sandbox (empty database, prices A=100 B=200, shipping 40, free from 3 items) for one test.
 * `env` (optional) overrides child process env vars, e.g. { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/aq-test' }. */
async function withSandbox(fn, opts, env) {
    const sb = await Sandbox.start(env || {});
    try { await sb.configure(opts || {}); await fn(sb); } finally { await sb.stop(); }
}

module.exports = { Sandbox, CHANNEL_SECRET, bkkDate, withSandbox };
