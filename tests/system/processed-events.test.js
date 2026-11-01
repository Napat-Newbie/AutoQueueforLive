// tests/system/processed-events.test.js
// PR R1: Persistent Webhook Event Deduplication across server restart
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { withSandbox, bkkDate } = require('../harness/sandbox');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readLog = (sb) => { try { return fs.readFileSync(path.join(sb.dir, 'system.log'), 'utf8'); } catch (e) { return ''; } };

test('sending the same slip event twice with sb.restart() counts amount only once and skips duplicate', () => withSandbox(async sb => {
    sb.mock.profile('Utest1', 'Test Customer 1');
    sb.mock.slipOk('k1', { amount: 150, transRef: 'REF_PERM_01', transDate: bkkDate(), transTime: '10:00:00' });
    sb.mock.lineMessage('m_slip_01', 'k1');

    const event = {
        webhookEventId: 'wh_slip_01',
        type: 'message',
        replyToken: 'rt_01',
        source: { type: 'user', userId: 'Utest1' },
        message: { type: 'image', id: 'm_slip_01' }
    };

    // First delivery
    await sb.webhook([event]);
    await sb.waitForSlips(1);

    const slipsBefore = sb.slips();
    assert.equal(slipsBefore.length, 1, 'precondition: 1 slip recorded');
    assert.equal(Number(slipsBefore[0].amount), 150, 'amount is 150');

    const downloadsBefore = sb.mock.calls.filter(c => c.path.includes('/content')).length;
    assert.equal(downloadsBefore, 1, 'image downloaded once');

    // Restart server (simulates shop PC restart)
    await sb.restart();

    // Verify slip is still there after restart
    const statsAfterRestart = await sb.stats();
    assert.equal(statsAfterRestart.stats.totalAmount, 150, 'totalAmount intact after restart');

    // Second delivery of the EXACT same event
    await sb.webhook([event]);
    await sleep(600);

    // Verify amount counted only once and no second slip created
    const slipsAfter = sb.slips();
    assert.equal(slipsAfter.length, 1, 'no duplicate slip created');
    const statsFinal = await sb.stats();
    assert.equal(statsFinal.stats.totalAmount, 150, 'totalAmount counted only once (150)');

    // Verify image was not downloaded again from LINE
    const downloadsAfter = sb.mock.calls.filter(c => c.path.includes('/content')).length;
    assert.equal(downloadsAfter, downloadsBefore, 'duplicate event skipped before downloading image from LINE');

    // Verify event is recorded in processed_events table
    const stored = sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', 'wh_slip_01');
    assert.equal(stored.length, 1, 'wh_slip_01 is recorded in processed_events');

    // Verify INFO log was written
    await sb.waitFor(() => {
        const log = readLog(sb);
        return /\[INFO\].*บล็อกข้อความซ้ำ \(Deduplication\): Event ID wh_slip_01/.test(log);
    }, 8000, 'INFO deduplication line missing from system.log');
}));

test('deduplication falls back to message.id when webhookEventId is absent', () => withSandbox(async sb => {
    sb.mock.profile('Utest2', 'Test Customer 2');
    sb.mock.slipOk('k2', { amount: 200, transRef: 'REF_PERM_02', transDate: bkkDate(), transTime: '10:05:00' });
    sb.mock.lineMessage('m_fallback_02', 'k2');

    const eventNoWebhookId = {
        type: 'message',
        replyToken: 'rt_02',
        source: { type: 'user', userId: 'Utest2' },
        message: { type: 'image', id: 'm_fallback_02' }
    };

    // First delivery
    await sb.webhook([eventNoWebhookId]);
    await sb.waitForSlips(1);
    assert.equal(sb.slips().length, 1);

    await sb.restart();

    // Second delivery with same message.id
    await sb.webhook([eventNoWebhookId]);
    await sleep(600);

    assert.equal(sb.slips().length, 1, 'no duplicate slip created on message.id fallback');
    const stats = await sb.stats();
    assert.equal(stats.stats.totalAmount, 200, 'total amount counted only once');

    // Stored with message.id as event_id
    const stored = sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', 'm_fallback_02');
    assert.equal(stored.length, 1, 'm_fallback_02 is recorded in processed_events');

    // Verify INFO log was written with message ID
    await sb.waitFor(() => {
        const log = readLog(sb);
        return /\[INFO\].*บล็อกข้อความซ้ำ \(Deduplication\): Event ID m_fallback_02/.test(log);
    }, 8000, 'INFO deduplication line missing from system.log');
}));

test('sending duplicate address message across restart skips re-processing and logs INFO', () => withSandbox(async sb => {
    sb.mock.profile('Uaddr1', 'Addr Customer');
    const text = 'คุณสมใจ นึกคิด 123/45 ถ.สุขุมวิท ต.คลองเตย อ.คลองเตย จ.กรุงเทพ 10110 เบอร์ 0812345678';
    const event = {
        webhookEventId: 'wh_addr_01',
        type: 'message',
        replyToken: 'rt_addr_01',
        source: { type: 'user', userId: 'Uaddr1' },
        message: { type: 'text', id: 'm_addr_01', text }
    };

    await sb.webhook([event]);
    await sb.waitFor(() => {
        const rows = sb.sql('SELECT value FROM configs WHERE key = ?', 'cust_addr_Uaddr1');
        return rows.length > 0;
    }, 8000, 'address not saved');

    await sb.restart();

    // Send duplicate address event
    await sb.webhook([event]);

    // Verify system log has INFO deduplication log
    await sb.waitFor(() => {
        const log = readLog(sb);
        return /\[INFO\].*บล็อกข้อความซ้ำ \(Deduplication\): Event ID wh_addr_01/.test(log);
    }, 8000, 'INFO deduplication line missing from system.log');
}));

test('cleanupProcessedEvents deletes events older than 8 days on restart', () => withSandbox(async sb => {
    const now = Date.now();
    const oldId = 'ev_old_01';
    const newId = 'ev_new_01';
    const nineDaysAgo = now - 9 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    sb.exec('INSERT INTO processed_events (event_id, seen_at) VALUES (?, ?)', oldId, nineDaysAgo);
    sb.exec('INSERT INTO processed_events (event_id, seen_at) VALUES (?, ?)', newId, sevenDaysAgo);

    assert.equal(sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', oldId).length, 1);
    assert.equal(sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', newId).length, 1);

    // Restart triggers db init and cleanupProcessedEvents(8)
    await sb.restart();

    assert.equal(sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', oldId).length, 0, 'events older than 8 days deleted');
    assert.equal(sb.sql('SELECT event_id FROM processed_events WHERE event_id = ?', newId).length, 1, 'events within 8 days kept');
}));
