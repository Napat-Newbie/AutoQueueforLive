// tests/unit/end-live-report.test.js
// Pins the end-of-live Discord report builder (buildEndOfLiveReportEmbed in index.js):
// every ERROR of the round must be listed with a fix suggestion, warns counted, no-error round stays green.
// The functions are cut out of the real index.js (tests/harness/extract.js) and run with stub globals.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const INDEX = path.join(__dirname, '..', '..', 'index.js');
function env() {
    return load(INDEX, {
        functions: ['buildEndOfLiveReportEmbed', 'assessErrorForDevReport'],
        consts: ['SEVERITY_STYLE']
    });
}

const SESSION = { id: 'LIVE_1', startTime: Date.now() - 65 * 60 * 1000, endTime: Date.now(), startTimeStr: '19:00:00', endTimeStr: '20:05:00' };
const field = (embed, name) => embed.fields.find(f => f.name.includes(name));

test('round without errors: green embed, "ไม่พบ Error", warn count still shown', () => {
    const e = env().buildEndOfLiveReportEmbed(SESSION, { slips: 3, amount: 420, draws: 3, customers: 2, byStatus: { completed: 2, waiting: 1 } },
        [{ type: 'WARN', message: 'ตรวจพบสลิปซ้ำ: ลูกค้า "A" ส่งสลิปรหัส X ที่เคยบันทึกไปแล้ว' }], { version: '1.0.16', shopLabel: 'ร้านTest' });
    assert.equal(e.color, 16753920); // มี warn -> ส้ม ไม่ใช่เขียว
    assert.match(e.title, /🏁 สรุปหลังจบไลฟ์ ร้านTest/);
    assert.match(field(e, 'Error').value, /ไม่พบ Error ในรอบนี้/);
    assert.match(field(e, 'WARN').value, /1 รายการ/);
    assert.match(field(e, 'สลิปรอบนี้').value, /3 ใบ/);
    assert.match(field(e, 'ยอดรับรวม').value, /420 บาท/);
    assert.match(field(e, 'สถานะคิว').value, /เสร็จ 2/);
    assert.match(field(e, 'ช่วงเวลา').value, /1 ชม\. 5 นาที/);
    assert.equal(field(e, 'รวมบิล'), undefined, 'no holdMerge field when not held');
});

test('round with errors: every error is listed with severity and a fix suggestion', () => {
    const issues = [
        { type: 'ERROR', message: 'บันทึกสลิปอัตโนมัติของ "B" ไม่สำเร็จ (SQLITE_BUSY)' },
        { type: 'WARN', message: 'ตรวจพบสลิปซ้ำ: ลูกค้า "C"' },
        { type: 'ERROR', message: 'SlipOK 402: เครดิตตรวจสลิปหมด (quota exhausted)' },
    ];
    const e = env().buildEndOfLiveReportEmbed(SESSION, { slips: 5, amount: 700, draws: 5, customers: 4, byStatus: {} }, issues, {});
    assert.equal(e.color, 15158332); // มี error -> แดง
    const errField = field(e, 'Error').value;
    assert.match(field(e, 'Error').name, /\(2\)/, 'header counts the errors');
    assert.match(errField, /บันทึกสลิปอัตโนมัติของ "B"/, 'first error listed');
    assert.match(errField, /แนวทางแก้ไข:/, 'fix line present');
    assert.match(errField, /SlipOK 402/, 'second error listed');
    assert.match(field(e, 'WARN').value, /1 รายการ/, 'warn not counted as error');
});

test('known error patterns get the matching fix from the rule set (not the generic fallback)', () => {
    const e = env().buildEndOfLiveReportEmbed(SESSION, { slips: 1, amount: 140, draws: 1, customers: 1, byStatus: {} },
        [{ type: 'ERROR', message: 'ตรวจสลิปไม่สำเร็จ: slipok api ตอบ 402 โควตาหมด' }], {});
    const v = field(e, 'Error').value;
    assert.match(v, /🟧 \*\*สูง\*\*/, 'slip-provider rule matched (severity HIGH)');
    assert.match(v, /ตรวจเครดิตและรหัสของผู้ให้บริการ/, 'its specific fix, not the generic one');
    assert.doesNotMatch(v, /จำลองซ้ำบนเครื่อง Dev ก่อนแก้/, 'generic fallback fix must not be used here');
});

test('more than 6 errors: capped at 6 with an overflow line', () => {
    const issues = Array.from({ length: 9 }, (_, i) => ({ type: 'ERROR', message: `ข้อผิดพลาดที่ ${i + 1}` }));
    const e = env().buildEndOfLiveReportEmbed(SESSION, { slips: 1, amount: 100, draws: 1, customers: 1, byStatus: {} }, issues, {});
    const v = field(e, 'Error').value;
    assert.match(v, /ข้อผิดพลาดที่ 6/, 'six shown');
    assert.doesNotMatch(v, /ข้อผิดพลาดที่ 7/, 'seventh hidden');
    assert.match(v, /และอีก 3 รายการ/);
    assert.ok(v.length <= 1100, 'field stays within Discord limits');
});

test('held round (รอรวมกับรอบหน้า) is called out in the report', () => {
    const e = env().buildEndOfLiveReportEmbed({ ...SESSION, holdMerge: true }, { slips: 0, amount: 0, draws: 0, customers: 0, byStatus: {} }, [], {});
    assert.match(field(e, 'รวมบิล').value, /รอรวมกับรอบหน้า/);
});
