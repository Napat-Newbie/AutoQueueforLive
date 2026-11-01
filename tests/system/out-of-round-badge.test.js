// tests/system/out-of-round-badge.test.js
// v1.0.16: money that arrives while NO live is running (a dip paid late, or a between-rounds transfer)
// must be instantly recognizable: the queue card carries a permanent "โอนนอกรอบ" flag that survives
// being claimed into the next round, the Kerry summary window lists the customer, the downloaded
// Excel notes it in the Remark column, and a warning line lands in system.log / Discord activity.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};

const findCard = (st, name) => [...st.queues.waiting, ...st.queues.called, ...st.queues.skipped].find(q => q.name === name);

function excelText(buffer, ExcelJS) {
    const wb = new ExcelJS.Workbook();
    return wb.xlsx.load(buffer).then(() => {
        const text = [];
        wb.eachSheet(ws => ws.eachRow(row => row.eachCell(c => text.push(String(c.value && c.value.richText ? c.value.richText.map(t => t.text).join('') : c.value)))));
        return text.join('\n');
    });
}

// v1.0.19 (owner audit 2026-10-31): out-of-round money must say WHERE it came from — money that arrived
// BEFORE the first live of its window ("ก่อนเริ่มไลฟ์", prep money, low double-ship risk) vs money that
// arrived AFTER a live had ended ("หลังจบไลฟ์", a late dip — beware double shipping). The old text said
// "เงินมาหลังจบไลฟ์" for BOTH.
test('queue card of an out-of-round payment carries the badge, and it survives being claimed into the new round', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'OOR1');   // paid while no live is running
    await sb.waitForSlips(1);
    assert.equal((await sb.stats()).queues.waiting[0].outOfRound, true, 'badge on the card before the live starts');
    assert.equal((await sb.stats()).queues.waiting[0].outOfRoundWhen, 'before', 'no live has ENDED yet — this is pre-live money, not a dip');

    const live = await sb.startLive();                               // rule ก claims the slip into this round
    await slipFor(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'LIVE1');      // paid DURING the live — no badge
    await sb.waitForSlips(2);

    const st = await sb.stats();
    assert.equal(findCard(st, 'Alice').outOfRound, true, 'badge must survive the claim into the new round');
    assert.equal(findCard(st, 'Alice').outOfRoundWhen, 'before', 'the when-label survives the claim too');
    assert.equal(findCard(st, 'Bob').outOfRound, false, 'a slip paid during the live has no badge');
    assert.equal(sb.slips()[0].session_id, live.session.id, 'precondition: Alice really was claimed');
}));

test('Kerry summary window lists the out-of-round customer; the downloaded Excel stays clean (no internal note in Remark)', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'OORK1');
    await sb.waitForSlips(1);
    const live = await sb.startLive();

    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.equal(summary.success, true);
    assert.deepEqual(summary.outOfRoundCustomers, [{ name: 'Alice', when: 'before' }], 'summary lists the customer WITH the when-label (fresh sandbox: no live has ended yet)');
    const aliceOrder = summary.orders.find(o => o.lineName === 'Alice');
    assert.equal(aliceOrder.outOfRound, true);
    assert.equal(aliceOrder.outOfRoundWhen, 'before');

    // the Excel the Kerry window downloads for that round — the Remark column must NOT carry an internal note (this file is uploaded to Kerry)
    const file = await sb.get(`/api/kerry/export_excel?sessionId=${live.session.id}`);
    assert.equal(file.status, 200);
    const text = await excelText(file.buffer, sb.requireDep('exceljs'));
    assert.doesNotMatch(text, /โอนนอกรอบ/, 'the downloaded Excel must not contain the out-of-round note');
}));

