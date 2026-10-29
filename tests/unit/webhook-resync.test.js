// tests/unit/webhook-resync.test.js
// v1.0.16: when binding the new tunnel URL to LINE fails (e.g. "Invalid webhook endpoint URL"), the program now
//  - says WHICH url / tunnel / HTTP status failed (so the cause can be diagnosed from the log / Discord), and
//  - keeps retrying by itself every minute instead of giving up after 3 tries.
// The real functions are cut out of index.js and run in a vm with fake axios/io/timers.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { grabConst } = require('../harness/extract');

const src = fs.readFileSync(process.env.AQ_TEST_INDEX_JS || path.join(__dirname, '..', '..', 'index.js'), 'utf8');
const URL1 = 'https://abc-def.trycloudflare.com';
/** top-level function text: from its declaration to the first line that is exactly "}" (the shared brace matcher is fooled by the quote characters inside a regex literal in this function) */
function cut(name) {
    const text = src.replace(/\r\n/g, '\n');
    const re = new RegExp(`(?:^|\\n)((?:async\\s+)?function\\s+${name}\\s*\\()`);
    const m = re.exec(text);
    if (!m) throw new Error(`function ${name} not found`);
    const start = m.index + m[0].indexOf(m[1]);
    return text.slice(start, text.indexOf('\n}\n', start) + 2);
}

function makeEnv() {
    const logs = [];
    const timers = [];
    const puts = [];
    const plan = [];   // 'ok' | 'fail' per axios.put call
    const ctx = {
        process: { env: { LINE_ACCESS_TOKEN: 'tok' } },
        console: { log() {}, error() {} },
        io: { emit() {} },
        addLog: (type, message) => logs.push({ type, message }),
        axios: {
            put: async (url, body) => {
                puts.push(body.endpoint);
                if ((plan.shift() || 'fail') === 'ok') return { data: {} };
                const e = new Error('Request failed with status code 400');
                e.response = { status: 400, data: { message: 'Invalid webhook endpoint URL' } };
                throw e;
            },
            post: async () => ({ data: { success: true } })
        },
        Date,
        setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false, done: false, unref() {} }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.cleared = true; }
    };
    vm.createContext(ctx);
    vm.runInContext(`var webhookRetryRound = 0, webhookRetryTimer = null, currentPublicUrl = '${URL1}', activeTunnelType = 'Cloudflare Quick Tunnel';
        var webhookSyncStatus = { synced: false, url: null, error: null, lastTested: null, testResult: null };`, ctx);
    ['WEBHOOK_RESYNC_INTERVAL_MS', 'WEBHOOK_RESYNC_SLOW_AFTER_ROUNDS', 'WEBHOOK_RESYNC_SLOW_INTERVAL_MS'].forEach(c => vm.runInContext(grabConst(src, c), ctx));
    vm.runInContext(cut('scheduleWebhookResync'), ctx);
    vm.runInContext(cut('updateLineWebhookEndpoint'), ctx);

    /** run an update to completion: only the short internal waits (<= 3 s) are fast-forwarded, the 60 s retry timer is left pending */
    async function runUpdate(...args) {
        let finished = false;
        const p = ctx.updateLineWebhookEndpoint(...args).then(() => { finished = true; }, () => { finished = true; });
        while (!finished) {
            await new Promise(r => setImmediate(r));
            const t = timers.find(x => !x.cleared && !x.done && x.ms <= 3000);
            if (t) { t.done = true; t.fn(); }
        }
        await p;
    }
    const pendingRetry = () => timers.filter(t => !t.cleared && !t.done && t.ms >= 60000);
    /** fast-forward only the short internal waits (2.5 s before the call, 3 s between attempts) until nothing short is pending */
    async function pumpShort() {
        for (let i = 0; i < 40; i++) {
            await new Promise(r => setImmediate(r));
            const t = timers.find(x => !x.cleared && !x.done && x.ms <= 3000);
            if (t) { t.done = true; t.fn(); i = 0; }
        }
    }
    async function fireRetry() { const t = pendingRetry()[0]; assert.ok(t, 'a retry timer is pending'); t.done = true; t.fn(); await pumpShort(); }
    return { ctx, logs, timers, puts, plan, runUpdate, pendingRetry, fireRetry };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test('first round fails 3 times: ONE error log naming the url, tunnel and HTTP status, and a 1-minute retry is scheduled', async () => {
    const e = makeEnv();
    await e.runUpdate(URL1);
    assert.equal(e.puts.length, 3, 'tried 3 times like before');
    assert.deepEqual(e.puts, [URL1 + '/webhook', URL1 + '/webhook', URL1 + '/webhook']);
    const errors = e.logs.filter(l => l.type === 'ERROR');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /Invalid webhook endpoint URL/);
    assert.match(errors[0].message, /HTTP 400/);
    assert.ok(errors[0].message.includes('Cloudflare Quick Tunnel'), 'tunnel type is in the message');
    assert.ok(errors[0].message.includes(URL1 + '/webhook'), 'the url sent to LINE is in the message');
    assert.equal(e.ctx.webhookSyncStatus.synced, false);
    const retry = e.pendingRetry();
    assert.equal(retry.length, 1);
    assert.equal(retry[0].ms, 60 * 1000);
});

