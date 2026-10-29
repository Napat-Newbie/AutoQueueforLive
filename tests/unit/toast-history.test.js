// tests/unit/toast-history.test.js
// v1.0.16: notification history (20 latest), toast, copy-to-chat messages, red rows in the recent table, chord sound, flash-once.
// Real functions are cut out of public/index.html and run in a vm with small fakes (no browser). What it cannot show: how it looks / sounds.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
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
function makeCtx(extra = {}) {
    const store = {};
    const ctx = {
        sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
        document: { getElementById: () => null },
        Date, JSON, Number, String, Array, Math, Set, console,
        ...extra,
    };
    vm.createContext(ctx);
    vm.runInContext(`const NOTIF_HISTORY_MAX = 20; const NOTIF_STORAGE_KEY = 'k'; let __notifHistory = []; let __notifUnread = 0; function renderNotifBadge() {} function renderNotifDrawer() {}
        const __pendingSeen = new Set(); let __pendingSeenReady = false;`, ctx);
    ['pushNotif', 'buildTopupMessage', 'buildAddressRequestMessage', 'mergeUnrecordedIntoRecent', 'markPendingFlash', 'playToneSequence'].forEach(n => vm.runInContext(grab(n), ctx));
    return { ctx, store };
}
const get = (ctx, expr) => vm.runInContext(expr, ctx);

test('history keeps only the 20 latest, newest first', () => {
    const { ctx } = makeCtx();
    for (let i = 1; i <= 25; i++) ctx.pushNotif('warn', 'msg ' + i);
    assert.equal(get(ctx, '__notifHistory.length'), 20);
    assert.equal(get(ctx, '__notifHistory[0].text'), 'msg 25');
    assert.equal(get(ctx, '__notifHistory[19].text'), 'msg 6');
    assert.equal(get(ctx, '__notifUnread'), 25, 'drawer closed: every new one counts as unread');
});

test('the same message within a minute is recorded once; blank messages are ignored', () => {
    const { ctx } = makeCtx();
    ctx.pushNotif('bad', 'ท่อหลุด'); ctx.pushNotif('bad', 'ท่อหลุด'); ctx.pushNotif('bad', '   '); ctx.pushNotif('bad', '');
    assert.equal(get(ctx, '__notifHistory.length'), 1);
});

test('history is saved in sessionStorage (survives F5)', () => {
    const { ctx, store } = makeCtx();
    ctx.pushNotif('ok', 'บันทึกไว้');
    assert.match(store.k, /บันทึกไว้/);
});

test('copy message for a short-paid customer: says the amount still needed; shipping-fee case is worded differently', () => {
    const { ctx } = makeCtx();
    const a = ctx.buildTopupMessage({ name: 'สมหญิง', amount: 100, need: 40, held: false });
    assert.match(a, /คุณสมหญิง/); assert.match(a, /100 บาท/); assert.match(a, /โอนเพิ่มอีก 40 บาท/);
    const b = ctx.buildTopupMessage({ name: 'สมหญิง', amount: 100, need: 40, held: true });
    assert.match(b, /ค่าส่ง/); assert.match(b, /40 บาท/);
    assert.notEqual(a, b);
    const c = ctx.buildTopupMessage({ name: 'X', amount: 0, need: 1234, held: false });
    assert.match(c, /ได้รับสลิปแล้ว/); assert.match(c, /1,234 บาท/);
});

test('copy message asking for the address names the customer and asks for the four things Kerry needs', () => {
    const { ctx } = makeCtx();
    const m = ctx.buildAddressRequestMessage('สมชาย');
    assert.match(m, /คุณสมชาย/);
    ['ที่อยู่', 'รหัสไปรษณีย์', 'เบอร์โทร', 'ชื่อ'].forEach(w => assert.ok(m.includes(w), w));
    assert.match(ctx.buildAddressRequestMessage(''), /คุณลูกค้า/);
});

