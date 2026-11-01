// tests/unit/updater-env.test.js
// Found in the field test 2026-10-31 (real v1.0.16 -> v1.0.17 update on a Windows PC): after the one-click update the
// app came back WITHOUT its supervisor. The worker runs with AQ_SUPERVISED=1 (set by the supervisor); apply_update
// spawned updater.bat with that env, updater.bat -> AutoQueueforLive.vbs -> run_background.bat -> index.js inherited
// it, and index.js line "if (!process.env.AQ_SUPERVISED ...)" skipped starting a supervisor. Crash auto-restart was
// then gone until the merchant closed and reopened the program.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.js');
const { updaterEnv } = require(path.join(ROOT, 'lib', 'updaterValidation'));
const src = fs.readFileSync(INDEX, 'utf8');

test('updaterEnv drops the supervisor markers and keeps everything else', () => {
    const input = { PATH: 'C:\\Windows', NODE_OPTIONS: '--max-old-space-size=512', AQ_SUPERVISED: '1', AQ_RESTART_COUNT: '2', UPDATE_MANIFEST_URL: 'https://x' };
    const out = updaterEnv(input);
    assert.equal(out.AQ_SUPERVISED, undefined);
    assert.equal(out.AQ_RESTART_COUNT, undefined);
    assert.equal(out.PATH, 'C:\\Windows');
    assert.equal(out.NODE_OPTIONS, '--max-old-space-size=512');
    assert.equal(out.UPDATE_MANIFEST_URL, 'https://x');
    assert.equal(input.AQ_SUPERVISED, '1', 'the running process env is not changed');
});

test('apply_update starts updater.bat with updaterEnv(process.env)', () => {
    const i = src.indexOf("spawn('cmd.exe', ['/c', updaterBat");
    assert.ok(i > 0, 'updater spawn not found');
    const call = src.slice(i, src.indexOf('});', i));
    assert.match(call, /env:\s*updaterEnv\(process\.env\)/);
});