test('the retry runs by itself: another failure is only a WARN (no repeated ERROR flood), then success clears everything', async () => {
    const e = makeEnv();
    await e.runUpdate(URL1);                        // round 0: 3 failures
    e.plan.push('fail');                            // retry #1 fails
    await e.fireRetry(); await settle();
    assert.equal(e.logs.filter(l => l.type === 'ERROR').length, 1, 'still just the first ERROR');
    assert.equal(e.logs.filter(l => l.type === 'WARN').length, 1);
    assert.match(e.logs.filter(l => l.type === 'WARN')[0].message, /รอบที่ 1/);
    assert.equal(e.pendingRetry().length, 1, 'next retry scheduled');

    e.plan.push('ok');                              // retry #2 succeeds
    await e.fireRetry(); await settle();
    assert.equal(e.ctx.webhookSyncStatus.synced, true);
    const ok = e.logs.filter(l => l.type === 'SUCCESS');
    assert.ok(ok.some(l => /รอบที่ 2/.test(l.message) && l.message.includes(URL1 + '/webhook')), 'success after retries is logged');
    assert.equal(e.pendingRetry().length, 0, 'no more retries once bound');
    assert.equal(e.ctx.webhookRetryRound, 0);
});

test('retry stops when the tunnel already got a new URL, or when someone bound it manually', async () => {
    const a = makeEnv();
    await a.runUpdate(URL1);
    const callsBefore = a.puts.length;
    a.ctx.currentPublicUrl = 'https://other.trycloudflare.com';   // tunnel restarted with a new url
    await a.fireRetry(); await settle();
    assert.equal(a.puts.length, callsBefore, 'no request for the stale url');
    assert.equal(a.pendingRetry().length, 0);

    const b = makeEnv();
    await b.runUpdate(URL1);
    const before = b.puts.length;
    b.ctx.webhookSyncStatus.synced = true;                         // merchant pressed the test button and it worked
    await b.fireRetry(); await settle();
    assert.equal(b.puts.length, before);
    assert.equal(b.pendingRetry().length, 0);
});

test('after 30 rounds the retry slows down to every 5 minutes', () => {
    const e = makeEnv();
    e.ctx.webhookRetryRound = 29;
    vm.runInContext(`scheduleWebhookResync('${URL1}')`, e.ctx);
    assert.equal(e.pendingRetry()[0].ms, 60 * 1000);
    e.ctx.webhookRetryRound = 30;
    vm.runInContext(`scheduleWebhookResync('${URL1}')`, e.ctx);
    const last = e.timers[e.timers.length - 1];
    assert.equal(last.ms, 5 * 60 * 1000);
});

test('without a LINE token nothing is retried (nothing to retry with)', async () => {
    const e = makeEnv();
    e.ctx.process.env.LINE_ACCESS_TOKEN = '';
    await e.runUpdate(URL1);
    assert.equal(e.puts.length, 0);
    assert.equal(e.pendingRetry().length, 0);
});


