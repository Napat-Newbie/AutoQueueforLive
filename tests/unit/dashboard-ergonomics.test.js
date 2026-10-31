// tests/unit/dashboard-ergonomics.test.js
// v1.0.16 dashboard ergonomics. Real functions are cut out of public/index.html and run in a vm (no DOM needed),
// plus a few static guards for things that cannot be unit-run (panel not frozen, no external sound file, reconnect re-sync).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

function grab(name) {   // functions are indented inside <script>: cut by balanced braces
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing from index.html`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}
const ctx = { socket: {} };
vm.createContext(ctx);
['tunnelHealthVerdict', 'queueWaitInfo', 'formatWaitText', 'formatAgo', 'buildReadinessRows'].forEach(n => vm.runInContext(grab(n), ctx));
const rows = (inp) => ctx.buildReadinessRows(inp);
const byKey = (r, k) => r.find(x => x.key === k);

test('tunnel health: down / not synced are critical, healthy or unknown-sync is fine', () => {
    assert.equal(ctx.tunnelHealthVerdict(null).bad, true);
    assert.equal(ctx.tunnelHealthVerdict({ active: false }).kind, 'down');
    // owner 2026-11-01: merchant wording, no "Tunnel"
    assert.match(ctx.tunnelHealthVerdict({ active: false }).message, /ระบบเชื่อมต่อ LINE หลุด/);
    assert.doesNotMatch(ctx.tunnelHealthVerdict({ active: false }).message, /Tunnel|ท่อสัญญาณ/);
    assert.equal(ctx.tunnelHealthVerdict({ active: true, synced: false }).kind, 'sync');
    assert.equal(ctx.tunnelHealthVerdict({ active: true, synced: true }).bad, false);
    assert.equal(ctx.tunnelHealthVerdict({ active: true }).bad, false, 'sync state unknown is not an alarm');
});

test('queueWaitInfo: Bangkok time (UTC+7) to epoch, shows HH:MM; bad input -> null', () => {
    const w = ctx.queueWaitInfo('20261029', '14:05:30');
    assert.equal(w.hhmm, '14:05');
    assert.equal(w.ts, Date.UTC(2026, 9, 29, 7, 5, 30), '14:05:30 Bangkok = 07:05:30 UTC');
    assert.equal(ctx.queueWaitInfo('20261029', '9:07').hhmm, '09:07');
    assert.equal(ctx.queueWaitInfo(undefined, '14:05'), null);
    assert.equal(ctx.queueWaitInfo('20261029', ''), null);
});

test('formatWaitText / formatAgo wording', () => {
    assert.equal(ctx.formatWaitText(0), 'เพิ่งโอน');
    assert.equal(ctx.formatWaitText(7), 'รอ 7 นาที');
    assert.equal(ctx.formatWaitText(75), 'รอ 1 ชม. 15 นาที');
    assert.equal(ctx.formatWaitText(-1), '');
    assert.equal(ctx.formatAgo(20 * 1000), 'เมื่อสักครู่');
    assert.equal(ctx.formatAgo(5 * 60000), '5 นาทีที่แล้ว');
    assert.equal(ctx.formatAgo(125 * 60000), '2 ชม. 5 นาทีที่แล้ว');
});

test('readiness checklist: everything fine -> five green rows', () => {
    const r = rows({
        tunnel: { active: true, synced: true },
        quota: { success: true, provider: 'slipok', remaining: 200, used: 50, limit: 250, overQuota: 0 },
        merge: { success: true, pending: false }, balances: { success: true, count: 0 }, socketConnected: true
    });
    assert.equal(r.length, 5);
    assert.deepEqual(Array.from(r, x => x.level), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('readiness checklist: tunnel down / quota empty / socket lost are red, low quota + balances are yellow, merge is info', () => {
    const r = rows({
        tunnel: { active: false },
        quota: { success: true, provider: 'slipok', remaining: 0, used: 250, limit: 250, overQuota: 0 },
        merge: { success: true, pending: true, customers: 3 },
        balances: { success: true, count: 2, total: 150, list: [{ name: 'Alice', balance: 100 }, { name: 'Bob', balance: 50 }] },
        socketConnected: false
    });
    assert.equal(byKey(r, 'tunnel').level, 'bad');
    assert.equal(byKey(r, 'quota').level, 'bad');
    assert.equal(byKey(r, 'merge').level, 'info');
    assert.match(byKey(r, 'merge').detail, /3 คน/);
    assert.equal(byKey(r, 'balances').level, 'warn');
    assert.match(byKey(r, 'balances').detail, /Alice: 100 บาท/);
    assert.match(byKey(r, 'balances').detail, /รีเซ็ตเป็น 0/);
    assert.equal(byKey(r, 'socket').level, 'bad');

    const low = rows({ tunnel: { active: true, synced: true }, quota: { success: true, provider: 'slipok', remaining: 8, used: 242, limit: 250, overQuota: 0 }, merge: { success: true, pending: false }, balances: { success: true, count: 0 }, socketConnected: true });
    assert.equal(byKey(low, 'quota').level, 'warn');
    const other = rows({ tunnel: { active: true }, quota: { success: true, provider: 'easyslip', status: 'exhausted' }, merge: null, balances: null, socketConnected: true });
    assert.equal(byKey(other, 'quota').level, 'bad');
    assert.equal(byKey(other, 'merge').level, 'warn', 'a failed check is shown as a warning, never silently skipped');
    assert.equal(byKey(other, 'balances').level, 'warn');
});

test('static guards: control panel NOT frozen (v1.0.17), no external sound file, queue numbering, reconnect re-sync, shutdown guard', () => {
    assert.ok(!/\.live-control-panel\s*\{[^}]*position:\s*sticky/.test(html), 'v1.0.17: the top control panel is not frozen any more');
    assert.ok(!html.includes('mixkit'), 'no sound file may be fetched from the internet');
    assert.match(html, /:not\(\.topup-card\):not\(\.pending-amount-card\)/, 'cards waiting for the amount take no queue number');
    const connectBlock = html.slice(html.indexOf('__socketEverConnected = false'), html.indexOf('__socketEverConnected = true;') + 40);
    assert.match(connectBlock, /loadLiveStatsIfLive\(\)/, 'reconnect reloads the queue');
    assert.match(connectBlock, /fetchLiveSessionStatus\(\)/);
    const shutdown = grab('confirmShutdownApp');
    assert.match(shutdown, /\/api\/live_session\/current/, 'shutdown first checks whether a live is running');
    assert.match(grab('performShutdown'), /force:\s*!!force/);
});
