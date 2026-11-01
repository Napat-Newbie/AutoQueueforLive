// lib/liveReport.js
// v1.0.20 (P5: 1.1): สรุปหลังจบไลฟ์ (Discord Embed) และการวิเคราะห์ปัญหาของรอบไลฟ์
'use strict';

const Products = require('./products');

// รูปแบบการแสดงผลตามระดับความรุนแรงของปัญหา (v1.0.20, P5)
const SEVERITY_STYLE = { CRITICAL: { icon: '🟥', color: 15158332, label: 'วิกฤต' }, HIGH: { icon: '🟧', color: 15105570, label: 'สูง' }, MEDIUM: { icon: '🟨', color: 16776960, label: 'ปานกลาง' }, LOW: { icon: '🟦', color: 3447003, label: 'ต่ำ' } };

function quotedNamesOf(message) {
    return String(message || '').split('"').filter((_, i) => i % 2 === 1);
}

function getLiveIssueRules() {
    const OPEN_CARD = 'เปิดรูปในการ์ดรอใส่ยอด ถ้าเป็นสลิปจริงให้ใส่ยอดเอง ถ้าไม่ใช่สลิปให้ปัดตก';
    return [
        { key: 'bank_delay', test: /Code 1010/, severity: 'LOW',
          title: 'สลิปธนาคารที่ต้องรอหลังโอนถึงจะตรวจได้ (SlipOK 1010)',
          detail: (g) => {
              const seen = [];
              g.messages.forEach(m => {
                  const b = m.indexOf('ยังตรวจไม่ได้');
                  const bank = (m.indexOf('สลิป') === 0 && b > 4) ? m.slice(4, b) : 'ธนาคารต้นทาง';
                  const mm = m.match(/ประมาณ (\d+) นาที/);
                  const t = bank + (mm ? ' รอประมาณ ' + mm[1] + ' นาที' : '');
                  if (!seen.includes(t)) seen.push(t);
              });
              return seen.slice(0, 4).join(' • ');
          },
          meaning: 'ธนาคารต้นทางของลูกค้ายังไม่ให้ตรวจสลิปจนกว่าจะพ้นเวลาที่กำหนดหลังโอน (ตามเอกสาร SlipOK) ไม่ใช่สลิปผิดหรือสลิปปลอม รูปถูกเก็บไว้ในคิวรอใส่ยอดแล้ว',
          action: 'ให้ลูกค้าส่งรูปเดิมซ้ำหลังพ้นเวลานั้น ระบบจะตรวจให้ หรือเปิดรูปในการ์ดรอใส่ยอดแล้วใส่ยอดเอง' },
        { key: 'bank_outage', test: /Code 1009/, severity: 'LOW',
          title: 'ระบบธนาคารขัดข้องชั่วคราว (SlipOK 1009)',
          meaning: 'SlipOK แจ้งว่าธนาคารขัดข้องและขอให้ตรวจใหม่ในอีก 15 นาที เอกสาร SlipOK ระบุว่ารหัสนี้ไม่เสียโควต้า รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'เปิดรูปในการ์ดรอใส่ยอดแล้วใส่ยอดเอง หรือให้ลูกค้าส่งรูปเดิมซ้ำหลังผ่านไป 15 นาที' },
        { key: 'quota', test: /Code 100[34]|HTTP 402|เครดิตตรวจสลิป.*หมดแล้ว|โควตา.*หมด/, severity: 'HIGH',
          title: 'เครดิตหรือแพ็กเกจตรวจสลิปหมด',
          meaning: 'ผู้ให้บริการตรวจสลิปปฏิเสธเพราะแพ็กเกจหมดอายุหรือใช้เกินโควต้า (SlipOK 1003/1004) หรือเครดิตไม่พอ (HTTP 402) ระหว่างนี้สลิปที่เข้ามาถูกส่งเข้าคิวให้ตรวจภาพเอง หรือสลับไปผู้ให้บริการสำรองถ้าตั้งไว้',
          action: 'ต่อแพ็กเกจหรือเติมเครดิตที่ผู้ให้บริการ แล้วตรวจการ์ดรอใส่ยอดที่ค้างจากช่วงนั้น' },
        { key: 'slipok_config', test: /Code 100[012]/, severity: 'HIGH',
          title: 'ตั้งค่า SlipOK ไม่ถูกต้อง (1000-1002)',
          meaning: 'โปรแกรมแปลรหัส 1000-1002 ว่า API Key หรือ Branch ID ไม่ถูกต้อง สลิปที่เข้ามาถูกส่งเข้าคิวรอใส่ยอด',
          action: 'ตรวจ API Key และ Branch ID ในหน้าตั้งค่า' },
        { key: 'slipok_unreachable', test: /เชื่อมต่อ SlipOK ไม่ได้/, severity: 'HIGH',
          title: 'เชื่อมต่อ SlipOK ไม่ได้',
          meaning: 'ไม่ได้รับคำตอบจาก SlipOK อาจเป็นเน็ตของเครื่องร้านสะดุดหรือบริการล่ม (ข้อมูลที่บันทึกไว้แยกไม่ได้ว่าเป็นข้อไหน) สลิปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'ตรวจอินเทอร์เน็ตของเครื่องร้าน แล้วใส่ยอดเองจากการ์ดรอใส่ยอด' },
        { key: 'slipok_unknown', test: /SlipOK ตอบกลับข้อผิดพลาดที่ไม่รู้จัก/, severity: 'MEDIUM',
          title: 'SlipOK ตอบรหัสที่โปรแกรมยังไม่รู้จัก',
          meaning: 'รหัสนี้ไม่อยู่ในรายการที่โปรแกรมแปลความหมายได้ (รหัสอยู่ในข้อความด้านบน)',
          action: 'เทียบรหัสกับเอกสาร SlipOK แล้วแจ้งผู้พัฒนา' },
        { key: 'no_qr', test: /Code 1007/, severity: 'LOW',
          title: 'SlipOK ไม่พบ QR Code ในรูป (1007)',
          meaning: 'โปรแกรมแปลรหัสนี้ว่าไม่พบ QR Code ในรูป อาจไม่ใช่รูปสลิปหรือถูกครอบตัด ระบบยังบอกไม่ได้ว่ารูปแต่ละใบเป็นเพราะอะไร รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'bad_image', test: /Code 100[56]/, severity: 'LOW',
          title: 'รูปเปิดอ่านไม่ได้หรือไม่ใช่รูปภาพ (1005/1006)',
          meaning: 'SlipOK อ่านไฟล์ที่ส่งมาเป็นรูปภาพไม่ได้ รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'not_payment_qr', test: /Code 1008/, severity: 'LOW',
          title: 'QR ในรูปไม่ใช่ QR ตรวจสอบการชำระเงิน (1008)',
          meaning: 'มี QR ในรูป แต่ SlipOK ระบุว่าไม่ใช่ QR สำหรับตรวจสอบการชำระเงิน รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'qr_expired', test: /Code 1011/, severity: 'LOW',
          title: 'QR หมดอายุ หรือไม่พบรายการโอนจริง (1011)',
          meaning: 'SlipOK ไม่พบรายการโอนจริงของ QR นี้ หรือ QR หมดอายุ ระบบแยกไม่ได้ว่าเป็นกรณีไหน รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'mismatch', test: /Code 101[34]/, severity: 'MEDIUM',
          title: 'SlipOK แจ้งว่ายอดหรือบัญชีผู้รับไม่ตรง (1013/1014)',
          meaning: 'ผลตรวจจาก SlipOK ว่ายอดหรือบัญชีผู้รับไม่ตรง รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'เปิดรูปตรวจกับบัญชีร้านและยอดที่ลูกค้าโอน แล้วใส่ยอดเองหรือปัดตก' },
        { key: 'wrong_account', test: /ตรวจพบสลิปโอนผิดบัญชี/, severity: 'HIGH',
          title: 'สลิปโอนเข้าบัญชีที่ไม่ใช่ของร้าน (ไม่บันทึก)',
          detail: (g) => g.messages.slice(0, 4).map(m => { const n = quotedNamesOf(m); return (n[0] || '?') + ' → ' + (n[1] || '?'); }).join(' • '),
          meaning: 'ชื่อผู้รับบนสลิปไม่มีชื่อบัญชีร้านที่ตั้งไว้ (ไทยหรืออังกฤษ) อยู่ข้างใน ระบบจึงไม่บันทึกและไม่นับยอด ระบบเช็กจากชื่อ ไม่ได้เช็กเลขบัญชี',
          action: 'ถ้าลูกค้าโอนผิดจริง แจ้งลูกค้า ถ้าเป็นบัญชีร้านจริง (เช่น สลิป TrueMoney ที่ชื่อผู้รับเป็นภาษาอังกฤษ) ให้ใส่ชื่อบัญชีอังกฤษในหน้าตั้งค่า แล้วให้ลูกค้าส่งสลิปใบเดิมอีกครั้ง' },
        { key: 'duplicate', test: /ตรวจพบสลิปซ้ำ/, severity: 'LOW',
          title: 'สลิปซ้ำ (เคยบันทึกไปแล้ว)',
          meaning: 'รหัสอ้างอิงของสลิปตรงกับสลิปที่บันทึกไว้แล้ว ระบบไม่บันทึกและไม่นับยอดซ้ำ',
          action: 'ไม่ต้องทำอะไรถ้าลูกค้าส่งซ้ำโดยไม่ได้ตั้งใจ ถ้าลูกค้าบอกว่าโอนใหม่ ให้ตรวจเวลาโอนบนสลิป' },
        { key: 'linked_keyed', test: /ผูกเป็นใบเดียวกัน/, severity: 'LOW',
          title: 'สลิปที่ตรวจผ่านตรงกับยอดที่แม่ค้ากรอกเองไว้',
          meaning: 'ระบบถือเป็นใบเดียวกัน ผูกรหัสสลิปเข้าใบเดิม ไม่สร้างใบใหม่ จึงไม่นับยอดและสิทธิ์ซ้ำ (เงื่อนไข: ลูกค้าคนเดียวกัน ยอดเท่ากัน เวลาโอนไม่หลังเวลาที่รูปเข้า)',
          action: 'ไม่ต้องทำอะไร ถ้าลูกค้าโอนก้อนใหม่ที่เวลาโอนหลังจากนั้น ระบบนับเป็นใบใหม่ตามปกติ' },
        { key: 'open_pending', test: /ยังมีรูปรอใส่ยอดค้างอยู่/, severity: 'MEDIUM',
          title: 'ลูกค้ามีรูปรอใส่ยอดค้าง ทั้งที่มีสลิปตรวจผ่านแล้ว',
          meaning: 'ระบบแยกไม่ได้ว่ารูปที่ค้างเป็นใบเดียวกับสลิปที่ตรวจผ่านหรือคนละรายการ จึงบันทึกสลิปที่ตรวจผ่านตามปกติ และไม่ปัดตกรูปที่ค้างให้',
          action: 'เปิดรูปที่ค้าง ถ้าเป็นใบเดียวกันให้ปัดตกการ์ดเก่า อย่ากรอกยอดซ้ำ' },
        { key: 'incomplete_read', test: /อ่านได้แต่ข้อมูลไม่ครบ/, severity: 'MEDIUM',
          title: 'ผู้ให้บริการอ่านสลิปได้ไม่ครบ (ส่งเข้าคิวให้ตรวจเอง)',
          meaning: 'ได้คำตอบจากผู้ให้บริการ แต่ขาดยอดหรือรหัสอ้างอิง ระบบจึงไม่บันทึกอัตโนมัติ และส่งเข้าคิวให้แม่ค้าตรวจเอง',
          action: 'เปิดรูปในการ์ดรอใส่ยอด แล้วใส่ยอดเอง' },
        { key: 'image_download', test: /ดาวน์โหลดรูป.*จาก LINE ไม่สำเร็จ/, severity: 'HIGH',
          title: 'ดึงรูปสลิปจาก LINE ไม่สำเร็จ',
          meaning: 'โปรแกรมไม่ได้รับรูปสลิปของลูกค้าคนนี้ จึงไม่มีสลิปนั้นในคิว (สาเหตุที่โปรแกรมบันทึกไว้อยู่ในบรรทัด Error ของ system.log)',
          action: 'เปิดแชทลูกค้าใน LINE OA ดูรูปสลิป แล้วใส่ยอดเอง หรือให้ลูกค้าส่งใหม่' },
        { key: 'line_reply', test: /ส่ง replyToken ล้มเหลว|ส่งข้อความตอบกลับ LINE ล้มเหลว|Push Message สำรอง/, severity: 'MEDIUM',
          title: 'ส่งข้อความตอบลูกค้าทาง LINE ไม่สำเร็จ',
          meaning: 'ข้อความตอบกลับลูกค้าไม่ถูกส่ง สาเหตุที่เป็นไปได้ตามข้อความของโปรแกรม: replyToken หมดอายุหรือเน็ตช้า, Channel Access Token ผิด, หรือโควตาข้อความ LINE เต็ม (แยกไม่ได้ว่าข้อไหน)',
          action: 'ตรวจ Channel Access Token และโควตาข้อความในบัญชี LINE Official ถ้าเกิดซ้ำ' },
        { key: 'save_failed', test: /บันทึกสลิปอัตโนมัติ.*ไม่สำเร็จ/, severity: 'HIGH',
          title: 'บันทึกสลิปอัตโนมัติไม่สำเร็จ (ส่งเข้าคิวให้ตรวจเอง)',
          meaning: 'ฐานข้อมูลบันทึกสลิปไม่สำเร็จ (ข้อความผิดพลาดของระบบอยู่ในบรรทัดนี้) โปรแกรมส่งสลิปเข้าคิวให้แม่ค้าตรวจเอง',
          action: 'เปิดการ์ดของลูกค้าคนนั้น ตรวจยอดกับรูปก่อนให้สินค้า ถ้าเกิดซ้ำส่ง system.log ให้ผู้พัฒนา' },
        { key: 'db_busy', test: /ฐานข้อมูลไม่ว่างชั่วคราว/, severity: 'LOW',
          title: 'ฐานข้อมูลไม่ว่างชั่วคราว (ลองบันทึกใหม่เอง)',
          meaning: 'ฐานข้อมูลถูกใช้งานอยู่ตอนบันทึกสลิป โปรแกรมลองบันทึกซ้ำเอง',
          action: 'ถ้ามี Error "บันทึกสลิปอัตโนมัติ… ไม่สำเร็จ" ของลูกค้าคนเดียวกันตามมา ให้ตรวจการ์ดของคนนั้น' },
        { key: 'backup_failed', test: /เก็บสลิปสำรองไม่สำเร็จ/, severity: 'CRITICAL',
          title: 'เก็บสลิปสำรองไม่สำเร็จ (สลิปอาจไม่อยู่ในระบบ)',
          meaning: 'บันทึกอัตโนมัติและการเก็บสลิปสำรองล้มเหลวทั้งคู่ สลิปของลูกค้าคนนี้อาจไม่อยู่ในคิว',
          action: 'เปิดแชท LINE ของลูกค้าคนนั้น ตรวจสลิปด้วยตัวเอง' },
        { key: 'webhook_event', test: /ประมวลผล Webhook Event/, severity: 'HIGH',
          title: 'ประมวลผลข้อความจาก LINE ไม่สำเร็จ',
          meaning: 'เกิดข้อผิดพลาดตอนประมวลผลข้อความที่ LINE ส่งมา (สาเหตุอยู่ท้ายบรรทัดด้านบน) ข้อความหรือสลิปนั้นอาจไม่ถูกประมวลผล',
          action: 'ตรวจแชทลูกค้าที่ส่งมาช่วงเวลานั้น' },
        { key: 'line_signature', test: /x-line-signature|Channel Secret/, severity: 'MEDIUM',
          title: 'LINE Webhook ถูกปฏิเสธ หรือยังไม่ได้ตั้ง Channel Secret',
          meaning: 'ข้อความที่เข้ามาไม่มีลายเซ็นหรือลายเซ็นไม่ตรง จึงถูกปฏิเสธ (กลไกกันคนนอกส่งข้อมูลเข้ามา) หรือยังไม่ได้ตั้ง Channel Secret ระบบจึงตรวจที่มาของข้อความไม่ได้',
          action: 'ถ้าเกิดกับข้อความจริงจาก LINE ให้ตรวจ Channel Secret ในหน้าตั้งค่า' },
        { key: 'tunnel', test: /Tunnel|Webhook ซ้ำยังไม่สำเร็จ|อัปเดต LINE Webhook อัตโนมัติ/, severity: 'MEDIUM',
          title: 'ท่อสัญญาณ (Tunnel) หรือการผูก LINE Webhook มีปัญหา',
          meaning: 'ท่อเชื่อมต่อหลุดหรือผูกลิงก์กับ LINE ไม่สำเร็จ ในช่วงนั้น LINE อาจส่งสลิปมาไม่ถึงเครื่องร้าน โปรแกรมลองเชื่อมต่อหรือผูกใหม่เอง',
          action: 'ดูแถบแดงบนหน้าจอ ถ้าเกิดบ่อยให้ตรวจเน็ตร้าน และตรวจแชทลูกค้าช่วงที่ท่อหลุดว่ามีสลิปที่ไม่เข้าระบบหรือไม่' },
        { key: 'gemini', test: /Gemini AI/, severity: 'LOW',
          title: 'AI อ่านที่อยู่ไม่สำเร็จ (ใช้ระบบสำรอง)',
          meaning: 'Gemini อ่านที่อยู่ไม่สำเร็จหรือเกินโควตา โปรแกรมสลับไปอ่านด้วยระบบสำรอง (Regex)',
          action: 'ตรวจที่อยู่ของลูกค้าที่ส่งมาช่วงนั้นก่อนส่งออก Kerry' },
        { key: 'other_provider', test: /EasySlip|Thunder|SlipVerify|Custom API/, severity: 'MEDIUM',
          title: 'ผู้ให้บริการตรวจสลิปอื่นตอบผิดพลาดหรือยังไม่ได้ตั้งค่า',
          meaning: 'ผู้ให้บริการตอบกลับไม่ถูกต้อง หรือไม่ได้ใส่ Token ในการตั้งค่า (รายละเอียดอยู่ในข้อความด้านบน) โปรแกรมไม่ได้แยกสาเหตุเพิ่ม',
          action: 'ดูบรรทัดเต็มใน system.log และตรวจการตั้งค่าผู้ให้บริการ' },
        { key: 'crash', test: /Uncaught Exception|Unhandled Rejection/, severity: 'CRITICAL',
          title: 'โปรแกรมเจอข้อผิดพลาดที่ไม่ได้ดักไว้',
          meaning: 'เกิดข้อผิดพลาดนอกจุดที่โค้ดดักไว้ (สาเหตุอยู่ในข้อความด้านบน) โปรแกรมบันทึกรายละเอียดไว้ใน system.log',
          action: 'เก็บ system.log ส่งให้ผู้พัฒนา' },
        { key: 'restart', test: /ตัวเฝ้าโปรแกรมเปิดใหม่อัตโนมัติ/, severity: 'HIGH',
          title: 'โปรแกรมหยุดทำงานแล้วถูกเปิดใหม่อัตโนมัติ',
          meaning: 'ตัวเฝ้าเปิดโปรแกรมใหม่เพราะโปรแกรมหยุดทำงานผิดปกติ',
          action: 'ดู supervisor.log และ system.log ช่วงก่อนหน้า ตามที่ข้อความระบุ' },
        { key: 'disk', test: /พื้นที่เครื่องเหลือน้อย/, severity: 'MEDIUM',
          title: 'พื้นที่ดิสก์เหลือน้อย',
          meaning: 'โปรแกรมลบรูปสลิปเก่าให้เองแล้วตามจำนวนที่ระบุในข้อความ',
          action: 'ย้ายไฟล์ที่ไม่ใช้ออกจากเครื่อง' }
    ];
}

function analyzeLiveIssues(issues) {
    const rules = getLiveIssueRules();
    const map = new Map();
    (issues || []).forEach(it => {
        const msg = String((it && it.message) || '');
        const type = (it && it.type === 'ERROR') ? 'ERROR' : 'WARN';
        const rule = rules.find(r => r.test.test(msg)) || null;
        const norm = msg.split('"').map((s, i) => i % 2 === 1 ? '"…"' : s.replace(/\d+/g, '#')).join('');
        const key = type + '|' + (rule ? rule.key : 'raw:' + norm.slice(0, 120));
        let g = map.get(key);
        if (!g) { g = { type, key: rule ? rule.key : ('raw[' + type + ']:' + norm.slice(0, 100)), rule, count: 0, messages: [] }; map.set(key, g); }
        g.count++;
        if (g.messages.length < 50) g.messages.push(msg);
    });
    return Array.from(map.values()).sort((a, b) => (a.type === b.type ? 0 : (a.type === 'ERROR' ? -1 : 1)) || b.count - a.count);
}

function renderLiveIssueGroup(g) {
    const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
    const rule = g.rule;
    let detail = '';
    if (rule && typeof rule.detail === 'function') detail = rule.detail(g);
    if (!detail && rule) {
        const names = [];
        g.messages.forEach(m => { const n = quotedNamesOf(m)[0]; if (n && !names.includes(n)) names.push(n); });
        if (names.length) detail = 'ลูกค้า: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' และอีก ' + (names.length - 4) + ' คน' : '');
    }
    if (!detail) detail = clip(g.messages[0], rule ? 160 : 200);
    detail = clip(detail, 230);

    let icon = '⚠️', label = '';
    if (g.type === 'ERROR') {
        if (rule) { const st = SEVERITY_STYLE[rule.severity] || SEVERITY_STYLE.MEDIUM; icon = st.icon; label = '**' + st.label + '** — '; }
        else icon = '❔';
    }
    const title = rule ? rule.title : 'ข้อความที่ระบบยังไม่มีคำวิเคราะห์เฉพาะ';
    const meaning = rule ? rule.meaning
        : (g.aiNote ? '🤖 ความเห็นจาก AI (ยังไม่ยืนยัน): ' + clip(g.aiNote, 260) : 'ยังไม่มีคำวิเคราะห์เฉพาะสำหรับข้อความนี้ (ระบบไม่เดาสาเหตุ)');
    const action = rule ? rule.action : 'ค้นข้อความด้านบนใน system.log ของร้านเพื่อดูรายละเอียดเต็ม';
    const out = icon + ' ' + label + title + (g.count > 1 ? ' — ' + g.count + ' ครั้ง' : '') + '\n' +
        '> เกิดอะไรขึ้น: ' + detail + '\n> วิเคราะห์: ' + meaning + '\n> ควรทำ: ' + action;
    return out.length > 950 ? out.slice(0, 949) + '…' : out;
}

function summarizeLiveProducts(rows) {
    const { counts, pieces } = Products.countProducts(rows);
    const list = Object.keys(counts).map(n => ({ name: n, qty: counts[n] })).sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name));
    return { list, pieces };
}

function buildEndOfLiveReportEmbeds(session, stats, issues, meta = {}, aiNotes = {}) {
    const fmtB = (n) => { const v = Math.round(Number(n) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); };
    const durMs = (session.endTime || 0) - (session.startTime || 0);
    const h = Math.floor(durMs / 3600000), m = Math.floor((durMs % 3600000) / 60000);
    const durStr = durMs <= 0 ? 'น้อยกว่า 1 นาที' : (h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`);
    const errCount = (issues || []).filter(i => i.type === 'ERROR').length;
    const warnCount = (issues || []).filter(i => i.type === 'WARN').length;
    const groups = analyzeLiveIssues(issues);
    // v1.0.17: แนบความเห็น AI เฉพาะกลุ่มที่ยังไม่มีกฎ (ผู้เรียกสร้าง aiNotes จาก getAiOpinionsForUnknownIssues)
    if (aiNotes && typeof aiNotes === 'object') groups.forEach(g => { if (!g.rule && aiNotes[g.key]) g.aiNote = aiNotes[g.key]; });
    const errGroups = groups.filter(g => g.type === 'ERROR');
    const warnGroups = groups.filter(g => g.type === 'WARN');
    const st = stats.byStatus || {};

    const fields = [
        { name: '⏱️ ช่วงเวลา', value: `${session.startTimeStr || '-'} → ${session.endTimeStr || '-'} (${durStr})`, inline: false },
        { name: '🧾 สลิปรอบนี้', value: `${stats.slips} ใบ`, inline: true },
        { name: '👥 ลูกค้า', value: `${stats.customers} คน`, inline: true },
        { name: '💰 ยอดรับรวม', value: `${fmtB(stats.amount)} บาท`, inline: true },
        { name: '🎟️ สิทธิ์ที่ออก', value: `${stats.draws} ชิ้น`, inline: true }
    ];
    if (stats.rejected !== undefined) fields.push({ name: '🗑️ สลิปที่ปัดตก', value: `${stats.rejected} ใบ (ไม่นับในตัวเลขด้านบน)`, inline: true });
    fields.push({ name: '📋 สถานะคิว', value: `รอ ${st.waiting || 0} • เรียกแล้ว ${st.called || 0} • ข้าม ${st.skipped || 0} • เสร็จ ${st.completed || 0} • รอตรวจ ${st.abnormal_pending || 0}`, inline: false });
    if (session.holdMerge) fields.push({ name: '🔗 รวมบิล', value: 'รอบนี้ตั้ง "รอรวมกับรอบหน้า" — ยังไม่ต้องแพ็คส่งแยกรอบนี้', inline: false });

    if (stats.products) {
        const list = stats.products.list || [];
        const MAXP = 15;
        let text;
        if (list.length === 0) text = 'ไม่มีสินค้าที่ได้สิทธิ์ในรอบนี้';
        else {
            text = list.slice(0, MAXP).map(p => `${p.name} ×${p.qty}`).join(' • ');
            if (list.length > MAXP) text += ` • …และอีก ${list.length - MAXP} รายการ`;
            text += '\n> นับเฉพาะใบที่ได้สิทธิ์ ไม่รวมใบที่ข้ามและที่ปัดตก (กติกาเดียวกับหน้าประวัติ)';
            if (text.length > 1000) text = text.slice(0, 999) + '…';
        }
        fields.push({ name: `🛍️ สินค้าที่ออก (${stats.products.pieces || 0} ชิ้น, ${list.length} รายการ)`, value: text, inline: false });
    }

    // แพ็กกลุ่มปัญหาลงฟิลด์ (ฟิลด์ละไม่เกิน ~1000 ตัวอักษร ตามขีดจำกัด 1024 ของ Discord)
    const pack = (name, contName, texts) => {
        const out = [];
        let cur = '';
        texts.forEach(t => {
            if (cur && (cur.length + 2 + t.length) > 1000) { out.push(cur); cur = t; }
            else cur = cur ? cur + '\n\n' + t : t;
        });
        if (cur) out.push(cur);
        return out.map((v, i) => ({ name: i === 0 ? name : contName, value: v, inline: false }));
    };
    const sizeOf = (arr) => (`🏁 สรุปหลังจบไลฟ์ ${meta.shopLabel || ''}`).length + 120 + arr.reduce((a, f) => a + f.name.length + f.value.length, 0);
    // v1.0.17: รายละเอียด WARN ห้ามหาย — ถ้าทั้งรอบใส่ข้อความเดียวไม่ไหว แบ่งเป็น 2 ข้อความ (สถิติ+Error / WARN)
    // แทนที่จะตัดกลุ่ม WARN ทิ้งเหลือแค่ตัวเลขอย่างเดิม (เจ้าของร้านขอดูสาเหตุของทุกคำเตือน)
    const errBlock = (maxErr) => {
        if (errCount === 0) return [{ name: `🚨 Error ที่เจอในรอบนี้ (0)`, value: 'ไม่พบ Error ในรอบนี้ 🎉', inline: false }];
        const shown = errGroups.slice(0, maxErr).map(renderLiveIssueGroup);
        if (errGroups.length > maxErr) shown.push(`… และอีก ${errGroups.length - maxErr} ประเภท (ดูทั้งหมดใน system.log ของร้าน)`);
        const head = `${errCount} รายการ (${errGroups.length} ประเภท)`;
        return pack(`🚨 Error ที่เจอในรอบนี้ (${errCount})`, '🚨 Error (ต่อ)', [head].concat(shown));
    };
    const warnBlock = (maxWarn) => {
        if (warnCount === 0) return [];
        const shown = warnGroups.slice(0, maxWarn).map(renderLiveIssueGroup);
        if (warnGroups.length > maxWarn) shown.push(`… และอีก ${warnGroups.length - maxWarn} ประเภท (ดูทั้งหมดใน system.log ของร้าน)`);
        const head = `${warnCount} รายการ (${warnGroups.length} ประเภท)`;
        return pack(`⚠️ คำเตือน (WARN) (${warnCount})`, '⚠️ คำเตือน (ต่อ)', [head].concat(shown));
    };
    const shrinkToFit = (block, maxList, baseFields, baseSize) => {
        for (const n of maxList) {
            const b = block(n);
            if (baseSize + sizeOf(b) <= 5800 && baseFields + b.length <= 25) return b;
        }
        return block(maxList[maxList.length - 1]);
    };
    const mkEmbed = (fs, suffix, color) => ({
        title: `🏁 สรุปหลังจบไลฟ์ ${meta.shopLabel || ''}${suffix}`.trim(),
        color, fields: fs,
        footer: { text: `AutoQueueforLive v${meta.version || '?'} • รหัสรอบ ${session.id || '-'}` }
    });
    const colorOf = (errs) => errs > 0 ? 15158332 : (warnCount > 0 ? 16753920 : 3066993);

    const errFields = shrinkToFit(errBlock, [12, 10, 8, 6, 4], fields.length, sizeOf(fields));
    const warnFields = shrinkToFit(warnBlock, [12, 8, 6, 4, 3, 2], 0, 0);   // ต่ำสุด 2 ประเภท + บรรทัดชี้ system.log — ไม่มีทางเหลือแค่ตัวเลข
    const all = fields.concat(errFields, warnFields);
    if (sizeOf(all) <= 5800 && all.length <= 25) {
        return [mkEmbed(all, '', colorOf(errCount))];
    }
    return [
        mkEmbed(fields.concat(errFields), '', colorOf(errCount)),
        mkEmbed(warnFields, ' (ต่อ — คำเตือนของรอบนี้)', 16753920)
    ];
}

function buildEndOfLiveReportEmbed(session, stats, issues, meta = {}, aiNotes = {}) {
    return buildEndOfLiveReportEmbeds(session, stats, issues, meta, aiNotes)[0];
}

module.exports = {
    SEVERITY_STYLE,
    quotedNamesOf,
    getLiveIssueRules,
    analyzeLiveIssues,
    renderLiveIssueGroup,
    summarizeLiveProducts,
    buildEndOfLiveReportEmbeds,
    buildEndOfLiveReportEmbed
};
