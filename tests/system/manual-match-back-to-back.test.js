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

/** transfer #1 image (1010) reaches the shop at 10:00:00 and is keyed as `amount`. qrRef (optional) simulates a decoded slip-QR reference stored on the row. */
async function firstTransferKeyed(sb, amount = 140, arrival = '10:00:00', qrRef = null) {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), arrival, id);
    if (qrRef) sb.exec('UPDATE slips SET qr_ref = ? WHERE id = ?', qrRef, id);
    const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount });
    assert.equal(r.json.success, true);
    return id;
}

// Owner decision 2026-10-31 ("ปิดรูรั่ว", after seeing this very todo): the DEFAULT stays safe — transfer #2 is still
// linked to the keyed slip (140 counted, no auto double count, because without the real-key QR experiment the guard
// cannot tell "same slip re-sent" from "a second transfer", HANDOFF §4). What changed: the dropped payment is no longer
// a 12-second toast — the merchant gets a persistent confirmation card (full_sync `manualMatches`) and ONE-TAP recovery:
//   POST /api/queue/manual_match_count_second  = "it really was a second transfer" (records it, 280 counted)
//   POST /api/queue/manual_match_dismiss       = "it was the same slip re-sent" (keeps 140, card closes)
test('back-to-back second transfer: default stays linked (140, no auto double count) and the merchant sees an actionable confirmation card', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140, 'safe default: linked as one slip, nothing counted twice');
    assert.ok(Array.isArray(st.manualMatches) && st.manualMatches.length === 1, 'an actionable confirmation card exists');
    const m = st.manualMatches[0];
    assert.equal(m.transRef, 'SEC0002');
    assert.equal(Number(m.amount), 140);
}));

test('back-to-back second transfer: one-tap "count the second transfer" records it (280 / 2 draws, own slip row) and cannot be pressed twice', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const matchId = (await sb.stats()).manualMatches[0].id;
    const r = await sb.post('/api/queue/manual_match_count_second', { matchId });
    assert.equal(r.json.success, true);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 280, 'the customer paid 2 x 140 and both are counted now');
    assert.equal(st.stats.totalDraws, 2);
    assert.ok(sb.slips().some(s => s.trans_ref === 'SEC0002' && s.status !== 'rejected'), 'the second transfer has its own recorded slip');
    const keyed = sb.slips().find(s => (s.qr_payload || '').startsWith('manual_image'));
    assert.ok(keyed && !keyed.trans_ref, 'the keyed slip (transfer #1) no longer carries the second transfer reference');
    assert.equal(st.manualMatches.length, 0, 'the confirmation card is gone after the decision');
    const again = await sb.post('/api/queue/manual_match_count_second', { matchId });
    assert.equal(again.status, 404, 'pressing again finds no card — idempotent');
    assert.equal((await sb.stats()).stats.totalAmount, 280, 'nothing extra was counted');
}));

test('back-to-back second transfer: dismissing as "same slip re-sent" keeps 140 and closes the card', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const matchId = (await sb.stats()).manualMatches[0].id;
    const d = await sb.post('/api/queue/manual_match_dismiss', { matchId });
    assert.equal(d.json.success, true);
    const after = await sb.stats();
    assert.equal(after.stats.totalAmount, 140, 'dismiss = the old behaviour stands (one slip, 140)');
    assert.equal(after.stats.totalDraws, 1);
    assert.equal(after.manualMatches.length, 0, 'card closed');
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

// v1.0.18 (owner decision 2026-10-31 "close the leak" + the owner-key experiment the same evening):
// the slip-QR sub-tag 02 IS the transaction identity (proven: KTB slip's QR ref == the transRef SlipOK
// returned, byte for byte). So when the keyed row carries a qr_ref, matching is done BY REFERENCE and the
// time window no longer matters — this closes the old clock-skew limitation documented below.
// The tolerance exists for clock differences; beyond it the SAME slip used to be counted twice. Shop PC clock
// 2.5 min behind the bank clock: the image is stamped 10:02:30 while the bank says the transfer was 10:05:00.
test('same slip re-sent, shop clock 2.5 minutes behind the bank clock (arrival 10:02:30, bank time 10:05:00) -> linked BY QR REFERENCE, not counted twice', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140, '10:02:30', 'SAME001');   // 270 s of skew — far outside the 120 s window
    sb.mock.slipOk('ksame', { amount: 140, transRef: 'SAME001', transDate: bkkDate(), transTime: '10:05:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksame'); await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 1, 'one slip, linked by reference');
    assert.equal((await sb.stats()).stats.totalAmount, 140);
}));

