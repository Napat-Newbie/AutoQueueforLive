// tests/unit/dev-report.test.js
// v1.0.20 (P5: 1.3 devReport): ประเมินความรุนแรงของข้อผิดพลาด และสร้าง embed ขออัปเดตเวอร์ชันใหม่
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const {
    assessErrorForDevReport,
    UPDATE_REQUEST_REPEAT_THRESHOLD,
    shouldRequestNewVersion,
    buildUpdateRequestEmbed
} = require(path.join(ROOT, 'lib', 'devReport'));

test('UPDATE_REQUEST_REPEAT_THRESHOLD: ค่าเพดานการเกิดซ้ำต้องเป็น 5', () => {
    assert.equal(UPDATE_REQUEST_REPEAT_THRESHOLD, 5);
});

test('assessErrorForDevReport: จัดระดับความรุนแรงและแนวทางแก้ไขถูกต้องตามกฎตายตัว', () => {
    // CRITICAL
    assert.equal(assessErrorForDevReport('SYSTEM_CRASH', 'uncaught exception').severity, 'CRITICAL');
    assert.equal(assessErrorForDevReport('SLIP', 'เก็บสลิปสำรองไม่สำเร็จ').severity, 'CRITICAL');

    // HIGH (network, db, provider, line, disk)
    assert.equal(assessErrorForDevReport('LINE', 'ETIMEDOUT').severity, 'HIGH');
    assert.equal(assessErrorForDevReport('DB', 'sqlite lock error').severity, 'HIGH');
    assert.equal(assessErrorForDevReport('SLIP', 'SlipOK quota 1009').severity, 'HIGH');
    assert.equal(assessErrorForDevReport('LINE', 'webhook verify failed').severity, 'HIGH');
    assert.equal(assessErrorForDevReport('SYSTEM', 'ดิสก์เต็ม').severity, 'HIGH');

    // MEDIUM (tunnel, gemini, kerry/excel, fallback)
    assert.equal(assessErrorForDevReport('TUNNEL', 'cloudflare tunnel dropped').severity, 'MEDIUM');
    assert.equal(assessErrorForDevReport('AI', 'gemini timeout reading ที่อยู่').severity, 'MEDIUM');
    assert.equal(assessErrorForDevReport('AI', 'gemini reading ที่อยู่ error').fix, 'ตรวจโควตา Gemini และปรับตัวอ่านที่อยู่สำรอง (Regex) ให้รองรับรูปแบบนี้');

    // Kerry / Excel export rule (ข้อความ error มี kerry/excel ต้องได้ severity MEDIUM และ cause 'ส่งออกไฟล์ Kerry ไม่สำเร็จ')
    const kerryErr = assessErrorForDevReport('EXPORT', 'เกิดข้อผิดพลาดในการสร้างไฟล์ kerry excel');
    assert.equal(kerryErr.severity, 'MEDIUM');
    assert.equal(kerryErr.cause, 'ส่งออกไฟล์ Kerry ไม่สำเร็จ');
    assert.equal(assessErrorForDevReport('KERRY', 'export error').severity, 'MEDIUM');
    assert.equal(assessErrorForDevReport('KERRY', 'export error').cause, 'ส่งออกไฟล์ Kerry ไม่สำเร็จ');
    assert.equal(assessErrorForDevReport('EXCEL', 'kerry error').severity, 'MEDIUM');
    assert.equal(assessErrorForDevReport('EXCEL', 'kerry error').cause, 'ส่งออกไฟล์ Kerry ไม่สำเร็จ');

    assert.equal(assessErrorForDevReport('UNKNOWN', 'random unexpected text').severity, 'MEDIUM');

    // null / undefined
    assert.equal(assessErrorForDevReport(null, null).severity, 'MEDIUM');
    assert.ok(assessErrorForDevReport(null, null).fix.length > 0);
});

test('shouldRequestNewVersion: ขอเวอร์ชันใหม่เมื่อเป็น CRITICAL หรือเกิดซ้ำถึงเพดาน', () => {
    assert.equal(shouldRequestNewVersion('CRITICAL', 0), true);
    assert.equal(shouldRequestNewVersion('CRITICAL', 1), true);
    assert.equal(shouldRequestNewVersion('HIGH', 0), false);
    assert.equal(shouldRequestNewVersion('HIGH', 4), false);
    assert.equal(shouldRequestNewVersion('HIGH', 5), true);
    assert.equal(shouldRequestNewVersion('HIGH', 6), true);
    assert.equal(shouldRequestNewVersion('MEDIUM', 10), true);
    assert.equal(shouldRequestNewVersion(null, 5), true);
    assert.equal(shouldRequestNewVersion(null, 2), false);
});

test('buildUpdateRequestEmbed: สร้าง embed ขออัปเดตเวอร์ชันใหม่ครบถ้วนตามโครงสร้าง', () => {
    const embed = buildUpdateRequestEmbed({
        problem: 'ระบบตรวจสลิปขัดข้อง',
        whyCannotSelfHeal: 'Error เกิดซ้ำ 5 ครั้งใน 30 นาที',
        tried: 'ลองเชื่อมต่อใหม่ 3 ครั้ง',
        fixGuidance: 'ตรวจสอบ API Key ของผู้ให้บริการ',
        meta: { shopLabel: 'ร้านสมมติ', version: '1.0.20' }
    });

    assert.match(embed.title, /ขออัปเดตเวอร์ชันใหม่/);
    assert.equal(embed.color, 15158332);
    assert.ok(Array.isArray(embed.fields));

    const shopField = embed.fields.find(f => f.name.includes('ร้าน / เวอร์ชัน'));
    assert.ok(shopField);
    assert.match(shopField.value, /ร้านสมมติ \/ v1\.0\.20/);

    const problemField = embed.fields.find(f => f.name.includes('ปัญหาที่พบ'));
    assert.ok(problemField);
    assert.match(problemField.value, /ระบบตรวจสลิปขัดข้อง/);

    const fixField = embed.fields.find(f => f.name.includes('ที่ผู้พัฒนาควรทำ'));
    assert.ok(fixField);
    assert.match(fixField.value, /ตรวจสอบ API Key/);
    assert.match(fixField.value, /ออกเวอร์ชันใหม่/);
});

test('anti-copy: ฟังก์ชันและค่าคงที่ต้องถูกย้ายออกจาก index.js', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.doesNotMatch(src, /function\s+assessErrorForDevReport\s*\(/, 'ห้ามมีนิยาม function assessErrorForDevReport ใน index.js');
    assert.doesNotMatch(src, /function\s+shouldRequestNewVersion\s*\(/, 'ห้ามมีนิยาม function shouldRequestNewVersion ใน index.js');
    assert.doesNotMatch(src, /function\s+buildUpdateRequestEmbed\s*\(/, 'ห้ามมีนิยาม function buildUpdateRequestEmbed ใน index.js');
    assert.doesNotMatch(src, /const\s+UPDATE_REQUEST_REPEAT_THRESHOLD\s*=\s*\d+;/, 'ห้ามมีนิยามค่าคงที่ UPDATE_REQUEST_REPEAT_THRESHOLD ซ้ำใน index.js');
});
