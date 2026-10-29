// tests/system/alert-events.test.js
// v1.0.16 dashboard alerts, server side. The real index.js runs in a sandbox; a tiny Socket.IO client listens like the
// browser would. Proves WHAT the server tells the dashboard (the browser-side look and sound are not covered here).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');
const { connectEvents } = require('../harness/sio-poll');

const send = (sb, user, name, msg, key, { amount = 140, ref, receiver = 'TestShop' } = {}) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref, receiverName: receiver });
    return sb.sendSlip(user, msg, key);
};
const processed = (sb, user, times = 1) => sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= times, 10000, `slip of ${user} not processed`)
    .then(() => new Promise(r => setTimeout(r, 400)));

test('wrong-account slip: dashboard gets slip_warning (kind wrong_account) and NOT the old image_failed ping', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'AEV0001', receiver: 'Somebody Else' });
        await processed(sb, 'Ualice');
        const w = ev.named('slip_warning');
        assert.equal(w.length, 1);
        assert.equal(w[0].data.kind, 'wrong_account');
        assert.equal(w[0].data.name, 'Alice');
        assert.match(w[0].data.reason, /Somebody Else/);
        assert.equal(ev.named('image_failed').length, 0, 'one sound only');
        // the red card + the red row source are still there
        assert.equal((await sb.stats()).imageFails.length, 1);
    } finally { ev.close(); }
}));

test('slip already used by another customer: slip_warning kind duplicate', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'AEV0002' });
    await sb.waitForSlips(1);
    const ev = await connectEvents(sb.base);
    try {
        await send(sb, 'Ubob', 'Bob', 'm2', 'k1', { ref: 'AEV0002' });
        await processed(sb, 'Ubob');
        const w = ev.named('slip_warning');
        assert.equal(w.length, 1);
        assert.equal(w[0].data.kind, 'duplicate');
        assert.equal(w[0].data.name, 'Bob');
    } finally { ev.close(); }
}));

test('normal slip still plays the normal ping and sends no warning', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'AEV0003' });
        await sb.waitForSlips(1);
        await sb.waitFor(() => ev.named('play_sound').length >= 1, 5000, 'no play_sound');
        assert.equal(ev.named('slip_warning').length, 0);
        assert.equal(ev.named('pending_amount_slip').length, 0);
    } finally { ev.close(); }
}));

test('unreadable slip (card waiting for the amount): pending_amount_slip with the name, instead of the normal ping', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        sb.mock.profile('Ubob', 'Bob');
        sb.mock.slipUnreadable('ku');
        await sb.sendSlip('Ubob', 'mu', 'ku');
        await sb.waitForSlips(1);
        await sb.waitFor(() => ev.named('pending_amount_slip').length >= 1, 5000, 'no pending_amount_slip');
        assert.equal(ev.named('pending_amount_slip')[0].data.name, 'Bob');
        assert.equal(ev.named('play_sound').length, 0, 'the generic ping is replaced by the chord');
    } finally { ev.close(); }
}));

test('customer sends the address in chat: address_updated event + the card flag turns to true without waiting for another slip', () => withSandbox(async sb => {
    await send(sb, 'Ualice', 'Alice', 'm1', 'k1', { ref: 'AEV0005' });
    await sb.waitForSlips(1);
    assert.equal((await sb.stats()).queues.waiting[0].hasAddress, false);

    const ev = await connectEvents(sb.base);
    try {
        const text = 'Alice 0812345678 99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110';
        await sb.webhook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ualice' }, message: { type: 'text', id: 'txt1', text } }]);
        await sb.waitFor(() => ev.named('address_updated').length >= 1, 8000, 'no address_updated event');
        assert.ok(ev.named('address_updated')[0].data.name);
        // the screen is refreshed by itself: a full_sync that already carries the new flag
        await sb.waitFor(() => ev.named('full_sync').some(e => (e.data.queues.waiting || []).some(q => q.hasAddress === true)), 8000, 'no full_sync with hasAddress=true');
        assert.equal((await sb.stats()).queues.waiting[0].hasAddress, true);
    } finally { ev.close(); }
}));
