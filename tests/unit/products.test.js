// tests/unit/products.test.js
// v1.0.20 (P2, P5: 1.1): กติกาเดียวของการนับ "สินค้า × จำนวนชิ้น", การประกอบตาราง "สินค้า × รอบไลฟ์" (buildProductRoundSummary),
// และรูปแบบรหัสรอบไลฟ์ LIVE_ID_RE — lib/products.js ใช้ร่วมกันทั้งสรุป Discord หลังจบไลฟ์ และหน้าประวัติ
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const Products = require(path.join(ROOT, 'lib', 'products'));
const { load } = require('../harness/extract');

const INDEX = path.join(ROOT, 'index.js');
const row = (o) => Object.assign({ status: 'completed', draws: 1, qr_payload: 'REF|A x1' }, o);

test('LIVE_ID_RE: ตรวจจับรูปแบบรหัสรอบไลฟ์ LIVE_<timestamp> ถูกต้อง', () => {
    const { LIVE_ID_RE } = Products;
    assert.ok(LIVE_ID_RE instanceof RegExp);
    assert.equal(LIVE_ID_RE.test('LIVE_1793450521936'), true);
    assert.equal(LIVE_ID_RE.test('LIVE_1'), true);
    assert.equal(LIVE_ID_RE.test('LIVE_0'), true);
    assert.equal(LIVE_ID_RE.test('LIVE_'), false);
    assert.equal(LIVE_ID_RE.test('1793450521936'), false);
    assert.equal(LIVE_ID_RE.test('manual_123'), false);
    assert.equal(LIVE_ID_RE.test('LIVE_123_abc'), false);
    assert.equal(LIVE_ID_RE.test(''), false);
});

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

test('buildProductRoundSummary: จัดกลุ่มสลิปตามรอบไลฟ์ และนอกรอบไลฟ์ (__oor__) พร้อมคำนวณผลรวม', () => {
    const { buildProductRoundSummary } = Products;
    assert.equal(typeof buildProductRoundSummary, 'function');

    const slips = [
        row({ session_id: 'LIVE_100', qr_payload: 'REF|เสื้อยืด x2, กางเกง x1', draws: 3 }),
        row({ session_id: 'LIVE_200', qr_payload: 'REF|เสื้อยืด x1', draws: 1 }),
        row({ session_id: null, qr_payload: 'REF|หมวก x1', draws: 1 }),               // นอกรอบ
        row({ session_id: 'INVALID_ID', qr_payload: 'REF|เสื้อยืด x3', draws: 3 }),   // session_id ผิดรูปแบบ -> นอกรอบ
    ];
    const rounds = [
        { sessionId: 'LIVE_200' },
        { sessionId: 'LIVE_100' }
    ];

    const res = buildProductRoundSummary(slips, rounds);

    assert.equal(res.columns.length, 3);
    assert.deepEqual(res.columns.map(c => c.key), ['LIVE_200', 'LIVE_100', '__oor__']);

    assert.equal(res.columnTotals[0], 1); // LIVE_200: เสื้อยืด x1
    assert.equal(res.columnTotals[1], 3); // LIVE_100: เสื้อยืด x2, กางเกง x1
    assert.equal(res.columnTotals[2], 4); // __oor__: หมวก x1, เสื้อยืด x3
    assert.equal(res.grandTotal, 8);

    const shirtRow = res.rows.find(r => r.name === 'เสื้อยืด');
    assert.ok(shirtRow);
    assert.deepEqual(shirtRow.cells, [1, 2, 3]);
    assert.equal(shirtRow.total, 6);
});

test('กติกาเดียวกับตัวจริง: summarizeLiveProducts (สรุป Discord ใน lib/liveReport) ให้ผลเท่ากับ lib ทุกกรณี', () => {
    const { summarizeLiveProducts } = require(path.join(ROOT, 'lib', 'liveReport'));
    const rows = [
        row({ qr_payload: 'R1|A x2, B x1', draws: 3 }),
        row({ qr_payload: 'manual_image|/u.jpg|C x2', draws: 2 }),
        row({ qr_payload: 'R3|', draws: 2 }),
        row({ status: 'rejected', qr_payload: 'R4|A x9', draws: 9 }),
    ];
    const fromLib = summarizeLiveProducts(rows);
    const lib = Products.countProducts(rows);
    const libList = Object.keys(lib.counts).map(n => ({ name: n, qty: lib.counts[n] })).sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name));
    assert.equal(JSON.stringify(fromLib.list), JSON.stringify(libList));
    assert.equal(fromLib.pieces, lib.pieces);
    assert.ok(fromLib.list.some(i => i.name === Products.UNKNOWN_PRODUCT && i.qty === 2), 'แถว ไม่ระบุสินค้า ปรากฏในสรุปด้วย');
});

test('anti-copy: buildProductRoundSummary และ LIVE_ID_RE ต้องถูกย้ายออกจาก index.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.doesNotMatch(src, /function\s+buildProductRoundSummary\s*\(/, 'ห้ามมีนิยาม function buildProductRoundSummary ใน index.js');
    assert.doesNotMatch(src, /const\s+LIVE_ID_RE\s*=\s*\/\^LIVE_\\d\+\$\/;/, 'ห้ามมีนิยามค่าคงที่ const LIVE_ID_RE = /^LIVE_\\d+$/; ใน index.js');
});
