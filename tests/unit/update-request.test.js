// tests/unit/update-request.test.js
// Pins the "request new version" rules (shouldRequestNewVersion / buildUpdateRequestEmbed in index.js):
// a CRITICAL error, or the same error repeating to the threshold within 30 minutes, means Self-Healing
// cannot fix it — the dev-report channel must receive a postal-style update request naming the
// installed version and telling the developer to ship a new version.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const {
    buildUpdateRequestEmbed,
    shouldRequestNewVersion,
    UPDATE_REQUEST_REPEAT_THRESHOLD
} = require(path.join(ROOT, 'lib', 'devReport'));
function env() {
    return {
        buildUpdateRequestEmbed,
        shouldRequestNewVersion,
        UPDATE_REQUEST_REPEAT_THRESHOLD
    };
}

const field = (embed, name) => embed.fields.find(f => f.name.includes(name));

test('shouldRequestNewVersion: CRITICAL severity always asks for a new version, lower ones do not', () => {
    const { shouldRequestNewVersion } = env();
    assert.equal(shouldRequestNewVersion('CRITICAL', 0), true);
    assert.equal(shouldRequestNewVersion('HIGH', 0), false);
    assert.equal(shouldRequestNewVersion('MEDIUM', 1), false);
});

test('shouldRequestNewVersion: the same error repeating to the threshold asks for a new version', () => {
    const { shouldRequestNewVersion, UPDATE_REQUEST_REPEAT_THRESHOLD } = env();
    // ค่าเพดานถูก pin ผ่านพฤติกรรม (const ใน vm context อ่านเป็น property ตรง ๆ ไม่ได้)
    const below = (n) => shouldRequestNewVersion('HIGH', n) === false && shouldRequestNewVersion('MEDIUM', n) === false;
    const at = (n) => shouldRequestNewVersion('HIGH', n) === true;
    assert.ok(below(0) && below(3) && below(4), 'below the threshold must NOT request an update');
    assert.ok(at(5) && at(6) && at(50), 'at/above the threshold must request an update');
    assert.equal(shouldRequestNewVersion(null, 12), true);
    assert.ok(UPDATE_REQUEST_REPEAT_THRESHOLD === undefined || UPDATE_REQUEST_REPEAT_THRESHOLD === 5); // ไม่อ่านค่าตรง — ใช้พฤติกรรมด้านบน
});

test('buildUpdateRequestEmbed: names shop + installed version, the problem, why self-healing cannot fix it, and what to do', () => {
    const { buildUpdateRequestEmbed } = env();
    const e = buildUpdateRequestEmbed({
        problem: 'SlipOK ตอบ 500 ทุกครั้ง',
        whyCannotSelfHeal: 'เกิดซ้ำ 6 ครั้งใน 30 นาที',
        tried: 'ลองตรวจซ้ำ 3 รอบ',
        fixGuidance: 'เพิ่มการสลับไปผู้ให้บริการอื่นอัตโนมัติ',
        meta: { shopLabel: 'ร้านทดสอบ', version: '1.0.17' }
    });
    assert.match(e.title, /ขออัปเดตเวอร์ชันใหม่/);
    assert.match(field(e, 'ร้าน / เวอร์ชัน').value, /ร้านทดสอบ \/ v1\.0\.17/);
    assert.match(field(e, 'ปัญหาที่พบ').value, /SlipOK ตอบ 500/);
    assert.match(field(e, 'ทำไมระบบซ่อมเองไม่ได้').value, /เกิดซ้ำ 6 ครั้ง/);
    assert.match(field(e, 'สิ่งที่ระบบพยายามแล้ว').value, /ลองตรวจซ้ำ 3 รอบ/);
    assert.match(field(e, 'ที่ผู้พัฒนาควรทำ').value, /ออกเวอร์ชันใหม่/);
    assert.match(field(e, 'ที่ผู้พัฒนาควรทำ').value, /ตรวจสอบอัปเดต/);
});

test('buildUpdateRequestEmbed: optional tried/fix fields can be omitted without breaking the embed', () => {
    const { buildUpdateRequestEmbed } = env();
    const e = buildUpdateRequestEmbed({ problem: 'โปรแกรมพังซ้ำ 5 ครั้งใน 10 นาที', meta: {} });
    assert.ok(Array.isArray(e.fields) && e.fields.length >= 4);
    assert.equal(e.fields.find(f => f.name.includes('สิ่งที่ระบบพยายามแล้ว')), undefined);
    assert.match(field(e, 'ที่ผู้พัฒนาควรทำ').value, /ออกเวอร์ชันใหม่/);
});
