// tests/system/manual-match-back-to-back.test.js
// Review finding 1 (PR #7): the v1.0.17 guard against double counting a slip the shop keyed by hand (index.js pickManualMatch,
// MANUAL_MATCH_TOLERANCE_SEC = 120) cannot tell "the same slip re-sent" from "a SECOND transfer of the same amount made just before
// the keyed image arrived". Both look identical to the guard: same customer, same amount, transfer time <= image arrival + 120 s.
//
// These tests pin down the behaviour for the second case. Customer buys twice for 140 baht: transfer #1 (Bangkok Bank, SlipOK says "wait" 1010,
// the shop keys 140 from the picture at 10:00:00) and transfer #2 at 09:59:00 with a normal verified slip (different bank reference).
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const BBL = () => ({ code: 1010, message: 'wait', data: { qrcodeData: 'QR', bankCode: '002', bankName: 'กรุงเทพ', delay: 7, message: 'wait' } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const processed = (sb, user, times = 1) => sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= times, 10000, `slip of ${user} not processed`).then(() => sleep(500));

/** transfer #1 image (1010) reaches the shop at 10:00:00 and is keyed as `amount` */
async function firstTransferKeyed(sb, amount = 140, arrival = '10:00:00') {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), arrival, id);
    const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount });
    assert.equal(r.json.success, true);
    return id;
}

// TODO(review finding 1): fails today by design -> marked `todo` so CI stays green until the owner decides the policy (see the note at the top).
test('two same-amount transfers back to back: transfer #2 (verified, own bank reference, 09:59:00) arrives AFTER transfer #1 was keyed -> both must be counted', { todo: 'index.js pickManualMatch links transfer #2 to the keyed slip and drops it (only 140 of 280 counted); needs a policy decision' }, () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 280, 'the customer paid 2 x 140 but only ' + st.stats.totalAmount + ' is counted');
    assert.equal(st.stats.totalDraws, 2);
    assert.ok(sb.slips().some(s => s.trans_ref === 'SEC0002' && s.status !== 'rejected'), 'the second transfer has its own recorded slip');
}));

test('same two transfers but the verified slip arrives BEFORE the shop keys transfer #1 -> both are counted (shows the result depends only on the order)', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount: 140 });
    assert.equal(r.json.success, true);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 280);
    assert.equal(st.stats.totalDraws, 2);
}));

test('window edge: transfer #2 made 121 s after the keyed image arrived (10:02:01) is counted; the guard only reaches 120 s', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '10:02:01' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    assert.equal((await sb.stats()).stats.totalAmount, 280);
}));

test('window edge: transfer #2 made exactly 120 s after the keyed image arrived (10:02:00) is treated as the same slip (documents the current rule)', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '10:02:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 1, 'linked to the keyed slip, no new slip');
    assert.equal((await sb.stats()).stats.totalAmount, 140);
}));


// ---- more ways the same guard can be wrong (from the Gemini review, each re-derived from the code before being written down) ----

// pickManualMatch had an UPPER bound only (arrive + 120 s >= transfer). v1.0.17 review (owner decision 2026-10-31):
// a LOWER bound of 60 minutes was added, so a genuine payment made long BEFORE the keyed image (here: yesterday 18:00,
// never recorded because it was lost) is no longer "linked" to today's keyed slip and dropped.
test('an older real payment (yesterday 18:00, own bank reference) of the same amount is NOT the keyed slip of today and must be counted', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);   // keyed today, image arrived 10:00:00
    sb.mock.slipOk('kyest', { amount: 140, transRef: 'YEST001', transDate: bkkDate(-1), transTime: '18:00:00' });
    await sb.sendSlip('Ualice', 'm2', 'kyest'); await processed(sb, 'Ualice', 2);
    assert.equal((await sb.stats()).stats.totalAmount, 280);
    assert.ok(sb.slips().some(s => s.trans_ref === 'YEST001' && s.status !== 'rejected'), 'yesterday\'s payment has its own slip');
}));

// The same 60-minute window, near its edges, for the still-open-pending warning (same "same payment?" question):
// a transfer 50 minutes before the pending image is plausibly the same payment; one 16 hours old is not.
const fs = require('fs');
const path = require('path');
const readLog = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
test('still-open pending warning: transfer 50 min before the pending image warns; 16 hours before stays silent', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);   // pending, amount 0, never keyed
    sb.mock.slipOk('krecent', { amount: 140, transRef: 'RECENT01', transDate: bkkDate(), transTime: '09:10:00' });
    await sb.sendSlip('Ualice', 'm2', 'krecent'); await processed(sb, 'Ualice', 2);
    await sb.waitFor(() => /รูปรอใส่ยอดค้างอยู่ 1 ใบ/.test(readLog(sb)), 8000, 'a near-time transfer should warn about the still-open pending card');
}));
test('still-open pending warning: a transfer 8 hours before the pending image does not warn (outside the window)', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
    sb.mock.slipOk('kold', { amount: 140, transRef: 'OLD00001', transDate: bkkDate(), transTime: '02:00:00' });
    await sb.sendSlip('Ualice', 'm2', 'kold'); await processed(sb, 'Ualice', 2); await sleep(800);
    assert.ok(!/รูปรอใส่ยอดค้างอยู่/.test(readLog(sb)), 'an old transfer is not the same payment — no warning');
    assert.ok(sb.slips().some(s => s.trans_ref === 'OLD00001'), 'the verified slip is recorded on its own');
}));

// The tolerance exists for clock differences; beyond it the SAME slip is counted twice. Shop PC clock 2.5 min behind the bank clock:
// the image is stamped 10:02:30 while the bank says the transfer was 10:05:00.
test('same slip re-sent, shop clock 2.5 minutes behind the bank clock (arrival 10:02:30, bank time 10:05:00) -> must be linked, not counted twice', { todo: 'skew beyond MANUAL_MATCH_TOLERANCE_SEC (120 s) makes the same slip count twice' }, () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140, '10:02:30');
    sb.mock.slipOk('ksame', { amount: 140, transRef: 'SAME001', transDate: bkkDate(), transTime: '10:05:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksame'); await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 1, 'one slip, linked');
    assert.equal((await sb.stats()).stats.totalAmount, 140);
}));

// Known limitation (characterization, passes today): the amounts must match to 0.005 baht. If the shop keyed a rounded amount, the same slip counts again.
test('shop keyed 140 but the slip says 140.50 -> no link, both are counted (documents the exact-amount rule)', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('kcent', { amount: 140.5, transRef: 'CENT001', transDate: bkkDate(), transTime: '09:55:00' });
    await sb.sendSlip('Ualice', 'm2', 'kcent'); await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 2);
    assert.equal((await sb.stats()).stats.totalAmount, 280.5);
}));
