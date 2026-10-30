// tests/system/dashboard-ergonomics.test.js
// v1.0.16 dashboard ergonomics, server side: transfer date + address flag on queue cards, no queue number for cards
// that still wait for the amount, "last slip" heartbeat, and the guard against shutting the program down during a live.
// Runs the real index.js in a sandbox (tests/harness/sandbox.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};
const pollHeartbeat = async (sb, wantNumber) => {
    for (let i = 0; i < 40; i++) {
        const r = await sb.get('/api/queue/slip_heartbeat');
        if (wantNumber ? typeof r.json.at === 'number' : r.json.at === null) return r.json;
        await new Promise(r2 => setTimeout(r2, 150));
    }
    throw new Error('heartbeat did not reach the expected state');
};

test('queue cards carry the transfer date and an address flag (same rule as the Kerry window)', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'ERGO1');
    await sb.waitForSlips(1);

    let card = (await sb.stats()).queues.waiting[0];
    assert.match(card.date, /^\d{8}$/, 'transfer date is sent to the screen');
    assert.ok(card.time, 'transfer time is sent too');
    assert.equal(card.hasAddress, false, 'no address yet');

    // phone + postcode + address all present -> true
    sb.exec("INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)", 'cust_addr_Ualice', JSON.stringify({ recipient_name: 'Alice', phone: '0812345678', address: '1 Test Road', postcode: '10110' }));
    card = (await sb.stats()).queues.waiting[0];
    assert.equal(card.hasAddress, true);

    // missing phone -> still false
    sb.exec("INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)", 'cust_addr_Ualice', JSON.stringify({ recipient_name: 'Alice', phone: '', address: '1 Test Road', postcode: '10110' }));
    card = (await sb.stats()).queues.waiting[0];
    assert.equal(card.hasAddress, false);
}));

test('a card that still waits for the amount (unreadable slip image) does not count as a queue position', () => withSandbox(async sb => {
    sb.mock.profile('Ubob', 'Bob');
    sb.mock.slipUnreadable('ku');
    await sb.sendSlip('Ubob', 'mu', 'ku');
    await sb.waitForSlips(1);
    await slipFor(sb, 'Ualice', 'Alice', 'm2', 'k2', 140, 'ERGO2');
    await sb.waitForSlips(2);

    const st = await sb.stats();
    assert.equal(st.queues.waiting.length, 2, 'both cards are on screen');
    assert.equal(st.queues.waiting.filter(q => q.isPendingAmount).length, 1);
    assert.equal(st.stats.waitingCount, 1, 'only the real queue counts (the card waiting for the amount does not)');
}));

test('last-slip heartbeat: empty at start, set as soon as a slip image arrives', () => withSandbox(async sb => {
    const first = await pollHeartbeat(sb, false);
    assert.equal(first.success, true);
    assert.equal(first.at, null);
    const before = Date.now();
    await slipFor(sb, 'Ualice', 'Alice', 'm3', 'k3', 140, 'ERGO3');
    const after = await pollHeartbeat(sb, true);
    assert.ok(after.at >= before - 1000 && after.at <= Date.now() + 1000, 'timestamp is "now"');
}));

test('shutdown during a live is refused (409) unless confirmed twice; the program keeps running', () => withSandbox(async sb => {
    // /api/system/shutdown needs the merchant to be logged in (first-time password setup works from the shop machine itself)
    const login = await fetch(sb.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'shop1234' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.ok(cookie, 'got a session cookie');
    const shutdown = (body) => fetch(sb.base + '/api/system/shutdown', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

    await sb.startLive();
    const r = await shutdown({});
    assert.equal(r.status, 409);
    assert.equal((await r.json()).code, 'LIVE_ACTIVE');
    // still alive and still live
    const cur = await sb.get('/api/live_session/current');
    assert.equal(cur.status, 200);
    assert.ok(cur.json.session && cur.json.session.startTime, 'live session untouched');
}));
