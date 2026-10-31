// lib/address.js — โดเมน "ที่อยู่/ชื่อภาษาไทย" ส่วนตัวอ่านข้อความล้วน (ย้ายจาก index.js ใน v1.0.19 แบบตัวอักษรเดิมทุกตัว)
// สิ่งที่ "ยังไม่" อยู่ที่นี่โดยตั้งใจ: callGeminiAddress (ยิงเน็ตจริง + อ่าน env) และ ตัวจัดคิวลองใหม่เบื้องหลัง (มีสถานะ + timer) — อยู่กับ index.js ไปก่อน
// ข้อกำหนดสำคัญ: ฟังก์ชันกลุ่มนี้ห้ามมี regex ที่มีเครื่องหมายคำพูด ' " ` ข้างใน (ตัวดึงฟังก์ชันของเทสต์ tests/harness/extract.js อ่านไม่ได้ — กฎเดิมจาก AGENTS)
'use strict';

// เลือกชื่อผู้รับจากข้อความที่อยู่ ลำดับ: (ก) บรรทัดที่ขึ้นต้น "ชื่อ/ผู้รับ" (ข) บรรทัดที่มีคำนำหน้าชื่อคนไทย
// (ค) บรรทัดแรก (กติกาเดิม) (ง) ข้อความหน้าเบอร์โทรในบรรทัดเดียวกัน (จ) บรรทัดสุดท้าย
// ข้อความที่มีตัวเลข / คำบอกที่อยู่ / คำทักทาย ไม่ใช่ชื่อ (กันเอาบรรทัดที่อยู่หรือ "ขอบคุณค่ะ" มาเป็นชื่อ) ไม่เจอ = คืนค่าว่าง ให้ผู้เรียกใช้ชื่อสำรอง
function pickRecipientName(text, phoneText) {
    const LABEL_RE = /^(ชื่อผู้รับ|ชื่อ-นามสกุล|ชื่อ|ผู้รับ)\s*[:.\-]?\s*/;
    const TITLE_RE = /^(นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|คุณ)\s*[ก-๏a-zA-Z]/;
    const NOT_NAME_RE = /(ต\.|อ\.|จ\.|ซ\.|ถ\.|ตำบล|อำเภอ|จังหวัด|ซอย|หมู่|ถนน|แขวง|เขต|รหัส|เลขที่|อาคาร|คอนโด|ไปรษณีย์|ที่อยู่|ส่งที่|กรุงเทพ|ขอบคุณ|ค่ะ|ครับ|ด่วน|ฝาก|สลิป|เปลี่ยน|เบอร์|โทร|สวัสดี|นะคะ|นะครับ|รบกวน|tel|phone)/i;
    // v1.0.19: วงเล็บที่เป็นหมายเหตุ เช่น (ฝากแม่รับ) ตัดออก ส่วนวงเล็บที่เป็นชื่อ เช่น (คุณเอก) คงไว้
    const tidy = (s) => String(s || '').replace(/\s*\(([^)]*)\)/g, (m, inner) => (NOT_NAME_RE.test(inner) ? '' : m)).replace(/^คุณ\s*/, '').replace(/\s+/g, ' ').trim();
    const looksLikeName = (s) => s.length >= 2 && s.length <= 40 && /[ก-๏a-zA-Z]/.test(s) && !/[0-9๐-๙]/.test(s) && !NOT_NAME_RE.test(s);
    // v1.0.19: ตัดอีโมจิ/สัญลักษณ์หน้าบรรทัด (📦 🙋 📞) ก่อนดู
    const raw = String(text || '').split('\n').map(l => l.replace(/^[^ก-๏a-zA-Z0-9(+]+/, '').trim()).filter(Boolean);
    const lines = raw.map(l => (phoneText ? l.replace(phoneText, '') : l).trim());
    for (const l of lines) {
        if (!LABEL_RE.test(l)) continue;
        const s = tidy(l.replace(LABEL_RE, ''));
        if (looksLikeName(s)) return s;
    }
    for (const l of lines) {
        if (!TITLE_RE.test(l)) continue;
        const s = tidy(l);
        if (looksLikeName(s)) return s;
    }
    if (lines.length > 0) {
        const s = tidy(lines[0].replace(/k\./gi, ''));
        if (looksLikeName(s)) return s;
    }
    if (phoneText) {
        const phoneLine = raw.find(l => l.includes(phoneText));
        if (phoneLine) {
            const s = tidy(phoneLine.slice(0, phoneLine.indexOf(phoneText)));
            if (looksLikeName(s)) return s;
        }
    }
    if (lines.length > 1) {
        const s = tidy(lines[lines.length - 1]);
        if (looksLikeName(s)) return s;
    }
    // (ฉ) v1.0.19: บรรทัดแรกที่ดูเป็นชื่อ (เช่น ชื่ออยู่บรรทัดที่ 2 หลังคำทักทาย หรือหลังบรรทัดเบอร์โทร)
    for (const l of lines) {
        const s = tidy(l);
        if (looksLikeName(s)) return s;
    }
    return '';
}

