// lib/slipVerify.js — โดเมน "การตรวจสลิป" ส่วนตรรกะล้วน (ย้ายจาก index.js ใน v1.0.19 แบบตัวอักษรเดิมทุกตัว)
// 1) classifySlipOkError: แปลผลรหัสข้อผิดพลาดของ SlipOK ตามเอกสาร (ตัวเดียวที่ทุกจุดต้องใช้ — ห้ามตีความเอง)
// 2) extractQrRef: ถอดตัวตนรายการ (sub-tag 02) จาก QR ของสลิป — พิสูจน์แล้วด้วยคีย์จริง 2026-10-31 ว่าตรงกับ transRef
//    (กรุงไทย + กรุงเทพ ตรงเป๊ะทุกตัวอักษร; ใช้เทียบแบบ "ตรงกันเป๊ะ" เท่านั้น)
'use strict';

function classifySlipOkError(httpStatus, body) {
    const code = body ? Number(body.code) : NaN;
    const d = (body && body.data) || {};
    const T = (kind, level, message, extra) => Object.assign({ kind, level, message, code: Number.isFinite(code) ? code : null }, extra || {});
    if (code === 1010) {
        const bank = d.bankName ? 'ธนาคาร' + d.bankName : 'ธนาคารต้นทาง';
        const delay = Number(d.delay) > 0 ? Number(d.delay) : null;
        return T('bank_delay', 'WARN', 'สลิป' + bank + 'ยังตรวจไม่ได้ ต้องรอ' + (delay ? 'ประมาณ ' + delay + ' นาที' : 'สักครู่') + 'หลังโอน (SlipOK Code 1010) ไม่ใช่สลิปผิด ระบบเก็บรูปไว้ในคิวรอใส่ยอด ให้ลูกค้าส่งรูปเดิมซ้ำหลังเวลานั้น ระบบจะตรวจให้เอง', { bankName: d.bankName || '', delay });
    }
    if (code === 1009) return T('bank_outage', 'WARN', 'ระบบธนาคารขัดข้องชั่วคราว SlipOK ขอให้ตรวจใหม่ในอีก 15 นาที (Code 1009 เอกสาร SlipOK ระบุว่าไม่เสียโควต้า) รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1003) return T('quota', 'ERROR', 'แพ็กเกจ SlipOK หมดอายุ (Code 1003) ต้องต่ออายุแพ็กเกจ');
    if (code === 1004) return T('quota', 'ERROR', 'ใช้เกินโควต้า SlipOK ถึงวงเงินที่กำหนด (Code 1004) ต้องต่อแพ็กเกจ');
    if (Number(httpStatus) === 402) return T('quota', 'ERROR', 'SlipOK แจ้งว่าเครดิตไม่พอ (HTTP 402)');
    if (code === 1005 || code === 1006) return T('bad_image', 'WARN', 'รูปที่ลูกค้าส่งมาเปิดอ่านไม่ได้หรือไม่ใช่รูปภาพ (Code ' + code + ') รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1007) return T('no_qr', 'WARN', 'ไม่พบ QR Code ในรูปที่ลูกค้าส่งมา อาจไม่ใช่สลิปหรือถูกครอบตัด (Code 1007) รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1008) return T('not_payment_qr', 'WARN', 'QR ในรูปไม่ใช่ QR ตรวจสอบการชำระเงิน (Code 1008) รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1011) return T('qr_expired', 'WARN', 'QR หมดอายุ หรือไม่พบรายการโอนจริง (Code 1011) รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1013 || code === 1014) return T('mismatch', 'WARN', 'SlipOK แจ้งว่ายอดหรือบัญชีผู้รับไม่ตรง (Code ' + code + ') รูปถูกเก็บไว้ในคิวรอใส่ยอด');
    if (code === 1000 || code === 1001 || code === 1002) return T('config', 'ERROR', 'ตั้งค่า SlipOK ไม่ถูกต้อง (Code ' + code + ' ตรวจ API Key และ Branch ID ในหน้าตั้งค่า)');
    if (!body) return T('other', 'ERROR', 'เชื่อมต่อ SlipOK ไม่ได้ (เน็ตสะดุดหรือบริการล่ม) สลิปถูกเก็บไว้ในคิวรอใส่ยอด');
    return T('other', 'ERROR', 'SlipOK ตอบกลับข้อผิดพลาดที่ไม่รู้จัก' + (Number.isFinite(code) ? ' (Code ' + code + ')' : '') + (httpStatus ? ' HTTP ' + httpStatus : ''));
}

// ถอดตัวตนรายการจาก QR ของสลิป: โครงสร้าง tag 00 (template) → sub 00 เวอร์ชัน / sub 01 รหัสธนาคารผู้โอน / sub 02 ข้อมูลรายการ
// คืน null เมื่อถอดไม่ได้/รูปแบบผิด — ผู้เรียกต้องกลับไปใช้วิธีเดิม (หน้าต่างเวลา + การ์ดยืนยัน) ไม่มีทางผูกผิด
function extractQrRef(qrText) {
    const text = String(qrText || '').trim();
    if (!text || text.length < 10) return null;
    let i = 0;
    while (i + 4 <= text.length) {
        const id = text.slice(i, i + 2);
        const len = parseInt(text.slice(i + 2, i + 4), 10);
        if (!/^\d{2}$/.test(id) || !Number.isFinite(len) || i + 4 + len > text.length) return null;
        if (id === '00') {
            const inner = text.slice(i + 4, i + 4 + len);
            let j = 0;
            while (j + 4 <= inner.length) {
                const sid = inner.slice(j, j + 2);
                const slen = parseInt(inner.slice(j + 2, j + 4), 10);
                if (!/^\d{2}$/.test(sid) || !Number.isFinite(slen) || j + 4 + slen > inner.length) return null;
                if (sid === '02') {
                    const v = inner.slice(j + 4, j + 4 + slen);
                    return v.length >= 8 ? v : null;   // สั้นผิดปกติ = ไม่ใช่ข้อมูลรายการ
                }
                j += 4 + slen;
            }
            return null;
        }
        i += 4 + len;
    }
    return null;
}

// v1.0.19 (เจ้าของสั่ง 2026-11-01): รหัสธนาคารผู้โอน (tag 00 -> sub 01, 3 หลัก) ใช้บอกว่ากติกา "รหัส QR == รหัส SlipOK" พิสูจน์แล้วสำหรับธนาคารนั้นหรือไม่
function extractQrBank(qrText) {
    const text = String(qrText || '').trim();
    if (!text || text.length < 10) return null;
    let i = 0;
    while (i + 4 <= text.length) {
        const id = text.slice(i, i + 2);
        const len = parseInt(text.slice(i + 2, i + 4), 10);
        if (!/^\d{2}$/.test(id) || !Number.isFinite(len) || i + 4 + len > text.length) return null;
        if (id === '00') {
            const inner = text.slice(i + 4, i + 4 + len);
            let j = 0;
            while (j + 4 <= inner.length) {
                const sid = inner.slice(j, j + 2);
                const slen = parseInt(inner.slice(j + 2, j + 4), 10);
                if (!/^\d{2}$/.test(sid) || !Number.isFinite(slen) || j + 4 + slen > inner.length) return null;
                if (sid === '01') { const v = inner.slice(j + 4, j + 4 + slen); return /^\d{3}$/.test(v) ? v : null; }
                j += 4 + slen;
            }
            return null;
        }
        i += 4 + len;
    }
    return null;
}
// ธนาคารที่พิสูจน์แล้วว่า QR sub-tag 02 == transRef ของ SlipOK ทุกตัวอักษร: KTB (006, การทดลองคีย์จริง 2026-10-31),
// BBL (002) และ SCB (014) จาก log ไลฟ์จริงของร้าน 2026-11-01 (4/4 ตรง) -- เพิ่มธนาคารเมื่อมีหลักฐานจากบรรทัด "หลักฐานรหัส QR" เท่านั้น
const PROVEN_QR_BANKS = Object.freeze(['002', '006', '014']);

module.exports = { classifySlipOkError, extractQrRef, extractQrBank, PROVEN_QR_BANKS };
