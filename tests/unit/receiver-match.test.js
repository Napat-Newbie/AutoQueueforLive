// tests/unit/receiver-match.test.js
// v1.0.17: the "was the money paid into the shop's account?" check, with a Thai and an English shop name.
// The real function is cut out of index.js and run in a vm.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(process.env.AQ_TEST_INDEX_JS || path.join(__dirname, '..', '..', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
const start = src.indexOf('function receiverMatchesShop(');
const ctx = { String, Array };
vm.createContext(ctx);
vm.runInContext(src.slice(start, src.indexOf('\n}\n', start) + 2), ctx);
const m = (receiver, names) => ctx.receiverMatchesShop(receiver, names);

test('no shop name set (empty, spaces, undefined) = nothing is checked', () => {
    [[], ['', ''], ['  ', undefined], null, undefined].forEach(names => assert.deepEqual({ ...m({ displayName: 'ANYONE' }, names) }, { checked: false, ok: true, shown: '' }));
});

test('Thai name matches a Thai receiver; English name matches an English receiver; either one is enough', () => {
    assert.equal(m({ displayName: 'นางสาว มัญญิญา จ' }, ['มัญญิญา', 'Mantiya']).ok, true);
    assert.equal(m({ displayName: 'MANTIYA J', name: 'MANTIYA J' }, ['มัญญิญา', 'Mantiya']).ok, true);
    assert.equal(m({ displayName: 'MANTIYA J', name: 'MANTIYA J' }, ['มัญญิญา', '']).ok, false, 'Thai name alone cannot match an English receiver (the old behaviour)');
});

test('both receiver fields are compared, not only the first one that has text', () => {
    assert.equal(m({ displayName: 'บัญชี ร้านค้า', name: 'MANTIYA J' }, ['มัญญิญา', 'Mantiya']).ok, true);
    assert.equal(m({ displayName: '', name: 'MANTIYA J' }, ['Mantiya']).ok, true);
    assert.equal(m({ accountName: 'Mantiya Shop' }, ['mantiya']).ok, true);
});

test('upper/lower case ignored; partial name is enough; a different person is refused; empty receiver is refused when a name is set', () => {
    assert.equal(m({ displayName: 'MANTIYA J' }, ['mAnTi']).ok, true);
    assert.equal(m({ displayName: 'SOMEBODY ELSE', name: 'SOMEBODY ELSE' }, ['มัญญิญา', 'Mantiya']).ok, false);
    const none = m({}, ['มัญญิญา']);
    assert.equal(none.checked, true); assert.equal(none.ok, false); assert.equal(none.shown, '');
    assert.equal(m(null, ['x']).ok, false);
});

test('the receiver text shown on the red card lists each different name once', () => {
    assert.equal(m({ displayName: 'MANTIYA J', name: 'MANTIYA J' }, ['zzz']).shown, 'MANTIYA J');
    assert.equal(m({ displayName: 'บัญชี ก', name: 'ACCOUNT K' }, ['zzz']).shown, 'บัญชี ก / ACCOUNT K');
});

test('static: settings page has the English field and saves it; only the Thai name feeds the Kerry sender', () => {
    assert.ok(html.includes('id="merchantEnInput"'));
    assert.match(html, /newMerchantNameEn = document\.getElementById\('merchantEnInput'\)\.value/);
    assert.match(html, /JSON\.stringify\(\{ newPrices, newShipping, newThreshold, newMerchantName, newMerchantNameEn, newOpenchatLink \}\)/);
    assert.ok(src.includes("const senderName = merchantAccountName || 'AutoQueueforLive';"), 'Kerry sender stays on the Thai name');
});
