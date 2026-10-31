// tests/system/gemini-key-not-in-url.test.js
// Review follow-up (PR #7): the Gemini API key must travel in the `x-goog-api-key` header, never in the URL query string
// (a URL ends up in proxy / tunnel logs, axios error objects (error.config.url) and any log line that prints the request).
// Both call sites are covered: address extraction (parseThaiAddressWithAI) and the end-of-live AI opinion (getAiOpinionsForUnknownIssues).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

const KEY = 'AIzaSyTESTKEY-0123456789abcdef';
const ENV = { GEMINI_API_KEY: KEY };

const logText = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
function assertKeyOnlyInHeader(sb, call) {
    assert.ok(!call.url.includes(KEY), 'the key must not be in the URL: ' + call.url.replace(KEY, '<KEY>'));
    assert.ok(!/[?&]key=/.test(call.url), 'no ?key= query parameter');
    assert.equal(call.headers['x-goog-api-key'], KEY, 'the key is sent as the x-goog-api-key header');
    assert.ok(!sb.mock.calls.some(c => String(c.url).includes(KEY)), 'no outbound request of the app carries the key in its URL');
    assert.ok(!logText(sb).includes(KEY), 'system.log never contains the key');
    assert.ok(!sb.output.includes(KEY), 'stdout/stderr never contain the key');
}

test('address extraction: key is in the x-goog-api-key header, not in the URL, and the parsed address is still used', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.geminiReply = JSON.stringify({ recipient_name: 'สมชาย ใจดี', phone: '0812345678', address: '123 หมู่ 4', subdistrict: 'บางรัก', district: 'บางรัก', province: 'กรุงเทพ', postcode: '10500', remark: '' });
    await sb.webhook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ualice' }, message: { type: 'text', id: 'txt1', text: 'สมชาย 0812345678 123 หมู่ 4 ต.บางรัก อ.บางรัก จ.กรุงเทพ 10500' } }]);
    await sb.waitFor(() => sb.mock.geminis.length >= 1, 8000, 'Gemini was not called for the address');
    assertKeyOnlyInHeader(sb, sb.mock.geminis[0]);
    assert.match(sb.mock.geminis[0].path, /gemini-3\.5-flash-lite:generateContent$/);
    await sb.waitFor(() => /Gemini AI สกัดที่อยู่สำเร็จ/.test(logText(sb)), 8000, 'the AI answer was not used');
}, null, ENV));

test('end-of-live AI opinion: key is in the header, not in the URL; the unknown WARN of the round is what is sent', () => withSandbox(async sb => {
    await sb.startLive();
    // a WARN that no rule in getLiveIssueRules matches -> an "unknown" group -> one Gemini call at the end of the live
    const r = await sb.post('/api/auth/login', { username: 'Dreamdev', password: 'definitely-wrong' });
    assert.equal(r.status, 401);
    await sb.waitFor(() => /เข้าสู่ระบบผู้พัฒนาไม่สำเร็จ/.test(logText(sb)), 8000, 'the WARN was not logged');
    sb.mock.geminiReply = JSON.stringify([{ i: 1, opinion: 'ทดสอบความเห็นเสริม' }]);
    await sb.endLive();
    await sb.waitFor(() => sb.mock.geminis.length >= 1, 8000, 'Gemini was not asked for an opinion');
    const call = sb.mock.geminis[0];
    assertKeyOnlyInHeader(sb, call);
    assert.match(JSON.stringify(call.body), /เข้าสู่ระบบผู้พัฒนาไม่สำเร็จ/, 'the unknown WARN is in the prompt');
}, null, ENV));

test('when Gemini fails (HTTP 500) nothing the app logs or prints contains the key', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');   // geminiReply stays null -> the mock answers 500
    await sb.webhook([{ type: 'message', replyToken: 'rt', source: { type: 'user', userId: 'Ualice' }, message: { type: 'text', id: 'txt2', text: 'สมชาย 0812345678 10500 ส่งที่ ซอย 5' } }]);
    await sb.waitFor(() => sb.mock.geminis.length >= 1, 8000, 'Gemini was not called');
    // v1.0.19: a 500 is temporary -> "ยังสกัดที่อยู่ไม่ได้ตอนนี้ ... จะลองใหม่อัตโนมัติ" (a hard failure still says "ไม่สำเร็จ")
    await sb.waitFor(() => /Gemini AI (สกัดที่อยู่ไม่สำเร็จ|ยังสกัดที่อยู่ไม่ได้ตอนนี้)/.test(logText(sb)), 8000, 'failure not logged');
    assertKeyOnlyInHeader(sb, sb.mock.geminis[0]);
}, null, ENV));