// Review 2026-10-31 19:17 (owner: "แก้ความเสี่ยงก่อน"): a DIFFERENT qr_ref is NOT proof of a different payment.
// "QR sub-tag 02 == transRef" was proven on ONE KTB slip only; for BBL / SCB the two were never compared (those test
// slips never returned 200), and the BBL QR sub-tag (date + time + digits) may never equal SlipOK's transRef for the
// SAME slip. Treating "not equal" as "another payment" then double-counts exactly the case this guard exists for:
// BBL 1010 -> the shop keys the amount -> the customer re-sends the same picture after the bank delay.
// So only EQUALITY is used as proof; a differing / incomparable reference keeps the safe default (linked, one slip,
// persistent confirmation card with one-tap "count the second transfer").
test('REAL BBL flow: 1010 stores the QR ref, shop keys 140, the SAME picture is re-sent and SlipOK answers a differently-shaped transRef -> NOT counted twice, card shown', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    // the real Bangkok Bank slip QR captured in the owner-key experiment (tests/unit/qr-ref.test.js)
    sb.mock.slips.set('kbblreal', { status: 400, body: { code: 1010, message: 'wait', data: { qrcodeData: '004600060000010103002022520261031140047230057235085102TH910468F0', bankCode: '002', bankName: 'กรุงเทพ', delay: 7 } } });
    await sb.sendSlip('Ualice', 'm1', 'kbblreal'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    assert.equal(sb.slips()[0].qr_ref, '2026103114004723005723508', 'precondition: the pending card got its qr_ref from the 1010 answer');
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
    assert.equal((await sb.post('/api/queue/manual_amount', { slipId: id, amount: 140 })).json.success, true);
    // same picture after the delay: SlipOK now verifies it. Its transRef format for BBL is UNKNOWN (never captured);
    // anything not byte-equal to the QR sub-tag must not be read as "another payment".
    sb.mock.slipOk('kbblreal', { amount: 140, transRef: '016304100047BPM05123', transDate: bkkDate(), transTime: '09:59:30' });
    await sb.sendSlip('Ualice', 'm2', 'kbblreal'); await processed(sb, 'Ualice', 2);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140, 'one picture, one payment: 140 must not become 280');
    assert.equal(st.stats.totalDraws, 1);
    assert.equal(sb.slips().length, 1, 'linked to the keyed slip, no second row');
    assert.equal(st.manualMatches.length, 1, 'the merchant still gets the confirmation card (one tap if it really was a second transfer)');
}));

test('second same-amount transfer INSIDE the window with a DIFFERENT qr_ref -> safe default (linked + card), one tap counts it', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140, '10:00:00', 'FIRST01');
    sb.mock.slipOk('ksecond', { amount: 140, transRef: 'SEC0002', transDate: bkkDate(), transTime: '09:59:00' });
    await sb.sendSlip('Ualice', 'm2', 'ksecond'); await processed(sb, 'Ualice', 2);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140, 'a differing reference is not proof -> not counted automatically');
    assert.equal(st.manualMatches.length, 1, 'confirmation card shown');
    const r = await sb.post('/api/queue/manual_match_count_second', { matchId: st.manualMatches[0].id });
    assert.equal(r.json.success, true);
    const after = await sb.stats();
    assert.equal(after.stats.totalAmount, 280, 'one tap: both transfers counted');
    assert.equal(after.stats.totalDraws, 2);
    assert.ok(sb.slips().some(s => s.trans_ref === 'SEC0002' && s.status !== 'rejected'), 'the second transfer has its own slip row');
}));

// v1.0.18: the pending card stores its slip-QR reference at creation time. SlipOK hands the QR text back for
// free inside the 1010 (bank-delay) answer, so no image decoding is needed in the common case.
test('a 1010 slip whose answer carries real qrcodeData gets its qr_ref stored on the pending card', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kscb', { status: 400, body: { code: 1010, message: 'wait', data: { qrcodeData: '0046000600000101030140225202610039r7bISZu9bair2yQu5102TH91044849', bankCode: '014', bankName: 'ไทยพาณิชย์', delay: 2 } } });
    await sb.sendSlip('Ualice', 'm1', 'kscb'); await sb.waitForSlips(1); await sleep(300);
    const row = sb.slips()[0];
    assert.equal(row.qr_ref, '202610039r7bISZu9bair2yQu', 'the QR sub-tag 02 from the 1010 answer is stored as the row identity');
}));

// Known limitation (characterization, passes today): the amounts must match to 0.005 baht. If the shop keyed a rounded amount, the same slip counts again.
test('shop keyed 140 but the slip says 140.50 -> no link, both are counted (documents the exact-amount rule)', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140);
    sb.mock.slipOk('kcent', { amount: 140.5, transRef: 'CENT001', transDate: bkkDate(), transTime: '09:55:00' });
    await sb.sendSlip('Ualice', 'm2', 'kcent'); await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 2);
    assert.equal((await sb.stats()).stats.totalAmount, 280.5);
}));

// 2026-11-01 (from the first real shop live on v1.0.18): the QR reference proves it is the SAME transfer, but if the
// merchant keyed a different amount than the slip really says, the link used to be silent. Now: still linked (no double
// count), the keyed amount is not changed silently, and the merchant gets an orange "check the amount" warning.
test('customer re-sends the slip, QR reference matches, but the keyed amount differs: linked + orange "check the amount" warning', () => withSandbox(async sb => {
    await firstTransferKeyed(sb, 140, '10:00:00', 'REFX0001');
    sb.mock.slipOk('ksame', { amount: 145, transRef: 'REFX0001', transDate: bkkDate(), transTime: '09:59:30' });
    await sb.sendSlip('Ualice', 'm2', 'ksame'); await processed(sb, 'Ualice', 2);
    const st = await sb.stats();
    assert.equal(sb.slips().length, 1, 'same transfer: no second slip row');
    assert.equal(st.stats.totalAmount, 140, 'keyed amount kept - the merchant decides');
    const items = (await sb.get('/api/notifications?limit=50')).json.items || [];
    const n = items.find(x => x.kind === 'warn' && /145/.test(x.text) && /140/.test(x.text));
    assert.ok(n, 'orange warning naming both amounts');
    assert.match(n.text, /ตรวจยอด/);
}));
