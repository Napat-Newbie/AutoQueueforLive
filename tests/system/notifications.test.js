// tests/system/notifications.test.js
// Owner request 2026-10-31: notifications must be SAVED (shop database, kept forever) — not a 20-item list in the
// browser tab that is gone after the live / a reload — and shown in a panel on the right of the dashboard.
// The server records every notifying event itself (even when no dashboard is open), keeps them in the
// `notifications` table, serves them at GET /api/notifications and pushes new ones as socket event 'notification'.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');
const { connectEvents } = require('../harness/sio-poll');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const notifs = async (sb, q = '') => (await sb.get('/api/notifications' + q)).json;
const sendText = (sb, user, id, text) => sb.webhook([{ type: 'message', replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id, text } }]);
const slipFor = async (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name); sb.mock.slipOk(key, { amount, transRef: ref });
    await sb.sendSlip(user, msg, key);
};

test('real events are recorded by the server, newest first, with the live round id', () => withSandbox(async sb => {
    const live = await sb.startLive();
    await slipFor(sb, 'Ucarol', 'Carol', 'm1', 'k1', 60, 'NOTI0001'); await sb.waitForSlips(1);          // not enough -> topup_needed
    sb.mock.profile('Ubob', 'Bob'); sb.mock.slipUnreadable('ku'); await sb.sendSlip('Ubob', 'm2', 'ku'); await sb.waitForSlips(2);   // pending_amount_slip
    await slipFor(sb, 'Ualice', 'Alice', 'm3', 'k3', 140, 'NOTI0003'); await sb.waitForSlips(3);
    await slipFor(sb, 'Ueve', 'Eve', 'm4', 'k3', 140, 'NOTI0003');                                         // same slip by another customer -> slip_warning duplicate
    await sendText(sb, 'Ualice', 't1', 'สมหญิง รักดี\n99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678');   // address_updated
    const got = await sb.waitFor(async () => { const r = await notifs(sb); return r.items && r.items.length >= 4 ? r : null; }, 10000, 'notifications not recorded');
    assert.equal(got.success, true);
    const items = got.items;
    const ids = items.map(n => n.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'newest first');
    const find = (re) => items.find(n => re.test(n.text));
    const topup = find(/Carol โอนไม่ครบ ต้องโอนเพิ่มอีก 80 บาท/);
    assert.ok(topup, 'top-up needed'); assert.equal(topup.kind, 'warn');
    const pend = find(/Bob ส่งสลิปที่ระบบอ่านยอดไม่ได้/);
    assert.ok(pend, 'waiting-for-amount card'); assert.equal(pend.kind, 'warn');
    const dup = items.find(n => n.title === '⚠️ สลิปซ้ำ');
    assert.ok(dup, 'duplicate slip'); assert.equal(dup.kind, 'bad', 'money that is NOT recorded is urgent (red)'); assert.match(dup.text, /Eve/);
    const addr = await sb.waitFor(async () => (await notifs(sb)).items.find(n => /อัปเดตที่อยู่จัดส่งแล้ว/.test(n.text)), 8000, 'address notification missing');
    assert.equal(addr.kind, 'ok');
    assert.equal(topup.sessionId, live.session.id, 'tagged with the live round');
    assert.ok(Number.isFinite(topup.t) && topup.t > Date.now() - 60000, 'has a real timestamp');
}));

test('kept after the live ends and the next round starts (stored in the shop database, not the browser)', () => withSandbox(async sb => {
    await sb.startLive();
    await slipFor(sb, 'Ucarol', 'Carol', 'm1', 'k1', 60, 'KEEP0001'); await sb.waitForSlips(1);
    await sb.waitFor(async () => (await notifs(sb)).items.some(n => /Carol โอนไม่ครบ/.test(n.text)), 8000, 'not recorded');
    await sb.endLive();
    await sb.startLive();
    const after = await notifs(sb);
    assert.ok(after.items.some(n => /Carol โอนไม่ครบ/.test(n.text)), 'still there after end + new live');
    const rows = sb.sql("SELECT kind, text FROM notifications WHERE text LIKE '%Carol%'");
    assert.ok(rows.length >= 1, 'the row is in the notifications table');
}));

test('dashboard-originated notification (tunnel down) is recorded once per minute and pushed to every open dashboard', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        const body = { kind: 'bad', text: 'ระบบเชื่อมต่อ LINE หลุด — ลูกค้าส่งสลิปตอนนี้อาจไม่เข้า', source: 'tunnel' };
        const r1 = await sb.post('/api/notifications', body);
        assert.equal(r1.json.success, true);
        const r2 = await sb.post('/api/notifications', body);
        assert.equal(r2.json.success, true);
        const items = (await notifs(sb)).items.filter(n => n.text === body.text);
        assert.equal(items.length, 1, 'the same text within a minute is stored once');
        await sb.waitFor(() => ev.named('notification').some(e => e.data && e.data.text === body.text), 5000, 'no socket push');
        const bad = await sb.post('/api/notifications', { kind: 'nonsense', text: 'x' });
        assert.equal(bad.status, 400, 'unknown kind rejected');
    } finally { ev.close(); }
}));

test('paging ("ดูย้อนหลังเพิ่ม") and the "เฉพาะเรื่องสำคัญ" filter', () => withSandbox(async sb => {
    for (let i = 1; i <= 60; i++) sb.exec('INSERT INTO notifications (created_at, kind, title, text, source, session_id) VALUES (?, ?, ?, ?, ?, ?)', Date.now() - (100 - i) * 1000, i % 3 === 0 ? 'ok' : 'warn', '', `ทดสอบ ${i}`, 'test', null);
    const page1 = await notifs(sb, '?limit=50');
    assert.equal(page1.items.length, 50);
    assert.equal(page1.hasMore, true);
    const page2 = await notifs(sb, `?limit=50&before=${page1.items[49].id}`);
    assert.equal(page2.items.length, 10);
    assert.equal(page2.hasMore, false);
    assert.equal(new Set([...page1.items, ...page2.items].map(n => n.id)).size, 60, 'no overlap, nothing missing');
    const important = await notifs(sb, '?limit=100&important=1');
    assert.ok(important.items.length === 40 && important.items.every(n => n.kind === 'warn' || n.kind === 'bad'));
}));
