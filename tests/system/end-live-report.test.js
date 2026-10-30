// tests/system/end-live-report.test.js
// Every time the merchant presses "จบไลฟ์" the app must send ONE summary embed to Discord:
// round stats + all ERRORs of the round + fix guidance. Runs the real index.js in a sandbox
// (tests/harness/sandbox.js) with a scripted Discord webhook (tests/harness/mock-universe.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox } = require('../harness/sandbox');

const DISCORD = { DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/12345/aq-test-hook' };

const pay = (sb, user, name, msg, key, amount, ref, receiver = 'TestShop') => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref, receiverName: receiver });
    return sb.sendSlip(user, msg, key);
};
const summaryEmbeds = (sb) => sb.mock.discords.flatMap(d => (d.body && d.body.embeds) || []).filter(e => /🏁 สรุปหลังจบไลฟ์/.test(String(e.title)));
const field = (embed, name) => embed.fields.find(f => f.name.includes(name));

test('ending a clean live sends one summary embed: correct stats, no errors, green', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'R1'); await sb.waitForSlips(1);
    await sb.endLive();

    const e = await sb.waitFor(() => summaryEmbeds(sb)[0], 8000, 'summary embed was not sent to Discord');
    assert.match(e.title, /🏁 สรุปหลังจบไลฟ์/);
    assert.match(field(e, 'สลิปรอบนี้').value, /^1 ใบ$/);
    assert.match(field(e, 'ลูกค้า').value, /^1 คน$/);
    assert.match(field(e, 'ยอดรับรวม').value, /^140 บาท$/);
    assert.match(field(e, 'สิทธิ์ที่ออก').value, /^1 ชิ้น$/);
    assert.match(field(e, 'สลิปที่ปัดตก').value, /^0 ใบ/);
    const prod = field(e, 'สินค้าที่ออก');
    assert.match(prod.name, /1 ชิ้น, 1 รายการ/);
    assert.match(prod.value, /A ×1/);
    assert.match(field(e, 'Error').value, /ไม่พบ Error ในรอบนี้/);
    assert.equal(field(e, 'WARN'), undefined, 'no warn field on a clean round');
    assert.equal(e.color, 3066993, 'green when nothing went wrong');
    assert.equal(summaryEmbeds(sb).length, 1, 'exactly one summary for one live');
}, null, DISCORD));

test('warnings during the live (wrong-account slip) are counted in the summary; the slip itself stays unrecorded', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'OK1'); await sb.waitForSlips(1);
    await pay(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'BAD1', 'Somebody Else');   // โอนผิดบัญชี -> WARN + การ์ดแดง ไม่บันทึกสลิป
    await sb.waitFor(async () => (await sb.stats()).imageFails.length === 1, 8000, 'wrong-account card missing');
    // รอให้บรรทัด WARN ถูกเขียนจริงก่อนกดจบไลฟ์ — การ์ดถูก push ก่อน addLog เล็กน้อย ถ้ากดจบทันทีจะแย่งชนะกับ log (เคย flaky)
    {
        const fs = require('fs'); const path = require('path');
        const logPath = () => path.join(sb.dir, 'system.log');
        await sb.waitFor(() => { try { return /สลิปโอนผิดบัญชี/.test(fs.readFileSync(logPath(), 'utf8')); } catch (e) { return false; } }, 8000, 'wrong-account WARN not logged');
    }

    await sb.endLive();
    const e = await sb.waitFor(() => summaryEmbeds(sb)[0], 8000, 'summary embed was not sent');
    assert.equal(sb.slips().length, 1, 'wrong-account slip is not recorded');
    assert.match(field(e, 'สลิปรอบนี้').value, /^1 ใบ$/);
    assert.match(field(e, 'Error').value, /ไม่พบ Error ในรอบนี้/);
    const w = field(e, 'WARN').value;
    assert.match(w, /1 รายการ/);
    assert.match(w, /สลิปโอนเข้าบัญชีที่ไม่ใช่ของร้าน/);
    assert.match(w, /เกิดอะไรขึ้น: Bob → Somebody Else/, 'who paid whom, taken from the real log line');
    assert.match(w, /> ควรทำ:/);
    const version = require('../../package.json').version;
    assert.ok(e.footer.text.includes('v' + version), 'footer carries the running version: ' + e.footer.text);
}, null, DISCORD));

test('a second live on the same day gets its own summary (ทุกครั้งที่จบไลฟ์) and stats do not bleed over', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'A1'); await sb.waitForSlips(1);
    await sb.endLive();
    const first = await sb.waitFor(() => summaryEmbeds(sb)[0], 8000, 'first summary missing');
    assert.match(field(first, 'สลิปรอบนี้').value, /^1 ใบ$/, 'round A stats');

    await pay(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'GAP1'); await sb.waitForSlips(2);   // จ่ายระหว่างรอบ (นอกรอบ)
    await sb.startLive();                     // กติกา ก: สลิปนอกรอบถูกผูกเข้ารอบ B
    await sb.endLive();
    const second = await sb.waitFor(() => summaryEmbeds(sb)[1], 8000, 'second summary missing');
    assert.match(second.title, /🏁 สรุปหลังจบไลฟ์/);
    assert.match(field(second, 'สลิปรอบนี้').value, /^1 ใบ$/, 'claimed out-of-round slip counts in the new round only');
}, null, DISCORD));

