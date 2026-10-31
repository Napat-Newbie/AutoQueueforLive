// tests/unit/qr-ref.test.js
// Pins extractQrRef — the slip-QR reference parser (sub-tag 02 inside template tag 00).
// The three QR payloads below are REAL slip QRs captured during the 2026-10-31 owner-key experiment
// (scratch/slipok-qr-experiment.js). The KTB one's sub-tag 02 was verified to equal the transRef
// SlipOK returned on a successful verify, byte for byte (A0aa74ba726a04481) — that is the whole
// basis for matching keyed slips by reference instead of guessing from the time window.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const INDEX = path.join(__dirname, '..', '..', 'index.js');
const env = () => load(INDEX, { functions: ['extractQrRef'], globals: {} });

test('real Bangkok Bank slip QR: sub-tag 02 = date + time + digits', () => {
    assert.equal(env().extractQrRef('004600060000010103002022520261031140047230057235085102TH910468F0'), '2026103114004723005723508');
});

test('real SCB slip QR: sub-tag 02 = date-ish + alphanumeric reference', () => {
    assert.equal(env().extractQrRef('0046000600000101030140225202610039r7bISZu9bair2yQu5102TH91044849'), '202610039r7bISZu9bair2yQu');
});

test('real KTB slip QR: sub-tag 02 is EXACTLY the transRef SlipOK returned on the 200 answer', () => {
    assert.equal(env().extractQrRef('0038000600000101030060217A0aa74ba726a044815102TH910431B6'), 'A0aa74ba726a04481');
});

test('garbage input is rejected, never guessed', () => {
    const f = env().extractQrRef;
    assert.equal(f(''), null);
    assert.equal(f(null), null);
    assert.equal(f(undefined), null);
    assert.equal(f('QR'), null);            // the old mock's fake qrcodeData
    assert.equal(f('0006abc'), null);       // length field not numeric
    assert.equal(f('0099ZZ'), null);        // declared length overruns the text
});
