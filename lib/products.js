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

// รูปแบบรหัสรอบไลฟ์ LIVE_<timestamp> (v1.0.20, P5)
const LIVE_ID_RE = /^LIVE_\d+$/;

const Products = { countProducts };

// v1.0.20 (P2): ประกอบตาราง สินค้า × รอบไลฟ์ จากสลิปในช่วงที่เลือก (นับด้วยกติกาเดียวกันจาก lib/products.js)
// คอลัมน์ = รอบใหม่ → เก่า (ตามลำดับ rounds ที่ส่งเข้ามา ซึ่งเรียงแล้ว) + "นอกรอบไลฟ์" ท้ายสุดถ้ามีสลิปไม่มีรอบ
// ใช้ร่วมทั้ง /api/history_data (แสดงบนหน้าประวัติ) และ /api/history/product_rounds_excel (ดาวน์โหลด Excel)
function buildProductRoundSummary(slips, rounds) {
    const byRound = new Map();
    (slips || []).forEach(s => {
        const key = s.session_id && LIVE_ID_RE.test(String(s.session_id)) ? String(s.session_id) : '__oor__';
        if (!byRound.has(key)) byRound.set(key, []);
        byRound.get(key).push(s);
    });
    const columns = [];
    (rounds || []).forEach(r => { if (r.sessionId) columns.push({ key: String(r.sessionId), sessionId: r.sessionId }); });
    if (byRound.has('__oor__')) columns.push({ key: '__oor__', sessionId: null });
    const perCol = {};
    columns.forEach(c => { perCol[c.key] = Products.countProducts(byRound.get(c.key) || []); });
    const names = new Set();
    Object.keys(perCol).forEach(k => Object.keys(perCol[k].counts).forEach(n => names.add(n)));
    const rows = [...names].map(n => {
        const cells = columns.map(c => perCol[c.key].counts[n] || 0);
        return { name: n, cells, total: cells.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'th'));
    const columnTotals = columns.map(c => perCol[c.key].pieces);
    return { columns, rows, columnTotals, grandTotal: columnTotals.reduce((a, b) => a + b, 0) };
}

module.exports = {
    UNKNOWN_PRODUCT,
    LIVE_ID_RE,
    slipBreakdown,
    countProducts,
    buildProductRoundSummary
};
