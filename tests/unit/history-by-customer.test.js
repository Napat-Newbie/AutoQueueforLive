// tests/unit/history-by-customer.test.js
// Phase D (shop request 2026-10-31): the history page gets a "group by customer" view -- per day, per customer
// (LINE id, same-name customers kept apart), with the customer's total, pieces and slip count, and under it every
// slip row with ALL the old columns. Same counting rules as summarizeHistory (cancelled slips are not counted).
// Real functions are cut out of public/history.html and run in a vm.
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
const ctx = { Map, Object, String, Number, Array, Date, parseInt };
vm.createContext(ctx);
vm.runInContext('let roundLabels = {};', ctx);
['escapeHtml', 'formatDisplayDate', 'formatRoundLabel', 'roundCellHtml', 'statusInfo', 'summarizeHistory', 'customerLabels',
    'groupHistoryByCustomer', 'historyRowHtml', 'historyGroupedHtml'].forEach(n => vm.runInContext(grab(n), ctx));

// newest first, the way /api/history_data sends it
const rows = [
    { id: 5, date: '20261031', time: '14:00:00', name: 'Ann', lineName: 'Ann', amount: 280, draws: 2, status: 'waiting', ref: 'R5|A x2', sessionId: null, outOfRound: false, customerKey: 'U1' },
    { id: 4, date: '20261031', time: '13:00:00', name: 'Ann', lineName: 'Ann', amount: 140, draws: 1, status: 'completed', ref: 'R4|A x1', sessionId: null, outOfRound: false, customerKey: 'U2' },
    { id: 3, date: '20261031', time: '12:00:00', name: 'Ann', lineName: 'Ann', amount: 60, draws: 0, status: 'accumulated', ref: 'R3|', sessionId: null, outOfRound: true, customerKey: 'U1' },
    { id: 2, date: '20261031', time: '11:00:00', name: 'Bob', lineName: 'Bob', amount: 140, draws: 1, status: 'rejected', ref: 'R2|A x1', sessionId: null, outOfRound: false, customerKey: 'U3' },
    { id: 1, date: '20261030', time: '10:00:00', name: 'Bob', lineName: 'Bob', amount: 140, draws: 1, status: 'completed', ref: 'R1|A x1', sessionId: null, outOfRound: false, customerKey: 'U3' },
];
const plain = (v) => JSON.parse(JSON.stringify(v));

test('grouped per day (newest first), per LINE id; same-name customers stay apart with "(คนที่ 2)"', () => {
    const g = plain(ctx.groupHistoryByCustomer(rows));
    assert.deepEqual(g.days.map(d => d.date), ['20261031', '20261030']);
    const day1 = g.days[0];
    assert.deepEqual(day1.customers.map(c => c.label), ['Ann', 'Ann (คนที่ 2)']);
    const ann1 = day1.customers[0];
    assert.equal(ann1.key, 'U1');
    assert.equal(ann1.totalAmount, 340, '280 + 60 (the not-enough slip still counts as money, same as the page total)');
    assert.equal(ann1.totalDraws, 2);
    assert.equal(ann1.slipCount, 2);
    assert.deepEqual(ann1.slips.map(s => s.id), [5, 3], 'slips keep the time order of the table');
    assert.equal(day1.customers[1].totalAmount, 140);
    assert.equal(day1.totalAmount, 480);
    assert.deepEqual(g.days[1].customers.map(c => c.label), ['Bob']);
});

test('cancelled slips are not in any group, and are counted for the note', () => {
    const g = plain(ctx.groupHistoryByCustomer(rows));
    assert.equal(g.rejectedSlips, 1);
    const ids = g.days.flatMap(d => d.customers.flatMap(c => c.slips.map(s => s.id)));
    assert.ok(!ids.includes(2));
    assert.ok(!g.days[0].customers.some(c => c.key === 'U3'), 'Bob only had a cancelled slip on the 31st');
});

test('per-customer totals add up to the page totals from summarizeHistory (no second counting rule)', () => {
    const g = plain(ctx.groupHistoryByCustomer(rows));
    const s = ctx.summarizeHistory(rows);
    const sumAmount = g.days.reduce((a, d) => a + d.customers.reduce((b, c) => b + c.totalAmount, 0), 0);
    const sumDraws = g.days.reduce((a, d) => a + d.customers.reduce((b, c) => b + c.totalDraws, 0), 0);
    const sumSlips = g.days.reduce((a, d) => a + d.customers.reduce((b, c) => b + c.slipCount, 0), 0);
    assert.equal(sumAmount, s.totalAmount);
    assert.equal(sumDraws, s.totalDraws);
    assert.equal(sumSlips, s.totalSlips);
});

test('one slip row keeps all 8 old columns (same builder for both views)', () => {
    const tr = ctx.historyRowHtml(rows[0]);
    assert.equal((tr.match(/<td/g) || []).length, 8);
    for (const part of ['31/10/2026', '14:00:00', '฿280.00', 'A x2', 'รอเรียกคิว', 'R5']) assert.ok(tr.includes(part), `missing ${part}`);
    assert.ok(ctx.historyRowHtml(rows[2]).includes('🕒 นอกรอบ'), 'out-of-round badge kept');
    assert.ok(ctx.historyRowHtml({ ...rows[0], name: '<b>x</b>' }).includes('&lt;b&gt;'), 'names are escaped');
});

test('grouped HTML: day header, customer header with totals, every counted slip row, the cancelled note', () => {
    const out = ctx.historyGroupedHtml(rows);
    assert.ok(out.includes('📅 31/10/2026'));
    assert.ok(out.includes('Ann (คนที่ 2)'));
    assert.ok(out.includes('฿340.00'));
    for (const ref of ['R5', 'R4', 'R3', 'R1']) assert.ok(out.includes(ref), `slip ${ref} missing`);
    assert.ok(!out.includes('>R2'), 'the cancelled slip row is not shown in this view');
    assert.match(out, /ปัดตก\/ยกเลิก 1 ใบ/);
    assert.equal((out.match(/<tr class="group-customer"/g) || []).length, 3);
});

test('wiring: table view uses the row builder, a toggle switches views, default stays the slip table', () => {
    assert.match(grab('renderHistoryBody'), /historyGroupedHtml\(/);
    assert.match(grab('renderHistoryBody'), /historyRowHtml/);
    assert.match(grab('renderHistoryTable'), /renderHistoryBody\(\)/);
    assert.match(html, /id="viewBySlip"[^>]*onclick="setHistoryView\('slip'\)"/);
    assert.match(html, /id="viewByCustomer"[^>]*onclick="setHistoryView\('customer'\)"/);
    assert.match(html, /let historyView = 'slip';/);
});
