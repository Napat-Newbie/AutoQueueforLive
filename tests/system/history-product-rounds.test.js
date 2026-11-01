// tests/system/history-product-rounds.test.js
// v1.0.20 (P2): ตาราง "สินค้า × รอบไลฟ์" ต้องมาจากกติกานับเดียวกับสรุป Discord (lib/products.js)
// /api/history_data ส่ง productSummary พร้อมข้อมูล และมี endpoint ดาวน์โหลด Excel
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { withSandbox, bkkDate } = require('../harness/sandbox');

function excelText(buffer, ExcelJS) {
    const wb = new ExcelJS.Workbook();
    return wb.xlsx.load(buffer).then(() => {
        const text = [];
        wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
        return text.join('\n');
    });
}

test('productSummary: ตารางสินค้า × รอบ (รอบใหม่→เก่า + นอกรอบท้าย) ผลรวมต่อรอบเท่ากับ draws ของรอบนั้น', () => withSandbox(async sb => {
    const live1 = await sb.startLive();
    sb.insertSlip({ line_id: 'Ualice', name: 'Alice', amount: 200, draws: 2, session_id: live1.session.id, trans_date: bkkDate(0), trans_ref: 'P1', qr_payload: 'P1|A x2' });
    sb.insertSlip({ line_id: 'Ubob', name: 'Bob', amount: 200, draws: 1, session_id: live1.session.id, trans_date: bkkDate(0), trans_ref: 'P2', qr_payload: 'P2|B x1' });
    sb.insertSlip({ line_id: 'Urej', name: 'Rej', amount: 100, draws: 9, session_id: live1.session.id, trans_date: bkkDate(0), trans_ref: 'P3', qr_payload: 'P3|A x9', status: 'rejected' });
    await sb.endLive();

    const live2 = await sb.startLive();
    sb.insertSlip({ line_id: 'Ucarol', name: 'Carol', amount: 240, draws: 2, session_id: live2.session.id, trans_date: bkkDate(0), trans_ref: 'P4', qr_payload: 'P4|A x2' });
    sb.insertSlip({ line_id: 'Udave', name: 'Dave', amount: 100, draws: 1, session_id: live2.session.id, trans_date: bkkDate(0), trans_ref: 'P5', qr_payload: 'P5|' });   // มีชิ้นแต่ไม่มีรายการสินค้า
    await sb.endLive();

    sb.insertSlip({ line_id: 'Uerin', name: 'Erin', amount: 200, draws: 1, session_id: null, trans_date: bkkDate(0), trans_ref: 'P6', qr_payload: 'P6|B x1' });           // นอกรอบไลฟ์

    const r = await sb.get('/api/history_data');
    const data = r.json;
    assert.equal(data.success, true);
    const ps = data.productSummary;
    assert.ok(ps, 'API ส่ง productSummary มาด้วย');

    // คอลัมน์ = รอบใหม่ → เก่า, นอกรอบอยู่ท้ายสุด
    assert.deepEqual(ps.columns.map(c => c.sessionId), [live2.session.id, live1.session.id, null], 'รอบใหม่→เก่า + นอกรอบท้าย');

    const cell = (name) => ps.rows.find(x => x.name === name).cells;
    assert.deepEqual(cell('A'), [2, 2, 0], 'A: 2 ในรอบ 2, 2 ในรอบ 1 (ใบ rejected ไม่นับ), 0 นอกรอบ');
    assert.deepEqual(cell('B'), [0, 1, 1]);
    assert.deepEqual(cell('ไม่ระบุสินค้า'), [1, 0, 0], 'ใบไม่มีรายการสินค้ากลายเป็นแถว ไม่ระบุสินค้า ไม่หายไป');
    assert.equal(ps.grandTotal, 7, 'รวมทุกสินค้าทุกรอบ = 4+2+1');

    // ข้อกำหนดของโจทย์: ผลรวมชิ้นของแต่ละรอบต้องเท่ากับ draws ของรอบนั้น (รอบ rejected ไม่เข้า draws)
    const round2 = data.rounds.find(x => x.sessionId === live2.session.id);
    const round1 = data.rounds.find(x => x.sessionId === live1.session.id);
    assert.equal(ps.columnTotals[0], round2.draws, `รอบล่าสุด: ชิ้นรวม ${ps.columnTotals[0]} = draws ${round2.draws}`);
    assert.equal(ps.columnTotals[1], round1.draws, `รอบก่อน: ชิ้นรวม ${ps.columnTotals[1]} = draws ${round1.draws}`);
}));

