// tests/unit/edit-items-shipping.test.js
// v1.0.16 ✏️ the edit-items modal tells the merchant how many items the customer has in the round and whether
// shipping is free (items >= threshold = free, same rule the money code uses). The real function is cut out of index.html.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const ctx = {};
vm.createContext(ctx);
function grab(name) {   // the function is indented inside <script>, so cut it by balanced braces
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}
vm.runInContext(grab('editItemsShippingNote'), ctx);
vm.runInContext(grab('editItemsZeroProblem'), ctx);
// (other, before, now, fee, threshold)
const note = (...a) => ctx.editItemsShippingNote(...a);
const zeroProblem = (slips) => ctx.editItemsZeroProblem(slips);

test('3 items in the round with threshold 3 -> free shipping', () => {
    const n = note(0, 3, 3, 39, 3);
    assert.equal(n.free, true);
    assert.match(n.message, /รวม 3 ชิ้น.*ครบ 3 ชิ้น.*ส่งฟรี/);
    assert.equal(n.warnings.length, 0);
});

test('more than the threshold is also free; counts items outside the card too', () => {
    const n = note(2, 1, 3, 39, 3);          // 2 in other slips + 3 in this card = 5
    assert.equal(n.total, 5);
    assert.equal(n.free, true);
});

test('below the threshold -> pays shipping and says how many more for free shipping', () => {
    const n = note(0, 1, 1, 39, 3);
    assert.equal(n.free, false);
    assert.match(n.message, /ต้องจ่ายค่าส่ง 39฿.*อีก 2 ชิ้นส่งฟรี/);
    assert.equal(n.warnings.length, 0);
});

test('reducing from free to paying warns: next slip pays shipping again, and money is not returned', () => {
    const n = note(0, 3, 1, 39, 3);
    assert.equal(n.free, false);
    assert.equal(n.warnings.length, 2);
    assert.ok(n.warnings.some(w => /ไม่ถูกคืนเข้ากระเป๋า/.test(w)));
    assert.ok(n.warnings.some(w => /กลายเป็นต้องจ่ายค่าส่ง/.test(w)));
});

test('raising to the threshold warns that shipping already paid is not refunded automatically', () => {
    const n = note(0, 1, 3, 39, 3);
    assert.equal(n.free, true);
    assert.equal(n.warnings.length, 1);
    assert.match(n.warnings[0], /ระบบไม่คืนเข้ากระเป๋า/);
});

test('editing to zero items warns that a new shipping fee will be charged', () => {
    const n = note(0, 1, 0, 39, 3);
    assert.match(n.message, /ไม่มีสินค้า/);
    assert.ok(n.warnings.some(w => /เก็บค่าส่งใหม่/.test(w)));
});

test('swapping items with the same count changes nothing -> no warnings', () => {
    assert.equal(note(0, 2, 2, 39, 3).warnings.length, 0);
});

test('free-shipping shop (threshold 0/1 or fee 0): always free, never warns about shipping', () => {
    assert.equal(note(0, 1, 1, 39, 1).free, true);
    assert.equal(note(0, 1, 1, 39, 0).free, true);
    assert.equal(note(0, 1, 1, 0, 3).free, true);
    assert.equal(note(0, 1, 1, 39, 0).warnings.length, 0);
});

// v1.0.17 review: ปุ่ม "แก้ไขสินค้า" ต้องไม่ยอมให้บันทึกจนเหลือ 0 ชิ้น — การ์ดที่ไม่มีสินค้าไม่มีความหมายในคิว
// ฝั่งเว็บตรวจ "ยอดรวมทั้งหน้าต่าง = 0" ก่อนส่ง, ฝั่ง API ปฏิเสธรายสลิปอีกชั้น (ดู tests/system/edit-items.test.js)
test('editItemsZeroProblem: a zero-total edit is blocked with a hint to use the reject button', () => {
    const msg = zeroProblem([{ id: 7, qty: { A: 0 } }]);
    assert.match(msg, /0 ชิ้น/);
    assert.match(msg, /ปัดตกรูป/);
    assert.match(zeroProblem([{ id: 7, qty: {} }, { id: 8, qty: { B: 0 } }]), /ปัดตกรูป/, 'empty qty maps count as zero too');
});

test('editItemsZeroProblem: at least one item somewhere -> null (save proceeds; a lone zero slip is the API layer call)', () => {
    assert.equal(zeroProblem([{ id: 3, qty: { A: 1 } }]), null);
    assert.equal(zeroProblem([{ id: 3, qty: { A: 2 } }, { id: 9, qty: { B: 1 } }]), null);
    assert.equal(zeroProblem([{ id: 3, qty: { A: 2 } }, { id: 9, qty: {} }]), null);
});



