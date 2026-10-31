// tests/system/bank-delay-recheck.test.js
// v1.0.17: สลิปธนาคารที่ต้องรอ (SlipOK Code 1010) — ระบบเก็บรูปไว้แล้วตรวจซ้ำเองหลังพ้นเวลารอ (delay + 1 นาที, ลองสูงสุด 2 ครั้ง)
// แทนการรอให้ลูกค้าส่งรูปเดิมซ้ำ การ์ดรอใส่ยอดจะอัปเกรดเป็นสลิปตรวจผ่านเองด้วยคณิตเดียวกับ /api/queue/manual_amount
// ถ้าแม่ค้าใส่ยอดไปก่อนแล้ว ระบบจะผูกรหัสอ้างอิงเข้าใบเดิมผ่านหน้าต่างเวลาของ pickManualMatch (กันนับซ้ำ)
// เวลารอถูกย่อด้วย AQ_BANK_RECHECK_DELAY_MS ในชุดทดสอบ (mock SlipOK จับคู่ตามไบต์ของรูป จึงสคริปต์ใหม่ได้ระหว่างรอ)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const BBL = () => ({ code: 1010, message: 'wait', data: { qrcodeData: 'QR', bankCode: '002', bankName: 'กรุงเทพ', delay: 7, message: 'wait' } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readLog = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
const bkkTimeAgo = (sec) => new Date(Date.now() - sec * 1000).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Bangkok' });
const ENV = { AQ_BANK_RECHECK_DELAY_MS: '1200' };

const send1010 = async (sb) => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl');
    await sb.waitForSlips(1);
    await sleep(300);
    return sb.slips()[0].id;
};

test('1010 slip upgrades itself after the wait: re-verified from the stored image, same math as manual_amount', () => withSandbox(async sb => {
    const id = await send1010(sb);
    assert.equal(sb.slips()[0].amount, 0, 'precondition: waiting card with no amount');

    sb.mock.slipOk('kbbl', { amount: 140, transRef: 'AUTO0001', transDate: bkkDate(), transTime: bkkTimeAgo(60) });
    await sb.waitFor(() => sb.slips()[0].amount === 140, 10000, 'the card did not upgrade');
    const row = sb.slips()[0];
    assert.equal(row.trans_ref, 'AUTO0001');
    assert.equal(row.draws, 1, '140 baht = A x1 + shipping, same DP as keying it by hand');
    assert.equal(row.status, 'waiting');
    assert.match(row.qr_payload, /manual_image\|/, 'keeps the manual_image shape so the image button and edit modal still work');
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140);
    assert.equal(sb.sql('SELECT balance FROM customers WHERE line_id = ?', 'Ualice')[0].balance, 0, 'wallet after = same as manual_amount (change kept / nothing owed)');
    await sb.waitFor(() => /ตรวจสลิปซ้ำเองหลังพ้นเวลารอสำเร็จ/.test(readLog(sb)), 8000, 'success line missing from system.log');
}, null, ENV));

test('merchant already keyed the amount: the recheck attaches the bank reference to THAT row (no double count)', () => withSandbox(async sb => {
    const id = await send1010(sb);
    const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount: 140 });
    assert.equal(r.json.success, true);

    sb.mock.slipOk('kbbl', { amount: 140, transRef: 'AUTO0002', transDate: bkkDate(), transTime: bkkTimeAgo(60) });
    await sb.waitFor(() => sb.slips()[0].trans_ref === 'AUTO0002', 10000, 'reference never attached');
    assert.equal(sb.slips().length, 1, 'no second row — linked to the keyed slip');
    assert.equal((await sb.stats()).stats.totalAmount, 140, 'counted once');
    await sb.waitFor(() => /ผูกเป็นใบเดียวกัน ไม่นับยอดซ้ำ/.test(readLog(sb)), 8000, 'link line missing');
}, null, ENV));

test('still 1010 after two attempts: the card stays manual and the merchant is told', () => withSandbox(async sb => {
    await send1010(sb);   // mock stays scripted as 1010 forever
    await sb.waitFor(() => /พยายามตรวจสลิปซ้ำเอง 2 ครั้งแล้วยังไม่สำเร็จ/.test(readLog(sb)), 12000, 'give-up line missing');
    assert.equal(sb.slips()[0].amount, 0, 'card untouched — the manual path is still there');
    assert.equal(sb.slips()[0].status, 'waiting');
}, null, ENV));

test('the recheck runs the same account check: money to another account is not recorded', () => withSandbox(async sb => {
    await send1010(sb);
    sb.mock.slipOk('kbbl', { amount: 140, transRef: 'WRONGAC1', receiverName: 'Somewhere Else', transDate: bkkDate(), transTime: bkkTimeAgo(60) });
    await sb.waitFor(() => /โอนผิดบัญชี/.test(readLog(sb)), 10000, 'wrong-account line missing');
    assert.equal(sb.slips()[0].amount, 0, 'nothing applied to the card');
}, null, ENV));

// 2026-10-31: runBankDelayRecheck declared `const parts` and then re-assigned it when the stored payload was not in
// the manual_image|url|breakdown shape -> TypeError "Assignment to constant variable", the card never upgraded and the
// error was swallowed by the timer. Not reachable through today's webhook (it always writes manual_image), so this
// forces the other shape to pin the fallback branch.
test('re-check still upgrades a card whose stored payload is not in the manual_image shape', () => withSandbox(async sb => {
    const id = await send1010(sb);
    sb.exec("UPDATE slips SET qr_payload = 'legacy-shape' WHERE id = ?", id);
    sb.mock.slipOk('kbbl', { amount: 140, transRef: 'AUTO0009', transDate: bkkDate(), transTime: bkkTimeAgo(60) });
    const failLine = () => (readLog(sb).match(/ตรวจสลิปซ้ำเองหลังพ้นเวลารอ \(สลิป #\d+\) ไม่สำเร็จ: [^\n]*/) || [null])[0];
    await sb.waitFor(() => sb.slips()[0].amount === 140 || failLine(), 10000, 'neither upgraded nor logged a failure');
    assert.equal(failLine(), null, 'the re-check must not crash');
    const row = sb.slips()[0];
    assert.equal(row.trans_ref, 'AUTO0009');
    assert.equal(row.draws, 1);
    assert.match(row.qr_payload, /^manual_image\|\|/, 'rebuilt into the manual_image shape (empty image url)');
}, null, ENV));
