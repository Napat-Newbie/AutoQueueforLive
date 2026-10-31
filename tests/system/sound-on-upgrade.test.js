// tests/system/sound-on-upgrade.test.js
// Phase B (owner request 2026-10-31): a card that was "waiting for the amount" and BECOMES a numbered queue card
// must ring the new-queue sound like a normal slip does -- both when the merchant keys the amount and when the
// system's own bank re-check (SlipOK 1010) passes. Before this, these paths were silent.
// Server side only (what the dashboard is told); the real sound is a manual check.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withSandbox, bkkDate } = require('../harness/sandbox');
const { connectEvents } = require('../harness/sio-poll');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const BBL = () => ({ code: 1010, message: 'wait', data: { qrcodeData: 'QR', bankCode: '002', bankName: 'กรุงเทพ', delay: 7, message: 'wait' } });
const bkkTimeAgo = (sec) => new Date(Date.now() - sec * 1000).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Bangkok' });

const unreadableCard = async (sb) => {
    sb.mock.profile('Ubob', 'Bob');
    sb.mock.slipUnreadable('ku');
    await sb.sendSlip('Ubob', 'mu', 'ku');
    await sb.waitForSlips(1);
    await sleep(400);
    return sb.slips()[0].id;
};

test('merchant keys an amount that buys an item: the dashboard gets play_sound', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        const id = await unreadableCard(sb);
        assert.equal(ev.named('play_sound').length, 0, 'precondition: the waiting-for-amount card itself has the chord, not the ping');
        const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount: 140 });
        assert.equal(r.json.draws, 1);
        await sb.waitFor(() => ev.named('play_sound').length >= 1, 5000, 'no play_sound after the card became a queue');
    } finally { ev.close(); }
}));

test('merchant keys an amount that is NOT enough: no new-queue sound (it becomes an orange card)', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        const id = await unreadableCard(sb);
        const r = await sb.post('/api/queue/manual_amount', { slipId: id, amount: 60 });
        assert.equal(r.json.draws, 0);
        await sleep(800);
        assert.equal(ev.named('play_sound').length, 0);
    } finally { ev.close(); }
}));

test('bank re-check (1010) passes by itself and the card becomes a queue: play_sound', () => withSandbox(async sb => {
    const ev = await connectEvents(sb.base);
    try {
        sb.mock.profile('Ualice', 'Alice');
        sb.mock.slips.set('kbbl', { status: 400, body: BBL() });
        await sb.sendSlip('Ualice', 'm1', 'kbbl');
        await sb.waitForSlips(1);
        await sleep(300);
        assert.equal(ev.named('play_sound').length, 0, 'precondition: no ping for the 1010 card');
        sb.mock.slipOk('kbbl', { amount: 140, transRef: 'AUTOS001', transDate: bkkDate(), transTime: bkkTimeAgo(60) });
        await sb.waitFor(() => sb.slips()[0].amount === 140, 10000, 'the card did not upgrade');
        await sb.waitFor(() => ev.named('play_sound').length >= 1, 5000, 'no play_sound after the bank re-check upgraded the card');
    } finally { ev.close(); }
}, null, { AQ_BANK_RECHECK_DELAY_MS: '1200' }));
