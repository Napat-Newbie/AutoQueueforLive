// tests/unit/end-live-report.test.js
// Pins the end-of-live Discord report builder (buildEndOfLiveReportEmbed in index.js):
// stats + rejected count + product list, and every problem (ERROR / WARN) of the round grouped with
// "what happened / analysis / what to do". The analysis is rule-based: it must never guess a cause.
// The functions are cut out of the real index.js (tests/harness/extract.js) and run with stub globals.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { load } = require('../harness/extract');

const INDEX = path.join(__dirname, '..', '..', 'index.js');
const LIB_SLIP = path.join(__dirname, '..', '..', 'lib', 'slipVerify.js');   // v1.0.19: classifySlipOkError ย้ายบ้านแล้ว (assertion เดิมทุกตัว ไม่แก้)
function env() {
    const fromIndex = load(INDEX, {
        functions: ['buildEndOfLiveReportEmbed', 'buildEndOfLiveReportEmbeds', 'assessErrorForDevReport', 'analyzeLiveIssues', 'getLiveIssueRules', 'renderLiveIssueGroup',
            'quotedNamesOf', 'summarizeLiveProducts'],
        consts: ['SEVERITY_STYLE']
    });
    fromIndex.classifySlipOkError = load(LIB_SLIP, { functions: ['classifySlipOkError'] }).classifySlipOkError;
    return fromIndex;
}

const SESSION = { id: 'LIVE_1', startTime: Date.now() - 65 * 60 * 1000, endTime: Date.now(), startTimeStr: '19:00:00', endTimeStr: '20:05:00' };
const STATS = (extra) => Object.assign({ slips: 5, amount: 700, draws: 5, customers: 4, byStatus: {} }, extra || {});
const field = (embed, name) => embed.fields.find(f => f.name.includes(name));
const allText = (embed) => embed.fields.map(f => f.name + '\n' + f.value).join('\n');
const E = (type, message) => ({ type, message });

test('round without errors: green embed, "ไม่พบ Error", warn count still shown', () => {
    const e = env().buildEndOfLiveReportEmbed(SESSION, { slips: 3, amount: 420, draws: 3, customers: 2, byStatus: { completed: 2, waiting: 1 } },
        [E('WARN', 'ตรวจพบสลิปซ้ำ: ลูกค้า "A" ส่งสลิปรหัส X ที่เคยบันทึกไปแล้ว')], { version: '1.0.16', shopLabel: 'ร้านTest' });
    assert.equal(e.color, 16753920); // มี warn -> ส้ม ไม่ใช่เขียว
    assert.match(e.title, /🏁 สรุปหลังจบไลฟ์ ร้านTest/);
    assert.match(field(e, 'Error').value, /ไม่พบ Error ในรอบนี้/);
    assert.match(field(e, 'WARN').value, /1 รายการ/);
    assert.match(field(e, 'สลิปรอบนี้').value, /3 ใบ/);
    assert.match(field(e, 'ยอดรับรวม').value, /420 บาท/);
    assert.match(field(e, 'สถานะคิว').value, /เสร็จ 2/);
    assert.match(field(e, 'ช่วงเวลา').value, /1 ชม\. 5 นาที/);
    assert.equal(field(e, 'รวมบิล'), undefined, 'no holdMerge field when not held');
    assert.equal(field(e, 'สลิปที่ปัดตก'), undefined, 'rejected count only when the caller provides it');
    assert.equal(field(e, 'สินค้าที่ออก'), undefined, 'product list only when the caller provides it');
});

