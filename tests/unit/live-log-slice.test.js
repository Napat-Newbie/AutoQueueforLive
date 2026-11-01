// tests/unit/live-log-slice.test.js
// The end-of-live log file (owner request 2026-10-31) is cut out of system.log by TIME, using the timestamp every line
// starts with: addLog writes new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }), e.g. "10/31/2026, 7:34:12 PM".
// Trap: newer Node/ICU puts a NARROW NO-BREAK SPACE (U+202F) before AM/PM, not a normal space.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// v1.0.20 (P5: 1.2): โหลดจาก lib/privacy โดยตรงตามกติกา P5 (เดิมตัดจาก index.js ด้วย extract.js)
const ctx = require('../../lib/privacy');
const bkk = (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h - 7, mi, s);

test('parses the timestamp addLog writes on THIS Node (whatever space ICU puts before AM/PM)', () => {
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const stamp = now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });
    assert.equal(ctx.parseLogLineTime(`[${stamp}] [INFO] hello`), now.getTime());
});

test('parses both space kinds, 12 AM / 12 PM, and rejects lines without a stamp', () => {
    assert.equal(ctx.parseLogLineTime('[10/31/2026, 7:34:12\u202fPM] [INFO] x'), bkk(2026, 10, 31, 19, 34, 12));
    assert.equal(ctx.parseLogLineTime('[10/31/2026, 7:34:12 PM] [INFO] x'), bkk(2026, 10, 31, 19, 34, 12));
    assert.equal(ctx.parseLogLineTime('[11/1/2026, 12:05:00 AM] [WARN] x'), bkk(2026, 11, 1, 0, 5, 0));
    assert.equal(ctx.parseLogLineTime('[11/1/2026, 12:05:00 PM] [WARN] x'), bkk(2026, 11, 1, 12, 5, 0));
    assert.equal(ctx.parseLogLineTime('no stamp here'), null);
    assert.equal(ctx.parseLogLineTime(''), null);
});

test('sliceLogForLive keeps only the lines inside [start, end], across a midnight', () => {
    const text = [
        '[10/31/2026, 11:59:00 PM] [INFO] before',
        '[10/31/2026, 11:59:59 PM] [INFO] ⏺ start line',
        'garbage without a stamp',
        '[11/1/2026, 12:00:30 AM] [WARN] inside after midnight',
        '[11/1/2026, 12:10:00 AM] [INFO] ⏹ end line',
        '[11/1/2026, 12:10:01 AM] [INFO] after',
        '',
    ].join('\n');
    const out = ctx.sliceLogForLive(text, bkk(2026, 10, 31, 23, 59, 59), bkk(2026, 11, 1, 0, 10, 0));
    assert.deepEqual(Array.from(out), ['[10/31/2026, 11:59:59 PM] [INFO] ⏺ start line', '[11/1/2026, 12:00:30 AM] [WARN] inside after midnight', '[11/1/2026, 12:10:00 AM] [INFO] ⏹ end line']);
});

// Found while building the log file (2026-10-31): redactPersonalInfo masked ANY 13-digit run as a Thai ID card number,
// so the live round id "LIVE_1793450521936" (Date.now() = 13 digits) became "LIVE_[เลขบัตร]" — in the activity channel
// since v1.0.16 and in the new log file, making a round impossible to trace. Digits glued to "_" are program ids, not ID cards.
const redact = ctx.redactPersonalInfo;
test('redactPersonalInfo keeps program ids (LIVE_<ms>, manual_<ms>_...) but still masks ID cards and phones', () => {
    assert.equal(redact('จบไลฟ์ (รหัสรอบ LIVE_1793450521936, ใช้เวลา 5 นาที)'), 'จบไลฟ์ (รหัสรอบ LIVE_1793450521936, ใช้เวลา 5 นาที)');
    assert.equal(redact('/uploads/manual_1793435171091_Ubob.jpg'), '/uploads/manual_1793435171091_Ubob.jpg');
    assert.equal(redact('บัตร 1103700012345 ของลูกค้า'), 'บัตร [เลขบัตร] ของลูกค้า');
    assert.equal(redact('เลขบัตร:1103700012345'), 'เลขบัตร:[เลขบัตร]');
    assert.equal(redact('โทร 0812345678'), 'โทร 0xx-xxx-56xx');
});
