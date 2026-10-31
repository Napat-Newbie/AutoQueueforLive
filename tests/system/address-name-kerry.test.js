// tests/system/address-name-kerry.test.js
// Phase C (shop report 2026-10-31): the Kerry export used the LINE name instead of the name the customer typed
// (customers often write their name at the END of the address message), and a later message without a name
// (e.g. only a new phone number) replaced the real name with the LINE name.
// Runs the real index.js in a sandbox. No Gemini key in the sandbox -> the regex fallback path is what runs here.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const sendText = (sb, user, id, text) => sb.webhook([{ type: 'message', replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id, text } }]);
const addrOf = (sb, user) => {
    const r = sb.sql('SELECT value FROM configs WHERE key = ?', `cust_addr_${user}`)[0];
    return r ? JSON.parse(r.value) : null;
};
const buyer = async (sb) => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slipOk('k1', { amount: 140, transRef: 'KN0001' });
    await sb.sendSlip('Ualice', 'm1', 'k1');
    await sb.waitForSlips(1);
};

test('name written at the END of the address message is the Kerry recipient (not the LINE name)', () => withSandbox(async sb => {
    await buyer(sb);
    await sendText(sb, 'Ualice', 't1', '99/1 หมู่ 2 ต.บางพลี อ.บางพลี\nจ.สมุทรปราการ 10540\n0812345678\nสมหญิง รักดี');
    await sb.waitFor(() => addrOf(sb, 'Ualice'), 8000, 'address not saved');
    assert.equal(addrOf(sb, 'Ualice').recipient_name, 'สมหญิง รักดี');

    const summary = (await sb.get('/api/kerry/summary')).json;
    assert.equal(summary.success, true);
    assert.equal(summary.orders[0].address.recipient_name, 'สมหญิง รักดี');

    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get('/api/kerry/export_excel');
    assert.equal(file.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const text = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
    assert.match(text.join('\n'), /สมหญิง รักดี/, 'the Excel file uses the typed name');
}));

test('a later message with no name (only a new phone) keeps the real name sent before', () => withSandbox(async sb => {
    await buyer(sb);
    await sendText(sb, 'Ualice', 't1', 'สมชาย ใจดี\n99/1 ม.2 ต.บางพลี อ.บางพลี จ.สมุทรปราการ 10540\n0812345678');
    await sb.waitFor(() => addrOf(sb, 'Ualice'), 8000, 'address not saved');
    assert.equal(addrOf(sb, 'Ualice').recipient_name, 'สมชาย ใจดี');

    await sendText(sb, 'Ualice', 't2', '0899999999');
    await sb.waitFor(() => (addrOf(sb, 'Ualice') || {}).phone === '0899999999', 8000, 'second message not applied');
    assert.equal(addrOf(sb, 'Ualice').recipient_name, 'สมชาย ใจดี', 'must not be replaced by the LINE name "Alice"');
}));

test('a later message WITH a different name replaces the old one', () => withSandbox(async sb => {
    await buyer(sb);
    await sendText(sb, 'Ualice', 't1', 'สมชาย ใจดี\n99/1 ม.2 ต.บางพลี อ.บางพลี จ.สมุทรปราการ 10540\n0812345678');
    await sb.waitFor(() => addrOf(sb, 'Ualice'), 8000, 'address not saved');
    await sendText(sb, 'Ualice', 't2', 'มานี มีนา\n5 ถนนนิมมาน ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200\n0811111111');
    await sb.waitFor(() => (addrOf(sb, 'Ualice') || {}).phone === '0811111111', 8000, 'second message not applied');
    assert.equal(addrOf(sb, 'Ualice').recipient_name, 'มานี มีนา');
}));

test('no name ever sent: the LINE name is still used (old behaviour kept)', () => withSandbox(async sb => {
    await buyer(sb);
    await sendText(sb, 'Ualice', 't1', '99/1 ซอย 5 ถนนสุขุมวิท\nแขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678');
    await sb.waitFor(() => addrOf(sb, 'Ualice'), 8000, 'address not saved');
    assert.equal(addrOf(sb, 'Ualice').recipient_name, 'Alice');
}));

test('a later message with ONLY a new phone keeps the earlier address, and Kerry still has a full address', () => withSandbox(async sb => {
    await buyer(sb);
    await sendText(sb, 'Ualice', 't1', 'สมชาย ใจดี\n99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678');
    await sb.waitFor(() => addrOf(sb, 'Ualice'), 8000, 'address not saved');
    const before = addrOf(sb, 'Ualice');
    assert.match(before.address, /99\/1 ถนนสุขุมวิท/);

    await sendText(sb, 'Ualice', 't2', 'เปลี่ยนเบอร์ 0899999999');
    await sb.waitFor(() => (addrOf(sb, 'Ualice') || {}).phone === '0899999999', 8000, 'second message not applied');
    const after = addrOf(sb, 'Ualice');
    assert.equal(after.address, before.address, 'the address must not become the phone message');
    assert.equal(after.postcode, '10110');
    assert.equal(after.recipient_name, 'สมชาย ใจดี');
    const summary = (await sb.get('/api/kerry/summary')).json;
    assert.equal(summary.orders[0].hasAddress, true);
    assert.match(summary.orders[0].address.address, /99\/1 ถนนสุขุมวิท/);
}));
