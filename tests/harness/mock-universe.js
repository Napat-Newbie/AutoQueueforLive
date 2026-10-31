// tests/harness/mock-universe.js
// A local HTTP server that plays every outside service the app talks to (LINE, SlipOK, ...).
// The app's axios calls are redirected here by tests/harness/preload.js with the real URL in `x-aq-orig-url`.
// Anything the app calls that is NOT scripted here is recorded in `unexpected` so tests can assert
// "no surprise outbound calls".
'use strict';
const http = require('http');

class MockUniverse {
    constructor() {
        this.server = null;
        this.url = null;
        this.calls = [];          // every proxied call: { method, url, host, path, status }
        this.unexpected = [];     // calls nobody scripted
        this.lineImages = new Map();   // messageId -> Buffer | { status, body }
        this.profiles = new Map();     // userId -> displayName
        this.slips = new Map();        // key -> { status, body }  (SlipOK answer for the slip whose image contains `SLIP:<key>`)
        this.replies = [];             // text pushed/replied to customers
        this.discords = [];            // webhook payloads the app sent to Discord: { path, body }
        this.geminis = [];             // every Gemini API call: { path, url (as the app built it), headers, body }
        this.geminiReply = null;       // scripted response text (a JSON string); null -> 500 so accidental calls fail loudly
        this.geminiQueue = [];         // optional one-shot answers used first, in order: { status, body } or { text } (e.g. a 429 then a success)
    }

    async start() {
        this.server = http.createServer((req, res) => this._handle(req, res));
        await new Promise(r => this.server.listen(0, '127.0.0.1', r));
        this.url = `http://127.0.0.1:${this.server.address().port}`;
        return this.url;
    }

    async stop() {
        if (!this.server) return;
        await new Promise(r => this.server.close(r));
        this.server.closeAllConnections?.();
        this.server = null;
    }

    // ---- scripting helpers ------------------------------------------------------------
    /** Image the customer "sends": the bytes carry a key the SlipOK mock later recognises. */
    imageFor(key) { return Buffer.from(`SLIP:${key}`); }

    /** LINE message `messageId` downloads as the image for `key`. */
    lineMessage(messageId, key) { this.lineImages.set(messageId, this.imageFor(key)); }

    /** LINE content download fails with HTTP `status` (e.g. 500). */
    lineMessageFails(messageId, status = 500) { this.lineImages.set(messageId, { status, body: { message: 'boom' } }); }

    profile(userId, displayName) { this.profiles.set(userId, displayName); }

    /** SlipOK reads slip `key` as a valid transfer. */
    slipOk(key, { amount, transRef, receiverName = 'TestShop', receiverNameEn, transDate = '20261029', transTime = '11:00:00' }) {
        this.slips.set(key, {
            status: 200,
            body: {
                success: true,
                data: {
                    success: true, message: 'ok', transRef, transDate, transTime, amount,
                    sender: { displayName: 'Sender', name: 'Sender' },
                    receiver: { displayName: receiverName, name: receiverNameEn !== undefined ? receiverNameEn : receiverName },
                },
            },
        });
    }

    /** SlipOK cannot read slip `key` (error response -> app must send it to the manual queue). */
    slipUnreadable(key) {
        this.slips.set(key, { status: 400, body: { success: false, code: 1002, message: 'unreadable' } });
    }

    // ---- request handling -------------------------------------------------------------
    _handle(req, res) {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks);
            const orig = req.headers['x-aq-orig-url'];
            if (!orig) { res.writeHead(400); return res.end('missing x-aq-orig-url'); }
            let u;
            try { u = new URL(orig); } catch (e) { res.writeHead(400); return res.end('bad url'); }
            const reply = (status, payload, headers = {}) => {
                this.calls.push({ method: req.method, url: orig, host: u.host, path: u.pathname, status });
                if (Buffer.isBuffer(payload)) {
                    res.writeHead(status, { 'content-type': 'application/octet-stream', ...headers });
                    return res.end(payload);
                }
                res.writeHead(status, { 'content-type': 'application/json', ...headers });
                res.end(JSON.stringify(payload === undefined ? {} : payload));
            };

            // LINE: download slip image
            let m = u.host === 'api-data.line.me' && u.pathname.match(/^\/v2\/bot\/message\/([^/]+)\/content$/);
            if (m) {
                const v = this.lineImages.get(m[1]);
                if (!v) return reply(404, { message: 'no such message' });
                if (Buffer.isBuffer(v)) return reply(200, v);
                return reply(v.status, v.body);
            }
            // LINE: profile
            m = u.host === 'api.line.me' && u.pathname.match(/^\/v2\/bot\/profile\/([^/]+)$/);
            if (m) return reply(200, { displayName: this.profiles.get(m[1]) || `User-${m[1]}` });
            // LINE: reply / push (recorded, always OK)
            if (u.host === 'api.line.me' && /^\/v2\/bot\/message\/(reply|push)$/.test(u.pathname)) {
                try { this.replies.push(JSON.parse(body.toString('utf8'))); } catch (e) { this.replies.push({ raw: body.toString('utf8') }); }
                return reply(200, {});
            }
            // SlipOK: verify
            if (u.host === 'api.slipok.com' && /^\/api\/line\/apikey\//.test(u.pathname)) {
                const text = body.toString('latin1');
                const k = text.match(/SLIP:([A-Za-z0-9_-]+)/);
                const scripted = k && this.slips.get(k[1]);
                if (!scripted) return reply(400, { success: false, code: 1002, message: 'unscripted slip' });
                return reply(scripted.status, scripted.body);
            }
            // Gemini API (recorded; scripted reply via this.geminiReply, otherwise 500) — ใช้ทดสอบ AI เสริมความเห็นในสรุปหลังจบไลฟ์
            if (u.host === 'generativelanguage.googleapis.com') {
                this.geminis.push({ path: u.pathname, url: orig, headers: { ...req.headers }, body: JSON.parse(body.toString('utf8') || '{}') });
                if (this.geminiQueue.length) {
                    const next = this.geminiQueue.shift();
                    const answer = () => (next.text !== undefined
                        ? reply(200, { candidates: [{ content: { parts: [{ text: next.text }] } }] })
                        : reply(next.status || 500, next.body || { error: { message: 'scripted gemini error' } }));
                    // { delayMs } = a slow Gemini (seen on a real shop live 2026-10-31: 5 of 36 answers took > 4 s)
                    if (next.delayMs) { setTimeout(() => { try { answer(); } catch (e) { /* client gave up */ } }, next.delayMs); return; }
                    return answer();
                }
                if (this.geminiReply === null) return reply(500, { error: { message: 'no scripted gemini reply' } });
                return reply(200, { candidates: [{ content: { parts: [{ text: this.geminiReply }] } }] });
            }
            // Discord webhook (recorded, always OK) — ใช้ทดสอบการแจ้งเตือน/สรุปที่ระบบส่งเข้า Discord
            if (u.host === 'discord.com' || u.host === 'discordapp.com') {
                try { this.discords.push({ path: u.pathname, body: JSON.parse(body.toString('utf8')) }); }
                catch (e) { this.discords.push({ path: u.pathname, raw: body.toString('utf8') }); }
                return reply(200, {});
            }
            // Cloudflare / GitHub / anything else: refuse, but remember it
            this.unexpected.push(`${req.method} ${orig}`);
            return reply(404, { message: 'not scripted in test universe' });
        });
    }
}

module.exports = { MockUniverse };
