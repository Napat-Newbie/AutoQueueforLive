// tests/system/out-of-round-accumulated.test.js
// Phase A (owner decision 2026-10-31): money that is NOT enough for an item yet ('accumulated'), received outside a
// live round (before pressing start, or between two rounds), must not vanish when the next round starts.
// The slip is attached to that round like the 'waiting' ones (rule "ก"), and the customer's wallet keeps that money
// after the v1.0.13 wallet reset -- but never more than what was really left in the wallet (money already spent on
// an item is not given back twice), and leftovers from an EARLIER round are still reset as before.
// Sandbox defaults: A=100, B=200, shipping 40, free shipping from 3 items -> 60 baht alone buys nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};
const balanceOf = (sb, lineId) => {
    const r = sb.sql('SELECT balance FROM customers WHERE line_id = ?', lineId)[0];
    return r ? Number(r.balance) : null;
};

test('pre-live money that is not enough yet: kept in the wallet, attached to the round, counted, orange card shown', () => withSandbox(async sb => {
    await slipFor(sb, 'Ucarol', 'Carol', 'mc1', 'kc1', 60, 'PREC0001'); await sb.waitForSlips(1);
    assert.equal(sb.slips()[0].status, 'accumulated', 'precondition: 60 baht buys nothing');
    assert.equal(sb.slips()[0].session_id, null, 'precondition: arrived while no live was running');

    const live = await sb.startLive();
    assert.equal(live.claimedOutOfRound, 1, 'the not-enough slip is attached too');
    assert.equal(sb.slips()[0].session_id, live.session.id);
    assert.equal(balanceOf(sb, 'Ucarol'), 60, 'the 60 baht must still be in the wallet after the round starts');

    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 60, 'counted in the round money total');
    assert.equal(st.stats.totalSlips, 1);
    const card = st.topups.find(t => t.name === 'Carol');
    assert.ok(card, 'orange "needs to top up" card for Carol');
    assert.equal(card.need, 80, '60 in the wallet, A + shipping = 140 -> 80 more');

    // she tops up during the live: the item is priced from the REAL total (60 + 80)
    await slipFor(sb, 'Ucarol', 'Carol', 'mc2', 'kc2', 80, 'LIVEC0002'); await sb.waitForSlips(2);
    const second = sb.slips()[1];
    assert.equal(second.draws, 1, '60 + 80 = 140 buys A with shipping');
    assert.equal(second.status, 'waiting');
    assert.equal(balanceOf(sb, 'Ucarol'), 0);
    const after = await sb.stats();
    assert.deepEqual(after.queues.waiting.map(q => q.name), ['Carol']);
    assert.equal(after.topups.length, 0, 'orange card gone once she has an item');
    assert.equal(after.stats.totalAmount, 140);
}));

test('money between two rounds that is not enough yet goes to the NEXT round with the wallet kept (owner decision: all of it)', () => withSandbox(async sb => {
    const A = await sb.startLive();
    await sb.endLive();
    await slipFor(sb, 'Ucarol', 'Carol', 'mc1', 'kc1', 60, 'GAPC0001'); await sb.waitForSlips(1);
    const B = await sb.startLive();
    assert.equal(B.claimedOutOfRound, 1);
    assert.equal(sb.slips()[0].session_id, B.session.id, 'belongs to round B');
    assert.notEqual(B.session.id, A.session.id);
    assert.equal(balanceOf(sb, 'Ucarol'), 60);
}));

test('a leftover from an EARLIER round is still reset; only the money sent out of round is kept', () => withSandbox(async sb => {
    const A = await sb.startLive();
    await slipFor(sb, 'Udan', 'Dan', 'md1', 'kd1', 60, 'RA0001'); await sb.waitForSlips(1);   // inside round A, not enough
    await sb.endLive();
    await slipFor(sb, 'Udan', 'Dan', 'md2', 'kd2', 30, 'GAP0002'); await sb.waitForSlips(2);   // between rounds, still not enough
    assert.equal(balanceOf(sb, 'Udan'), 90, 'precondition: 60 from round A + 30 out of round');

    const B = await sb.startLive();
    const rows = sb.slips();
    assert.equal(rows[0].session_id, A.session.id, 'the round-A slip stays in round A');
    assert.equal(rows[1].session_id, B.session.id, 'the out-of-round slip joins round B');
    assert.equal(balanceOf(sb, 'Udan'), 30, 'round A leftover (60) reset as in v1.0.13, the 30 sent out of round is kept');
}));

test('out-of-round money already spent on an item is not given back a second time', () => withSandbox(async sb => {
    await slipFor(sb, 'Uerin', 'Erin', 'me1', 'ke1', 60, 'PREE0001'); await sb.waitForSlips(1);   // not enough
    await slipFor(sb, 'Uerin', 'Erin', 'me2', 'ke2', 80, 'PREE0002'); await sb.waitForSlips(2);   // 140 -> A + shipping
    assert.equal(sb.slips()[0].status, 'accumulated', 'precondition: first slip stays accumulated');
    assert.equal(sb.slips()[1].draws, 1);
    assert.equal(balanceOf(sb, 'Uerin'), 0, 'precondition: the wallet was spent');

    const live = await sb.startLive();
    assert.equal(live.claimedOutOfRound, 2);
    assert.equal(balanceOf(sb, 'Uerin'), 0, 'the 60 was already used for the item -- must not come back');
    const st = await sb.stats();
    assert.equal(st.topups.length, 0, 'no orange card: she already has her item');
    assert.equal(st.stats.totalAmount, 140);
}));

// Found in the field test 2026-10-31: the pre-live readiness window still said every wallet "will be reset to 0 --
// refund or tell the customer", even for out-of-round money that Phase A keeps. /api/queue/pending_balances now says,
// per customer, how much will be KEPT and how much RESET, with the same rule the live start applies.
test('pending_balances (readiness window): out-of-round not-enough money is reported as KEPT, not reset', () => withSandbox(async sb => {
    await slipFor(sb, 'Ucarol', 'Carol', 'mc1', 'kc1', 60, 'PBAL0001'); await sb.waitForSlips(1);
    const b = (await sb.get('/api/queue/pending_balances')).json;
    assert.equal(b.success, true);
    assert.equal(b.total, 60);
    assert.equal(b.keepTotal, 60);
    assert.equal(b.resetTotal, 0);
    assert.equal(b.keepCount, 1);
    assert.equal(b.resetCount, 0);
    assert.deepEqual(b.list.map(c => [c.name, c.balance, c.keep, c.reset]), [['Carol', 60, 60, 0]]);
}));

test('pending_balances: an earlier-round leftover is reported as RESET and matches what the live start really does', () => withSandbox(async sb => {
    await sb.startLive();
    await slipFor(sb, 'Udan', 'Dan', 'md1', 'kd1', 60, 'PBAL0101'); await sb.waitForSlips(1);   // inside round A
    await sb.endLive();
    await slipFor(sb, 'Udan', 'Dan', 'md2', 'kd2', 30, 'PBAL0102'); await sb.waitForSlips(2);   // between rounds
    const b = (await sb.get('/api/queue/pending_balances')).json;
    assert.deepEqual(b.list.map(c => [c.name, c.balance, c.keep, c.reset]), [['Dan', 90, 30, 60]]);
    assert.equal(b.keepTotal, 30);
    assert.equal(b.resetTotal, 60);
    await sb.startLive();
    assert.equal(balanceOf(sb, 'Udan'), 30, 'the preview said 30 kept -- the live start must keep exactly that');
}));
