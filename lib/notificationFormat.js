// lib/notificationFormat.js — แปลงเหตุการณ์ของระบบเป็นข้อความแจ้งเตือนไทยสำหรับแผงแจ้งเตือน (v1.0.20, P5)
// ย้ายจาก index.js แบบตัวอักษรเดิมทุกตัว (Pure function ไม่แตะสถานะกลาง)
'use strict';

// แปลงเหตุการณ์ที่ส่งไปหน้าจอ เป็นการแจ้งเตือน 1 รายการ ข้อความเดียวกับที่หน้าจอเคยสร้างเอง (kind: bad = ด่วน/สีแดง, warn, ok, info)
// สลิปซ้ำ/โอนผิดบัญชี = เงินที่ระบบไม่บันทึก จึงเป็นเรื่องด่วน (สีแดง) ส่วนตรวจการ์ดรอใส่ยอด/สลิปตรงกับยอดที่กรอก = สีส้ม
function notificationFromEvent(event, d) {
    d = d || {};
    if (event === 'topup_needed') {
        if (!d.name) return null;
        return { kind: 'warn', title: '💸 โอนไม่ครบ', text: 'ลูกค้า ' + d.name + ' โอนไม่ครบ ต้องโอนเพิ่มอีก ' + Number(d.need).toLocaleString('en-US') + ' บาท' + (d.held ? ' (ค่าส่ง)' : '') };
    }
    if (event === 'image_failed') return { kind: 'bad', title: '🖼️ โหลดรูปสลิปไม่ได้', text: 'โหลดรูปสลิปจาก LINE ไม่สำเร็จ — เปิดดูรูปในแชท LINE OA แล้วใส่ยอดเอง' };
    if (event === 'slip_warning') {
        const titles = { duplicate: '⚠️ สลิปซ้ำ', wrong_account: '⚠️ โอนเข้าผิดบัญชี', check_pending: '⚠️ ตรวจการ์ดรอใส่ยอด', manual_match: '❓ สลิปตรงกับยอดที่กรอกไว้', amount_mismatch: '⚠️ ยอดที่กรอกไม่ตรงกับสลิป' };
        // v1.0.19: amount_mismatch = เงินบันทึกแล้ว แค่ยอดที่แม่ค้ากรอกอาจผิด -> สีส้ม ไม่ใช่เรื่องด่วนสีแดง
        const notUrgent = d.kind === 'check_pending' || d.kind === 'manual_match' || d.kind === 'amount_mismatch';
        return { kind: notUrgent ? 'warn' : 'bad', title: titles[d.kind] || '⚠️ สลิปที่ระบบไม่บันทึก', text: (d.name ? d.name + ' — ' : '') + (d.reason || '') };
    }
    if (event === 'address_updated') return { kind: 'ok', title: '📍 ที่อยู่จัดส่ง', text: 'คุณ' + (d.name || 'ลูกค้า') + ' อัปเดตที่อยู่จัดส่งแล้ว' };
    if (event === 'pending_amount_slip') {
        const hasBank = d.bankName !== undefined && d.bankName !== null;
        return { kind: 'warn', title: '🕒 สลิปรอใส่ยอด', text: (d.name ? d.name + ' ' : '') + (hasBank ? 'ส่งสลิปธนาคาร' + d.bankName + 'ที่ยังตรวจไม่ได้' + (d.delay ? ' (ต้องรอ ~' + d.delay + ' นาทีหลังโอน)' : '') + ' — ให้ลูกค้าส่งรูปเดิมซ้ำทีหลัง' : 'ส่งสลิปที่ระบบอ่านยอดไม่ได้ — รอแม่ค้ากดเช็คสลิปและใส่ยอด') };
    }
    if (event === 'provider_quota_alert') return { kind: 'bad', title: '💳 เครดิตตรวจสลิป', text: String(d.message || '').replace(/^⚠️\s*(\[แจ้งเตือนด่วน\]:\s*)?/, '') };
    return null;
}

module.exports = { notificationFromEvent };
