// tests/unit/history-summary.test.js
// v1.0.17 history page: cancelled slips are not counted anywhere in the summaries, customers are counted by LINE id,
// the status column speaks Thai for every status. Real functions are cut out of public/history.html and run in a vm.
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
const ctx = { Map, Object, String, Number, parseInt };
vm.createContext(ctx);
['statusInfo', 'summarizeHistory', 'customerLabels'].forEach(n => vm.runInContext(grab(n), ctx));

const row = (o) => ({ date: '20261029', time: '12:00:00', amount: 140, draws: 1, status: 'waiting', ref: 'R|A x1', customerKey: 'U' + o.name, ...o });
// the same shop day the audit used: Alice completed, Bob cancelled, Carol short-paid, Erin cleared, two different customers named Sam, Fiona called, Dave manual image waiting for check
const day = [
    row({ name: 'Alice', status: 'completed' }),
    row({ name: 'Bob', status: 'rejected' }),
    row({ name: 'Carol', status: 'accumulated', amount: 100, draws: 0, ref: 'R|' }),
    row({ name: 'Erin', status: 'cleared' }),
    row({ name: 'Sam', customerKey: 'Usam1', status: 'called' }),
    row({ name: 'Sam', customerKey: 'Usam2', status: 'called' }),
    row({ name: 'Fiona', status: 'called' }),
    row({ name: 'Dave', status: 'abnormal_pending', amount: 0, draws: 0, ref: 'MANUAL (รอเช็ค)|' }),
];

test('cancelled slips are left out of money, pieces, slip count, product summary and customer list', () => {
    const s = ctx.summarizeHistory(day);
    assert.equal(s.totalAmount, 800, 'Bob 140 is not counted');
    assert.equal(s.totalDraws, 5);
    assert.equal(s.totalSlips, 7, '8 rows, 1 cancelled');
    assert.equal(s.rejectedSlips, 1);
    assert.equal(s.productCounts.A, 5, 'product total equals the pieces total (was 6 before: it counted the cancelled slip)');
    const names = Array.from(s.dailyCustomers['20261029'].values());
    assert.ok(!names.includes('Bob'), 'cancelled customer is not listed');
    assert.equal(s.dailyCustomers['20261029'].size, 5);
});

test('two different customers with the same LINE name are two people (counted by LINE id) and are told apart in the list', () => {
    const s = ctx.summarizeHistory(day);
    const map = s.dailyCustomers['20261029'];
    assert.equal(Array.from(map.values()).filter(n => n === 'Sam').length, 2);
    assert.deepEqual(Array.from(ctx.customerLabels(map)).filter(l => l.startsWith('Sam')), ['Sam', 'Sam (คนที่ 2)']);
});

test('old data without LINE id still groups by name; the same customer buying twice is one person', () => {
    const s = ctx.summarizeHistory([row({ name: 'Ann', customerKey: null }), row({ name: 'Ann', customerKey: null }), row({ name: 'Ann', customerKey: 'Uann' })]);
    assert.equal(s.dailyCustomers['20261029'].size, 2, 'name-only rows form one group, the row with an id another');
    const s2 = ctx.summarizeHistory([row({ name: 'Ann' }), row({ name: 'Ann' })]);
    assert.equal(s2.dailyCustomers['20261029'].size, 1);
});

test('skipped / zero-piece slips stay out of the product summary and customer list (rule unchanged), but money still counts', () => {
    const s = ctx.summarizeHistory([row({ name: 'Skip', status: 'skipped' }), row({ name: 'Zero', draws: 0, status: 'accumulated', ref: 'R|' })]);
    assert.deepEqual(Object.keys(s.productCounts), []);
    assert.deepEqual(Object.keys(s.dailyCustomers), []);
    assert.equal(s.totalAmount, 280);
});

test('product names: several items per slip, with and without a count', () => {
    const s = ctx.summarizeHistory([row({ name: 'X', draws: 3, ref: 'R|A x2, B x1' }), row({ name: 'Y', draws: 1, ref: 'R|เสื้อสีแดง' })]);
    assert.equal(s.productCounts.A, 2); assert.equal(s.productCounts.B, 1); assert.equal(s.productCounts['เสื้อสีแดง'], 1);
    assert.deepEqual(ctx.summarizeHistory(null).totalSlips, 0);
});

test('every status has Thai text; waiting-for-image-check and cleared are not shown as "เสร็จสิ้น"', () => {
    const t = (s) => ctx.statusInfo(s).text;
    assert.equal(t('abnormal_pending'), 'รอตรวจรูปสลิป');
    assert.notEqual(t('cleared'), t('completed'));
    assert.equal(t('completed'), 'เสร็จสิ้น');
    ['waiting', 'called', 'skipped', 'accumulated', 'rejected', 'cleared', 'abnormal_pending', 'completed'].forEach(s => assert.ok(!/^[a-z_]+$/.test(t(s)), `${s} must not show raw English: ${t(s)}`));
    assert.equal(t('something_new'), 'something_new', 'an unknown future status is shown as is, not hidden');
});

test('static: the page shows the cancelled-slip note and escapes the date in the customer list', () => {
    assert.ok(html.includes('id="sumSlipsNote"'));
    assert.match(html, /escapeHtml\(formatDisplayDate\(dateStr\)\)/);
    assert.ok(!html.includes('📅 ${formatDisplayDate(dateStr)}'));
});
