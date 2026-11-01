// lib/products.js — กติกาเดียวของการนับ "สินค้า × จำนวนชิ้น" จากสลิป (v1.0.20, P2)
// ใช้ร่วมกันทั้งสรุปหลังจบไลฟ์ใน Discord (summarizeLiveProducts ใน index.js)
// และตาราง "สินค้า × รอบไลฟ์" ของหน้าประวัติ (คำนวณที่เซิร์ฟเวอร์แล้วส่งไป) — ห้ามมีสองกติกา
'use strict';

// สลิปที่มีชิ้นแต่ breakdown ว่าง (ข้อมูลเก่า / ถูกแก้จนรายการหาย) นับเข้าแถวนี้เท่ากับจำนวนชิ้น
// เพื่อให้ผลรวมชิ้นตรงกับ draws เสมอ แทนที่จะหายไปเงียบๆ ทำให้ยอดสองที่ไม่ตรงกัน
const UNKNOWN_PRODUCT = 'ไม่ระบุสินค้า';

// breakdown อยู่ใน qr_payload: "รหัสอ้างอิง|ชื่อ xจำนวน, ..." ส่วนใบ manual_image คือ "manual_image|url|breakdown"
function slipBreakdown(payload) {
    const p = String(payload || '');
    if (!p) return '';
    const parts = p.split('|');
    return p.startsWith('manual_image') ? (parts[2] || '') : (parts[1] || '');
}

// นับสินค้าของกลุ่มสลิป (ทั้งรอบหรือทั้งช่วงที่กรอง): ไม่นับ rejected/skipped/ยังไม่มีชิ้น (draws > 0 เท่านั้น)
// กติกาเดิมของ summarizeLiveProducts ทุกตัวอักษร + เติมแถว "ไม่ระบุสินค้า" สำหรับใบไม่มี breakdown
function countProducts(rows) {
    const counts = {};
    let pieces = 0;
    (rows || []).forEach(r => {
        if (r.status === 'rejected' || r.status === 'skipped' || !(Number(r.draws) > 0)) return;
        const breakdown = slipBreakdown(r.qr_payload);
        if (!breakdown) {
            counts[UNKNOWN_PRODUCT] = (counts[UNKNOWN_PRODUCT] || 0) + Number(r.draws);
            pieces += Number(r.draws);
            return;
        }
        breakdown.split(',').forEach(p => {
            const t = p.trim();
            if (!t) return;
            const m = t.match(/(.+)\s+x(\d+)$/);
            const name = m ? m[1].trim() : t;
            const qty = m ? parseInt(m[2], 10) : 1;
            counts[name] = (counts[name] || 0) + qty;
            pieces += qty;
        });
    });
    return { counts, pieces, unknown: counts[UNKNOWN_PRODUCT] || 0 };
}

module.exports = { UNKNOWN_PRODUCT, slipBreakdown, countProducts };
