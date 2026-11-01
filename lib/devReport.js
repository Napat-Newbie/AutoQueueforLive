// lib/devReport.js — ประเมิน Error และสร้าง Embed สำหรับแจ้งเตือน Dev Report (v1.0.20, P5)
// ย้ายจาก index.js แบบตัวอักษรเดิมทุกตัว (Pure function ไม่แตะสถานะกลาง)
'use strict';

// 🎯 ประเมินความรุนแรงและแนวทางแก้ไข (กฎตายตัว ไม่ใช้ AI จึงไม่เสียโควตา)
function assessErrorForDevReport(category, text) {
    const t = `${category || ''} ${text || ''}`.toLowerCase();
    const rules = [
        { test: /system_crash|uncaught|unhandled|เก็บสลิปสำรองไม่สำเร็จ/, severity: 'CRITICAL',
          cause: 'โค้ดเกิดข้อผิดพลาดที่ไม่มีการดักไว้ หรือสลิปของลูกค้าอาจตกหล่น',
          fix: 'ดู Stack ใน "บันทึกระบบ" ของร้าน หาบรรทัดที่พัง เพิ่มการตรวจค่าว่าง/try-catch ตรงจุดนั้น แล้วเขียนทดสอบกรณีนี้ก่อนออกเวอร์ชันถัดไป' },
        { test: /เน็ตสะดุด|etimedout|econnreset|econnaborted|enotfound|eai_again|socket hang up/, severity: 'HIGH',
          cause: 'อินเทอร์เน็ตของร้านสะดุด หรือเชื่อมต่อเซิร์ฟเวอร์ LINE ไม่ได้ชั่วคราว (ไม่ใช่ปัญหา Token หรือโควตา)',
          fix: 'ระบบลองดาวน์โหลดซ้ำอัตโนมัติแล้วแต่ยังไม่สำเร็จ ให้ตรวจเน็ตร้าน/เราเตอร์ในช่วงเวลานั้น และให้แม่ค้าเปิดดูรูปสลิปของลูกค้าในแชท LINE OA แล้วใส่ยอดเอง' },
        { test: /บันทึกสลิปอัตโนมัติ|sqlite|database|ฐานข้อมูล/, severity: 'HIGH',
          cause: 'ฐานข้อมูลบันทึกไม่สำเร็จ (ไฟล์ถูกล็อก ดิสก์เต็ม หรือข้อมูลผิดรูปแบบ)',
          fix: 'ตรวจพื้นที่ดิสก์และขนาดไฟล์ WAL ของร้าน ถ้าเกิดซ้ำให้ลดงานเขียนพร้อมกัน หรือย้ายงานเขียนเข้าคิวเดียว' },
        { test: /slipok|easyslip|thunder|quota|เครดิต|ตรวจสลิป|1009|402|401/, severity: 'HIGH',
          cause: 'บริการตรวจสลิปตอบกลับผิดพลาด (เครดิตหมด รหัสผิด หรือบริการล่ม)',
          fix: 'ตรวจเครดิตและรหัสของผู้ให้บริการ พิจารณาเพิ่มการสลับผู้ให้บริการอัตโนมัติ/แจ้งเตือนเครดิตต่ำให้เร็วขึ้น' },
        { test: /line|webhook|reply|push/, severity: 'HIGH',
          cause: 'เชื่อมต่อ LINE ไม่สำเร็จ (Token หมดอายุ Webhook ไม่ตรง หรือโควตาข้อความเต็ม)',
          fix: 'ตรวจ LINE Access Token และ Webhook URL ใน LINE Developers ถ้าเกี่ยวกับโควตา ลดข้อความ Push' },
        { test: /tunnel|cloudflare|localtunnel/, severity: 'MEDIUM',
          cause: 'ท่อเชื่อมต่ออินเทอร์เน็ตหลุด หรือเน็ตร้านไม่เสถียร',
          fix: 'ดูว่าระบบเชื่อมต่อใหม่ได้เองหรือไม่ ถ้าหลุดบ่อย พิจารณาใช้ Cloudflare Tunnel แบบมีบัญชี (ลิงก์ถาวร)' },
        { test: /gemini|ai|ที่อยู่/, severity: 'MEDIUM',
          cause: 'AI อ่านที่อยู่ไม่สำเร็จ (โควตา Gemini หรือข้อความรูปแบบแปลก)',
          fix: 'ตรวจโควตา Gemini และปรับตัวอ่านที่อยู่สำรองให้ครอบคลุมรูปแบบข้อความนั้น' },
        { test: /disk|ดิสก์|พื้นที่/, severity: 'HIGH',
          cause: 'พื้นที่เก็บข้อมูลในเครื่องร้านใกล้เต็ม',
          fix: 'แนะนำร้านล้างไฟล์ที่ไม่ใช้ หรือย้ายรูป/ไฟล์สำรองเก่าออก ทบทวนนโยบายเก็บไฟล์' }
    ];
    const r = rules.find(x => x.test.test(t));
    return r || { severity: 'MEDIUM', cause: 'ข้อผิดพลาดทั่วไปของระบบ', fix: 'ดูรายละเอียดใน "บันทึกระบบ" ของร้าน แล้วจำลองซ้ำบนเครื่อง Dev ก่อนแก้' };
}

