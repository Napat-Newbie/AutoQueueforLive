// lib/kerryAddress.js — จัดเรียงที่อยู่เต็มตามมาตรฐาน Kerry Express KEX EasyShip (v1.0.20, P5)
// ย้ายจาก index.js แบบตัวอักษรเดิมทุกตัว (Pure function ไม่แตะสถานะกลาง)
'use strict';

// 📦 ฟังก์ชันจัดเรียงที่อยู่เต็มตามมาตรฐาน Kerry Express KEX EasyShip (*ที่อยู่/Address)
// กฎเหล็ก:
// 1. ช่องที่อยู่ต้องไม่มีรหัสไปรษณีย์ 5 หลัก (Kerry มีคอลัมน์รหัสไปรษณีย์แยกเฉพาะใน Col 5)
// 2. ห้ามใช้ slash เช่น 'แขวง/ต.' หรือ 'เขต/อ.' ซึ่งทำให้ Kerry อ่านเพี้ยนและเกิดอาการข้อมูลเบิ้ลซ้ำ
// 3. ป้องกันการระบุ ตำบล/อำเภอ/จังหวัด ซ้ำซ้อนหากในที่อยู่เดิมมีระบุไว้แล้ว
function buildKerryFullAddress(addr) {
    if (!addr) return '';
    if (typeof addr === 'string') {
        return addr
            .replace(/แขวง\/ต\./g, 'ต.')
            .replace(/เขต\/อ\./g, 'อ.')
            .replace(/\b[1-9]\d{4}\b/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // 🛡️ Escape อักขระพิเศษ (เช่น ( ) * + ?) จากที่อยู่ลูกค้า ก่อนนำไปสร้าง RegExp ป้องกันส่งออก Kerry ล่ม
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let rawAddr = (addr.address || '').trim();
    let sub = (addr.subdistrict || '').trim();
    let dist = (addr.district || '').trim();
    let prov = (addr.province || '').trim();
    let post = (addr.postcode ? String(addr.postcode) : '').trim();

    // 1. นำรหัสไปรษณีย์ 5 หลักออกจากที่อยู่ (Kerry แยกช่องรหัสไปรษณีย์ไว้ใน Col 5 อยู่แล้ว)
    if (post) {
        rawAddr = rawAddr.replace(new RegExp(`\\b${escapeRegExp(post)}\\b`, 'g'), '');
    }
    rawAddr = rawAddr.replace(/\b[1-9]\d{4}\b/g, '');

    // 2. ตรวจสอบพื้นที่กรุงเทพมหานคร vs ต่างจังหวัด
    const fullTextToCheck = `${rawAddr} ${sub} ${dist} ${prov}`;
    const isBkk = /กรุงเทพ|กทม|bangkok/i.test(fullTextToCheck);

    // 3. กำหนดคำนำหน้ามาตรฐาน (ห้ามมี slash แขวง/ต. หรือ เขต/อ.)
    const subPrefix = isBkk ? 'แขวง' : 'ต.';
    const distPrefix = isBkk ? 'เขต' : 'อ.';
    const provPrefix = isBkk ? '' : 'จ.';

    // คลีนเครื่องหมาย slash แขวง/ต. หรือ เขต/อ. ที่อาจตกค้างใน rawAddr
    rawAddr = rawAddr.replace(/แขวง\/ต\./g, subPrefix).replace(/เขต\/อ\./g, distPrefix);
    rawAddr = rawAddr.replace(/\s{2,}/g, ' ').trim();

    // คลีนคำนำหน้าที่อาจมีติดมาใน sub, dist, prov อยู่แล้ว
    const cleanSub = sub.replace(/^(ต\.|ตำบล|แขวง)/, '').trim();
    const cleanDist = dist.replace(/^(อ\.|อำเภอ|เขต)/, '').trim();
    const cleanProv = prov.replace(/^(จ\.|จังหวัด)/, '').trim();

    const parts = [];
    if (rawAddr) parts.push(rawAddr);

    // เช็คว่าใน rawAddr มีตำบล/แขวง อยู่แล้วหรือไม่ ถ้ายังไม่มีจึงต่อท้าย
    if (cleanSub) {
        const subRegex = new RegExp(`(?:ต\\.|ตำบล|แขวง)?\\s*${escapeRegExp(cleanSub)}`, 'i');
        if (!subRegex.test(rawAddr)) {
            parts.push(`${subPrefix}${cleanSub}`);
        }
    }

    // เช็คว่ามีอำเภอ/เขต อยู่แล้วหรือไม่
    if (cleanDist) {
        const distRegex = new RegExp(`(?:อ\\.|อำเภอ|เขต)?\\s*${escapeRegExp(cleanDist)}`, 'i');
        const currentText = parts.join(' ');
        if (!distRegex.test(currentText)) {
            parts.push(`${distPrefix}${cleanDist}`);
        }
    }

    // เช็คว่ามีจังหวัดอยู่แล้วหรือไม่ (ป้องกันสับสนกับ อำเภอเมือง)
    if (cleanProv) {
        const provRegex = new RegExp(`(?:จ\\.|จังหวัด)\\s*${escapeRegExp(cleanProv)}|(?:^|\\s+)${escapeRegExp(cleanProv)}(?:\\s+|$)`, 'i');
        const currentWithoutDist = parts.filter(p => !p.startsWith('อ.') && !p.startsWith('เขต')).join(' ');
        const hasProvExplicit = /(?:จ\.|จังหวัด)/.test(parts.join(' ')) && provRegex.test(parts.join(' '));

        if (!hasProvExplicit && !provRegex.test(currentWithoutDist)) {
            parts.push(isBkk ? 'กรุงเทพมหานคร' : `${provPrefix}${cleanProv}`);
        }
    } else if (isBkk) {
        const currentText = parts.join(' ');
        if (!/กรุงเทพ/i.test(currentText)) {
            parts.push('กรุงเทพมหานคร');
        }
    }

    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

module.exports = {
    buildKerryFullAddress
};