test('endpoint ดาวน์โหลด Excel: ได้ไฟล์ .xlsx ที่มีชื่อสินค้า ไม่ระบุสินค้า และแถวรวม ครบ', () => withSandbox(async sb => {
    const live = await sb.startLive();
    sb.insertSlip({ line_id: 'Ualice', name: 'Alice', amount: 200, draws: 2, session_id: live.session.id, trans_date: bkkDate(0), trans_ref: 'Q1', qr_payload: 'Q1|A x2' });
    sb.insertSlip({ line_id: 'Udave', name: 'Dave', amount: 100, draws: 1, session_id: live.session.id, trans_date: bkkDate(0), trans_ref: 'Q2', qr_payload: 'Q2|' });
    await sb.endLive();

    const r = await sb.get('/api/history/product_rounds_excel');
    assert.equal(r.status, 200);
    assert.match(String(r.headers['content-type'] || ''), /spreadsheetml/, 'ตอบเป็นไฟล์ xlsx');
    const text = await excelText(r.buffer, sb.requireDep('exceljs'));
    assert.match(text, /สินค้า/, 'มีหัวตาราง');
    assert.match(text, /ไลฟ์ /, 'คอลัมน์เป็นชื่อรอบ');
    assert.match(text, /ไม่ระบุสินค้า/);
    assert.match(text, /รวมทุกสินค้า/);
    assert.match(text, /นอกรอบไลฟ์|รวม/, 'มีคอลัมน์รวม');
}));

test('endpoint Excel ผ่าน tunnel โดยไม่ล็อกอิน = 401 (Tier A เหมือน /api/history_data) และชื่อไฟล์กรองเฉพาะตัวเลข', () => withSandbox(async sb => {
    // จำลอง "ผ่าน tunnel ไม่ใช่เครื่องร้าน": ยิงจาก loopback แต่แนบ header ของ proxy ตามที่ isDirectLocalRequest ตรวจ
    const viaTunnel = (path) => new Promise((resolve, reject) => {
        http.get(`${sb.base}${path}`, { headers: { 'x-forwarded-for': '203.0.113.9' } }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }));
        }).on('error', reject);
    });
    const tun = await viaTunnel('/api/history/product_rounds_excel');
    assert.equal(tun.status, 401, 'คนแปลกหน้าผ่าน tunnel ต้องล็อกอินก่อน (เดิมเปิดหมด)');

    const local = await sb.get('/api/history/product_rounds_excel');
    assert.equal(local.status, 200, 'เครื่องร้านโดยตรงใช้ได้ตามปกติ');
    assert.match(String(local.headers['content-disposition'] || ''), /^attachment; filename="product_rounds_\d*_\d*\.xlsx"$/, 'ชื่อไฟล์เหลือแค่ตัวเลข');

    // ค่าที่ส่งมาไม่ใช่วันที่ ต้องไม่หลุดเข้า header ดิบๆ (กัน header injection)
    const dirty = await sb.get('/api/history/product_rounds_excel?startDate=2026-11-01%22%3Bx&endDate=%0D%0Aevil');
    assert.equal(dirty.status, 200);
    assert.match(String(dirty.headers['content-disposition'] || ''), /^attachment; filename="product_rounds_\d*_\d*\.xlsx"$/, 'ค่าแปลกปลอมถูกกรองออกจากชื่อไฟล์');
}));