// v1.0.19: หาชื่อจังหวัดที่พิมพ์โดยไม่มี จ./จังหวัด นำหน้า (ทั้งคำเท่านั้น กันคำอย่าง "เลย" ในประโยคทั่วไป)
function findThaiProvinceName(text) {
    const PROVINCES = ['กรุงเทพมหานคร', 'กระบี่', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยะลา', 'ยโสธร', 'ร้อยเอ็ด', 'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี'];
    const tokens = String(text || '').split(/[\s,]+/).map(t => t.replace(/\d+$/, ''));
    return tokens.find(t => PROVINCES.includes(t)) || '';
}

function parseThaiAddressFallback(text, defaultName = 'ลูกค้า LINE') {
    if (!text || typeof text !== 'string') return null;

    // 1. สกัดเบอร์โทรศัพท์ -- v1.0.19: อ่านเบอร์ที่พิมพ์เว้นวรรค/ขีดทีละตัวได้ และถ้ามีหลายเบอร์ เลือกเบอร์มือถือก่อนเบอร์บ้าน (02...)
    let phone = '';
    let phoneMatch = null;
    {
        const re = /(?<!\d)(?:\+?66|0)(?:[\s\-.]*\d){8,9}(?!\d)/g;
        const found = [];
        let m;
        while ((m = re.exec(text)) !== null) {
            let d = m[0].replace(/\D/g, '');
            if (d.startsWith('66')) d = '0' + d.slice(2);
            if (/^0\d{8,9}$/.test(d)) found.push({ raw: m[0], digits: d });
        }
        const pick = found.find(f => /^0[689]\d{8}$/.test(f.digits)) || found[0];
        if (pick) { phone = pick.digits; phoneMatch = [pick.raw]; }
    }

    // 2. สกัดรหัสไปรษณีย์ 5 หลัก
    let postcode = '';
    const postMatch = text.match(/\b([1-9][0-9]{4})\b/);
    if (postMatch) {
        postcode = postMatch[1];
    }

    // หากไม่มีทั้งเบอร์โทรและรหัสไปรษณีย์ แสดงว่าไม่ใช่ข้อความที่อยู่จัดส่ง
    if (!phone && !postcode) return null;

    // 3. สกัดจังหวัด
    let province = '';
    const provMatch = text.match(/(?:จ\.|จังหวัด)\s*([ก-๙a-zA-Z]+)/);
    if (provMatch) province = provMatch[1].trim();
    // v1.0.19: กรุงเทพ/กทม ไม่มี จ. นำหน้า เดิมจึงไม่เคยได้จังหวัด และจังหวัดที่พิมพ์โดยไม่มี จ. นำหน้า
    if (/^(กรุงเทพ|กรุงเทพฯ|กทม)$/.test(province) || (!province && /กรุงเทพ|กทม/.test(text))) province = 'กรุงเทพมหานคร';
    if (!province) province = findThaiProvinceName(text);

    // 4. สกัดอำเภอ / เขต
    let district = '';
    const distMatch = text.match(/(?:อ\.|อำเภอ|เขต)\s*([ก-๙a-zA-Z]+)/);
    if (distMatch) district = distMatch[1].trim();

    // 5. สกัดตำบล / แขวง
    let subdistrict = '';
    const subMatch = text.match(/(?:ต\.|ตำบล|แขวง)\s*([ก-๙a-zA-Z]+)/);
    if (subMatch) subdistrict = subMatch[1].trim();

    // 6. สกัดชื่อผู้รับ — v1.0.17 (Phase C): หาจากทุกบรรทัด เพราะลูกค้ามักพิมพ์ชื่อไว้ท้ายข้อความ (ดู pickRecipientName)
    let recipient_name = pickRecipientName(text, phoneMatch ? phoneMatch[0] : '');

    // 7. สกัดบ้านเลขที่/ซอย/ถนน (ข้อความที่เหลือ)
    let addressClean = text
        .replace(phoneMatch ? phoneMatch[0] : '', '')
        .replace(postMatch ? postMatch[0] : '', '')
        .replace(provMatch ? provMatch[0] : '', '')
        .replace(distMatch ? distMatch[0] : '', '')
        .replace(subMatch ? subMatch[0] : '', '')
        .replace(recipient_name, '')
        .replace(/ชื่อ|เบอร์|โทร|ผู้รับ|ที่อยู่|ส่งที่/gi, '')
        .replace(/\n+/g, ' ')
        .trim();

    // v1.0.17 (เจ้าของอนุมัติ 2026-10-31): ข้อความที่ไม่มีส่วนของที่อยู่เลย (เช่น "เปลี่ยนเบอร์ 08x") เดิมเก็บทั้งข้อความเป็นที่อยู่
    // ทำให้ขั้นรวมที่อยู่เดิมใน webhook ไม่คืนที่อยู่เก่า และ Kerry ได้ "ที่อยู่" เป็นเบอร์โทร -> ให้ช่องที่อยู่ว่างแทน
    const hasAddressPart = !!(postcode || province || district || subdistrict) || /[0-9๐-๙]/.test(addressClean);

    const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
    let finalRecipient = recipient_name ? recipient_name.trim() : '';
    if (!finalRecipient || genericNames.includes(finalRecipient.toLowerCase())) {
        finalRecipient = defaultName || 'ลูกค้า LINE';
    }

    return {
        recipient_name: finalRecipient,
        phone: phone || '',
        address: hasAddressPart ? (addressClean || text) : '',
        subdistrict: subdistrict || '',
        district: district || '',
        province: province || '',
        postcode: postcode || '',
        remark: ''   // v1.0.19: ช่องนี้ลงไฟล์ Kerry (พิมพ์บนใบปะหน้า) ห้ามใส่โน้ตภายใน เดิมใส่ "สกัดด้วยระบบสำรอง Regex" ทุกครั้งที่ใช้ระบบสำรอง
    };
}

function normalizeThaiPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('66')) d = '0' + d.slice(2);
    return /^0\d{8,9}$/.test(d) ? d : '';
}

