// tests/system/merchant-actions-log.test.js
// Every merchant action during a live must (1) leave a line in system.log and (2) reach the Discord
// activity channel (the live monitor), so mistakes can be traced back afterwards. Before v1.0.16 the
// queue action buttons (เรียกคิว/เสร็จสิ้น/...) wrote NO detailed log line at all — only a generic audit row.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const ENV = {
    DISCORD_ACTIVITY_WEBHOOK_URL: 'https://discord.com/api/webhooks/999999/aqactivitychanneltest000001',
    DISCORD_DEVREPORT_WEBHOOK_URL: 'https://discord.com/api/webhooks/888888/aqdevreportchanneltest00002',
    DISCORD_ACTIVITY_FLUSH_MS: '300'   // flush the activity batch every 0.3 s instead of 60 s, for the test only
};

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};

// ระบบเขียน system.log แบบ async (ไม่บล็อกโปรแกรมหลัก) ดังนั้นเทสต์ต้องรอ-อ่านซ้ำจนกว่าบรรทัดจะลงไฟล์จริง
// (บน Linux CI การเขียนไฟล์เสร็จช้ากว่าการตอบ HTTP กลับ ทำให้การอ่านครั้งเดียวแบบเดิมพบ race condition)
const waitForLog = (sb, re, message) => sb.waitFor(
    () => re.test(fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8')),
    8000, message || `system.log never matched ${re}`
);

test('queue buttons during a live land in system.log AND the Discord activity channel', () => withSandbox(async sb => {
    await slipFor(sb, 'Ualice', 'Alice', 'm1', 'k1', 140, 'ACT1');
    await sb.waitForSlips(1);
    await sb.startLive();

    const alice = sb.slips()[0].id;
    await sb.post('/api/queue/action', { action: 'called', slipIds: [alice] });
    await sb.post('/api/queue/action', { action: 'completed', slipIds: [alice] });
    await sb.endLive();

    await waitForLog(sb, /เริ่มไลฟ์รอบใหม่ \(รหัสรอบ LIVE_/);
    await waitForLog(sb, /แม่ค้ากด "เรียกคิว" — Alice/);
    await waitForLog(sb, /แม่ค้ากด "เสร็จสิ้น" — Alice/);
    await waitForLog(sb, /จบไลฟ์ \(รหัสรอบ LIVE_/);

    // Discord ช่องกิจกรรม (live monitor): การกระทำของแม่ค้าต้องมาถึงในสรุปฉบับที่ส่งเป็นชุด
    // (แต่ละ action อาจไปคนละชุดก็ได้ จึงรวมข้อความทุกชุดที่ส่งถึงช่องนี้แล้วตรวจรวมกัน)
    await sb.waitFor(() => {
        const feed = sb.mock.discords
            .filter(d => d.path.includes('aqactivitychanneltest000001'))
            .map(d => (d.body.embeds || []).map(e => String(e.description || '')).join('\n')).join('\n');
        return /แม่ค้ากด "เรียกคิว" — Alice/.test(feed) && /แม่ค้ากด "เสร็จสิ้น" — Alice/.test(feed);
    }, 12000, 'merchant queue actions never reached the Discord activity channel');

    // พฤติกรรมเดิมของ v1.0.16 ต้องไม่พัง: สรุปหลังจบไลฟ์ยังส่งทุกครั้ง
    await sb.waitFor(() => sb.mock.discords.some(d => (d.body.embeds || []).some(e => /สรุปหลังจบไลฟ์/.test(String(e.title || '')))), 12000, 'end-of-live summary missing');

    assert.deepEqual(sb.unexpectedCalls(), []);
}, {}, ENV));

test('manual amount entry, orange-card dismiss, image-fail dismiss and slip reject are all logged', () => withSandbox(async sb => {
    // แม่ค้ากรอกยอดสลิปเอง (รูปที่ระบบอ่านไม่ได้)
    const manualId = sb.insertSlip({ name: 'Manu', line_id: 'Umanu', amount: 0, draws: 0, trans_date: bkkDate(0), qr_payload: 'manual_image|abc|', status: 'abnormal_pending' });
    await sb.post('/api/queue/manual_amount', { slipId: manualId, amount: 140 });
    await waitForLog(sb, /แม่ค้ากรอกยอดสลิปเอง 140 บาท — Manu/);

    // ปิดการ์ดส้ม (รอโอนเพิ่ม)
    const oweId = sb.insertSlip({ name: 'Owe', line_id: 'Uowe', amount: 60, draws: 0, trans_date: bkkDate(0), status: 'accumulated' });
    await sb.post('/api/queue/dismiss_topup', { id: oweId });
    await waitForLog(sb, /แม่ค้าปิดการ์ดส้ม "รอโอนเพิ่ม" ของ Owe \(1 ใบ\)/);

    // ปัดตกรูปที่ไม่ใช่สลิป
    const rejId = sb.insertSlip({ name: 'Reject', line_id: 'Urej', amount: 0, draws: 0, trans_date: bkkDate(0) });
    await sb.post('/api/queue/reject_slip', { slipId: rejId });
    await waitForLog(sb, /แม่ค้าปัดตกรูปที่ไม่ใช่สลิปการโอนเงิน — Reject \(สลิป #/);

    // อนุมัติ/ปัดตกสลิปรอตรวจหลังจบไลฟ์
    const abnormalId = sb.insertSlip({ name: 'LateCheck', line_id: 'Ulate', amount: 140, draws: 1, trans_date: bkkDate(0), status: 'abnormal_pending' });
    await sb.post('/api/queue/verify_abnormal', { slipIds: [abnormalId], isApproved: true });
    await waitForLog(sb, /หลังจบไลฟ์ แม่ค้าอนุมัติสลิปรอตรวจภาพ 1 ใบ/);

    // เคลียร์คิวทั้งหมด
    sb.insertSlip({ name: 'Waiter', line_id: 'Uwait', amount: 140, draws: 1, trans_date: bkkDate(0), status: 'waiting' });
    await sb.post('/api/queue/clear', {});
    await waitForLog(sb, /แม่ค้ากด "เคลียร์คิวทั้งหมด" \(1 รายการ\)/);

    assert.deepEqual(sb.unexpectedCalls(), []);
}, {}, ENV));
