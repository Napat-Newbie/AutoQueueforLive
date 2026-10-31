// tests/unit/slipok-codes.test.js
// v1.0.17: SlipOK error codes are read as the SlipOK docs define them, and the "same payment keyed by hand + verified later" matcher.
// Real functions are cut out of index.js and run in a vm.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(process.env.AQ_TEST_INDEX_JS || path.join(__dirname, '..', '..', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
function cut(name, keyword = 'function') {
    const start = src.indexOf(`${keyword} ${name}`);
    if (start < 0) throw new Error(`${name} not found in index.js`);
    return src.slice(start, src.indexOf('\n}\n', start) + 2);
}
const ctx = { Number, String, Object, Math, Date, Array };
vm.createContext(ctx);
vm.runInContext('const MANUAL_MATCH_TOLERANCE_SEC = 120;\nconst MANUAL_MATCH_MAX_AGE_SEC = 60 * 60;', ctx);
['classifySlipOkError', 'stampToSec', 'pickManualMatch'].forEach(n => vm.runInContext(cut(n), ctx));
const BBL = { code: 1010, message: 'x', data: { bankCode: '002', bankName: 'กรุงเทพ', delay: 7, qrcodeData: 'Q' } };

test('1010 (Bangkok Bank delay) is a calm WARN that names the bank and the minutes, not a credit problem', () => {
    const r = ctx.classifySlipOkError(400, BBL);
    assert.equal(r.kind, 'bank_delay'); assert.equal(r.level, 'WARN');
    assert.equal(r.bankName, 'กรุงเทพ'); assert.equal(r.delay, 7);
    assert.match(r.message, /ธนาคารกรุงเทพ/); assert.match(r.message, /7 นาที/);
    assert.ok(!/เครดิต/.test(r.message), 'must not say credit is used up');
    assert.equal(ctx.classifySlipOkError(400, { code: 1010, data: {} }).level, 'WARN', 'missing bank/delay still handled');
});

test('customer-side and bank-side codes are WARN; only real problems are ERROR', () => {
    const lv = (code, status = 400) => ctx.classifySlipOkError(status, { code }).level;
    [1005, 1006, 1007, 1008, 1009, 1011, 1013, 1014].forEach(c => assert.equal(lv(c), 'WARN', 'code ' + c));
    [1000, 1001, 1002, 1003, 1004, 1999].forEach(c => assert.equal(lv(c), 'ERROR', 'code ' + c));
    assert.equal(ctx.classifySlipOkError(402, {}).kind, 'quota');
    assert.equal(ctx.classifySlipOkError(null, null).level, 'ERROR', 'no answer at all (network)');
    assert.match(ctx.classifySlipOkError(null, null).message, /เชื่อมต่อ SlipOK ไม่ได้/);
});

test('only the real quota codes (1003 package expired, 1004 over quota) are classed as quota; 1009/1006/1008 are not', () => {
    assert.equal(ctx.classifySlipOkError(400, { code: 1003 }).kind, 'quota');
    assert.equal(ctx.classifySlipOkError(400, { code: 1004 }).kind, 'quota');
    [1006, 1008, 1009, 1010].forEach(c => assert.notEqual(ctx.classifySlipOkError(400, { code: c }).kind, 'quota'));
    const line = src.split('\n').find(l => l.includes("status === 402 ||") && l.includes('errText.includes'));
    assert.ok(line, 'quota check line exists');
    assert.ok(!/code === 1009|code === 1006|code === 1008/.test(line), 'bank outage / bad image / not-a-payment-QR no longer mean "credit exhausted"');
    assert.match(line, /code === 1003 \|\| code === 1004/);
});

test('stampToSec reads yyyymmdd + HH:mm[:ss]; garbage gives null', () => {
    assert.equal(ctx.stampToSec('20261029', '23:42:37'), Date.UTC(2026, 9, 29, 23, 42, 37) / 1000);
    assert.equal(ctx.stampToSec('20261029', '9:05'), Date.UTC(2026, 9, 29, 9, 5, 0) / 1000);
    assert.equal(ctx.stampToSec('2026-10-29', '10:00:00'), null);
    assert.equal(ctx.stampToSec(undefined, '10:00:00'), null);
    assert.equal(ctx.stampToSec('20261029', 'abc'), null);
});

const manual = (id, amount, time, extra = {}) => ({ id, amount, trans_date: '20261029', trans_time: time, ...extra });
const T = (time) => ctx.stampToSec('20261029', time);

test('same payment: the image reached the system after the transfer -> matched; a LATER transfer of the same amount is a new payment', () => {
    const rows = [manual(1, 140, '10:00:30')];
    assert.equal(ctx.pickManualMatch(rows, 140, T('09:59:50')).id, 1, 'transferred just before the image arrived');
    assert.equal(ctx.pickManualMatch(rows, 140, T('10:30:00')), null, 'transferred 30 min after the first image: a second payment');
    assert.equal(ctx.pickManualMatch(rows, 140, T('10:01:00')).id, 1, 'clock difference up to 2 minutes is tolerated');
    assert.equal(ctx.pickManualMatch(rows, 140, T('10:03:30')), null, 'beyond the tolerance it is a new payment');
});

test('v1.0.17 review (owner decision 2026-10-31): a transfer older than the image by more than 60 minutes is NOT the keyed slip', () => {
    const rows = [manual(1, 140, '10:00:00')];
    assert.equal(ctx.pickManualMatch(rows, 140, T('09:10:00')).id, 1, '50 minutes before the image: inside the window');
    assert.equal(ctx.pickManualMatch(rows, 140, T('09:00:00')).id, 1, 'exactly 60 minutes: the inclusive edge of the window');
    assert.equal(ctx.pickManualMatch(rows, 140, T('08:59:59')), null, '60 minutes and 1 second: outside');
    assert.equal(ctx.pickManualMatch(rows, 140, T('02:00:00')), null, '8 hours before: an older, different payment');
    assert.equal(ctx.pickManualMatch(rows, 140, ctx.stampToSec('20261028', '18:00:00')), null, 'yesterday 18:00: never the keyed slip of today');
});

test('different amount, no rows, or unreadable time never match', () => {
    const rows = [manual(1, 140, '10:00:30')];
    assert.equal(ctx.pickManualMatch(rows, 150, T('09:59:50')), null);
    assert.equal(ctx.pickManualMatch([], 140, T('09:59:50')), null);
    assert.equal(ctx.pickManualMatch(rows, 140, null), null);
    assert.equal(ctx.pickManualMatch(rows, NaN, T('09:59:50')), null);
    assert.equal(ctx.pickManualMatch([manual(2, 140, 'bad')], 140, T('09:59:50')), null);
});

test('with two keyed slips of the same amount the OLDER one is used up first, so two real payments are still counted twice', () => {
    const rows = [manual(1, 140, '10:00:00'), manual(2, 140, '10:20:00')];
    assert.equal(ctx.pickManualMatch(rows, 140, T('09:59:00')).id, 1);
    assert.equal(ctx.pickManualMatch(rows.slice(1), 140, T('10:19:00')).id, 2, 'once #1 is linked (it leaves the list) the next verified slip matches #2');
});
