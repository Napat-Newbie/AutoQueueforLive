// tests/unit/notification-format.test.js
// v1.0.20 (P5: 1.4 notificationFormat): แปลง socket event เป็นการแจ้งเตือนไทยสำหรับแผงแจ้งเตือน
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const { notificationFromEvent } = require(path.join(ROOT, 'lib', 'notificationFormat'));

const plain = (v) => JSON.parse(JSON.stringify(v));

test('notificationFromEvent: แปลง socket event ทุกประเภทเป็น notification ตามกติกาเดิม', () => {
    const f = (e, d) => plain(notificationFromEvent(e, d));

    // topup_needed
    assert.deepEqual(f('topup_needed', { name: 'Carol', need: 80, held: false }), { kind: 'warn', title: '💸 โอนไม่ครบ', text: 'ลูกค้า Carol โอนไม่ครบ ต้องโอนเพิ่มอีก 80 บาท' });
    assert.match(f('topup_needed', { name: 'Carol', need: 40, held: true }).text, /\(ค่าส่ง\)$/);
    assert.equal(notificationFromEvent('topup_needed', {}), null, 'ไม่มีชื่อลูกค้า = ไม่สร้างแจ้งเตือน');

    // image_failed
    assert.deepEqual(f('image_failed'), { kind: 'bad', title: '🖼️ โหลดรูปสลิปไม่ได้', text: 'โหลดรูปสลิปจาก LINE ไม่สำเร็จ — เปิดดูรูปในแชท LINE OA แล้วใส่ยอดเอง' });

    // slip_warning
    assert.equal(f('slip_warning', { kind: 'duplicate', name: 'Eve', reason: 'ซ้ำ' }).kind, 'bad');
    assert.equal(f('slip_warning', { kind: 'duplicate', name: 'Eve', reason: 'ซ้ำ' }).title, '⚠️ สลิปซ้ำ');
    assert.equal(f('slip_warning', { kind: 'wrong_account', name: 'X', reason: 'r' }).kind, 'bad');
    assert.equal(f('slip_warning', { kind: 'manual_match', name: 'X', reason: 'r' }).kind, 'warn');
    assert.deepEqual(f('slip_warning', { kind: 'amount_mismatch', name: 'X', reason: 'r' }), { kind: 'warn', title: '⚠️ ยอดที่กรอกไม่ตรงกับสลิป', text: 'X — r' });
    assert.equal(f('slip_warning', { kind: 'check_pending', name: 'X', reason: 'r' }).text, 'X — r');

    // address_updated
    assert.deepEqual(f('address_updated', { name: 'สมหญิง' }), { kind: 'ok', title: '📍 ที่อยู่จัดส่ง', text: 'คุณสมหญิง อัปเดตที่อยู่จัดส่งแล้ว' });
    assert.deepEqual(f('address_updated', {}), { kind: 'ok', title: '📍 ที่อยู่จัดส่ง', text: 'คุณลูกค้า อัปเดตที่อยู่จัดส่งแล้ว' });

    // pending_amount_slip
    assert.equal(f('pending_amount_slip', { name: 'Bob' }).text, 'Bob ส่งสลิปที่ระบบอ่านยอดไม่ได้ — รอแม่ค้ากดเช็คสลิปและใส่ยอด');
    assert.equal(f('pending_amount_slip', { name: 'Bob', bankName: 'กรุงเทพ', delay: 7 }).text, 'Bob ส่งสลิปธนาคารกรุงเทพที่ยังตรวจไม่ได้ (ต้องรอ ~7 นาทีหลังโอน) — ให้ลูกค้าส่งรูปเดิมซ้ำทีหลัง');

    // provider_quota_alert
    assert.equal(f('provider_quota_alert', { message: '⚠️ [แจ้งเตือนด่วน]: เครดิตหมด' }).text, 'เครดิตหมด');
    assert.equal(f('provider_quota_alert', { message: 'x' }).kind, 'bad');

    // unhandled / non-notifying events
    assert.equal(notificationFromEvent('play_sound', {}), null);
    assert.equal(notificationFromEvent('full_sync', {}), null);
});

test('anti-copy: notificationFromEvent ต้องถูกย้ายออกจาก index.js (ห้ามนิยามฟังก์ชันซ้ำใน index.js)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
    assert.doesNotMatch(src, /function\s+notificationFromEvent\s*\(/, 'ห้ามมีนิยาม function notificationFromEvent ใน index.js');
});
