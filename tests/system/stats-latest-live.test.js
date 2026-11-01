// tests/system/stats-latest-live.test.js
// v1.0.20 (P1): ยอดสรุปหน้า Dashboard หลังจบไลฟ์ = ยอดของ "รอบไลฟ์ล่าสุดที่จบแล้ว" ทั้งรอบ
// ไม่ใช่ยอดตามวันที่ — ไลฟ์ที่ 21:00–01:30 (ข้ามเที่ยงคืน) เคยเหลือแค่ยอดหลังเที่ยงคืนบนจอ
// สลิปก่อน/หลังเที่ยงคืนจำลองด้วย fixture ที่ใส่ trans_date ต่างวันเข้ารอบเดียวกัน (sandbox ใช้เวลาจริง)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const slipFor = (sb, user, name, msg, key, amount, ref) => {
    sb.mock.profile(user, name);
    sb.mock.slipOk(key, { amount, transRef: ref });
    return sb.sendSlip(user, msg, key);
};

test('หลังจบไลฟ์ที่ข้ามเที่ยงคืน ยอดสรุปต้องเป็นยอดรวมทั้งรอบ + มีป้ายบอกช่วงรอบ', () => withSandbox(async sb => {
    const live = await sb.startLive();
    // สลิป "ก่อนเที่ยงคืน" (trans_date เมื่อวาน) และ "หลังเที่ยงคืน" (วันนี้) ในรอบเดียวกัน
    sb.insertSlip({ line_id: 'Ualice', name: 'Alice', amount: 100, draws: 1, session_id: live.session.id, trans_date: bkkDate(-1), trans_time: '23:55:00', status: 'completed' });
    sb.insertSlip({ line_id: 'Ubob', name: 'Bob', amount: 200, draws: 2, session_id: live.session.id, trans_date: bkkDate(0), trans_time: '00:10:00', status: 'completed' });
    await sb.endLive();

    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 300, 'ยอดรวมทั้งรอบ (เดิมเหลือแค่ 200 = เฉพาะหลังเที่ยงคืน)');
    assert.equal(st.stats.totalSlips, 2, 'นับสลิปทั้งรอบ 2 ใบ');
    assert.equal(st.stats.totalDraws, 3, 'ชิ้นรวมทั้งรอบ 3 ชิ้น');
    assert.equal(st.stats.uniqueCustomers, 2);
    assert.ok(st.stats.liveBadge && st.stats.liveBadge.startsWith('ไลฟ์ล่าสุด:'), 'มีป้ายบอกว่าเป็นยอดของรอบไหน');
    assert.ok(!st.stats.afterLive, 'ไม่มีเงินเข้าหลังจบไลฟ์ = ไม่มีบรรทัดแยก');
}));

test('เงินที่เข้าหลังจบไลฟ์ไม่ปนในยอดรอบ — แสดงแยกเป็นบรรทัดเล็ก และการ์ดยังอยู่ในคิว', () => withSandbox(async sb => {
    const live = await sb.startLive();
    sb.insertSlip({ line_id: 'Ualice', name: 'Alice', amount: 140, draws: 1, session_id: live.session.id, trans_date: bkkDate(0), trans_time: '21:30:00', status: 'completed' });
    await sb.endLive();

    await slipFor(sb, 'Ucarol', 'Carol', 'm9', 'k9', 140, 'AFTER1');   // โอนตอนไม่มีไลฟ์ (หลังจบรอบ)
    await sb.waitForSlips(2);

    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140, 'ยอดรอบ = เฉพาะสลิปของรอบ ไม่รวมเงินที่เข้าหลังจบไลฟ์ (เดิมโดนรวมเป็น 280)');
    assert.ok(st.stats.afterLive, 'มีบรรทัดเงินเข้าหลังจบไลฟ์');
    assert.equal(st.stats.afterLive.slips, 1);
    assert.equal(st.stats.afterLive.amount, 140);

    // กติกา ก: การ์ดโอนนอกรอบห้ามหายจากจอ แม้ยอดสรุปจะยึดรอบล่าสุดแล้ว
    const carol = st.queues.waiting.find(q => (q.lineName || q.name) === 'Carol');
    assert.ok(carol, 'การ์ดของ Carol ยังแสดงในคิวรอ');
    assert.equal(carol.outOfRound, true);
    const alice = [...st.queues.waiting, ...st.queues.called].find(q => (q.lineName || q.name) === 'Alice');
    assert.ok(!alice, 'สลิป completed ของรอบไม่กลับมาเป็นการ์ดคิว');
}));

test('ยังไม่เคยมีไลฟ์เลย — ยอดยังเป็นของวันนี้ตามเดิม ไม่มีป้ายรอบ', () => withSandbox(async sb => {
    await slipFor(sb, 'Udan', 'Dan', 'm1', 'k1', 140, 'NOLIVE1');
    await sb.waitForSlips(1);
    const st = await sb.stats();
    assert.equal(st.stats.totalAmount, 140, 'ยอดตามวันนี้เหมือนพฤติกรรมเดิม');
    assert.ok(!st.stats.liveBadge, 'ไม่มีป้ายรอบ');
    assert.ok(!st.stats.afterLive, 'ไม่มีบรรทัดเงินหลังจบไลฟ์');
}));

test('ปิดการ์ดส้ม "รอโอนเพิ่ม" ของรอบที่จบข้ามเที่ยงคืนได้ (สลิป trans_date เมื่อวาน)', () => withSandbox(async sb => {
    const live = await sb.startLive();
    const eveId = sb.insertSlip({ line_id: 'Ueve', name: 'Eve', amount: 50, draws: 0, session_id: live.session.id, trans_date: bkkDate(-1), trans_time: '23:58:00', status: 'accumulated' });
    // ยอดไม่พอ = ตัวจริงเก็บเงินเข้ากระเป๋าหลังสลิป (เริ่มไลฟ์รีเซ็ตกระเป๋าก่อนหน้านี้แล้ว) จึงตั้งยอดตามหลังสลิป
    sb.exec('INSERT OR REPLACE INTO customers (line_id, name, balance) VALUES (?, ?, ?)', 'Ueve', 'Eve', 50);
    await sb.endLive();

    // การ์ดส้มของ Eve (สลิปเมื่อวาน) ต้องยังมีให้เห็นหลังจบไลฟ์
    let st = await sb.stats();
    assert.ok(st.topups.some(t => t.id === eveId), 'การ์ดส้มของสลิปก่อนเที่ยงคืนยังแสดง (เดิมหายไปพร้อมกับยอด)');

    const r = await sb.post('/api/queue/dismiss_topup', { id: eveId });
    assert.equal(r.json.success, true);
    assert.equal(r.json.cleared, 1, 'ปิดการ์ดได้จริง (เดิม UPDATE กรอง trans_date=วันนี้ จึงไม่โดนใบนี้)');
    const row = sb.slips().find(s => s.id === eveId);
    assert.equal(row.status, 'cleared');
}));
