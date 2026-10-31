// tests/system/address-gemini.test.js
// Owner request 2026-10-31 ("ทำให้ Gemini สกัดสำเร็จได้เยอะที่สุด เพราะเชื่อได้มากกว่า"), after a real-key evaluation:
// Gemini got 25/30 messages fully right (regex fallback 15/30), but (1) a Gemini answer without a postcode was thrown away
// silently, (2) a burst of messages hit HTTP 429 and every one after it fell back to the regex for good, and (3) whenever the
// fallback was used, the Kerry file's Remark column got the internal note "สกัดด้วยระบบสำรอง Regex ..." (printed on the parcel).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

const ENV = { GEMINI_API_KEY: 'test-gemini-key-not-real', AQ_AI_RETRY_SCALE: '0.02' };   // retry waits x0.02 in tests
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sendText = (sb, user, id, text) => sb.webhook([{ type: 'message', replyToken: `rt-${id}`, source: { type: 'user', userId: user }, message: { type: 'text', id, text } }]);
const addrOf = (sb, user) => { const r = sb.sql('SELECT value FROM configs WHERE key = ?', `cust_addr_${user}`)[0]; return r ? JSON.parse(r.value) : null; };
const readLog = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };
const ai = (o) => JSON.stringify(Object.assign({ recipient_name: '', phone: '', address: '', subdistrict: '', district: '', province: '', postcode: '', remark: '' }, o));
const RATE_LIMITED = { status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' }] } } };

// only Gemini fills the delivery remark (the fallback never does), so the remark proves whose answer is saved
const EMOJI_MSG = '📦 ส่งที่ 📦\n🙋‍♀️ พิมพ์ชนก แสนดี\n🏠 6/6 ต.บ้านใหม่ อ.ปากเกร็ด จ.นนทบุรี 11120\n📞 0823332211\nวางไว้หน้าประตูได้เลย';
const EMOJI_AI = ai({ recipient_name: 'พิมพ์ชนก แสนดี', phone: '0823332211', address: '6/6', subdistrict: 'บ้านใหม่', district: 'ปากเกร็ด', province: 'นนทบุรี', postcode: '11120', remark: 'วางไว้หน้าประตูได้เลย' });

test('a Gemini answer that misses the postcode is USED (not thrown away); the postcode comes from the message', () => withSandbox(async sb => {
    sb.mock.profile('Ujan', 'Jan LINE');
    sb.mock.geminiQueue.push({ text: ai({ recipient_name: 'จันทร์เพ็ญ ดีงาม', phone: '0631234567', address: '3/3', subdistrict: 'บ้านเป็ด', district: 'เมืองขอนแก่น', province: 'ขอนแก่น', postcode: '' }) });
    await sendText(sb, 'Ujan', 't1', 'สวัสดีค่ะ ส่งที่อยู่นะคะ\nจันทร์เพ็ญ ดีงาม\n3/3 ต.บ้านเป็ด อ.เมืองขอนแก่น จ.ขอนแก่น 40000\n0631234567');
    const a = await sb.waitFor(() => addrOf(sb, 'Ujan'), 8000, 'address not saved');
    assert.equal(a.recipient_name, 'จันทร์เพ็ญ ดีงาม', 'Gemini name used');
    assert.equal(a.postcode, '40000', 'missing postcode filled from the message');
    assert.equal(a.province, 'ขอนแก่น');
    assert.match(readLog(sb), /Gemini AI สกัดที่อยู่สำเร็จ/);
}, null, ENV));

test('Gemini phone is normalised (+66 / dashes -> 0XXXXXXXXX)', () => withSandbox(async sb => {
    sb.mock.profile('Uana', 'Ana');
    sb.mock.geminiQueue.push({ text: ai({ recipient_name: 'อนันต์ สุขใจ', phone: '+66 81-234-5678', address: '7 หมู่ 1', subdistrict: 'ท่าช้าง', district: 'เมืองจันทบุรี', province: 'จันทบุรี', postcode: '22000' }) });
    await sendText(sb, 'Uana', 't1', 'อนันต์ สุขใจ\n7 หมู่ 1 ต.ท่าช้าง อ.เมืองจันทบุรี จ.จันทบุรี 22000\n+66 81 234 5678');
    const a = await sb.waitFor(() => addrOf(sb, 'Uana'), 8000, 'address not saved');
    assert.equal(a.phone, '0812345678');
}, null, ENV));

test('HTTP 429: the fallback answer is saved at once, then Gemini is retried in the background and its answer replaces it', () => withSandbox(async sb => {
    sb.mock.profile('Upim', 'Pim LINE');
    sb.mock.geminiQueue.push(RATE_LIMITED, { text: EMOJI_AI });
    await sendText(sb, 'Upim', 't1', EMOJI_MSG);
    const first = await sb.waitFor(() => addrOf(sb, 'Upim'), 8000, 'nothing saved after the 429');
    assert.equal(first.postcode, '11120', 'the fallback result is there right away (Kerry is never empty)');
    const upgraded = await sb.waitFor(() => { const a = addrOf(sb, 'Upim'); return a && a.remark === 'วางไว้หน้าประตูได้เลย' ? a : null; }, 10000, 'the background Gemini retry never replaced the fallback answer');
    assert.equal(upgraded.recipient_name, 'พิมพ์ชนก แสนดี');
    assert.equal(upgraded.province, 'นนทบุรี');
    assert.equal(sb.mock.geminis.length, 2, 'one failed call + one retry');
    assert.match(readLog(sb), /Gemini AI สกัดที่อยู่สำเร็จ \(ลองใหม่/);
}, null, ENV));

test('a background retry never overwrites a NEWER address message from the same customer', () => withSandbox(async sb => {
    sb.mock.profile('Unid', 'Nid LINE');
    sb.mock.geminiQueue.push(RATE_LIMITED, { text: ai({ recipient_name: 'นิดา ใจกว้าง', phone: '0991112233', address: '77 ซ.ลาดกระบัง 54', subdistrict: 'ลาดกระบัง', district: 'ลาดกระบัง', province: 'กรุงเทพมหานคร', postcode: '10520' }) });
    await sendText(sb, 'Unid', 't1', 'นิดา ใจดี 0991110000\n1 ต.ในเมือง อ.เมืองขอนแก่น จ.ขอนแก่น 40000');   // -> 429, fallback, retry queued
    await sb.waitFor(() => addrOf(sb, 'Unid'), 8000, 'first message not saved');
    await sendText(sb, 'Unid', 't2', 'นิดา ใจกว้าง 0991112233\n77 ซ.ลาดกระบัง 54 แขวงลาดกระบัง เขตลาดกระบัง กรุงเทพ 10520');   // newer -> Gemini OK
    await sb.waitFor(() => (addrOf(sb, 'Unid') || {}).postcode === '10520', 8000, 'second message not applied');
    // timeline with scale 0.5: msg 1 -> 429 (Gemini paused ~2.5 s, retry of msg 1 due at ~2.5 s); msg 2 arrives inside the pause
    // -> fallback now + its own retry; at ~2.5 s the retry of msg 1 must be SKIPPED, the retry of msg 2 gets the Gemini answer
    await sb.waitFor(() => /ข้ามการลองสกัดที่อยู่ของ "Nid LINE"/.test(readLog(sb)), 8000, 'the outdated retry of message 1 was not skipped');
    await sb.waitFor(() => sb.mock.geminis.length >= 2, 8000, 'message 2 was never retried with Gemini');
    await sleep(500);
    const a = addrOf(sb, 'Unid');
    assert.equal(a.postcode, '10520', 'still the newer address');
    assert.equal(a.phone, '0991112233');
    assert.equal(a.province, 'กรุงเทพมหานคร');
    assert.equal(sb.mock.geminis.length, 2, 'the outdated retry is dropped without calling Gemini');
}, null, Object.assign({}, ENV, { AQ_AI_RETRY_SCALE: '0.5' })));

test('a non-retryable error (bad key, 403) is not retried; the fallback answer stays and a WARN is written', () => withSandbox(async sb => {
    sb.mock.profile('Ubad', 'Bad');
    sb.mock.geminiQueue.push({ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'API key not valid' } } });
    await sendText(sb, 'Ubad', 't1', 'สมชาย ใจดี\n99/1 หมู่ 2 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540\n0812345678');
    await sb.waitFor(() => addrOf(sb, 'Ubad'), 8000, 'not saved');
    await sleep(1200);
    assert.equal(sb.mock.geminis.length, 1, 'no retry for a bad key');
    assert.match(readLog(sb), /\[WARN\] Gemini AI/);
}, null, ENV));

test('the Kerry Remark column never carries the internal "fallback" note', () => withSandbox(async sb => {
    sb.mock.profile('Ufb', 'Fb');
    sb.mock.slipOk('k1', { amount: 140, transRef: 'RMK00001' });
    await sb.sendSlip('Ufb', 'm1', 'k1'); await sb.waitForSlips(1);
    await sendText(sb, 'Ufb', 't1', 'สมชาย ใจดี\n99/1 หมู่ 2 ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540\n0812345678');   // no Gemini key -> fallback
    const a = await sb.waitFor(() => addrOf(sb, 'Ufb'), 8000, 'not saved');
    assert.doesNotMatch(String(a.remark || ''), /Regex|ระบบสำรอง|Rate Limit/, 'no internal note stored as the parcel remark');
    const ExcelJS = sb.requireDep('exceljs');
    const file = await sb.get('/api/kerry/export_excel');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(file.buffer);
    const text = []; wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value)))));
    assert.doesNotMatch(text.join('\n'), /Regex|ระบบสำรอง|Rate Limit/);
}));
