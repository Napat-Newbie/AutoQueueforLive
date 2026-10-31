// tests/system/persist-across-restart.test.js
// Owner 2026-11-01 ("จัดการ"): the one-tap "second transfer" cards and the Gemini address retry queue lived only in memory -
// closing / restarting the program in the middle of a live lost them (the regex answer and the log stayed). Both are now
// kept in the shop database (configs) and loaded again when the program starts. Proven with a REAL restart of the program.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BBL = () => ({ code: 1010, message: 'wait', data: { qrcodeData: 'QR', bankCode: '002', bankName: 'กรุงเทพ', delay: 7, message: 'wait' } });
const processed = (sb, user, times) => sb.waitFor(() => sb.mock.calls.filter(c => c.path === `/v2/bot/profile/${user}`).length >= times, 10000, `slip of ${user} not processed`).then(() => sleep(500));
const addrOf = (sb, user) => { const r = sb.sql('SELECT value FROM configs WHERE key = ?', `cust_addr_${user}`)[0]; return r ? JSON.parse(r.value) : null; };

test('a "second transfer?" card survives a program restart, and its one-tap recovery still works', () => withSandbox(async sb => {
    sb.mock.profile('Ualice', 'Alice');
    sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
    await sb.sendSlip('Ualice', 'm1', 'kbbl'); await sb.waitForSlips(1); await sleep(300);
    const id = sb.slips()[0].id;
    sb.exec('UPDATE slips SET trans_date = ?, trans_time = ? WHERE id = ?', bkkDate(), '10:00:00', id);
    assert.equal((await sb.post('/api/queue/manual_amount', { slipId: id, amount: 140 })).json.success, true);
    sb.mock.slipOk('k2', { amount: 140, transRef: 'SECOND01', transDate: bkkDate(), transTime: '09:59:30' });
    await sb.sendSlip('Ualice', 'm2', 'k2'); await processed(sb, 'Ualice', 2);
    assert.equal((await sb.stats()).manualMatches.length, 1, 'precondition: the card is shown');

    await sb.restart();
    const st = await sb.stats();
    assert.equal(st.manualMatches.length, 1, 'card still there after the restart');
    const r = await sb.post('/api/queue/manual_match_count_second', { matchId: st.manualMatches[0].id });
    assert.equal(r.json.success, true, 'one-tap recovery works after the restart');
    assert.equal((await sb.stats()).stats.totalAmount, 280);

    await sb.restart();
    assert.equal((await sb.stats()).manualMatches.length, 0, 'a resolved card does not come back');
}));

test('a queued Gemini address retry survives a program restart and still replaces the fallback answer', () => withSandbox(async sb => {
    sb.mock.profile('Upim', 'Pim LINE');
    sb.mock.geminiQueue.push({ status: 429, body: { error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '5s' }] } } });
    const text = 'พิมพ์ชนก แสนดี\n6/6 ต.บ้านใหม่ อ.ปากเกร็ด จ.นนทบุรี 11120\n0823332211\nวางไว้หน้าประตูได้เลย';
    await sb.webhook([{ type: 'message', replyToken: 'rt1', source: { type: 'user', userId: 'Upim' }, message: { type: 'text', id: 't1', text } }]);
    await sb.waitFor(() => addrOf(sb, 'Upim'), 8000, 'fallback answer not saved');
    assert.notEqual(addrOf(sb, 'Upim').remark, 'วางไว้หน้าประตูได้เลย', 'precondition: the fallback answer (no Gemini remark yet)');

    await sb.restart();   // the retry is due ~5 s after the 429; the restart happens before it
    sb.mock.geminiQueue.push({ text: JSON.stringify({ recipient_name: 'พิมพ์ชนก แสนดี', phone: '0823332211', address: '6/6', subdistrict: 'บ้านใหม่', district: 'ปากเกร็ด', province: 'นนทบุรี', postcode: '11120', remark: 'วางไว้หน้าประตูได้เลย' }) });
    const a = await sb.waitFor(() => { const x = addrOf(sb, 'Upim'); return x && x.remark === 'วางไว้หน้าประตูได้เลย' ? x : null; }, 25000, 'the retry was lost in the restart');
    assert.equal(a.province, 'นนทบุรี');
}, null, { GEMINI_API_KEY: 'test-gemini-key-not-real' }));