test('rejected count and product list are shown when provided', () => {
    const e = env().buildEndOfLiveReportEmbed(SESSION, STATS({ rejected: 3, products: { pieces: 7, list: [{ name: 'A', qty: 5 }, { name: 'B', qty: 2 }] } }), [], {});
    assert.equal(field(e, 'สลิปที่ปัดตก').value, '3 ใบ (ไม่นับในตัวเลขด้านบน)');
    const p = field(e, 'สินค้าที่ออก');
    assert.match(p.name, /7 ชิ้น, 2 รายการ/);
    assert.match(p.value, /A ×5 • B ×2/);
    assert.match(p.value, /ไม่รวมใบที่ข้ามและที่ปัดตก/);
    const none = env().buildEndOfLiveReportEmbed(SESSION, STATS({ rejected: 0, products: { pieces: 0, list: [] } }), [], {});
    assert.match(field(none, 'สินค้าที่ออก').value, /ไม่มีสินค้าที่ได้สิทธิ์ในรอบนี้/);
    assert.equal(field(none, 'สลิปที่ปัดตก').value, '0 ใบ (ไม่นับในตัวเลขด้านบน)');
});

test('more than 15 products: first 15 listed (most pieces first) plus an overflow count; field stays within Discord limits', () => {
    const list = Array.from({ length: 22 }, (_, i) => ({ name: 'สินค้าชื่อยาวมากๆ รุ่นที่ ' + (i + 1), qty: 30 - i }));
    const e = env().buildEndOfLiveReportEmbed(SESSION, STATS({ products: { pieces: 999, list } }), [], {});
    const p = field(e, 'สินค้าที่ออก');
    assert.match(p.value, /รุ่นที่ 15 ×16/);
    assert.doesNotMatch(p.value, /รุ่นที่ 16 ×/);
    assert.match(p.value, /และอีก 7 รายการ/);
    assert.ok(p.value.length <= 1024);
});

test('round with errors: each problem type is listed with "what happened", "analysis" and "what to do"', () => {
    const issues = [
        E('ERROR', 'บันทึกสลิปอัตโนมัติของ "B" ไม่สำเร็จ (SQLITE_BUSY) ส่งเข้าคิวให้แอดมินตรวจเอง'),
        E('WARN', 'ตรวจพบสลิปซ้ำ: ลูกค้า "C" ส่งสลิปรหัส X ที่เคยบันทึกไปแล้ว'),
        E('ERROR', 'ตรวจสลิปไม่สำเร็จ: slipok api ตอบ 402 โควตาหมด'),
    ];
    const e = env().buildEndOfLiveReportEmbed(SESSION, STATS(), issues, {});
    assert.equal(e.color, 15158332); // มี error -> แดง
    const err = field(e, 'Error');
    assert.match(err.name, /\(2\)/, 'header counts the error lines');
    assert.match(err.value, /2 รายการ \(2 ประเภท\)/);
    assert.match(err.value, /บันทึกสลิปอัตโนมัติไม่สำเร็จ/);
    assert.match(err.value, /ลูกค้า: B/, 'customer name taken from the log line');
    assert.match(err.value, /> วิเคราะห์:/);
    assert.match(err.value, /> ควรทำ:/);
    assert.match(err.value, /เครดิตหรือแพ็กเกจตรวจสลิปหมด/, 'the 402 line is recognised');
    const warn = field(e, 'WARN');
    assert.match(warn.value, /1 รายการ/);
    assert.match(warn.value, /สลิปซ้ำ/);
    assert.doesNotMatch(err.value, /สลิปซ้ำ/, 'a warn is not listed as an error');
});

test('a message that matches no rule is shown raw with an honest "no analysis" note - no guessed cause or fix', () => {
    const e = env().buildEndOfLiveReportEmbed(SESSION, STATS(), [E('ERROR', 'เกิดเหตุประหลาดที่ไม่เคยมีมาก่อน: foo bar baz')], {});
    const v = field(e, 'Error').value;
    assert.match(v, /เกิดเหตุประหลาดที่ไม่เคยมีมาก่อน: foo bar baz/, 'raw message is shown');
    assert.match(v, /ยังไม่มีคำวิเคราะห์เฉพาะสำหรับข้อความนี้ \(ระบบไม่เดาสาเหตุ\)/);
    assert.match(v, /system\.log/);
    assert.doesNotMatch(v, /จำลองซ้ำบนเครื่อง Dev|ตรวจเครดิต|LINE Access Token/, 'no keyword-guessed advice');
    assert.match(v, /❔/, 'unknown severity marker, not a made-up level');
});

