// tests/unit/money.test.js
// Pins the money rules of index.js (calculateBestDraws / describeTopup / walletAfter / fmtBaht).
// The functions are cut out of the real index.js (tests/harness/extract.js) and run with stub globals.
// Setup used everywhere: items A=100, B=200, shipping 40, free shipping at 3 items.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const INDEX = path.join(__dirname, '..', '..', 'index.js');
function env(overrides = {}) {
    return load(INDEX, {
        functions: ['calculateBestDraws', 'calculateBestDrawsCore', 'describeTopup', 'walletAfter', 'fmtBaht'],
        consts: ['MAX_DP_BUDGET'],
        // v1.0.19: สูตรแท้อยู่ใน lib/money.js — ตัวห่อใน index.js เรียกผ่านตัวแปร Money (ทุก assertion เดิมไม่แก้ = พิสูจน์พฤติกรรมเหมือนเดิม)
        globals: { Money: require('../../lib/money'), priceList: [{ name: 'A', price: 100 }, { name: 'B', price: 200 }], shippingFee: 40, freeShippingThreshold: 3, addLog() {}, ...overrides },
    });
}

test('140 baht buys one A and pays the 40 shipping', () => {
    const r = env().calculateBestDrawsCore(140, 0);
    assert.deepEqual({ draws: r.draws, remainder: r.remainder, cost: r.cost, appliedShipping: r.appliedShipping, isFreeShip: r.isFreeShip }, { draws: 1, remainder: 0, cost: 140, appliedShipping: true, isFreeShip: false });
    assert.deepEqual(r.breakdown, ['A x1']);
});

test('139 baht is not enough for anything (A + shipping = 140)', () => {
    const r = env().calculateBestDrawsCore(139, 0);
    assert.equal(r.draws, 0);
    assert.equal(r.remainder, 139);
});

test('exactly the price of B (200) with no shipping paid yet is held, not downgraded to A', () => {
    const e = env();
    const held = e.calculateBestDraws(200, 0, { holdExactPrice: true });
    assert.equal(held.draws, 0);
    assert.equal(held.heldForShipping, true);
    assert.equal(held.remainder, 200);
    // without the hold rule the same money would buy one A and keep 60
    const plain = e.calculateBestDraws(200, 0);
    assert.equal(plain.draws, 1);
    assert.equal(plain.remainder, 60);
});

test('three items reach the free-shipping threshold: 300 baht = A,A,A and no shipping', () => {
    const r = env().calculateBestDrawsCore(300, 0);
    assert.equal(r.draws, 3);
    assert.equal(r.isFreeShip, true);
    assert.equal(r.appliedShipping, false);
    assert.equal(r.cost, 300);
});

test('340 baht: B + A + 40 shipping uses every baht (remainder 0) and beats the 300 free-shipping combo (remainder 40)', () => {
    const r = env().calculateBestDrawsCore(340, 0);
    assert.equal(r.draws, 2);
    assert.equal(r.remainder, 0);
    assert.equal(r.cost, 340);
    assert.equal(r.appliedShipping, true);
    assert.deepEqual(r.breakdown, ['B x1', 'A x1']);
});

test('customer who already holds 2 items needs only one more to get free shipping', () => {
    const r = env().calculateBestDrawsCore(100, 2);
    assert.equal(r.draws, 1);
    assert.equal(r.isFreeShip, true);
    assert.equal(r.cost, 100);
});

test('no price list or unaffordable: nothing is bought and the money is kept', () => {
    assert.equal(env({ priceList: [] }).calculateBestDrawsCore(500, 0).draws, 0);
    assert.equal(env().calculateBestDrawsCore(99, 0).draws, 0);
});

test('describeTopup: exactly one item price is held for shipping; otherwise how much is still missing', () => {
    const e = env();
    assert.deepEqual({ ...e.describeTopup(100, 0) }, { need: 40, held: true, virtual: 100 });
    const t = e.describeTopup(60, 0);
    assert.equal(t.held, false);
    assert.equal(t.need, 80);                       // 100 (cheapest) + 40 shipping - 60
    assert.equal(e.describeTopup(100, 3).need, 0);  // shipping is free from the 3rd item on
});

test('walletAfter: got items -> keep the change; got nothing -> keep what was actually transferred', () => {
    const e = env();
    assert.equal(e.walletAfter({ draws: 1, remainder: 60 }, 200), 60);
    assert.equal(e.walletAfter({ draws: 0, remainder: 240 }, 200), 200);   // must NOT include the virtual shipping (bug of v1.0.7-1.0.10)
});

test('fmtBaht prints whole baht without decimals', () => {
    const e = env();
    assert.equal(e.fmtBaht(40), '40');
    assert.equal(e.fmtBaht(40.5), '40.50');
});
