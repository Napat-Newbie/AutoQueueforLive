// tests/unit/pack-manifest.test.js
// v1.0.19 backlog: pack_update.js --publish must exit non-zero on failure, and the raw-URL
// manifest rewrite (the step between commit A and commit B, done BY HAND until now) must be
// a command. These tests pin the new pure/IO-injected pieces of pack_update.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildRawUrl, rewriteManifest } = require('../../pack_update.js');

test('buildRawUrl builds the raw.githubusercontent URL the updater allowlist expects', () => {
    assert.equal(
        buildRawUrl('a749f9b0123456789', '1.0.18'),
        'https://raw.githubusercontent.com/Napat-Newbie/AutoQueueforLive/a749f9b0123456789/releases/update_v1.0.18.zip'
    );
});

test('rewriteManifest rewrites downloadUrl only after the downloaded zip matches the manifest sha256', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packtest-'));
    const manifestPath = path.join(dir, 'version.json');
    const goodSha = require('crypto').createHash('sha256').update('ZIPBYTES').digest('hex');
    fs.writeFileSync(manifestPath, JSON.stringify({ version: '1.0.19', sha256: goodSha, downloadUrl: 'https://github.com/x/y/releases/download/v1.0.19/update_v1.0.19.zip' }), 'utf8');
    const sha = 'cafe1234';

    // ผ่าน: ตัวโหลดคืนไบต์ที่แฮชแล้วตรงกับ manifest → ไฟล์ถูกเขียน URL ใหม่
    const ok = rewriteManifest({ manifestPath, version: '1.0.19', commitSha: sha, download: () => Buffer.from('ZIPBYTES') });
    assert.equal(ok.ok, true, ok.message);
    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(after.downloadUrl, buildRawUrl(sha, '1.0.19'));
    assert.equal(after.sha256, goodSha, 'sha256 must not be touched');

    // พลาด: ไบต์ที่โหลดได้แฮวไม่ตรง → ห้ามเขียนไฟล์ และบอกเหตุผล
    fs.writeFileSync(manifestPath, JSON.stringify({ version: '1.0.19', sha256: goodSha, downloadUrl: 'old' }), 'utf8');
    const bad = rewriteManifest({ manifestPath, version: '1.0.19', commitSha: sha, download: () => Buffer.from('TAMPERED') });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /sha256/);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).downloadUrl, 'old', 'manifest untouched on failure');

    // พลาด: เวอร์ชันใน manifest ไม่ตรงกับที่ขอ → ห้ามเขียน (กันแก้ไฟล์ผิรุ่น)
    const wrongV = rewriteManifest({ manifestPath, version: '1.0.20', commitSha: sha, download: () => Buffer.from('ZIPBYTES') });
    assert.equal(wrongV.ok, false);
    assert.match(wrongV.message, /เวอร์ชัน/);

    fs.rmSync(dir, { recursive: true, force: true });
});

test('rewriteManifest reports a download failure without touching the manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packtest-'));
    const manifestPath = path.join(dir, 'version.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ version: '1.0.19', sha256: 'x', downloadUrl: 'old' }), 'utf8');
    const r = rewriteManifest({ manifestPath, version: '1.0.19', commitSha: 'sha', download: () => { throw new Error('HTTP 404'); } });
    assert.equal(r.ok, false);
    assert.match(r.message, /404/);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).downloadUrl, 'old');
    fs.rmSync(dir, { recursive: true, force: true });
});
