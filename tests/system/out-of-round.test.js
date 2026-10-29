// tests/system/out-of-round.test.js
// Rule "ก" (chosen by the shop owner): money received OUTSIDE a live round (before pressing start, or between two
// rounds) belongs to the NEXT round that starts. Runs the real index.js in a sandbox (tests/harness/sandbox.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};

test('slip paid before pressing "start live" is still in the live queue afterwards (was: vanished)', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'PRE0001');
    await sb.waitForSlips(1);
    let st = await sb.stats();
    assert.equal(st.queues.waiting.length, 1, 'visible while no live is running');

    const live = await sb.startLive();
    st = await sb.stats();
    assert.equal(st.queues.waiting.length, 1, 'must stay visible once the live starts');
    assert.equal(st.queues.waiting[0].name, 'Alice');
    assert.equal(sb.slips()[0].session_id, live.session.id, 'attached to the round that started');
    assert.equal(st.stats.totalSlips, 1, 'counted in the round totals');
    assert.equal(st.stats.totalAmount, 140);
    assert.equal(live.claimedOutOfRound, 1, 'the start response tells how many were attached');
}));

test('a pre-live slip claimed into the round is in the Kerry summary AND the downloaded Excel file', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'PREK1');   // A + 40 shipping, before the live
    await sb.waitForSlips(1);
    const live = await sb.startLive();
    assert.equal(live.claimedOutOfRound, 1, 'precondition: the slip was attached to this round');

    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.equal(summary.success, true);
    assert.equal(summary.totalCustomers, 1);
    assert.deepEqual(summary.orders.map(o => o.lineName), ['Alice']);

    // the Excel the Kerry window downloads for that round
    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get(`/api/kerry/export_excel?sessionId=${live.session.id}`);
    assert.equal(file.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const text = [];
    wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
    assert.match(text.join('\n'), /Alice/, 'the claimed out-of-round customer must be shipped');
}));

test('two rounds on the same day: money received between them goes to round B, not round A', () => withSandbox(async sb => {
    const A = await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'A0001');
    await sb.waitForSlips(1);
    await sb.endLive();

    await slipFor(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'GAP0001');   // paid after round A ended, before round B
    await sb.waitForSlips(2);
    assert.equal(sb.slips()[1].session_id, null, 'out of round while no live is running');

    const B = await sb.startLive();
    const rows = sb.slips();
    assert.equal(rows[0].session_id, A.session.id, 'Alice stays in round A');
    assert.equal(rows[1].session_id, B.session.id, 'Bob joins round B');
    const st = await sb.stats();
    assert.deepEqual(st.queues.waiting.map(q => q.name), ['Bob'], 'round B queue shows Bob only');
    assert.equal(B.claimedOutOfRound, 1);
}));

test('only unfinished, recent slips are attached; finished/rejected/odd/old ones are left alone', () => withSandbox(async sb => {
    // waiting -> attached
    await slipFor(sb, 'Ugina', 'Gina', 'mg', 'kg', 140, 'REFG'); await sb.waitForSlips(1);
    // called / skipped (merchant touched them but did not finish) -> attached
    await slipFor(sb, 'Uhank', 'Hank', 'mh', 'kh', 140, 'REFH'); await sb.waitForSlips(2);
    await slipFor(sb, 'Uivy', 'Ivy', 'mi', 'ki', 140, 'REFI'); await sb.waitForSlips(3);
    // completed / cleared / rejected -> already resolved, left alone
    await slipFor(sb, 'Udave', 'Dave', 'md', 'kd', 140, 'REFD'); await sb.waitForSlips(4);
    await slipFor(sb, 'Ufrank', 'Frank', 'mf', 'kf', 140, 'REFF'); await sb.waitForSlips(5);
    await slipFor(sb, 'Uerin', 'Erin', 'me', 'ke', 140, 'REFE'); await sb.waitForSlips(6);
    // not enough money (wallet only, no item) -> left alone
    await slipFor(sb, 'Ucarol', 'Carol', 'mc', 'kc', 60, 'REFC'); await sb.waitForSlips(7);

    const idOf = (name) => sb.slips().find(r => r.line_name === name).id;
    await sb.post('/api/queue/action', { action: 'called', slipIds: [idOf('Hank')] });
    await sb.post('/api/queue/action', { action: 'skipped', slipIds: [idOf('Ivy')] });
    await sb.post('/api/queue/action', { action: 'completed', slipIds: [idOf('Dave')] });
    await sb.post('/api/queue/action', { action: 'cleared', slipIds: [idOf('Frank')] });
    await sb.post('/api/queue/reject_slip', { slipId: idOf('Erin') });
    // older than the look-back window (yesterday and today are in, the day before is out)
    const yesterday = sb.insertSlip({ name: 'Yesterday', line_id: 'Uy1', amount: 140, draws: 1, trans_date: bkkDate(-1), trans_ref: 'OLD1' });
    const tooOld = sb.insertSlip({ name: 'TooOld', line_id: 'Uy2', amount: 140, draws: 1, trans_date: bkkDate(-2), trans_ref: 'OLD2' });

    const live = await sb.startLive();
    const sessionOf = (name) => sb.slips().find(r => r.line_name === name).session_id;
    for (const n of ['Gina', 'Hank', 'Ivy', 'Yesterday']) assert.equal(sessionOf(n), live.session.id, `${n} should be attached`);
    for (const n of ['Dave', 'Frank', 'Erin', 'Carol', 'TooOld']) assert.equal(sessionOf(n), null, `${n} should be left alone`);
    assert.equal(live.claimedOutOfRound, 4);
    assert.ok(yesterday && tooOld);
}));

