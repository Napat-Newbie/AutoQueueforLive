// tests/unit/kerry-address.test.js
// v1.0.20 (P5: 1.5 kerryAddress): จัดรูปแบบที่อยู่จัดส่ง Kerry Express KEX EasyShip
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const { buildKerryFullAddress } = require(path.join(ROOT, 'lib', 'kerryAddress'));

test('buildKerryFullAddress: คืนค่าว่างเมื่อไม่มีที่อยู่ หรือค่าว่าง', () => {
    assert.equal(buildKerryFullAddress(null), '');
    assert.equal(buildKerryFullAddress(undefined), '');
    assert.equal(buildKerryFullAddress(''), '');
});

test('buildKerryFullAddress: กรณีที่อยู่เป็น string (คลีน slash และตัดรหัสไปรษณีย์ 5 หลัก)', () => {
    const raw = '123/45 หมู่ 2 แขวง/ต.บ้านไร่ เขต/อ.เมือง 10200';
    const out = buildKerryFullAddress(raw);
    assert.equal(out, '123/45 หมู่ 2 ต.บ้านไร่ อ.เมือง');
    assert.doesNotMatch(out, /10200/);
    assert.doesNotMatch(out, /แขวง\/ต\./);
    assert.doesNotMatch(out, /เขต\/อ\./);
});

test('buildKerryFullAddress: จัดที่อยู่กรุงเทพฯ (ใช้ แขวง/เขต/กรุงเทพมหานคร และตัดรหัสไปรษณีย์)', () => {
    const addr = {
        address: '99/1 ซอยอารีย์ พหลโยธิน 10400',
        subdistrict: 'สามเสนใน',
        district: 'พญาไท',
        province: 'กรุงเทพมหานคร',
        postcode: '10400'
    };
    const out = buildKerryFullAddress(addr);
    assert.equal(out, '99/1 ซอยอารีย์ พหลโยธิน แขวงสามเสนใน เขตพญาไท กรุงเทพมหานคร');
    assert.doesNotMatch(out, /10400/);
    assert.doesNotMatch(out, /ต\./);
    assert.doesNotMatch(out, /อ\./);
});

test('buildKerryFullAddress: จัดที่อยู่ต่างจังหวัด (ใช้ ต./อ./จ. และไม่เบิ้ลคำนำหน้าซ้ำ)', () => {
    const addr = {
        address: '55 หมู่ 4 ต.หนองหอย',
        subdistrict: 'ตำบลหนองหอย',
        district: 'อำเภอเมืองเชียงใหม่',
        province: 'จังหวัดเชียงใหม่',
        postcode: '50000'
    };
    const out = buildKerryFullAddress(addr);
    assert.equal(out, '55 หมู่ 4 ต.หนองหอย อ.เมืองเชียงใหม่ จ.เชียงใหม่');
    assert.doesNotMatch(out, /50000/);
    assert.doesNotMatch(out, /ต\.หนองหอย ต\.หนองหอย/);
});

test('buildKerryFullAddress: รองรับอักขระพิเศษในที่อยู่ (วงเล็บ, เครื่องหมายดอกจัน, บวก) โดยไม่พัง RegExp', () => {
    const addr = {
        address: '12/3 (ห้องพักครู) ซอย 5+6 *ข้างวัด*',
        subdistrict: 'บางปลา (โซนใหม่)',
        district: 'บางพลี',
        province: 'สมุทรปราการ',
        postcode: '10540'
    };
    assert.doesNotThrow(() => {
        const out = buildKerryFullAddress(addr);
        assert.match(out, /\(ห้องพักครู\)/);
        assert.match(out, /ต\.บางปลา \(โซนใหม่\)/);
        assert.match(out, /อ\.บางพลี/);
        assert.match(out, /จ\.สมุทรปราการ/);
    });
});

test('anti-copy: buildKerryFullAddress ต้องถูกย้ายออกจาก index.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.doesNotMatch(src, /function\s+buildKerryFullAddress\s*\(/, 'ห้ามมีนิยาม function buildKerryFullAddress ใน index.js');
});