test('repeated problems are grouped (digits ignored) and counted; distinct ones are capped with an overflow line', () => {
    const same = Array.from({ length: 9 }, (_, i) => E('ERROR', `ข้อผิดพลาดที่ ${i + 1}`));
    let e = env().buildEndOfLiveReportEmbed(SESSION, STATS(), same, {});
    let v = field(e, 'Error').value;
    assert.match(field(e, 'Error').name, /\(9\)/);
    assert.match(v, /9 รายการ \(1 ประเภท\)/);
    assert.match(v, /9 ครั้ง/);

    const distinct = Array.from({ length: 15 }, (_, i) => E('ERROR', `เหตุการณ์แปลกแบบที่ ${'ก'.repeat(i + 1)} เกิดขึ้น`));
    e = env().buildEndOfLiveReportEmbed(SESSION, STATS(), distinct, {});
    v = e.fields.filter(f => /Error/.test(f.name)).map(f => f.value).join('\n');
    assert.match(v, /และอีก 3 ประเภท/);
    assert.match(v, /เหตุการณ์แปลกแบบที่ ก{12} เกิดขึ้น/);
    assert.doesNotMatch(v, /เหตุการณ์แปลกแบบที่ ก{13} เกิดขึ้น/);
});

test('real SlipOK messages (from classifySlipOkError) are all recognised by a rule, ERROR/WARN level kept', () => {
    const x = env();
    const cases = [
        [1010, 400, { bankName: 'กรุงเทพ', delay: 7 }, 'bank_delay'], [1009, 400, {}, 'bank_outage'],
        [1003, 400, {}, 'quota'], [1004, 400, {}, 'quota'], [null, 402, null, 'quota'],
        [1000, 400, {}, 'slipok_config'], [1001, 400, {}, 'slipok_config'], [1002, 400, {}, 'slipok_config'],
        [1005, 400, {}, 'bad_image'], [1006, 400, {}, 'bad_image'], [1007, 400, {}, 'no_qr'], [1008, 400, {}, 'not_payment_qr'],
        [1011, 400, {}, 'qr_expired'], [1013, 400, {}, 'mismatch'], [1014, 400, {}, 'mismatch'],
        [1099, 400, {}, 'slipok_unknown'], [null, null, null, 'slipok_unreachable']
    ];
    for (const [code, http, data, key] of cases) {
        const info = x.classifySlipOkError(http, code === null && http === 402 ? { message: 'x' } : (code === null ? null : { code, data }));
        const groups = x.analyzeLiveIssues([E(info.level, info.message)]);
        assert.equal(groups.length, 1);
        assert.equal(groups[0].key, key, `code ${code}/${http} -> ${key}, got ${groups[0].key} (message: ${info.message})`);
        assert.equal(groups[0].type, info.level);
    }
});

test('bank delay (1010): the analysis names the bank and the minutes from the log, and says it is not a bad slip', () => {
    const x = env();
    const info = x.classifySlipOkError(400, { code: 1010, data: { bankName: 'กรุงเทพ', delay: 7 } });
    const e = x.buildEndOfLiveReportEmbed(SESSION, STATS(), [E(info.level, info.message), E(info.level, info.message)], {});
    const v = field(e, 'WARN').value;
    assert.match(v, /เกิดอะไรขึ้น: ธนาคารกรุงเทพ รอประมาณ 7 นาที/);
    assert.match(v, /2 ครั้ง/);
    assert.match(v, /ไม่ใช่สลิปผิดหรือสลิปปลอม/);
    assert.match(v, /ส่งรูปเดิมซ้ำ/);
});

