// tests/system/kerry-zero-pieces.test.js
// Owner decision 2026-10-31: the Kerry window and the Excel file list ONLY customers who get at least one item.
// A customer whose slips bought nothing yet (money waiting in the wallet, orange card) is not shipped anything,
// so they must not appear (before: they were listed as "สินค้า 0 ชิ้น", and Phase A made this happen more often).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const slipFor = async (sb, user, name, msg, key, amount, ref, n) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    await sb.sendSlip(user, msg, key);
    await sb.waitForSlips(n);
};
const excelText = async (sb, query) => {
    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get('/api/kerry/export_excel' + query);
    assert.equal(file.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const text = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
    return text.join('\n');
};

test('a customer with 0 items in the round is not in the Kerry summary nor the Excel file', () => withSandbox(async sb => {
    const live = await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'KZ0001', 1);   // A + shipping -> 1 item
    await slipFor(sb, 'Ucarol', 'Carol', 'm2', 'k2', 60, 'KZ0002', 2);    // not enough -> 0 items
    assert.equal(sb.slips()[1].draws, 0, 'precondition');

    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.equal(summary.success, true);
    assert.deepEqual(summary.orders.map(o => o.lineName), ['Alice']);
    assert.equal(summary.totalCustomers, 1);
    assert.ok(!summary.missingCustomers.includes('Carol'), 'not asked for an address either');

    const text = await excelText(sb, `?sessionId=${live.session.id}`);
    assert.match(text, /Alice/);
    assert.doesNotMatch(text, /Carol/);
}));

test('the same customer once they top up enough is listed (filter is on items, not on having a 0 slip)', () => withSandbox(async sb => {
    const live = await sb.startLive();
    await slipFor(sb, 'Ucarol', 'Carol', 'm1', 'k1', 60, 'KZ0101', 1);
    await slipFor(sb, 'Ucarol', 'Carol', 'm2', 'k2', 80, 'KZ0102', 2);   // 60 + 80 = 140 -> 1 item
    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.deepEqual(summary.orders.map(o => o.lineName), ['Carol']);
    assert.equal(summary.orders[0].totalDraws, 1);
    assert.equal(summary.orders[0].totalAmount, 140, 'money of both slips still shown for that customer');
}));

test('out-of-round not-enough money claimed into the round (Phase A) does not put the customer on the Kerry list', () => withSandbox(async sb => {
    await slipFor(sb, 'Ucarol', 'Carol', 'm1', 'k1', 60, 'KZ0201', 1);
    const live = await sb.startLive();
    assert.equal(live.claimedOutOfRound, 1, 'precondition: claimed');
    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.equal(summary.orders.length, 0);
    assert.deepEqual(summary.outOfRoundCustomers, []);
}));