function isRetryableGeminiError(err) {
    const st = err && err.response && err.response.status;
    if (!st) return true;   // หมดเวลา / เน็ตหลุด / DNS
    return st === 429 || st >= 500;
}

function geminiRetryDelayMs(err) {
    try {
        const details = (err.response.data.error.details) || [];
        const info = details.find(x => String(x['@type'] || '').includes('RetryInfo'));
        const sec = info ? parseFloat(String(info.retryDelay)) : NaN;
        if (sec > 0) return Math.min(sec * 1000, 120000);
    } catch (e) { /* ไม่มีข้อมูลเวลารอ */ }
    try {
        const h = Number(err.response.headers['retry-after']);
        if (h > 0) return Math.min(h * 1000, 120000);
    } catch (e) { /* ไม่มีหัว retry-after */ }
    return 0;
}

// คำตอบ Gemini เป็นหลัก ช่องที่ว่าง/รูปแบบผิดค่อยเติมจากระบบสำรองของข้อความเดียวกัน ไม่มีทั้งเบอร์และรหัสไปรษณีย์ = ไม่ใช่ที่อยู่ (null)
function finishAiAddress(ai, fb, defaultName) {
    if (!ai || typeof ai !== 'object') return null;
    const out = Object.assign({}, ai);
    out.phone = normalizeThaiPhone(ai.phone) || (fb && fb.phone) || '';
    const pc = String(ai.postcode || '').trim();
    out.postcode = /^\d{5}$/.test(pc) ? pc : ((fb && fb.postcode) || '');
    for (const f of ['address', 'subdistrict', 'district', 'province']) {
        out[f] = String(out[f] || '').trim();
        if (!out[f] && fb && fb[f]) out[f] = fb[f];
    }
    out.remark = String(ai.remark || '').trim();
    if (!out.phone && !out.postcode) return null;
    const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
    let finalName = out.recipient_name ? String(out.recipient_name).trim() : '';
    if (!finalName || genericNames.includes(finalName.toLowerCase())) finalName = defaultName || 'ลูกค้า LINE';
    out.recipient_name = finalName;
    return out;
}

module.exports = { pickRecipientName, findThaiProvinceName, parseThaiAddressFallback, normalizeThaiPhone, isRetryableGeminiError, geminiRetryDelayMs, finishAiAddress };
