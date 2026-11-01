// tests/unit/privacy.test.js
// v1.0.20 (P5: 1.2 privacy): ปิดบังข้อมูลส่วนตัว (เบอร์โทร/เลขบัตร) และการตัดบรรทัด log ของรอบไลฟ์
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { redactPersonalInfo, parseLogLineTime, sliceLogForLive } = require('../../lib/privacy');
const ROOT = path.join(__dirname, '..', '..');

const bkk = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h - 7, mi, s);

test('redactPersonalInfo: ปิดบังเลขบัตร 13 หลัก และเบอร์โทร แต่คงรหัสโปรแกรมที่ติด _ ไว้', () => {
    // เลขบัตรประชาชน
    assert.equal(redactPersonalInfo('บัตร 1103700012345 ของลูกค้า'), 'บัตร [เลขบัตร] ของลูกค้า');
    assert.equal(redactPersonalInfo('เลขบัตร:1103700012345'), 'เลขบัตร:[เลขบัตร]');

    // รหัสของโปรแกรมที่ติด _ ต้องไม่ถูกปิดบัง
    assert.equal(redactPersonalInfo('จบไลฟ์ (รหัสรอบ LIVE_1793450521936, ใช้เวลา 5 นาที)'), 'จบไลฟ์ (รหัสรอบ LIVE_1793450521936, ใช้เวลา 5 นาที)');
    assert.equal(redactPersonalInfo('/uploads/manual_1793435171091_Ubob.jpg'), '/uploads/manual_1793435171091_Ubob.jpg');

    // เบอร์โทรศัพท์ 9 หรือ 10 หลัก
    assert.equal(redactPersonalInfo('โทร 0812345678'), 'โทร 0xx-xxx-56xx');
    assert.equal(redactPersonalInfo('02-123-4567'), '0xx-xxx-45xx');

    // ค่าว่าง / null / undefined
    assert.equal(redactPersonalInfo(null), '');
    assert.equal(redactPersonalInfo(undefined), '');
    assert.equal(redactPersonalInfo(''), '');
});

test('parseLogLineTime: อ่านเวลาจากหัวบรรทัด log ถูกต้องทุกกรณี', () => {
    assert.equal(parseLogLineTime('[10/31/2026, 7:34:12 PM] [INFO] x'), bkk(2026, 10, 31, 19, 34, 12));
    assert.equal(parseLogLineTime('[10/31/2026, 7:34:12\u202fPM] [INFO] x'), bkk(2026, 10, 31, 19, 34, 12));
    assert.equal(parseLogLineTime('[11/1/2026, 12:05:00 AM] [WARN] x'), bkk(2026, 11, 1, 0, 5, 0));
    assert.equal(parseLogLineTime('[11/1/2026, 12:05:00 PM] [WARN] x'), bkk(2026, 11, 1, 12, 5, 0));
    assert.equal(parseLogLineTime('ไม่มีเวลาในบรรทัดนี้'), null);
    assert.equal(parseLogLineTime(''), null);
});

test('sliceLogForLive: ตัดเฉพาะบรรทัดที่อยู่ในช่วง [startMs, endMs]', () => {
    const text = [
        '[10/31/2026, 11:59:00 PM] [INFO] ก่อนเริ่ม',
        '[10/31/2026, 11:59:59 PM] [INFO] บรรทัดเริ่ม',
        'ข้อความขยะไม่มีเวลา',
        '[11/1/2026, 12:00:30 AM] [WARN] ในรอบหลังเที่ยงคืน',
        '[11/1/2026, 12:10:00 AM] [INFO] บรรทัดจบ',
        '[11/1/2026, 12:10:01 AM] [INFO] หลังจบ'
    ].join('\n');
    const out = sliceLogForLive(text, bkk(2026, 10, 31, 23, 59, 59), bkk(2026, 11, 1, 0, 10, 0));
    assert.deepEqual(out, [
        '[10/31/2026, 11:59:59 PM] [INFO] บรรทัดเริ่ม',
        '[11/1/2026, 12:00:30 AM] [WARN] ในรอบหลังเที่ยงคืน',
        '[11/1/2026, 12:10:00 AM] [INFO] บรรทัดจบ'
    ]);
});

test('anti-copy: ฟังก์ชันทั้งสามต้องถูกย้ายออกจาก index.js (ห้ามนิยามซ้ำ)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.doesNotMatch(src, /function\s+redactPersonalInfo\s*\(/, 'ห้ามมีนิยาม function redactPersonalInfo ใน index.js');
    assert.doesNotMatch(src, /function\s+parseLogLineTime\s*\(/, 'ห้ามมีนิยาม function parseLogLineTime ใน index.js');
    assert.doesNotMatch(src, /function\s+sliceLogForLive\s*\(/, 'ห้ามมีนิยาม function sliceLogForLive ใน index.js');
});