// 📮 v1.0.16: embed "ขออัปเดตเวอร์ชันใหม่" — ใช้เมื่อระบบพบข้อผิดพลาดที่ซ่อมเองไม่ได้ (Self-Healing หมดทาง)
// เกณฑ์: Error ระดับ CRITICAL (โค้ดพังที่กู้คืนอัตโนมัติไม่มีทางช่วย) หรือ Error เดิมเกิดซ้ำถึงเพดานภายใน 30 นาที
// สองฟังก์ชันนี้เป็น pure function เพื่อทดสอบแยกด้วย unit test ตรง ๆ (เหมือน buildEndOfLiveReportEmbed)
const UPDATE_REQUEST_REPEAT_THRESHOLD = 5;
function shouldRequestNewVersion(severity, repeatCount) {
    return severity === 'CRITICAL' || Number(repeatCount) >= UPDATE_REQUEST_REPEAT_THRESHOLD;
}
function buildUpdateRequestEmbed({ problem = '', whyCannotSelfHeal = '', tried = '', fixGuidance = '', meta = {} } = {}) {
    const fields = [
        { name: 'ร้าน / เวอร์ชันที่ติดตั้งอยู่', value: `${meta.shopLabel || '-'} / v${meta.version || '?'}`, inline: false },
        { name: 'ปัญหาที่พบ', value: String(problem || '-').slice(0, 500), inline: false },
        { name: 'ทำไมระบบซ่อมเองไม่ได้', value: String(whyCannotSelfHeal || '-').slice(0, 500), inline: false }
    ];
    if (tried) fields.push({ name: 'สิ่งที่ระบบพยายามแล้ว', value: String(tried).slice(0, 500), inline: false });
    fields.push({
        name: 'ที่ผู้พัฒนาควรทำ',
        value: `${fixGuidance ? String(fixGuidance).slice(0, 500) + '\n' : ''}→ แก้แล้วออกเวอร์ชันใหม่ ให้ร้านกด "ตรวจสอบอัปเดต" ในโปรแกรม`,
        inline: false
    });
    return {
        title: '📮 [ขออัปเดตเวอร์ชันใหม่] พบข้อผิดพลาดที่ระบบซ่อมเองไม่ได้',
        color: 15158332,
        fields,
        footer: { text: `AutoQueueforLive Update Request • ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}` }
    };
}

module.exports = {
    assessErrorForDevReport,
    UPDATE_REQUEST_REPEAT_THRESHOLD,
    shouldRequestNewVersion,
    buildUpdateRequestEmbed
};
