// tests/unit/notif-panel.test.js
// Owner request 2026-10-31: a notification panel on the RIGHT of the dashboard (always there, can be shrunk to a
// thin strip, wording a merchant understands), saved forever, and only URGENT items still pop up.
// - server: notificationFromEvent (index.js) turns each notifying socket event into ONE stored notification with the
//   same text the dashboard used to build itself
// - dashboard: groupNotifsByDay + shouldPopupNotification (public/index.html)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load } = require('../harness/extract');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const server = load(path.join(ROOT, 'index.js'), { functions: ['notificationFromEvent'] });
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
function grab(name) {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing from index.html`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}
const ui = { Date, Number, String, Array, Map };
vm.createContext(ui);
['notifDayKey', 'groupNotifsByDay', 'shouldPopupNotification'].forEach(n => vm.runInContext(grab(n), ui));
const plain = (v) => JSON.parse(JSON.stringify(v));

test('server: each notifying event becomes one notification with the merchant text used before', () => {
    const f = (e, d) => plain(server.notificationFromEvent(e, d));
    assert.deepEqual(f('topup_needed', { name: 'Carol', need: 80, held: false }), { kind: 'warn', title: '💸 โอนไม่ครบ', text: 'ลูกค้า Carol โอนไม่ครบ ต้องโอนเพิ่มอีก 80 บาท' });
    assert.match(f('topup_needed', { name: 'Carol', need: 40, held: true }).text, /\(ค่าส่ง\)$/);
    assert.deepEqual(f('image_failed'), { kind: 'bad', title: '🖼️ โหลดรูปสลิปไม่ได้', text: 'โหลดรูปสลิปจาก LINE ไม่สำเร็จ — เปิดดูรูปในแชท LINE OA แล้วใส่ยอดเอง' });
    assert.equal(f('slip_warning', { kind: 'duplicate', name: 'Eve', reason: 'ซ้ำ' }).kind, 'bad');
    assert.equal(f('slip_warning', { kind: 'duplicate', name: 'Eve', reason: 'ซ้ำ' }).title, '⚠️ สลิปซ้ำ');
    assert.equal(f('slip_warning', { kind: 'wrong_account', name: 'X', reason: 'r' }).kind, 'bad');
    assert.equal(f('slip_warning', { kind: 'manual_match', name: 'X', reason: 'r' }).kind, 'warn');
    // v1.0.19: same transfer but the keyed amount differs - money IS recorded, so orange (no red pop-up)
    assert.deepEqual(f('slip_warning', { kind: 'amount_mismatch', name: 'X', reason: 'r' }), { kind: 'warn', title: '⚠️ ยอดที่กรอกไม่ตรงกับสลิป', text: 'X — r' });
    assert.equal(f('slip_warning', { kind: 'check_pending', name: 'X', reason: 'r' }).text, 'X — r');
    assert.deepEqual(f('address_updated', { name: 'สมหญิง' }), { kind: 'ok', title: '📍 ที่อยู่จัดส่ง', text: 'คุณสมหญิง อัปเดตที่อยู่จัดส่งแล้ว' });
    assert.equal(f('pending_amount_slip', { name: 'Bob' }).text, 'Bob ส่งสลิปที่ระบบอ่านยอดไม่ได้ — รอแม่ค้ากดเช็คสลิปและใส่ยอด');
    assert.equal(f('pending_amount_slip', { name: 'Bob', bankName: 'กรุงเทพ', delay: 7 }).text, 'Bob ส่งสลิปธนาคารกรุงเทพที่ยังตรวจไม่ได้ (ต้องรอ ~7 นาทีหลังโอน) — ให้ลูกค้าส่งรูปเดิมซ้ำทีหลัง');
    assert.equal(f('provider_quota_alert', { message: '⚠️ [แจ้งเตือนด่วน]: เครดิตหมด' }).text, 'เครดิตหมด');
    assert.equal(f('provider_quota_alert', { message: 'x' }).kind, 'bad');
    assert.equal(server.notificationFromEvent('play_sound', {}), null, 'non-notifying events are ignored');
    assert.equal(server.notificationFromEvent('full_sync', {}), null);
    assert.equal(server.notificationFromEvent('topup_needed', {}), null, 'no name = nothing to tell (same as before)');
});

test('panel groups by day (newest first) with merchant words: วันนี้ / เมื่อวาน / date', () => {
    const now = Date.UTC(2026, 9, 31, 13, 0, 0);   // 31 Oct 2026, 20:00 Bangkok
    const items = [
        { id: 4, t: now - 60 * 1000, kind: 'warn', text: 'a' },
        { id: 3, t: now - 3 * 3600 * 1000, kind: 'ok', text: 'b' },
        { id: 2, t: Date.UTC(2026, 9, 30, 13, 0, 0), kind: 'bad', text: 'c' },
        { id: 1, t: Date.UTC(2026, 9, 28, 3, 0, 0), kind: 'warn', text: 'd' },
    ];
    const g = plain(ui.groupNotifsByDay(items, now));
    assert.equal(g.length, 3);
    assert.equal(g[0].label, 'วันนี้');
    assert.equal(g[1].label, 'เมื่อวาน');
    assert.match(g[2].label, /28/);
    assert.deepEqual(g.map(d => d.items.map(n => n.id)), [[4, 3], [2], [1]]);
});

test('pop-ups only for urgent (red) items; red ones that already have their own red banner do not pop up twice', () => {
    assert.equal(ui.shouldPopupNotification({ kind: 'bad', source: 'slip_warning' }), true);
    assert.equal(ui.shouldPopupNotification({ kind: 'bad', source: 'image_failed' }), true);
    assert.equal(ui.shouldPopupNotification({ kind: 'warn', source: 'topup_needed' }), false);
    assert.equal(ui.shouldPopupNotification({ kind: 'ok', source: 'address_updated' }), false);
    assert.equal(ui.shouldPopupNotification({ kind: 'bad', source: 'provider_quota_alert' }), false, 'red banner already shown');
    assert.equal(ui.shouldPopupNotification({ kind: 'bad', source: 'tunnel' }), false, 'red banner already shown');
});

test('panel markup: on the right, can shrink, merchant wording, no technical words', () => {
    assert.match(html, /id="notifPanel"/);
    assert.match(html, /onclick="setNotifPanelCollapsed\(true\)"[^>]*>[^<]*ย่อ/);
    assert.match(html, /🔔 การแจ้งเตือน/);
    assert.match(html, /ดูย้อนหลังเพิ่ม/);
    assert.match(html, /เฉพาะเรื่องสำคัญ/);
    const panel = html.slice(html.indexOf('id="notifPanel"'), html.indexOf('<!-- /notifPanel -->'));
    assert.ok(panel.length > 0, 'panel end marker present');
    assert.doesNotMatch(panel, /\b(socket|API|server|webhook|session|notification)\b/i, 'no technical words in what the merchant reads');
});