test('a plain in-live payment is NOT flagged in the Kerry file (no false positives)', () => withSandbox(async sb => {
    const live = await sb.startLive();
    await slipFor(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'PLAIN1');
    await sb.waitForSlips(1);

    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live.session.id}`)).json;
    assert.deepEqual(summary.outOfRoundCustomers, [], 'nobody is listed as out-of-round');
    assert.equal(summary.orders.find(o => o.lineName === 'Bob').outOfRound, false);

    const file = await sb.get(`/api/kerry/export_excel?sessionId=${live.session.id}`);
    const text = await excelText(file.buffer, sb.requireDep('exceljs'));
    assert.doesNotMatch(text, /โอนนอกรอบ/, 'the Excel must not contain the note for an in-live payment');
    assert.match(text, /Bob/, 'precondition: Bob is actually in the file');
}));

test('history page data says which round an out-of-round payment belongs to', () => withSandbox(async sb => {
    // 1) จ่ายก่อนเริ่มไลฟ์ (ยังไม่ถูกผูก) — ประวัติต้องบอกว่า "นอกรอบ รอผูกเข้ารอบถัดไป" ไม่ใช่ข้อมูลเก่า
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'HIST1');
    await sb.waitForSlips(1);
    let h = (await sb.get('/api/history_data')).json;
    let alice = h.history.find(x => x.name === 'Alice');
    assert.equal(alice.sessionId, null, 'not attached to a round yet');
    assert.equal(alice.outOfRound, true, 'flagged as out-of-round (so the page can say "waiting for the next round")');
    assert.equal(alice.outOfRoundWhen, 'before', 'history row also carries the when-label');
    assert.ok(h.rounds.some(r => r.outside === true), 'the summary groups unattached money under "นอกรอบไลฟ์"');

    // 2) เริ่มไลฟ์ → ถูกผูกเข้ารอบนี้ — ประวัติต้องระบุชื่อรอบ + ยังติดธง outOfRound
    const live = await sb.startLive();
    await slipFor(sb, 'Ubob', 'Bob', 'm2', 'k2', 140, 'HIST2');   // จ่ายระหว่างไลฟ์ — ของรอบนี้โดยตรง
    await sb.waitForSlips(2);

    h = (await sb.get('/api/history_data')).json;
    alice = h.history.find(x => x.name === 'Alice');
    const bob = h.history.find(x => x.name === 'Bob');
    assert.equal(alice.sessionId, live.session.id, 'the out-of-round slip now names the round it belongs to');
    assert.equal(alice.outOfRound, true, 'still flagged: arrived outside, attached to this round');
    assert.equal(bob.sessionId, live.session.id);
    assert.equal(bob.outOfRound, false, 'an in-live payment is not flagged');

    // 3) ตารางสรุปยอดแยกรอบ: รอบนี้รับยอดนอกรอบมา 1 ใบ
    const roundRow = h.rounds.find(r => r.sessionId === live.session.id);
    assert.equal(roundRow.outOfRoundSlips, 1, 'the per-round summary counts the absorbed out-of-round slip');
    assert.equal(roundRow.slips, 2);
}));

// v1.0.19: เคสตรงข้าม — เงินที่เข้ามาหลังมีรอบไลฟ์จบไปแล้ว (ยอดจุ่ม) ต้องติดป้าย when='after'
// เพื่อให้หน้าต่าง Kerry คงคำเตือน "อย่าส่งของซ้ำ" ไว้กับกลุ่มนี้ ไม่ปนกับเงินก่อนเริ่มไลฟ์
test('money arriving AFTER a live has ended is labelled when=after (the dip case keeps the double-ship warning)', () => withSandbox(async sb => {
    // เวลาโอนบนสลิปต้องช้ากว่าเวลาจบรอบเสมอ ไม่ว่าจะรันเทสต์ตอนไหนของวัน
    // (เดิมใช้ค่าคงที่ 11:00:00 ของ mock ผสมกับ trans_date=วันนี้ที่เซิร์ฟเวอร์เขียนเอง — รันหลัง 11:00 น. จริงเทสต์ล้ม)
    // ส่งทั้ง transDate/transTime = เวลาไทยปัจจุบัน +2 นาที ถ้า +2 นาทีข้ามเที่ยงคืน ใช้ 23:59:59 ของวันนี้แทน (เวลาจบรอบย่อมเร็วกว่าเสมอ)
    const bkkNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const later = new Date(bkkNow().getTime() + 2 * 60 * 1000);
    const today = bkkNow();
    const sameDay = later.getDate() === today.getDate() && later.getMonth() === today.getMonth();
    const pad = n => String(n).padStart(2, '0');
    const transDate = `${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}`;
    const transTime = sameDay ? `${pad(later.getHours())}:${pad(later.getMinutes())}:${pad(later.getSeconds())}` : '23:59:59';

    const live1 = await sb.startLive();
    await sb.endLive();                                              // จบรอบแรกแล้ว (ไม่ต้องส่งอะไร)
    sb.mock.profile('Ucarol', 'Carol');
    sb.mock.slipOk('k9', { amount: 140, transRef: 'DIP1', transDate, transTime });
    await sb.sendSlip('Ucarol', 'm9', 'k9');                         // โอนตอนไม่มีไลฟ์ หลังมีรอบจบไปแล้ว
    await sb.waitForSlips(1);
    const st = await sb.stats();
    assert.equal(st.queues.waiting[0].outOfRound, true);
    assert.equal(st.queues.waiting[0].outOfRoundWhen, 'after', 'a live HAS ended before this money arrived — dip case');

    const live2 = await sb.startLive();
    const summary = (await sb.get(`/api/kerry/summary?sessionId=${live2.session.id}`)).json;
    assert.deepEqual(summary.outOfRoundCustomers, [{ name: 'Carol', when: 'after' }]);
}));

test('system.log + Discord activity channel get the out-of-round warning line', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'OORLOG');
    await sb.waitForSlips(1);
    // system.log เขียนแบบ async — รอ-อ่านซ้ำจนบรรทัดลงไฟล์จริง (กัน race บน Linux CI)
    await sb.waitFor(
        () => /ลูกค้า "Alice" โอนนอกรอบ \(เงินเข้าตอนไม่มีไลฟ์ 140 บาท\)/.test(fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8')),
        8000, 'the out-of-round warning never landed in system.log'
    );

    await sb.waitFor(() => sb.mock.discords.some(d => d.path.includes('aqactivitychanneltest000001')
        && ((d.body && d.body.embeds) || []).some(e => /"Alice" โอนนอกรอบ/.test(String(e.description || '')))
    ), 12000, 'the out-of-round warning never reached the Discord activity channel');

    assert.deepEqual(sb.unexpectedCalls(), []);
}, {}, {
    DISCORD_ACTIVITY_WEBHOOK_URL: 'https://discord.com/api/webhooks/999999/aqactivitychanneltest000001',
    DISCORD_ACTIVITY_FLUSH_MS: '300'
}));
