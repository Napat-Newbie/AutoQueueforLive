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

    await sb.endLive();
    const e = await sb.waitFor(() => summaryEmbeds(sb)[0], 8000, 'summary embed was not sent');
    assert.equal(sb.slips().length, 1, 'wrong-account slip is not recorded');
    assert.match(field(e, 'สลิปรอบนี้').value, /^1 ใบ$/);
    assert.match(field(e, 'Error').value, /ไม่พบ Error ในรอบนี้/);
    assert.match(field(e, 'WARN').value, /1 รายการ/);
    assert.match(e.footer.text, /v1\.0\.16/);
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
