// tests/system/shop-account-names.test.js
// v1.0.17: the shop can set a Thai AND an English account name. A slip passes the "right account" check when any name SlipOK gives for the receiver
// (displayName / name) contains either shop name. Real case: a TrueMoney slip comes back with the receiver in English only ("MANTIYA J").
// Runs the real index.js in a sandbox with the fake SlipOK / LINE (tests/harness).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let n = 0;
/** one customer sends one slip whose receiver SlipOK reports as `receiver` (displayName) / `receiverEn` (name) */
async function slip(sb, receiver, receiverEn) {
    n += 1;
    const user = 'Uc' + n, key = 'k' + n;
    sb.mock.profile(user, 'Cust' + n);
    sb.mock.slipOk(key, { amount: 756, transRef: 'APFNAME' + String(n).padStart(4, '0'), receiverName: receiver, receiverNameEn: receiverEn });
    await sb.sendSlip(user, 'm' + n, key);
    await sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= 1, 10000, 'slip not processed');
    await sleep(600);
}
const recorded = (sb) => sb.slips().length;
const redReason = async (sb) => ((await sb.stats()).imageFails[0] || {}).reason || '';

test('Thai name only (as before): a slip whose receiver comes back in English is flagged as a wrong account', () => withSandbox(async sb => {
    await slip(sb, 'MANTIYA J');
    assert.equal(recorded(sb), 0);
    assert.match(await redReason(sb), /ไม่ตรงกับชื่อบัญชีร้าน/);
}, { merchant: 'มัญญิญา' }));

test('Thai + English names: the TrueMoney-style slip (English receiver) is accepted', () => withSandbox(async sb => {
    await slip(sb, 'MANTIYA J');
    assert.equal(recorded(sb), 1);
    assert.equal(sb.slips()[0].amount, 756);
}, { merchant: 'มัญญิญา', merchantEn: 'Mantiya' }));

test('Thai + English names: an ordinary bank slip with a Thai receiver is still accepted', () => withSandbox(async sb => {
    await slip(sb, 'นางสาว มัญญิญา จ');
    assert.equal(recorded(sb), 1);
}, { merchant: 'มัญญิญา', merchantEn: 'Mantiya' }));

test('the match is on either of the two receiver fields: Thai in displayName OR English in name', () => withSandbox(async sb => {
    await slip(sb, 'บัญชี ร้านค้า', 'MANTIYA J');   // displayName does not match, name does
    assert.equal(recorded(sb), 1);
}, { merchant: 'มัญญิญา', merchantEn: 'Mantiya' }));

test('a slip to somebody else is still refused, and the red card names both shop names', () => withSandbox(async sb => {
    await slip(sb, 'SOMEBODY ELSE');
    assert.equal(recorded(sb), 0);
    const why = await redReason(sb);
    assert.match(why, /SOMEBODY ELSE/); assert.match(why, /มัญญิญา/); assert.match(why, /Mantiya/);
}, { merchant: 'มัญญิญา', merchantEn: 'Mantiya' }));

test('English name only (Thai left empty): the check is active with that name', () => withSandbox(async sb => {
    await slip(sb, 'MANTIYA J');
    assert.equal(recorded(sb), 1);
    await slip(sb, 'SOMEBODY ELSE');
    assert.equal(recorded(sb), 1, 'the second one is refused');
}, { merchant: '', merchantEn: 'mantiya' }));

test('no shop name at all: nothing is checked (unchanged)', () => withSandbox(async sb => {
    await slip(sb, 'ANYONE');
    assert.equal(recorded(sb), 1);
}, { merchant: '' }));

test('upper/lower case does not matter, and a partial English name is enough (banks cut the end of the name)', () => withSandbox(async sb => {
    await slip(sb, 'MANTIYA J');
    assert.equal(recorded(sb), 1);
}, { merchant: 'ร้านนี้', merchantEn: 'MaNtI' }));

test('the English name is saved and read back through the settings API; clearing it works', () => withSandbox(async sb => {
    assert.equal((await sb.get('/api/config')).json.merchantAccountNameEn, 'Mantiya');
    await sb.post('/api/config', { newMerchantNameEn: '  ' });
    assert.equal((await sb.get('/api/config')).json.merchantAccountNameEn, '');
    assert.equal(sb.sql("SELECT value FROM configs WHERE key = 'merchant_account_name_en'")[0].value, '', 'stored (so it survives a restart)');
}, { merchant: 'มัญญิญา', merchantEn: 'Mantiya' }));
