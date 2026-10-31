// tests/system/live-log-upload.test.js
// Owner request 2026-10-31: every time the merchant presses "จบไลฟ์", the system.log lines of THAT round are sent as a
// file to the Dev Report Discord channel (DISCORD_DEVREPORT_WEBHOOK_URL), so the developer can read them on any machine.
// Phone numbers / ID numbers are masked the same way as the activity channel (redactPersonalInfo).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

// must pass index.js DISCORD_WEBHOOK_RE (id 5-30 digits, token 20-120 chars) or the app treats it as "not configured"
const DEV = { DISCORD_DEVREPORT_WEBHOOK_URL: 'https://discord.com/api/webhooks/1234567890/aq-dev-report-test-token' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readLog = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
const logUploads = (sb) => sb.mock.discords.filter(d => d.raw && /system-log_LIVE_\d+\.txt/.test(d.raw));
const uploadFor = (sb, sid) => logUploads(sb).find(d => d.raw.includes(`system-log_${sid}.txt`));
const sendText = (sb, user, id, text) => sb.webhook([{ type: 'message', replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id, text } }]);
const slipFor = async (sb, user, name, msg, key, amount, ref, n) => {
    sb.mock.profile(user, name); sb.mock.slipOk(key, { amount, transRef: ref });
    await sb.sendSlip(user, msg, key); await sb.waitForSlips(n);
};

test('end of live: the round\'s system.log lines go to the Dev Report channel as a file, phones masked, nothing from before the round', () => withSandbox(async sb => {
    await slipFor(sb, 'Ubob', 'Bob', 'm1', 'k1', 140, 'PRELIVE1', 1);    // before the live
    await sleep(1200);                                                     // log timestamps have 1-second resolution
    const preLiveLines = readLog(sb).split('\n').filter(l => l.includes('Bob'));
    assert.ok(preLiveLines.length > 0, 'precondition: a pre-live log line mentions Bob');
    await sleep(1200);

    const live = await sb.startLive();
    const sid = live.session.id;
    await slipFor(sb, 'Ualice', 'Alice', 'm2', 'k2', 140, 'INLIVE01', 2);
    await sendText(sb, 'Ualice', 't1', 'สมหญิง รักดี\n99/1 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพ 10110\n0812345678');
    await sb.waitFor(() => /สกัดที่อยู่สำเร็จ/.test(readLog(sb)), 8000, 'address line not logged');
    await sb.endLive();

    const up = await sb.waitFor(() => uploadFor(sb, sid), 15000, 'no log file was sent to Discord after the live ended');
    assert.equal(up.path, '/api/webhooks/1234567890/aq-dev-report-test-token', 'sent to the Dev Report webhook');
    const raw = up.raw;
    assert.match(raw, new RegExp(`จบไลฟ์ \\(รหัสรอบ ${sid}`), 'the end-of-live line itself is in the file (file read after it was written)');
    assert.match(raw, /สกัดที่อยู่สำเร็จ/, 'lines from inside the round are in the file');
    assert.doesNotMatch(raw, /0812345678/, 'phone numbers are masked');
    assert.match(raw, /0xx-xxx-\d\dxx/, 'masked the same way as the activity channel');
    for (const l of preLiveLines) assert.ok(!raw.includes(l.trim()), 'a line from before the round must not be in the file: ' + l.slice(0, 80));
    assert.match(raw, new RegExp(`System log[^\\n]*${sid}`), 'the message text names the round');
}, null, DEV));

test('two rounds: each file has only its own round', () => withSandbox(async sb => {
    const a = await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'ROUNDA01', 1);
    await sb.endLive();
    await sb.waitFor(() => uploadFor(sb, a.session.id), 15000, 'round A file missing');
    await sleep(1200);
    const b = await sb.startLive();
    await slipFor(sb, 'Ucarol', 'Carol', 'm2', 'k2', 140, 'ROUNDB01', 2);
    await sb.endLive();
    const upB = await sb.waitFor(() => uploadFor(sb, b.session.id), 15000, 'round B file missing');
    assert.ok(!upB.raw.includes(`จบไลฟ์ (รหัสรอบ ${a.session.id}`), 'round A\'s end line is not in round B\'s file');
    assert.ok(upB.raw.includes(`จบไลฟ์ (รหัสรอบ ${b.session.id}`));
}, null, DEV));

test('no Dev Report webhook configured: no log file is sent anywhere', () => withSandbox(async sb => {
    await sb.startLive();
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'NOHOOK01', 1);
    await sb.endLive();
    await sleep(4000);
    assert.equal(logUploads(sb).length, 0);
}, null, { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/12345/aq-main' }));
