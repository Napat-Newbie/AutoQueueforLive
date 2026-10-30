// tests/system/slipok-codes.test.js
// v1.0.17: SlipOK code 1010 (Bangkok Bank slips need ~7 minutes), mis-read quota codes, and double counting between a slip the shop keyed by hand and the same
// slip verified later. Runs the real index.js in a sandbox with the fake SlipOK / LINE (tests/harness).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox, bkkDate } = require('../harness/sandbox');
const { connectEvents } = require('../harness/sio-poll');

const BBL = (delay = 7) => ({ code: 1010, message: 'รอ', data: { qrcodeData: 'QR', bankCode: '002', bankName: 'กรุงเทพ', delay, message: 'รอ' } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const processed = (sb, user, times = 1) => sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= times, 10000, `slip of ${user} not processed`).then(() => sleep(500));
const logText = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
const DEVREPORT = { DISCORD_DEVREPORT_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz' };

/** the Bangkok Bank customer sends the slip (SlipOK says "wait"), the shop keys the amount at 10:00:00 */
async function bblThenKeyed(sb, amount = 140) {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
    const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount });
    assert.equal(r.json.success, true);
    return id;
}

test('1010: the slip is kept as a waiting card that names the bank and the minutes; log is WARN, not an ERROR about credit; no dev-report', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        sb.mock.profile('Ualice', 'Alice');
        sb.mock.slips.set('kbbl', { status: 400, body: BBL(7) });
        await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(600);
        const row = sb.slips()[0];
        assert.equal(row.amount, 0); assert.match(row.qr_payload, /^manual_image/);
        const card = (await sb.stats()).queues.waiting[0];
        assert.equal(card.isPendingAmount, true);
        assert.equal(card.bankDelay.bankName, 'กรุงเทพ'); assert.equal(card.bankDelay.delay, 7); assert.equal(typeof card.bankDelay.at, 'number');
        const e = ev.named('pending_amount_slip')[0];
        assert.ok(e, 'screen is told'); assert.equal(e.data.bankName, 'กรุงเทพ'); assert.equal(e.data.delay, 7);
        await sb.waitFor(() => /Code 1010/.test(logText(sb)), 8000, 'no 1010 line in system.log');
        const log = logText(sb);
        assert.match(log, /\[WARN\][^\n]*Code 1010/);
        assert.ok(!/วงเงินเครดิต SlipOK หมด/.test(log), 'the misleading "credit used up" text is gone');
        assert.equal((await sb.get('/api/provider/quota')).json.status, 'ok', 'not treated as quota exhaustion');
        assert.equal(ev.named('provider_quota_alert').length, 0);
        assert.equal(sb.mock.replies.length, 0, 'nothing is sent to the customer');
    } finally { ev.close(); }
}, undefined, DEVREPORT));

test('1010 repeated 6 times does not reach the dev-report channel at all (no false "ขออัปเดตเวอร์ชันใหม่")', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    for (let i = 1; i <= 6; i++) await sb.sendSlip('Ualice', 'm' + i, 'kbbl');
    await sb.waitForSlips(6); await sleep(1500);
    assert.equal(sb.mock.discords.filter(d => /SlipOK|เครดิต|ขออัปเดต/.test(JSON.stringify(d))).length, 0);
}, undefined, DEVREPORT));

test('shop keys the amount, then the customer re-sends the same slip and it verifies: ONE payment is counted, the slip is linked', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        const id = await bblThenKeyed(sb, 140);
        sb.mock.slipOk('kbbl', { amount: 140, transRef: 'BBL0001', transDate: bkkDate(), transTime: '09:55:00' });   // transferred BEFORE the image arrived at 10:00:00
        await sb.sendSlip('Ualice', 'm1b', 'kbbl'); await processed(sb, 'Ualice', 2);
        const rows = sb.slips();
        assert.equal(rows.length, 1, 'no second slip was created');
        assert.equal(rows[0].trans_ref, 'BBL0001', 'the keyed slip now carries the bank reference');
        const st = await sb.stats();
        assert.equal(st.stats.totalAmount, 140); assert.equal(st.stats.totalDraws, 1);
        assert.equal(st.imageFails.length, 1, 'the shop is told');
        assert.match(st.imageFails[0].reason, /ไม่นับยอดซ้ำ/);
        assert.equal(ev.named('slip_warning').filter(w => w.data.kind === 'duplicate').length, 1);
        // a third send of the same slip is just the normal duplicate check now
        await sb.sendSlip('Ualice', 'm1c', 'kbbl'); await processed(sb, 'Ualice', 3);
        assert.equal(sb.slips().length, 1);
        assert.equal((await sb.stats()).stats.totalAmount, 140);
        assert.ok(id > 0);
    } finally { ev.close(); }
}));

