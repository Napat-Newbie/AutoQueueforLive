// tests/unit/dates.test.js
// v1.0.19: the date/time helpers now live in lib/dates.js (everything Bangkok-time).
// These are direct tests of the module - the classic slipok-codes test still cuts
// stampToSec out of the real module file with its original assertions.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../lib/dates');

test('stampToSec: exact known values (read as UTC of the Bangkok wall clock)', () => {
    assert.equal(D.stampToSec('20261031', '18:39:24'), Date.UTC(2026, 9, 31, 18, 39, 24) / 1000);
    assert.equal(D.stampToSec('20261031', '9:59'), Date.UTC(2026, 9, 31, 9, 59, 0) / 1000, 'H:MM without seconds is accepted (bank slips use both shapes)');
});

test('stampToSec: malformed input is null, never a guess', () => {
    assert.equal(D.stampToSec('2026-10-31', '18:39'), null, 'dashed date is not the YYYYMMDD format');
    assert.equal(D.stampToSec('', ''), null);
    assert.equal(D.stampToSec(null, null), null);
    // กติกาเดิมตั้งแต่ต้น (จึงต้องคงไว้ตามหลักย้ายแบบไม่เปลี่ยนพฤติกรรม): ชั่วโมงไม่ถูกตรวจช่วง 0-23
    // "25:00" จึงผ่านแพทเทิร์นและล้นไปเป็นชั่วโมงที่ 1 ของวันถัดไป — จดไว้เป็น documented behaviour
    assert.equal(D.stampToSec('20261031', '25:00'), Date.UTC(2026, 10, 1, 1, 0, 0) / 1000);
});

test('today/time strings keep their Bangkok formats', () => {
    assert.match(D.getTodayString(), /^\d{8}$/, 'YYYYMMDD');
    assert.match(D.getLocalTimeString(), /^\d{2}:\d{2}:\d{2}$/, 'HH:MM:SS');
    assert.equal(D.bangkokDateString(0), D.getTodayString(), 'offset 0 is exactly today');
});

test('bangkokDateString steps whole days and pairs with stampToSec', () => {
    const today = D.bangkokDateString(0);
    const yesterday = D.bangkokDateString(-1);
    assert.notEqual(today, yesterday);
    // วันที่จากทั้งสองตัวต้องเว้นห่างกัน 1 วัน (86400 วินาที) เมื่อแปลงเป็นวินาทีร่วมกัน
    const diff = D.stampToSec(today, '12:00:00') - D.stampToSec(yesterday, '12:00:00');
    assert.equal(diff, 86400);
});
