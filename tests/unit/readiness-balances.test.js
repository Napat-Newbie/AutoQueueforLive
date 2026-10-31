// tests/unit/readiness-balances.test.js
// Found in the field test 2026-10-31 (after Phase A): the "เงินค้างของลูกค้า" row of the pre-live readiness window
// told the merchant that ALL wallet money would be reset to 0 and should be refunded -- but out-of-round money that
// is not enough yet is now KEPT for the customer. A merchant following the old text could refund money twice.
// The real buildReadinessRows is cut out of public/index.html and run in a vm.
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
const ctx = { Number, String, Array, Math, JSON };
vm.createContext(ctx);
vm.runInContext(grab('buildReadinessRows'), ctx);
const balancesRow = (balances) => ctx.buildReadinessRows({ tunnel: null, quota: null, merge: null, balances, socketConnected: true }).find(r => r.key === 'balances');

test('only out-of-round money that the system keeps: blue info row, says it is kept and NOT to refund', () => {
    const r = balancesRow({ success: true, count: 1, total: 60, keepTotal: 60, resetTotal: 0, keepCount: 1, resetCount: 0, list: [{ name: 'Carol', balance: 60, keep: 60, reset: 0 }] });
    assert.equal(r.level, 'info');
    assert.match(r.detail, /Carol: 60 บาท/);
    assert.match(r.detail, /ไม่ต้องโอนคืน/);
    assert.doesNotMatch(r.detail, /รีเซ็ตเป็น 0/);
});

test('earlier-round leftovers that will be reset: yellow warning lists only the reset part, and the kept part separately', () => {
    const r = balancesRow({
        success: true, count: 2, total: 190, keepTotal: 30, resetTotal: 160, keepCount: 1, resetCount: 2,
        list: [{ name: 'Alice', balance: 100, keep: 0, reset: 100 }, { name: 'Dan', balance: 90, keep: 30, reset: 60 }],
    });
    assert.equal(r.level, 'warn');
    assert.match(r.detail, /2 คน รวม 160 บาท/);
    assert.match(r.detail, /Alice: 100 บาท/);
    assert.match(r.detail, /Dan: 60 บาท/);
    assert.match(r.detail, /รีเซ็ตเป็น 0/);
    assert.match(r.detail, /Dan: 30 บาท/, 'the kept 30 is named too');
    assert.match(r.detail, /ไม่ต้องโอนคืน/);
    assert.doesNotMatch(r.detail, /Alice: 0 บาท/);
});

test('an answer without the kept/reset split (older server) keeps the old wording', () => {
    const r = balancesRow({ success: true, count: 1, total: 100, list: [{ name: 'Alice', balance: 100 }] });
    assert.equal(r.level, 'warn');
    assert.match(r.detail, /Alice: 100 บาท/);
    assert.match(r.detail, /รีเซ็ตเป็น 0/);
});
