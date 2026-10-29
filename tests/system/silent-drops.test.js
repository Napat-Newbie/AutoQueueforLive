// tests/system/silent-drops.test.js
// A customer paid and sent a slip, but the app deliberately does not record it. The shop owner must be able to SEE that
// (card on the dashboard + line in system.log) instead of the slip disappearing silently.
// Runs the real index.js in a sandbox (tests/harness/sandbox.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

const send = (sb, user, name, msg, key, { amount = 140, ref, receiver = 'TestShop' } = {}) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref, receiverName: receiver });
    return sb.sendSlip(user, msg, key);
};
/** the webhook answers 200 at once and works in the background: wait until it has asked LINE for the customer's name */
const processed = (sb, user, times = 1) => sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= times, 10000, `slip of ${user} not processed`)
    .then(() => new Promise(r => setTimeout(r, 300)));
const cards = async (sb) => (await sb.stats()).imageFails;

test('slip transferred to a different account name: no row, no money counted, but a card explains why', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'WRONG01', receiver: 'Somebody Else' });
    await processed(sb, 'Ualice');
    assert.equal(sb.slips().length, 0, 'not recorded');
    const c = await cards(sb);
    assert.equal(c.length, 1);
    assert.equal(c[0].name, 'Alice');
    assert.match(c[0].reason, /Somebody Else/);
    assert.match(c[0].reason, /TestShop/);
    assert.match(c[0].reason, /140/);
    // and the line survives a restart in the log file
    const log = fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8');
    assert.match(log, /\[WARN\].*Alice/s);
}));

test('same customer re-sends a slip that is already recorded: no second row and no noisy card', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'DUP0001' });
    await sb.waitForSlips(1);
    await send(sb, 'Ualice', 'Alice', 'm2', 'k1', { ref: 'DUP0001' });
    await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 1);
    assert.deepEqual(await cards(sb), []);
}));

test('a slip already recorded for ANOTHER customer is reported', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'DUP0002' });
    await sb.waitForSlips(1);
    await send(sb, 'Ubob', 'Bob', 'm2', 'k1', { ref: 'DUP0002' });
    await processed(sb, 'Ubob');
    assert.equal(sb.slips().length, 1);
    const c = await cards(sb);
    assert.equal(c.length, 1);
    assert.equal(c[0].name, 'Bob');
    assert.match(c[0].reason, /DUP0002/);
    assert.match(c[0].reason, /Alice/);
}));

test('re-sending a slip the shop already rejected is reported', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'DUP0003' });
    await sb.waitForSlips(1);
    await sb.post('/api/queue/reject_slip', { slipId: sb.slips()[0].id });
    await send(sb, 'Ualice', 'Alice', 'm2', 'k1', { ref: 'DUP0003' });
    await processed(sb, 'Ualice', 2);
    assert.equal(sb.slips().length, 1);
    const c = await cards(sb);
    assert.equal(c.length, 1);
    assert.match(c[0].reason, /ปัดตก/);
}));

test('a card can be acknowledged and then disappears', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'WRONG02', receiver: 'Somebody Else' });
    await processed(sb, 'Ualice');
    const [card] = await cards(sb);
    const r = await sb.post('/api/queue/dismiss_image_fail', { id: card.id });
    assert.equal(r.json.success, true);
    assert.deepEqual(await cards(sb), []);
}));

test('LINE image download keeps failing (v1.0.14): red card without a custom reason, nothing recorded', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.lineMessageFails('mf', 500);
    await sb.webhook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ualice' }, message: { type: 'image', id: 'mf' } }]);
    await sb.waitFor(async () => (await cards(sb)).length === 1, 15000, 'no red card after failed download');
    const [c] = await cards(sb);
    assert.ok(!c.reason, 'the download-failure card keeps its built-in text (no custom reason)');
    assert.equal(sb.slips().length, 0);
}));

test('provider cannot read the slip: goes to the manual-check queue, never lost', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slipUnreadable('ku');
    await sb.sendSlip('Ualice', 'mu', 'ku');
    await sb.waitForSlips(1);
    const row = sb.slips()[0];
    assert.match(row.qr_payload, /^manual_image\|/);
    assert.equal(row.status, 'waiting');
    assert.equal(row.amount, 0);
}));

test('not enough money: recorded as accumulated with a "top up" card, not lost', () => withSandbox(async sb => {
    await send(sb, 'Ucarol', 'Carol', 'm1', 'k1', { amount: 60, ref: 'LOW0001' });
    await sb.waitForSlips(1);
    assert.equal(sb.slips()[0].status, 'accumulated');
    const st = await sb.stats();
    assert.equal(st.topups.length, 1);
    assert.equal(st.topups[0].need, 80);
    assert.equal(st.recentSlips.length, 1);
}));

test('webhook with a wrong signature is refused and nothing is processed', () => withSandbox(async sb => {
    sb.mock.lineMessage('mx', 'kx');
    const r = await sb.webhook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ux' }, message: { type: 'image', id: 'mx' } }], { signature: 'not-a-valid-signature' });
    assert.equal(r.status, 401);
    await new Promise(r2 => setTimeout(r2, 400));
    assert.equal(sb.slips().length, 0);
    assert.equal(sb.mock.calls.filter(c => c.host === 'api-data.line.me').length, 0);
}));

test('LINE delivers the same message twice: processed once', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slipOk('k1', { amount: 140, transRef: 'ONCE0001' });
    sb.mock.lineMessage('mdup', 'k1');
    const ev = { type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ualice' }, message: { type: 'image', id: 'mdup' } };
    await sb.webhook([ev]);
    await sb.webhook([ev]);
    await sb.waitForSlips(1);
    await new Promise(r => setTimeout(r, 400));
    assert.equal(sb.slips().length, 1);
    assert.equal(sb.mock.calls.filter(c => c.host === 'api-data.line.me').length, 1);
}));

test('several customers in one webhook batch are all recorded (BUG-01)', () => withSandbox(async sb => {
    const mk = (u, m, k, ref) => { sb.mock.profile(u, u); sb.mock.slipOk(k, { amount: 140, transRef: ref }); sb.mock.lineMessage(m, k); return { type: 'message', replyToken: 'rt' + m, source: { type: 'user', userId: u }, message: { type: 'image', id: m } }; };
    await sb.webhook([mk('Ua', 'ma', 'ka', 'B1'), mk('Ub', 'mb', 'kb', 'B2'), mk('Uc', 'mc', 'kc', 'B3')]);
    await sb.waitForSlips(3);
    assert.deepEqual(sb.slips().map(r => r.line_id).sort(), ['Ua', 'Ub', 'Uc']);
}));

test('no unexpected outside calls were made', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'CLEAN1' });
    await sb.waitForSlips(1);
    assert.deepEqual(sb.unexpectedCalls(), []);
}));
