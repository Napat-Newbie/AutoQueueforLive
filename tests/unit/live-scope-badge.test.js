// tests/unit/live-scope-badge.test.js
// v1.0.20 (P1): การ์ด "ยอดโอนรวม" บอกว่าเป็นยอดของรอบไหน (ป้ายไลฟ์ล่าสุด)
// และมีบรรทัดเล็กแยก "เงินเข้าหลังจบไลฟ์" ที่ไม่ปนในยอดรอบ
// ดึงฟังก์ชันจริงจาก public/index.html ไปรันใน vm เหมือน floating-total test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
function grab(name) {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing from index.html`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}
const mkEl = () => ({ innerText: '', style: { display: 'inline' } });

test('updateStatsUI: มีข้อมูลรอบ = แสดงป้ายและบรรทัดเงิน ไม่มี = ซ่อนทั้งคู่', () => {
    const els = { totalAmount: mkEl(), uniqueCustomers: mkEl(), totalSlips: mkEl(), totalDraws: mkEl(), waitingQueuesCount: mkEl(), floatingTotalAmount: mkEl(), liveScopeBadge: mkEl(), afterLiveMoney: mkEl() };
    const ctx = { document: { getElementById: id => els[id] || null } };
    vm.createContext(ctx);
    vm.runInContext(grab('updateStatsUI'), ctx);

    ctx.updateStatsUI({ totalAmount: 300, uniqueCustomers: 2, totalSlips: 2, totalDraws: 3, waitingCount: 0,
        liveBadge: 'ไลฟ์ล่าสุด: 1 พ.ย. 21:00 – 2 พ.ย. 01:30', afterLive: { amount: 140, slips: 1 } });
    assert.equal(els.liveScopeBadge.innerText, 'ไลฟ์ล่าสุด: 1 พ.ย. 21:00 – 2 พ.ย. 01:30');
    assert.notEqual(els.liveScopeBadge.style.display, 'none', 'มีป้าย = แสดง');
    assert.equal(els.afterLiveMoney.innerText, 'เงินเข้าหลังจบไลฟ์ ฿140.00 (1 สลิป)');
    assert.notEqual(els.afterLiveMoney.style.display, 'none', 'มีเงินหลังจบไลฟ์ = แสดง');

    ctx.updateStatsUI({ totalAmount: 300, uniqueCustomers: 2, totalSlips: 2, totalDraws: 3, waitingCount: 0 });
    assert.equal(els.liveScopeBadge.style.display, 'none', 'ไม่มีป้าย = ซ่อน');
    assert.equal(els.afterLiveMoney.style.display, 'none', 'ไม่มีเงินหลังจบไลฟ์ = ซ่อน');
});

test('updateStatsUI: หน้าเว็บรุ่นเดิมที่ไม่มี element ใหม่ต้องไม่พัง', () => {
    const els = { totalAmount: mkEl(), uniqueCustomers: mkEl(), totalSlips: mkEl(), totalDraws: mkEl(), waitingQueuesCount: mkEl() };
    const ctx = { document: { getElementById: id => els[id] || null } };
    vm.createContext(ctx);
    vm.runInContext(grab('updateStatsUI'), ctx);
    assert.doesNotThrow(() => ctx.updateStatsUI({ totalAmount: 1, uniqueCustomers: 0, totalSlips: 0, totalDraws: 0, waitingCount: 0,
        liveBadge: 'x', afterLive: { amount: 1, slips: 1 } }));
});

test('การ์ดยอดโอนรวมมีช่องสำหรับป้ายรอบและบรรทัดเงินหลังจบไลฟ์', () => {
    assert.match(html, /id="liveScopeBadge"/, 'มี element ป้ายรอบ');
    assert.match(html, /id="afterLiveMoney"/, 'มี element บรรทัดเงิน');
});
