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

module.exports = { getTodayString, getLocalTimeString, bangkokDateString, stampToSec };
