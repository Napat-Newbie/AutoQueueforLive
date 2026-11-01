// lib/dates.js — ตัวช่วยวันที่/เวลาไทย (ล้วน) ย้ายจาก index.js ใน v1.0.19 แบบตัวอักษรเดิมทุกตัว
// ทุกตัวอ่าน "วันนี้" ในเขตเวลากรุงเทพ (Asia/Bangkok) เสมอ ไม่สนเขตเวลาของเครื่อง
'use strict';

function getTodayString() {
    const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

function getLocalTimeString() {
    const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

function bangkokDateString(offsetDays = 0) {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function stampToSec(dateStr, timeStr) {
    const d = String(dateStr || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    const t = String(timeStr || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!d || !t) return null;
    return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), Number(t[3] || 0)) / 1000;
}

// v1.0.20 (P1): ข้อความไทยสั้นสำหรับป้าย "ไลฟ์ล่าสุด" บนการ์ดยอดโอนรวม
const THAI_SHORT_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function hhmm(timeStr) {
    const m = String(timeStr || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
}
// '20261101' + '21:00:05' → '1 พ.ย. 21:00' (ตัดวินาที วันไม่เติม 0 หน้า — อ่านแบบแม่ค้า)
function thaiShortDateTime(dateStr, timeStr) {
    const d = String(dateStr || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    const t = hhmm(timeStr);
    if (!d || !t) return null;
    return `${Number(d[3])} ${THAI_SHORT_MONTHS[Number(d[2]) - 1] || ''} ${t}`;
}
// epoch จริง → 'YYYYMMDD' กรุงเทพ (ใช้หา "วันที่จบไลฟ์" ของรอบที่ข้ามเที่ยงคืน)
function bangkokDateStrFromEpoch(epochMs) {
    const d = new Date(new Date(epochMs).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
// ป้ายช่วงไลฟ์: ข้ามวัน → '1 พ.ย. 21:00 – 2 พ.ย. 01:30' / วันเดียวกัน → '1 พ.ย. 21:00 – 23:30'
// ข้อมูลตอนเริ่มเสีย = null (ผู้เรียกซ่อนป้าย ไม่แสดงข้อความครึ่ง ๆ)
function thaiLiveSpan(startDateStr, startTimeStr, endEpochMs, endTimeStr) {
    const start = thaiShortDateTime(startDateStr, startTimeStr);
    if (!start) return null;
    const endT = hhmm(endTimeStr);
    if (!endT || !(Number(endEpochMs) > 0)) return start;
    const endDate = bangkokDateStrFromEpoch(endEpochMs);
    if (endDate === String(startDateStr)) return `${start} – ${endT}`;
    return `${start} – ${Number(endDate.slice(6))} ${THAI_SHORT_MONTHS[Number(endDate.slice(4, 6)) - 1] || ''} ${endT}`;
}

module.exports = { getTodayString, getLocalTimeString, bangkokDateString, stampToSec, hhmm, thaiShortDateTime, bangkokDateStrFromEpoch, thaiLiveSpan };
