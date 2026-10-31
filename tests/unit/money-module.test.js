// tests/unit/money-module.test.js
// v1.0.19: the money formulas now live in lib/money.js as pure functions taking the shop config.
// These cases mirror the classic assertions of tests/unit/money.test.js (which still cuts the
// index.js wrappers) — both files passing together proves the extraction changed nothing.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Money = require('../../lib/money');

const cfg = (over = {}) => ({ priceList: [{ name: 'A', price: 100 }, { name: 'B', price: 200 }], shippingFee: 40, freeShippingThreshold: 3, addLog() {}, ...over });

test('140 baht buys one A and pays the 40 shipping', () => {
    const r = Money.calculateBestDrawsCore(cfg(), 140, 0);
    assert.deepEqual({ draws: r.draws, remainder: r.remainder, cost: r.cost, appliedShipping: r.appliedShipping, isFreeShip: r.isFreeShip }, { draws: 1, remainder: 0, cost: 140, appliedShipping: true, isFreeShip: false });
    assert.deepEqual(r.breakdown, ['A x1']);
});

test('holdExactPrice parks the money when the amount equals one price exactly (forgot the shipping)', () => {
    const logs = [];
    // 200 = ราคา B พอดี แต่ไม่มีค่าส่ง: ระบบเดิมจะให้ A+ค่าส่ง (draws=1) — holdExactPrice ต้องพักยอดไว้แทน
    const r = Money.calculateBestDraws(cfg({ addLog: (lvl, msg) => logs.push(`${lvl} ${msg}`) }), 200, 0, { holdExactPrice: true });
    assert.equal(r.draws, 0);
    assert.equal(r.heldForShipping, true);
    assert.equal(r.remainder, 200);
    assert.ok(logs.some(l => l.includes('พักยอดรอค่าส่ง')));
    // ส่วน 100 พอดีราคา A (ซื้ออะไรไม่ได้อยู่แล้ว) ผลเหมือนกันแต่ไม่ผ่านกลไก hold — ยืนยันว่าเงินไม่หาย
    const r100 = Money.calculateBestDraws(cfg(), 100, 0, { holdExactPrice: true });
    assert.equal(r100.draws, 0);
    assert.equal(r100.remainder, 100);
});

test('describeTopup: held case asks for exactly the shipping fee', () => {
    const t = Money.describeTopup(cfg(), 100, 0);
    assert.deepEqual({ need: t.need, held: t.held }, { need: 40, held: true });
});

test('walletAfter keeps the remainder when draws were granted, the transferred money when not', () => {
    assert.equal(Money.walletAfter({ draws: 2, remainder: 15 }, 115), 15);
    assert.equal(Money.walletAfter({ draws: 0, remainder: 0 }, 80), 80);
});

test('fmtBaht formats integers and 2-decimal amounts the way the UI expects', () => {
    assert.equal(Money.fmtBaht(140), '140');
    assert.equal(Money.fmtBaht(140.5), '140.50');
    assert.equal(Money.fmtBaht(140.555), '140.56');
});

test('MAX_DP_BUDGET still matches the documented cap', () => {
    assert.equal(Money.MAX_DP_BUDGET, 500000);
});