test('rejected slips are counted separately and left out of the money, rights and product list', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'R1'); await sb.waitForSlips(1);
    await pay(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'R2'); await sb.waitForSlips(2);
    const bob = sb.slips().find(s => s.line_name === 'Bob');
    await sb.post('/api/queue/action', { action: 'rejected', slipIds: [bob.id] });
    await sb.endLive();

    const e = await sb.waitFor(() => summaryEmbeds(sb)[0], 8000, 'summary embed was not sent');
    assert.match(field(e, 'สลิปรอบนี้').value, /^1 ใบ$/, 'rejected slip not counted');
    assert.match(field(e, 'ยอดรับรวม').value, /^140 บาท$/);
    assert.match(field(e, 'สลิปที่ปัดตก').value, /^1 ใบ/);
    assert.match(field(e, 'สินค้าที่ออก').name, /1 ชิ้น/, 'rejected slip gives no product');
}, null, DISCORD));

// v1.0.17: ช่องแยกสำหรับสรุปหลังจบไลฟ์ (DISCORD_LIVE_SUMMARY_WEBHOOK_URL) — ตั้งไว้แล้วสรุปต้องไปเฉพาะช่องนั้น
const ENDLIVE = {
    DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/12345/main-alert-hook',
    DISCORD_LIVE_SUMMARY_WEBHOOK_URL: 'https://discord.com/api/webhooks/99999/end-live-summary-hook-abcdefghij'
};
test('when a dedicated end-live webhook is set, the summary goes ONLY to that channel', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'D1'); await sb.waitForSlips(1);
    await sb.endLive();

    await sb.waitFor(() => sb.mock.discords.some(d => (d.body.embeds || []).some(e => /🏁 สรุปหลังจบไลฟ์/.test(String(e.title)))), 8000, 'summary embed was not sent');
    const onEndLive = sb.mock.discords.filter(d => d.path.includes('99999/end-live-summary-hook-abcdefghij'));
    const onMain = sb.mock.discords.filter(d => d.path.includes('12345/main-alert-hook'));
    assert.ok(onEndLive.some(d => (d.body.embeds || []).some(e => /🏁 สรุปหลังจบไลฟ์/.test(String(e.title)))), 'summary arrived on the dedicated channel');
    assert.ok(!onMain.some(d => (d.body.embeds || []).some(e => /🏁 สรุปหลังจบไลฟ์/.test(String(e.title)))), 'main alert channel must NOT receive the summary');
}, null, ENDLIVE));

test('dedicated channel also receives the second message when the round is busy (WARN detail split)', () => withSandbox(async sb => {
    await sb.startLive();
    await pay(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'W1'); await sb.waitForSlips(1);
    // ทำให้เกิดคำเตือนจริง 2 ประเภท: โอนผิดบัญชี + สลิปซ้ำของลูกค้าอื่น
    await pay(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'W2', 'Somebody Else');
    await sb.waitFor(async () => (await sb.stats()).imageFails.length === 1, 8000, 'wrong-account card missing');
    await sb.mock.profile('Ucarol', 'Carol');
    sb.mock.slipOk('k3', { amount: 140, transRef: 'W1' });          // ใบเดียวกับของ Alice = ซ้ำของลูกค้าอื่น
    await sb.sendSlip('Ucarol', 'm3', 'k3');
    // รอให้บรรทัด WARN ของสลิปซ้ำถูกเขียนจริงก่อนกดจบไลฟ์ (การ์ดถูก push ก่อน addLog เล็กน้อย —
    // ถ้ารอแค่การ์ดแล้วกดจบทันที จะแย่งชนะกับ log ที่กำลังจะถูกเขียน)
    const fs = require('fs'); const path = require('path');
    const logPath = () => path.join(sb.dir, 'system.log');
    await sb.waitFor(() => { try { return /ตรวจพบสลิปซ้ำ/.test(fs.readFileSync(logPath(), 'utf8')); } catch (e) { return false; } }, 8000, 'duplicate WARN not logged');

    await sb.endLive();
    await sb.waitFor(() => summaryEmbeds(sb).length >= 1, 8000, 'summary missing');
    const onEndLive = sb.mock.discords.filter(d => d.path.includes('99999/end-live-summary-hook-abcdefghij'));
    const summaries = onEndLive.flatMap(d => (d.body.embeds || []).filter(e => /🏁 สรุปหลังจบไลฟ์/.test(String(e.title))));
    assert.ok(summaries.length >= 1);
    const warnText = summaries.flatMap(e => e.fields.filter(f => /คำเตือน|WARN/.test(f.name)).map(f => f.value)).join('\n');
    assert.match(warnText, /สลิปซ้ำ|ซ้ำกับลูกค้า/, 'duplicate warn has analysis text');
    assert.match(warnText, /> วิเคราะห์:|> ควรทำ:/, 'warn detail explains the cause');
}, null, ENDLIVE));
