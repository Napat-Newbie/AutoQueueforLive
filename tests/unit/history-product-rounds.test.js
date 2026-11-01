// tests/unit/history-product-rounds.test.js
// v1.0.20 (P2): ตาราง "สินค้า × รอบไลฟ์" ในหน้าประวัติ — เรนเดอร์จากข้อมูลที่เซิร์ฟเวอร์คำนวณ (กติกาเดียวกับสรุป Discord)
// ฟังก์ชันจริงถูกตัดจาก public/history.html ไปรันใน vm เหมือน history-summary test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_HISTORY_HTML || path.join(__dirname, '..', '..', 'public', 'history.html'), 'utf8');
function grab(name) {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing from history.html`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}

function makeCtx() {
    const box = { innerHTML: '' };   // ตัวเดียวกันทั้งฟังก์ชันและการอ่านผล (stub ต้องคืน instance เดิม)
    const ctx = {
        Date,
        roundLabels: { LIVE_2: { sessionId: 'LIVE_2', startTime: 2000, endTime: 3000, active: false, merged: false }, LIVE_1: { sessionId: 'LIVE_1', startTime: 1000, endTime: 1500, active: false, merged: false } },
        document: { getElementById: id => (id === 'product-rounds-box' ? box : null) },
    };
    vm.createContext(ctx);
    vm.runInContext(grab('escapeHtml') + '\n' + grab('formatRoundLabel') + '\n' + grab('renderProductRounds'), ctx);
    return ctx;
}

const PS = {
    columns: [{ key: 'LIVE_2', sessionId: 'LIVE_2' }, { key: 'LIVE_1', sessionId: 'LIVE_1' }, { key: '__oor__', sessionId: null }],
    rows: [
        { name: 'A', cells: [2, 2, 0], total: 4 },
        { name: 'ไม่ระบุสินค้า', cells: [1, 0, 0], total: 1 },
    ],
    columnTotals: [3, 3, 1],
    grandTotal: 7,
};

test('renderProductRounds: ตารางมีหัวรอบ + คอลัมน์รวม + แถวรวมทุกสินค้า + แถวไม่ระบุสินค้า', () => {
    const ctx = makeCtx();
    ctx.renderProductRounds(PS);
    const out = ctx.document.getElementById('product-rounds-box').innerHTML;
    assert.match(out, /ไลฟ์ /, 'หัวคอลัมน์เป็นชื่อรอบ');
    assert.match(out, /นอกรอบไลฟ์/, 'สลิปไม่มีรอบอยู่คอลัมน์ "นอกรอบไลฟ์"');
    assert.match(out, /รวมทุกสินค้า/, 'แถวสรุปมีจริง');
    assert.match(out, /ไม่ระบุสินค้า/);
    assert.match(out, /prod-rounds-table/, 'ใช้คลาสตารางของชุดนี้');
    assert.ok((out.match(/<strong>4<\/strong>/) || []).length >= 1, 'ยอดรวมของสินค้า A แสดง');
    assert.match(out, /<strong>7<\/strong>/, 'ยอดรวมทุกสินค้าทุกรอบแสดง');
});

test('renderProductRounds: ไม่มีข้อมูล = ข้อความว่าง ไม่ใช่ตารางเปล่า และค่า 0 แสดงเป็น -', () => {
    const ctx = makeCtx();
    ctx.renderProductRounds(null);
    assert.match(ctx.document.getElementById('product-rounds-box').innerHTML, /ไม่มียอดการแพ็คสินค้า/);
    ctx.renderProductRounds(PS);
    assert.match(ctx.document.getElementById('product-rounds-box').innerHTML, /<td>-<\/td>/, 'ช่อง 0 ชิ้นแสดงเป็น - อ่านง่าย');
});

test('หน้าประวัติมีตัวเลื่อนแนวนอน + คอลัมน์ชื่อสินค้าตรึงซ้าย + ปุ่มดาวน์โหลด Excel', () => {
    assert.match(html, /id="product-rounds-box"[^>]*style="[^"]*overflow-x:\s*auto/, 'กล่องตารางเลื่อนแนวนอนได้');
    assert.match(html, /\.prod-rounds-table[^}]*\}/, 'มี CSS ของตาราง');
    assert.match(html, /position:\s*sticky/, 'มีการตรึงคอลัมน์');
    assert.match(html, /id="productRoundsExcelBtn"/, 'มีปุ่มดาวน์โหลด Excel');
});