test('slips of an earlier round are never moved into a later round', () => withSandbox(async sb => {
    const A = await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'A0001'); await sb.waitForSlips(1);
    await sb.endLive();
    const B = await sb.startLive();
    assert.equal(sb.slips()[0].session_id, A.session.id);
    assert.equal(B.claimedOutOfRound, 0);
}));

test('shipping is not charged twice: pre-live buyer sends 100 more during the live and still gets an item', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'PRE0001'); await sb.waitForSlips(1);   // A + 40 shipping
    await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm2', 'k2', 100, 'LIVE0001'); await sb.waitForSlips(2);
    const second = sb.slips()[1];
    assert.equal(second.draws, 1, '100 baht buys A because shipping was already paid before the live');
    assert.equal(second.status, 'waiting');
}));

test('customer wallet is still reset to 0 when a live starts (v1.0.13 rule is unchanged)', () => withSandbox(async sb => {
    await slipFor(sb, 'Ucarol', 'Carol', 'mc', 'kc', 60, 'REFC'); await sb.waitForSlips(1);
    assert.equal(sb.sql('SELECT balance FROM customers WHERE line_id = ?', 'Ucarol')[0].balance, 60);
    await sb.startLive();
    assert.equal(sb.sql('SELECT balance FROM customers WHERE line_id = ?', 'Ucarol')[0].balance, 0);
}));

test('merged rounds (v1.0.15): items bought in round A count toward shipping in round B', () => withSandbox(async sb => {
    const A = await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'A0001'); await sb.waitForSlips(1);
    await sb.endLive({ holdMerge: true });
    const B = await sb.startLive();
    assert.equal(B.session.mergeFrom, A.session.id);
    await slipFor(sb, 'Ualice', 'Alice', 'm2', 'k2', 100, 'B0001'); await sb.waitForSlips(2);
    assert.equal(sb.slips()[1].draws, 1, 'no second shipping fee across merged rounds');
}));

test('a warning card raised before the live started (e.g. wrong-account slip) is still shown after the live starts', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slipOk('kw', { amount: 140, transRef: 'WRONGACC', receiverName: 'Somebody Else' });
    await sb.sendSlip('Ualice', 'mw', 'kw');
    await sb.waitFor(async () => (await sb.stats()).imageFails.length === 1, 8000, 'no card before the live');
    const live = await sb.startLive();
    const after = (await sb.stats()).imageFails;
    assert.equal(after.length, 1, 'the card must survive the start of the live');
    assert.match(after[0].reason, /Somebody Else/);
    assert.ok(live.session.id);
}));

test('no unexpected outside calls were made', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'X1'); await sb.waitForSlips(1);
    await sb.startLive();
    assert.deepEqual(sb.unexpectedCalls(), []);
}));
