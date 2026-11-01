// tests/unit/products.test.js
// v1.0.20 (P2): กติกาเดียวของการนับ "สินค้า × จำนวนชิ้น" — lib/products.js ใช้ร่วมทั้งสรุป Discord
// หลังจบไลฟ์ (summarizeLiveProducts ใน index.js) และตาราง "สินค้า × รอบไลฟ์" ของหน้าประวัติ — ห้ามมีสองกติกา
// (มีเทสต์เทียบกับตัวจริงที่ตัดมาจาก index.js เพื่อกันคนลืมแก้ข้างเดียว)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Products = require('../../lib/products');
const { load } = require('../harness/extract');

const INDEX = path.join(__dirname, '..', '..', 'index.js');
const row = (o) => Object.assign({ status: 'completed', draws: 1, qr_payload: 'REF|A x1' }, o);

test('นับสินค้า: ไม่นับ rejected/skipped/ไม่มีชิ้น · manual_image อ่าน breakdown ช่องที่ 3 · ไม่มี x นับเป็น 1', () => {
    const rows = [
        row({ qr_payload: 'R1|A x2, B x1', draws: 3 }),
        row({ status: 'rejected', qr_payload: 'R2|A x5', draws: 5 }),        // ปัดตก — ไม่นับ
        row({ status: 'skipped', qr_payload: 'R3|B x2', draws: 2 }),         // ถูกข้าม — ไม่นับ
        row({ status: 'accumulated', draws: 0, qr_payload: 'R4|A x1' }),     // ยังไม่มีชิ้น — ไม่นับ
        row({ qr_payload: 'manual_image|/uploads/x.jpg|C x2', draws: 2 }),   // กรอกยอดเอง: breakdown อยู่ช่องที่ 3
        row({ qr_payload: 'R5|คีย์แชมพู', draws: 1 }),                       // ไม่มี x — นับ 1
    ];
    const r = Products.countProducts(rows);
    assert.equal(r.counts.A, 2);
    assert.equal(r.counts.B, 1);
    assert.equal(r.counts.C, 2);
    assert.equal(r.counts['คีย์แชมพู'], 1);
    assert.equal(r.pieces, 6);
    assert.equal(r.unknown, 0);
});

test('มีชิ้นแต่ breakdown ว่าง → แถว "ไม่ระบุสินค้า" เท่ากับจำนวนชิ้น (ผลรวมตรงกับ draws เสมอ ไม่หายเงียบๆ)', () => {
    const rows = [
        row({ qr_payload: 'R|', draws: 2 }),     // ไม่มีรายการสินค้า
        row({ qr_payload: null, draws: 1 }),     // ไม่มี payload เลย
        row({ qr_payload: 'R2|A x1', draws: 1 }),
    ];
    const r = Products.countProducts(rows);
    assert.equal(r.counts[Products.UNKNOWN_PRODUCT], 3);
    assert.equal(r.pieces, 4, 'ผลรวมชิ้น = draws ทั้งหมด');
});

test('กติกาเดียวกับตัวจริงใน index.js: summarizeLiveProducts (สรุป Discord) ให้ผลเท่ากับ lib ทุกกรณี', () => {
    const ctx = load(INDEX, { functions: ['summarizeLiveProducts'] });
    ctx.Products = Products;   // v1.0.20 (P2): ตัวจริงเรียกใช้ lib/products.js
    const rows = [
        row({ qr_payload: 'R1|A x2, B x1', draws: 3 }),
        row({ qr_payload: 'manual_image|/u.jpg|C x2', draws: 2 }),
        row({ qr_payload: 'R3|', draws: 2 }),
        row({ status: 'rejected', qr_payload: 'R4|A x9', draws: 9 }),
    ];
    const fromIndex = ctx.summarizeLiveProducts(rows);
    const lib = Products.countProducts(rows);
    const libList = Object.keys(lib.counts).map(n => ({ name: n, qty: lib.counts[n] })).sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name));
    // เทียบผ่าน JSON เพราะ object จาก vm context มี prototype ต่าง realm จากของ test (deepStrictEqual ไม่ผ่านทั้งที่ค่าเท่ากัน)
    assert.equal(JSON.stringify(fromIndex.list), JSON.stringify(libList));
    assert.equal(fromIndex.pieces, lib.pieces);
    // เจาะจง: ใบไม่มี breakdown ต้องไม่หายไปเงียบๆ อีก (พฤติกรรมเดิมทิ้งทำให้ยอดชิ้นไม่ตรง draws)
    assert.ok(fromIndex.list.some(i => i.name === Products.UNKNOWN_PRODUCT && i.qty === 2), 'แถว ไม่ระบุสินค้า ปรากฏในสรุปด้วย');
});