test('1007 analysis only states what is known: no cause is claimed for an individual image', () => {
    const x = env();
    const info = x.classifySlipOkError(400, { code: 1007 });
    const v = field(x.buildEndOfLiveReportEmbed(SESSION, STATS(), [E(info.level, info.message)], {}), 'WARN').value;
    assert.match(v, /ระบบยังบอกไม่ได้ว่ารูปแต่ละใบเป็นเพราะอะไร/);
    assert.match(v, /เปิดรูปในการ์ดรอใส่ยอด/);
});

test('wrong-account warning shows who transferred to which account, and points at the English shop name setting', () => {
    const v = field(env().buildEndOfLiveReportEmbed(SESSION, STATS(), [
        E('WARN', 'ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "Bob" โอนเข้าบัญชี "SOMEONE E" (ไม่ใช่ ร้านTest)')], {}), 'WARN').value;
    assert.match(v, /เกิดอะไรขึ้น: Bob → SOMEONE E/);
    assert.match(v, /ชื่อบัญชีอังกฤษในหน้าตั้งค่า/);
    assert.match(v, /ไม่ได้เช็กเลขบัญชี/);
});

test('every rule is complete and the rule keys are unique', () => {
    const rules = env().getLiveIssueRules();
    const keys = new Set();
    for (const r of rules) {
        assert.ok(r.key && !keys.has(r.key), 'unique key ' + r.key); keys.add(r.key);
        assert.equal(Object.prototype.toString.call(r.test), '[object RegExp]', r.key + ' has a regex');
        for (const f of ['title', 'meaning', 'action']) assert.ok(typeof r[f] === 'string' && r[f].length > 10, `${r.key}.${f}`);
        assert.ok(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(r.severity), r.key + ' severity');
    }
});

test('a pile of long, varied problems fits Discord by SPLITTING into 2 embeds — every embed legal, WARN detail kept', () => {
    const issues = [];
    for (let i = 0; i < 40; i++) issues.push(E(i % 2 ? 'ERROR' : 'WARN', `เหตุผิดปกติแบบ${'ข'.repeat(i + 1)} ${'ยาวมาก'.repeat(60)}`));
    issues.push(E('WARN', 'ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "ก" โอนเข้าบัญชี "ข" (ไม่ใช่ ร้าน)'));
    const list = Array.from({ length: 40 }, (_, i) => ({ name: 'สินค้า' + 'ย'.repeat(40) + i, qty: 1 }));
    const embeds = env().buildEndOfLiveReportEmbeds(SESSION, STATS({ rejected: 2, products: { pieces: 40, list } }), issues, { shopLabel: '[ร้านตัวอย่าง]', version: '1.0.17' });
    assert.ok(embeds.length <= 2, 'at most two embeds');
    embeds.forEach(e => {
        const total = e.title.length + e.footer.text.length + e.fields.reduce((a, f) => a + f.name.length + f.value.length, 0);
        assert.ok(total <= 6000, 'embed total ' + total);
        assert.ok(e.fields.length <= 25);
        e.fields.forEach(f => { assert.ok(f.value.length <= 1024, f.name + ' ' + f.value.length); assert.ok(f.name.length <= 256); });
    });
    // ตามคำขอเจ้าของร้าน: รายละเอียด WARN ต้องไม่หายไปเพราะข้อมูลเยอะ
    const warnText = embeds.flatMap(e => e.fields.filter(f => /คำเตือน|WARN/.test(f.name)).map(f => f.value)).join('\n');
    assert.match(warnText, /> วิเคราะห์:/, 'warn analysis lines survive the split');
    assert.match(warnText, /และอีก \d+ ประเภท/, 'groups beyond the cap are counted honestly with a system.log pointer');
    const errText = embeds.flatMap(e => e.fields.filter(f => /Error/.test(f.name)).map(f => f.value)).join('\n');
    assert.match(errText, /> ควรทำ:/, 'error guidance still present');
});