test('recent table: unrecorded slips (wrong account / duplicate) come first as red rows without an amount; download failures are not added; max 30', () => {
    const { ctx } = makeCtx();
    const recent = Array.from({ length: 30 }, (_, i) => ({ tone: 'ok', name: 'R' + i, amount: 100, label: 'ok', time: '10:00:00' }));
    const fails = [
        { name: 'เก่า', time: '10:01:00', reason: 'โอนผิดบัญชี' },
        { name: 'ดาวน์โหลดไม่ได้', time: '10:02:00', reason: null },
        { name: 'ใหม่', time: '10:03:00', reason: 'สลิปซ้ำ' }
    ];
    const rows = ctx.mergeUnrecordedIntoRecent(recent, fails);
    assert.equal(rows.length, 30);
    assert.equal(rows[0].name, 'ใหม่', 'newest first');
    assert.equal(rows[1].name, 'เก่า');
    assert.equal(rows[0].tone, 'bad');
    assert.equal(rows[0].noAmount, true);
    assert.equal(rows[2].name, 'R0');
    assert.deepEqual(Array.from(ctx.mergeUnrecordedIntoRecent(null, null)), []);
});

test('a card waiting for the amount flashes only when it is NEW after the first screen load', () => {
    const { ctx } = makeCtx();
    const cls = () => { const s = new Set(); return { classList: { add: c => s.add(c), has: c => s.has(c) } }; };
    const first = cls(); ctx.markPendingFlash(first, 1);
    assert.equal(first.classList.has('pending-flash'), false, 'first page load: cards already there do not flash');
    vm.runInContext('__pendingSeenReady = true;', ctx);
    const again = cls(); ctx.markPendingFlash(again, 1);
    assert.equal(again.classList.has('pending-flash'), false, 're-render of the same card does not flash again');
    const fresh = cls(); ctx.markPendingFlash(fresh, 2);
    assert.equal(fresh.classList.has('pending-flash'), true, 'new card flashes');
});

test('chord sound plays 3 notes together; a normal sequence plays one note per step; rests (0) play nothing', () => {
    let oscCount = 0; const starts = [];
    const fakeCtx = {
        currentTime: 0, destination: {},
        createOscillator: () => { oscCount++; return { type: '', frequency: {}, connect() {}, start: t => starts.push(t), stop() {} }; },
        createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} })
    };
    const { ctx } = makeCtx({ getAudioCtx: () => fakeCtx });
    ctx.playToneSequence([[523.25, 659.25, 783.99]], [0.7], 'sine', 0.2);
    assert.equal(oscCount, 3);
    assert.equal(new Set(starts).size, 1, 'all three start at the same moment');
    oscCount = 0; starts.length = 0;
    ctx.playToneSequence([600, 0, 600], [0.1, 0.06, 0.1], 'sine');
    assert.equal(oscCount, 2, 'two beeps, the 0 is a rest');
    assert.equal(new Set(starts).size, 2);
});

test('static guards: the page wires every new event, has the bell + toast roots, and the sounds are synthesized', () => {
    ['slip_warning', 'address_updated', 'pending_amount_slip'].forEach(ev => assert.ok(html.includes(`socket.on('${ev}'`), ev));
    ['id="notifBellBtn"', 'id="notifDrawer"', 'id="toastStackTR"', 'id="toastStackBL"', 'id="notifBadge"'].forEach(s => assert.ok(html.includes(s), s));
    assert.ok(/warnBeep:\s*\{\s*freqs:\s*\[600, 0, 600\]/.test(html), 'warning beep is 600Hz x2');
    assert.ok(/pendingChord:\s*\{\s*freqs:\s*\[\[/.test(html), 'chord preset');
    assert.ok(html.includes('topup-copy-btn') && html.includes('addr-copy-btn'), 'copy buttons on the orange card and the no-address card');
    assert.ok(!/mixkit|new Audio\(/.test(html), 'no sound file from the internet');
});
