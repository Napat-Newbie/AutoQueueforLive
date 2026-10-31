// tests/unit/address-recipient-name.test.js
// Phase C (shop report 2026-10-31: Kerry export shows the LINE name instead of the name the customer typed --
// customers often put their name at the END of the message). The regex fallback used to read only the FIRST
// line, so it either missed the name or took an address line / chat words as the name.
// Real functions are cut out of index.js and run in a vm (tests/harness/extract.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const INDEX = process.env.AQ_TEST_APP_ROOT ? path.join(process.env.AQ_TEST_APP_ROOT, 'index.js') : path.join(__dirname, '..', '..', 'index.js');
const ctx = load(INDEX, { functions: ['parseThaiAddressFallback', 'pickRecipientName'] });
const nameOf = (text) => ctx.parseThaiAddressFallback(text, 'LINEname').recipient_name;

test('name on the first line (old behaviour kept)', () => {
    assert.equal(nameOf('สมชาย ใจดี\n99/1 ม.2 ต.บางพลี อ.บางพลี จ.สมุทรปราการ 10540\n0812345678'), 'สมชาย ใจดี');
});

test('name at the END of the message, after the address and phone', () => {
    assert.equal(nameOf('99/1 หมู่ 2 ต.บางพลี อ.บางพลี\nจ.สมุทรปราการ 10540\n0812345678\nสมหญิง รักดี'), 'สมหญิง รักดี');
});

test('no name at all: the address line is NOT used as the name -> LINE name', () => {
    assert.equal(nameOf('99/1 ซอย 5 ถนนสุขุมวิท\nแขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678'), 'LINEname');
});

test('first line is only the house number, the name with a title is further down', () => {
    assert.equal(nameOf('12/3\nนางสาว มาลี ศรีสุข\nต.ในเมือง อ.เมือง จ.ขอนแก่น 40000\n0891234567'), 'นางสาว มาลี ศรีสุข');
});

test('a line labelled "ชื่อ" wins, the label itself is removed', () => {
    assert.equal(nameOf('ที่อยู่ 5/5 ม.1 ต.หนองปรือ อ.บางละมุง จ.ชลบุรี 20150\nชื่อ: วิชัย มั่นคง\nโทร 0812345678'), 'วิชัย มั่นคง');
});

test('title น.ส. written without a space at the end of the message', () => {
    assert.equal(nameOf('88 ถนนนิมมาน ต.สุเทพ อ.เมือง จ.เชียงใหม่ 50200\n0812345678\nน.ส.กมลา ใจงาม'), 'น.ส.กมลา ใจงาม');
});

test('one-line message: the name before the phone number is used', () => {
    assert.equal(nameOf('สมชาย 0812345678 123 หมู่ 4 ต.บางพลี อ.บางพลี จ.สมุทรปราการ 10540'), 'สมชาย');
});

test('"คุณ" in front is dropped (same as before)', () => {
    assert.equal(nameOf('คุณสมใจ\n10/2 ต.ท่าช้าง อ.เมือง จ.จันทบุรี 22000\n0812345678'), 'สมใจ');
});

test('chat words are not a name: "เปลี่ยนเบอร์", "ขอบคุณค่ะ" -> no name (LINE name)', () => {
    assert.equal(nameOf('เปลี่ยนเบอร์ 0899999999'), 'LINEname');
    assert.equal(nameOf('99/1 ซอย 5 แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678\nขอบคุณค่ะ'), 'LINEname');
});

test('pickRecipientName returns "" when nothing looks like a name (caller decides the fallback)', () => {
    assert.equal(ctx.pickRecipientName('99/1 ซอย 5\n0812345678', '0812345678'), '');
});

// 2026-10-31 (owner approved): a message with nothing but a phone number used to store the WHOLE message as the
// address ("0899999999"), so the merge with the earlier address never kicked in and Kerry got a phone as address.
test('a message with only a phone number leaves the address EMPTY (so the earlier address can be kept)', () => {
    const r = ctx.parseThaiAddressFallback('0899999999', 'LINEname');
    assert.equal(r.phone, '0899999999');
    assert.equal(r.address, '');
    assert.equal(ctx.parseThaiAddressFallback('เปลี่ยนเบอร์ 0899999999', 'LINEname').address, '');
});

test('a normal address message still keeps its address text', () => {
    const r = ctx.parseThaiAddressFallback('สมชาย ใจดี\n99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678', 'LINEname');
    assert.match(r.address, /99\/1 ถนนสุขุมวิท/);
});
