// tests/system/history-customer-key.test.js
// v1.0.17: /api/history_data carries the customer's LINE id as `customerKey` so the history page can count customers
// by person instead of by (repeatable) LINE name. Runs the real index.js in a sandbox.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

test('history_data rows carry the LINE id; two customers with the same LINE name have different keys', () => withSandbox(async sb => {
    const send = async (n, user, name, ref) => { sb.mock.profile(user, name); sb.mock.slipOk('k' + n, { amount: 140, transRef: ref }); await sb.sendSlip(user, 'm' + n, 'k' + n); await sb.waitForSlips(n); };
    await send(1, 'Usam1', 'Sam', 'HK001');
    await send(2, 'Usam2', 'Sam', 'HK002');
    const r = await sb.get('/api/history_data');
    assert.equal(r.status, 200);
    const keys = r.json.history.map(h => h.customerKey).sort();
    assert.deepEqual(keys, ['Usam1', 'Usam2']);
    assert.deepEqual(r.json.history.map(h => h.name), ['Sam', 'Sam']);
}));

test('a manual-image slip also carries the key (so the customer is the same person as their other slips)', () => withSandbox(async sb => {
    sb.mock.profile('Ubob', 'Bob'); sb.mock.slipUnreadable('ku');
    await sb.sendSlip('Ubob', 'mu', 'ku'); await sb.waitForSlips(1);
    const r = await sb.get('/api/history_data');
    assert.equal(r.json.history[0].customerKey, 'Ubob');
}));
