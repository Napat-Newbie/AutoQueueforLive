// tests/system/edit-items.test.js
// v1.0.16 ✏️: when the DP picks the wrong items (or the wrong quantity), the merchant can correct the
// card themselves via POST /api/queue/edit_items. The edit changes ONLY the item list + draws — the
// transferred amount, the slip status, and the customer wallet must stay untouched (money invariants).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};

const waitForLog = (sb, re, message) => sb.waitFor(
    () => re.test(fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8')),
    8000, message || `system.log never matched ${re}`
);

test('merchant edits the item list: card, Kerry file and log all reflect the correction; money untouched', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'EDIT1');   // DP picks: A x1 (100) + 40 shipping
    await sb.waitForSlips(1);
    const slipId = sb.slips()[0].id;
    assert.equal(sb.slips()[0].draws, 1, 'precondition: auto-picked 1 item');
    assert.match(sb.slips()[0].qr_payload, /A x1/);

    // แม่ค้าแก้: ลูกค้าตกลงกันไว้ให้เป็นสินค้า B แทน
    const r = await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'B', qty: 1 }] });
    assert.equal(r.json.success, true);
    assert.equal(r.json.draws, 1);
    assert.equal(r.json.breakdown, 'B x1');

    const row = sb.slips()[0];
    assert.equal(row.draws, 1, 'draws follow the correction');
    assert.match(row.qr_payload, /B x1/, 'breakdown rewritten inside qr_payload (ref segment kept)');
    assert.doesNotMatch(row.qr_payload, /A x1/);
    assert.equal(row.amount, 140, 'transferred amount is a fact from the slip — never touched');
    assert.equal(row.status, 'waiting', 'status untouched');
    assert.equal(sb.sql('SELECT balance FROM customers WHERE line_id = ?', 'Ualice')[0].balance, 0, 'wallet untouched');

    // การ์ดบนหน้าจอ + ข้อมูลรายสลิปสำหรับปุ่มแก้ไข สะท้อนของใหม่
    const st = await sb.stats();
    assert.match(st.queues.waiting[0].breakdown, /B x1/);
    assert.equal(st.queues.waiting[0].slips[0].breakdown, 'B x1', 'per-slip breakdown exposed for the edit modal');

    // ไฟล์ Kerry ใช้รายการที่แก้แล้ว
    const live = await sb.startLive();
    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get(`/api/kerry/export_excel?sessionId=${live.session.id}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const text = [];
    wb.eachSheet(ws => ws.eachRow(rowX => rowX.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
    assert.match(text.join('\n'), /B x1/, 'the Kerry file ships the corrected item');

    // มีบรรทัด log การแก้ไข (เข้า system.log + Discord อัตโนมัติ)
    await waitForLog(sb, /แม่ค้าแก้ไขรายการสินค้า — Alice: เดิม "A x1" → ใหม่ "B x1"/);
}));

test('editing to zero items is rejected — a card with no items has no meaning in the queue (v1.0.17 review: use the reject button instead)', () => withSandbox(async sb => {
    await slipFor(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'EDIT2');
    await sb.waitForSlips(1);
    const slipId = sb.slips()[0].id;
    assert.equal(sb.slips()[0].draws, 1, 'precondition: auto-picked 1 item');

    const r = await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'A', qty: 0 }] });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /ปัดตกรูป/, 'the error points the merchant at the right button');
    assert.equal(sb.slips()[0].draws, 1, 'record untouched (still the auto-picked item)');
    assert.match(sb.slips()[0].qr_payload, /A x1/);

    assert.equal((await sb.post('/api/queue/edit_items', { slipId, items: [] })).status, 400, 'empty item list is the same 0-piece case');
}));

test('validation: only pending cards can be edited; bad quantities are rejected', () => withSandbox(async sb => {
    await slipFor(sb, 'Ucarol', 'Carol', 'm3', 'k3', 140, 'EDIT3');
    await sb.waitForSlips(1);
    const slipId = sb.slips()[0].id;

    assert.equal((await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'A', qty: -1 }] })).status, 400);
    assert.equal((await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'A', qty: 1.5 }] })).status, 400);
    assert.equal((await sb.post('/api/queue/edit_items', { slipId: 999999, items: [{ name: 'A', qty: 1 }] })).status, 404);

    // การ์ดที่จบแล้วแก้ไม่ได้ (เงินและประวัติปิดรอบแล้ว)
    await sb.post('/api/queue/action', { action: 'completed', slipIds: [slipId] });
    const done = await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'B', qty: 1 }] });
    assert.equal(done.status, 409);
    assert.equal(sb.slips()[0].draws, 1, 'completed card unchanged');
}));

test('edit_items_context: tells the modal how many items this customer already has in the round (free shipping at the threshold)', () => withSandbox(async sb => {
    await slipFor(sb, 'Udan', 'Dan', 'm4', 'k4', 140, 'CTX1');      // A x1 + shipping 40
    await sb.waitForSlips(1);
    await slipFor(sb, 'Udan', 'Dan', 'm5', 'k5', 100, 'CTX2');      // A x1 (shipping already paid)
    await sb.waitForSlips(2);
    const [s1, s2] = sb.slips();
    assert.equal(s1.draws + s2.draws, 2, 'precondition: 2 items in the round');

    // แก้การ์ดใบที่ 2 อย่างเดียว: อีกใบมี 1 ชิ้น
    const one = await sb.get(`/api/queue/edit_items_context?slipIds=${s2.id}`);
    assert.equal(one.json.success, true);
    assert.equal(one.json.otherDraws, 1);
    assert.equal(one.json.shippingFee, 40);
    assert.equal(one.json.freeShippingThreshold, 3);

    // แก้ทั้งการ์ด (2 สลิป): ไม่มีชิ้นอื่นนอกการ์ด
    const both = await sb.get(`/api/queue/edit_items_context?slipIds=${s1.id},${s2.id}`);
    assert.equal(both.json.otherDraws, 0);

    assert.equal((await sb.get('/api/queue/edit_items_context')).status, 400);
    assert.equal((await sb.get('/api/queue/edit_items_context?slipIds=999999')).status, 404);
}));

test('a "|" in an item name is rejected (it is the field separator inside the slip record)', () => withSandbox(async sb => {
    await slipFor(sb, 'Uero', 'Ero', 'm6', 'k6', 140, 'PIPE1');
    await sb.waitForSlips(1);
    const slipId = sb.slips()[0].id;
    const r = await sb.post('/api/queue/edit_items', { slipId, items: [{ name: 'A|x', qty: 1 }] });
    assert.equal(r.status, 400);
    assert.match(sb.slips()[0].qr_payload, /A x1/, 'record untouched');
}));