test('moderate round still produces a single embed (no needless second message)', () => {
    const x = env();
    const issues = [
        E('ERROR', 'บันทึกสลิปอัตโนมัติของ "B" ไม่สำเร็จ (SQLITE_BUSY) ส่งเข้าคิวให้แอดมินตรวจเอง'),
        E('WARN', 'ตรวจพบสลิปซ้ำ: ลูกค้า "C" ส่งสลิปรหัส X ที่เคยบันทึกไปแล้ว'),
        E('WARN', 'ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "D" โอนเข้าบัญชี "E" (ไม่ใช่ ร้านTest)'),
    ];
    const embeds = x.buildEndOfLiveReportEmbeds(SESSION, STATS(), issues, {});
    assert.equal(embeds.length, 1);
    assert.match(field(embeds[0], 'WARN').value, /2 รายการ \(2 ประเภท\)/);
    assert.match(field(embeds[0], 'WARN').value, /สลิปซ้ำ/);
    assert.match(field(embeds[0], 'WARN').value, /บัญชีที่ไม่ใช่ของร้าน/);
});

test('held round (รอรวมกับรอบหน้า) is called out in the report', () => {
    const e = env().buildEndOfLiveReportEmbed({ ...SESSION, holdMerge: true }, { slips: 0, amount: 0, draws: 0, customers: 0, byStatus: {} }, [], {});
    assert.match(field(e, 'รวมบิล').value, /รอรวมกับรอบหน้า/);
});

test('summarizeLiveProducts: same rule as the history page (no rejected / skipped / zero-draw rows), manual_image rows read, quantities summed', () => {
    const rows = [
        { status: 'completed', draws: 2, qr_payload: 'REF1|A x2' },
        { status: 'waiting', draws: 3, qr_payload: 'REF2|A x1, B x2' },
        { status: 'abnormal_pending', draws: 1, qr_payload: 'manual_image|/uploads/x.jpg|B x1' },
        { status: 'skipped', draws: 5, qr_payload: 'REF3|A x5' },
        { status: 'rejected', draws: 4, qr_payload: 'REF4|A x4' },
        { status: 'completed', draws: 0, qr_payload: 'REF5|A x9' },
        { status: 'completed', draws: 1, qr_payload: 'REF6|C' },
        { status: 'completed', draws: 1, qr_payload: 'REF7' }
    ];
    const r = env().summarizeLiveProducts(rows);
    assert.deepEqual(JSON.parse(JSON.stringify(r.list)), [{ name: 'A', qty: 3 }, { name: 'B', qty: 3 }, { name: 'C', qty: 1 }]);
    assert.equal(r.pieces, 7);
    assert.deepEqual(JSON.parse(JSON.stringify(env().summarizeLiveProducts([]))), { list: [], pieces: 0 });
});

// ---- v1.0.17: ความเห็นเสริมจาก AI สำหรับกลุ่มที่ยังไม่มีกฎ ----
test('AI opinion (aiNotes) is shown ONLY for unknown groups, clearly marked as unconfirmed', () => {
    const x = env();
    const issues = [
        E('ERROR', 'เกิดเหตุแปลกใหม่ที่ไม่มีในกฎ: foo bar'),
        E('WARN', 'ตรวจพบสลิปซ้ำ: ลูกค้า "A" ส่งสลิปรหัส X ที่เคยบันทึกไปแล้ว')
    ];
    const groups = x.analyzeLiveIssues(issues);
    const rawKey = groups.find(g => !g.rule).key;
    const ruleKey = groups.find(g => g.rule).key;
    const notes = {};
    notes[rawKey] = 'น่าจะเกิดจาก X ควรตรวจ Y';
    notes[ruleKey] = 'ความเห็นแปลกปลอมที่ห้ามปรากฏ';
    const e = x.buildEndOfLiveReportEmbed(SESSION, STATS(), issues, {}, notes);
    const all = e.fields.map(f => f.value).join('\n');
    assert.match(all, /🤖 ความเห็นจาก AI \(ยังไม่ยืนยัน\): น่าจะเกิดจาก X ควรตรวจ Y/);
    assert.doesNotMatch(all, /ความเห็นแปลกปลอม/, 'rule groups never take an AI note');
    // ไม่ส่ง aiNotes -> พฤติกรรมเดิม
    const e2 = x.buildEndOfLiveReportEmbed(SESSION, STATS(), issues, {}, {});
    assert.match(e2.fields.map(f => f.value).join('\n'), /ยังไม่มีคำวิเคราะห์เฉพาะ/);
});

