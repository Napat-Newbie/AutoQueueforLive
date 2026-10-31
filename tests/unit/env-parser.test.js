// tests/unit/env-parser.test.js
// v1.0.17: ตัวเฝ้า (supervisor) อ่านไฟล์ .env เองตอนที่โปรแกรมลูกพังซ้ำจนเลิกเปิดใหม่ เพื่อหยิบ webhook ไปส่ง
// ข้อความ "ขออัปเดตเวอร์ชันใหม่" เข้า Discord (index.js ต้นไฟล์) ตัวอ่านเดิมแบบง่ายติดกับดัก 2 อย่างที่ทำให้
// การแจ้งเตือนหายเงียบๆ ในจังหวะที่ต้องการมันที่สุด (HANDOFF §5): (1) คอมเมนต์ท้ายบรรทัดถูกเก็บติดไปกับค่า
// (2) บรรทัดที่ขึ้นต้นด้วย "export " แบบ Linux ถูกข้ามทั้งบรรทัด ฟังก์ชันจริงถูกตัดมาจาก index.js ผ่าน harness
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const ctx = load(path.join(__dirname, '..', '..', 'index.js'), { functions: ['parseEnvLines'] });
const parse = (t) => ctx.parseEnvLines(t);

test('plain KEY=value lines still parse exactly like the old reader (CRLF and LF)', () => {
    const env = parse('DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1/abc\r\nMERCHANT_ACCOUNT_NAME=ร้านตัวอย่าง\n');
    assert.equal(env.DISCORD_WEBHOOK_URL, 'https://discord.com/api/webhooks/1/abc');
    assert.equal(env.MERCHANT_ACCOUNT_NAME, 'ร้านตัวอย่าง');
});

test('a trailing comment is stripped instead of being glued onto the webhook URL', () => {
    const env = parse('DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1/abc # ช่องแจ้งเตือนของร้าน');
    assert.equal(env.DISCORD_WEBHOOK_URL, 'https://discord.com/api/webhooks/1/abc');
});

test('an "export " prefix (Linux style) no longer makes the line be skipped', () => {
    const env = parse('export DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1/abc');
    assert.equal(env.DISCORD_WEBHOOK_URL, 'https://discord.com/api/webhooks/1/abc');
});

test('comment-only lines, blank lines and lines without "=" are ignored', () => {
    const env = parse('# หมายเหตุบนสุด\n\nthis is not an assignment\nDISCORD_DEVREPORT_WEBHOOK_URL=https://discord.com/api/webhooks/2/xyz');
    assert.equal(Object.keys(env).length, 1);
    assert.equal(env.DISCORD_DEVREPORT_WEBHOOK_URL, 'https://discord.com/api/webhooks/2/xyz');
});

test('quoted values keep # inside, stop at the closing quote, and lose the quotes', () => {
    const env = parse('NAME="a # b" # คอมเมนต์ท้ายบรรทัด\nOTHER=\'x y\'');
    assert.equal(env.NAME, 'a # b');
    assert.equal(env.OTHER, 'x y');
});
