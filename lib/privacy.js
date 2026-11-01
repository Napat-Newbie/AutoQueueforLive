// lib/privacy.js — ปิดบังข้อมูลส่วนตัว (เบอร์โทร/เลขบัตร) และการตัดแบ่งไฟล์ log ของรอบไลฟ์ (v1.0.20, P5)
// ย้ายจาก index.js แบบตัวอักษรเดิมทุกตัว (Pure function ไม่แตะสถานะกลาง)
'use strict';

// 🛡️ ปิดบังข้อมูลส่วนตัวลูกค้าก่อนส่งออกนอกเครื่อง
// v1.0.18 (แก้ 2026-10-31): ตัวเลข 13 หลักที่ติดกับ "_" เป็นรหัสของโปรแกรม (LIVE_<เวลา>, manual_<เวลา>_...) ไม่ใช่เลขบัตรประชาชน
// เดิมปิดหมด รหัสรอบไลฟ์ในช่องกิจกรรม Discord จึงกลายเป็น LIVE_[เลขบัตร] ตั้งแต่ v1.0.16 ไล่ปัญหาตามรอบไม่ได้
function redactPersonalInfo(text) {
    return String(text === undefined || text === null ? '' : text)
        .replace(/(?<![\d_])\d{13}(?![\d_])/g, '[เลขบัตร]')
        .replace(/(?<!\d)0\d[\d\- ]{7,11}\d(?!\d)/g, (m) => {
            const digits = m.replace(/\D/g, '');
            return (digits.length === 9 || digits.length === 10) ? `0xx-xxx-${digits.slice(-4, -2)}xx` : m;
        });
}

// เวลาในแต่ละบรรทัดมาจาก toLocaleString en-US เขตเวลา Asia/Bangkok เช่น [10/31/2026, 7:34:12 PM] -- Node รุ่นใหม่คั่น PM ด้วย U+202F ซึ่ง \s ครอบคลุม
function parseLogLineTime(line) {
    const m = /^\[(\d{1,2})\/(\d{1,2})\/(\d{4}),\s(\d{1,2}):(\d{2}):(\d{2})\s(AM|PM)\]/.exec(String(line || ''));
    if (!m) return null;
    let h = Number(m[4]) % 12;
    if (m[7] === 'PM') h += 12;
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h - 7, Number(m[5]), Number(m[6]));
}

function sliceLogForLive(text, startMs, endMs) {
    return String(text || '').split(/\r?\n/).filter(line => {
        const t = parseLogLineTime(line);
        return t !== null && t >= startMs && t <= endMs;
    });
}

module.exports = {
    redactPersonalInfo,
    parseLogLineTime,
    sliceLogForLive
};
