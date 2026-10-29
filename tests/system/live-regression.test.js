// tests/system/live-regression.test.js
// Behaviour of the live round / Kerry export / dashboard data that must not change (and the fixes made after v1.0.15).
// Runs the real index.js in a sandbox (tests/harness/sandbox.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const pay = async (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    await sb.sendSlip(user, msg, key);
};

test('Kerry window during a live: customer count in the summary equals the customers in the downloaded file', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'K1'); await sb.waitForSlips(1);
    await pay(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'K2'); await sb.waitForSlips(2);
    // same day, but NOT in this round and already finished: a by-date summary would wrongly count this customer
    sb.insertSlip({ name: 'Zed', line_id: 'Uzed', amount: 140, draws: 1, trans_date: bkkDate(0), trans_ref: 'ZED1', status: 'completed' });

    // what the Kerry window sends by default: ?date=<day on screen>
    const summary = (await sb.get(`/api/kerry/summary?date=${bkkDate(0)}`)).json;
    assert.equal(summary.success, true);
    const names = summary.orders.map(o => o.lineName).sort();
    assert.deepEqual(names, ['Alice', 'Bob']);
    assert.equal(summary.totalCustomers, 2);

    // the Excel the same window downloads
    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get(`/api/kerry/export_excel?date=${bkkDate(0)}`);
    assert.equal(file.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const text = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
    const all = text.join('\n');
    assert.match(all, /Alice/);
    assert.match(all, /Bob/);
    assert.doesNotMatch(all, /Zed/, 'a customer outside the round must not be in the file');
}));

test('Kerry export after the live ended still finds the whole round', () => withSandbox(async sb => {
    const live = await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'E1'); await sb.waitForSlips(1);
    await sb.endLive();
    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.deepEqual(summary.orders.map(o => o.lineName), ['Alice']);
}));

test('dashboard data during a live is the live round (what a reloaded page now asks for)', () => withSandbox(async sb => {
    await pay(sb, 'Uold', 'Old', 'm0', 'k0', 140, 'OLD'); await sb.waitForSlips(1);           // paid before the live
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'L1'); await sb.waitForSlips(2);
    const today = (await sb.get('/api/stats/today')).json;
    const byDate = (await sb.get(`/api/stats/history?date=${bkkDate(0)}`)).json;
    assert.equal(today.stats.totalSlips, 2, 'the round: pre-live slip attached to it + the live slip');
    assert.equal(byDate.stats.totalSlips, 2, 'same data here because nothing else happened on this day');
}));

test('live session survives and keeps its id across a restart of the page (current session endpoint)', () => withSandbox(async sb => {
    const live = await sb.startLive();
    const cur = (await sb.get('/api/live_session/current')).json;
    assert.equal(cur.session.id, live.session.id);
    await sb.endLive();
    assert.equal((await sb.get('/api/live_session/current')).json.session, null);
}));

test('system log is written to a file next to the program', () => withSandbox(async sb => {
    const fs = require('fs'); const path = require('path');
    await sb.startLive();
    await sb.waitFor(() => fs.existsSync(path.join(sb.dir, 'system.log')), 5000, 'system.log was not created');
    const log = fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8');
    assert.match(log, /\[INFO\]/);
    assert.match(log, /\[\d+\/\d+\/\d+, /, 'lines carry a timestamp');
}));