test('a genuinely NEW payment of the same amount (transferred after the first image was sent) is still counted', () => withSandbox(async sb => {
    await bblThenKeyed(sb, 140);
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slipOk('knew', { amount: 140, transRef: 'NEW0002', transDate: bkkDate(), transTime: '10:30:00' });   // 30 minutes after
    await sb.sendSlip('Ualice', 'm2', 'knew'); await sb.waitForSlips(2); await sleep(500);
    const st = await sb.stats();
    assert.equal(sb.slips().length, 2);
    assert.equal(st.stats.totalAmount, 280); assert.equal(st.stats.totalDraws, 2);
    assert.equal(st.imageFails.length, 0, 'no warning for a real second payment');
}));

test('a different amount is never linked to the keyed slip', () => withSandbox(async sb => {
    await bblThenKeyed(sb, 140);
    sb.mock.slipOk('kother', { amount: 200, transRef: 'OTH0003', transDate: bkkDate(), transTime: '09:50:00' });
    await sb.sendSlip('Ualice', 'm3', 'kother'); await sb.waitForSlips(2); await sleep(500);
    assert.equal((await sb.stats()).stats.totalAmount, 340);
}));

test('the waiting card is NOT keyed yet and the same customer sends a verified slip: the slip is recorded, the shop is warned not to key the old card too', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        sb.mock.profile('Ualice', 'Alice');
        sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
        await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
        sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', sb.slips()[0].id);
        sb.mock.slipOk('kbbl', { amount: 140, transRef: 'BBL0009', transDate: bkkDate(), transTime: '09:56:00' });
        await sb.sendSlip('Ualice', 'm1b', 'kbbl'); await sb.waitForSlips(2); await sleep(600);
        const w = ev.named('slip_warning').filter(x => x.data.kind === 'check_pending');
        assert.equal(w.length, 1); assert.match(w[0].data.reason, /ปัดตกการ์ดเก่า/);
        assert.equal(sb.slips().filter(s => s.trans_ref === 'BBL0009').length, 1, 'verified slip recorded');
        assert.equal((await sb.stats()).queues.waiting.filter(q => q.isPendingAmount).length, 1, 'the old waiting card is left for the shop to decide');
    } finally { ev.close(); }
}));

test('bad image (1008) / bank outage (1009) no longer flip the app to "credit exhausted": the next normal slip is still verified automatically', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        for (const [i, code] of [[1, 1008], [2, 1009], [3, 1006]]) {
            sb.mock.profile('Ux' + i, 'X' + i);
            sb.mock.slips.set('k' + code, { status: 400, body: { code, message: 'm' } });
            await sb.sendSlip('Ux' + i, 'mx' + i, 'k' + code);
        }
        await sb.waitForSlips(3); await sleep(800);
        assert.equal((await sb.get('/api/provider/quota')).json.status, 'ok');
        assert.equal(ev.named('provider_quota_alert').length, 0);
        sb.mock.profile('Ucarol', 'Carol'); sb.mock.slipOk('kok', { amount: 140, transRef: 'OK0001' });
        await sb.sendSlip('Ucarol', 'mok', 'kok'); await sb.waitForSlips(4); await sleep(400);
        const carol = sb.slips().find(s => s.line_name === 'Carol');
        assert.equal(carol.trans_ref, 'OK0001', 'verified automatically, not sent to the manual queue');
    } finally { ev.close(); }
}));

test('SlipOK says package over quota (1004): that one IS credit exhausted -> red banner event', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        sb.mock.profile('Ux', 'X'); sb.mock.slips.set('kq', { status: 400, body: { code: 1004, message: 'over' } });
        await sb.sendSlip('Ux', 'mq', 'kq'); await sb.waitForSlips(1);
        await sb.waitFor(() => ev.named('provider_quota_alert').length >= 1, 6000, 'no quota alert for code 1004');
    } finally { ev.close(); }
}));
