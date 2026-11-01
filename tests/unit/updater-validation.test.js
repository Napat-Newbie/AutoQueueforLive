// tests/unit/updater-validation.test.js
// v1.0.20 (P5: 1.6): ตัวตรวจความถูกต้องของการอัปเดตระบบ (lib/updaterValidation.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.js');
const {
    compareVersions,
    DEFAULT_MANIFEST_URL,
    isUpdateUrlAllowed,
    updaterEnv
} = require(path.join(ROOT, 'lib', 'updaterValidation'));

test('compareVersions: เปรียบเทียบ semantic version ได้ถูกต้อง', () => {
    assert.equal(compareVersions('1.0.20', '1.0.19'), 1);
    assert.equal(compareVersions('1.0.19', '1.0.20'), -1);
    assert.equal(compareVersions('1.0.20', '1.0.20'), 0);
    assert.equal(compareVersions('v1.0.20', '1.0.20'), 0);
    assert.equal(compareVersions('1.1', '1.0.9'), 1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
    assert.equal(compareVersions('1.0.0.1', '1.0.0'), 1);
    assert.equal(compareVersions('', ''), 0);
    assert.equal(compareVersions(null, undefined), 0);
});

test('DEFAULT_MANIFEST_URL: ชี้ไปยัง GitHub Releases ทางการและผ่านการตรวจสอบความปลอดภัย', () => {
    assert.equal(DEFAULT_MANIFEST_URL, 'https://github.com/Napat-Newbie/AutoQueueforLive/releases/latest/download/version.json');
    assert.equal(isUpdateUrlAllowed(DEFAULT_MANIFEST_URL), true);
});

test('isUpdateUrlAllowed: อนุญาตเฉพาะโดเมนและ Repository ทางการของ GitHub เท่านั้น', () => {
    // Official GitHub URLs
    assert.equal(isUpdateUrlAllowed('https://github.com/Napat-Newbie/AutoQueueforLive/releases/latest/download/version.json'), true);
    assert.equal(isUpdateUrlAllowed('https://github.com/Napat-Newbie/AutoQueueforLive/releases/download/v1.0.20/update_v1.0.20.zip'), true);
    assert.equal(isUpdateUrlAllowed('https://raw.githubusercontent.com/Napat-Newbie/AutoQueueforLive/main/releases/version.json'), true);
    assert.equal(isUpdateUrlAllowed('https://objects.githubusercontent.com/github-production-release-asset-2e65be/AutoQueueforLive/update.zip'), true);
    assert.equal(isUpdateUrlAllowed('https://release-assets.githubusercontent.com/github-production-release-asset/1419733580/update_v1.0.20.zip'), true);

    // Non-HTTPS rejected
    assert.equal(isUpdateUrlAllowed('http://github.com/Napat-Newbie/AutoQueueforLive/releases/version.json'), false);

    // Other repositories / domain spoofing rejected
    assert.equal(isUpdateUrlAllowed('https://github.com/attacker/AutoQueueforLive/releases/version.json'), false);
    assert.equal(isUpdateUrlAllowed('https://raw.githubusercontent.com/attacker/AutoQueueforLive/main/version.json'), false);
    assert.equal(isUpdateUrlAllowed('https://release-assets.githubusercontent.com/github-production-release-asset/9999999999/update.zip'), false);
    assert.equal(isUpdateUrlAllowed('https://evil.com/Napat-Newbie/AutoQueueforLive/version.json'), false);
    assert.equal(isUpdateUrlAllowed('https://notgithub.com'), false);

    // Local / arbitrary paths rejected
    assert.equal(isUpdateUrlAllowed('file:///C:/path/to/update.zip'), false);
    assert.equal(isUpdateUrlAllowed('C:\\Windows\\system32\\cmd.exe'), false);

    // Null / undefined / invalid inputs rejected
    assert.equal(isUpdateUrlAllowed(''), false);
    assert.equal(isUpdateUrlAllowed(null), false);
    assert.equal(isUpdateUrlAllowed(undefined), false);
    assert.equal(isUpdateUrlAllowed(123), false);
    assert.equal(isUpdateUrlAllowed({}), false);
});

test('updaterEnv: ลบ AQ_SUPERVISED และ AQ_RESTART_COUNT โดยคงค่าตัวแปรอื่นไว้ และไม่กระทบ object เดิม', () => {
    const input = {
        PATH: 'C:\\Windows',
        PORT: '3000',
        AQ_SUPERVISED: '1',
        AQ_RESTART_COUNT: '3',
        UPDATE_MANIFEST_URL: 'https://github.com/Napat-Newbie/AutoQueueforLive/releases/version.json'
    };
    const out = updaterEnv(input);
    assert.equal(out.AQ_SUPERVISED, undefined);
    assert.equal(out.AQ_RESTART_COUNT, undefined);
    assert.equal(out.PATH, 'C:\\Windows');
    assert.equal(out.PORT, '3000');
    assert.equal(out.UPDATE_MANIFEST_URL, 'https://github.com/Napat-Newbie/AutoQueueforLive/releases/version.json');
    assert.equal(input.AQ_SUPERVISED, '1', 'object เดิมต้องไม่ถูกแก้ไข');
    assert.equal(input.AQ_RESTART_COUNT, '3', 'object เดิมต้องไม่ถูกแก้ไข');

    // handles empty / null gracefully
    assert.deepEqual(updaterEnv(null), {});
    assert.deepEqual(updaterEnv(undefined), {});
});

test('anti-copy: ฟังก์ชันอัปเดตและ DEFAULT_MANIFEST_URL ต้องถูกย้ายออกจาก index.js', () => {
    const src = fs.readFileSync(INDEX, 'utf8');
    assert.doesNotMatch(src, /function\s+compareVersions\s*\(/, 'ห้ามมีนิยาม function compareVersions ใน index.js');
    assert.doesNotMatch(src, /function\s+isUpdateUrlAllowed\s*\(/, 'ห้ามมีนิยาม function isUpdateUrlAllowed ใน index.js');
    assert.doesNotMatch(src, /function\s+updaterEnv\s*\(/, 'ห้ามมีนิยาม function updaterEnv ใน index.js');
    assert.doesNotMatch(src, /const\s+DEFAULT_MANIFEST_URL\s*=\s*'https/, 'ห้ามมีนิยาม const DEFAULT_MANIFEST_URL = ใน index.js');
});