test('getAiOpinionsForUnknownIssues: one batched Gemini call, JSON parsed back by index; 429/no-key/empty -> {} and never throws', async () => {
    const calls = [];
    const mkAxios = (status, text) => ({ post: async (url, body) => { calls.push({ url, body }); if (status !== 200) { const e = new Error('429'); e.response = { status }; throw e; } return { data: { candidates: [{ content: { parts: [{ text }] } }] } }; } });
    const path = require('path');
    const { load } = require('../harness/extract');
    const IDX = path.join(__dirname, '..', '..', 'index.js');
    const FNS = ['getAiOpinionsForUnknownIssues', 'analyzeLiveIssues', 'getLiveIssueRules'];
    const MSGS = [E('ERROR', 'ปัญหาแปลกกลุ่มที่ 1 ที่ไม่มีกฎ xyz'), E('WARN', 'ปัญหาแปลกกลุ่มที่ 2 ที่ไม่มีกฎ abc')];
    // สำเร็จ
    const okCtx = load(IDX, {
        functions: FNS,
        globals: { axios: mkAxios(200, JSON.stringify([{ i: 1, opinion: 'สันนิษฐานข้อ 1' }, { i: 2, opinion: 'สันนิษฐานข้อ 2' }])), process: { env: { GEMINI_API_KEY: 'test-key' } }, addLog: () => {} }
    });
    const okRaw = okCtx.analyzeLiveIssues(MSGS).filter(g => !g.rule);
    assert.equal(okRaw.length, 2, 'both test messages are unknown to the rules');
    const notes = await okCtx.getAiOpinionsForUnknownIssues(okRaw);
    assert.equal(calls.length, 1, 'exactly one batched call');
    assert.match(calls[0].url, /gemini-3\.5-flash-lite/);
    assert.ok(calls[0].body.contents[0].parts[0].text.includes('ปัญหาแปลกกลุ่มที่ 1'), 'both messages in one prompt');
    assert.equal(Object.keys(notes).length, 2);
    assert.match(notes[okRaw[0].key], /สันนิษฐานข้อ 1/);
    // 429 -> {}
    const qCtx = load(path.join(__dirname, '..', '..', 'index.js'), {
        functions: ['getAiOpinionsForUnknownIssues'],
        globals: { axios: mkAxios(429, ''), process: { env: { GEMINI_API_KEY: 'test-key' } }, addLog: () => {} }
    });
    assert.equal(Object.keys(await qCtx.getAiOpinionsForUnknownIssues([{ type: 'ERROR', key: 'raw:x', rule: null, messages: ['x'] }])).length, 0);
    // ไม่มี key -> ไม่ยิงเรียกเลย
    const nCalls = calls.length;
    const noKeyCtx = load(path.join(__dirname, '..', '..', 'index.js'), {
        functions: ['getAiOpinionsForUnknownIssues'],
        globals: { axios: mkAxios(200, '[]'), process: { env: {} }, addLog: () => {} }
    });
    assert.equal(Object.keys(await noKeyCtx.getAiOpinionsForUnknownIssues([{ type: 'ERROR', key: 'raw:y', rule: null, messages: ['y'] }])).length, 0);
    assert.equal(calls.length, nCalls, 'no call without a key');
    // รายการว่าง -> ไม่เรียก
    assert.equal(Object.keys(await okCtx.getAiOpinionsForUnknownIssues([])).length, 0);
});
