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
async function firstTransferKeyed(sb, amount = 140) {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
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
