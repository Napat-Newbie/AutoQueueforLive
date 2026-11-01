// tests/unit/count-past-draws.test.js
// countPastDraws() decides whether a customer already paid shipping (items bought earlier in this round / today).
// Runs the real function from index.js against an in-memory SQLite table.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('../harness/extract');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.js');
const { LIVE_ID_RE } = require(path.join(ROOT, 'lib', 'products'));

function env() {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE slips (id INTEGER PRIMARY KEY AUTOINCREMENT, line_id TEXT, draws INTEGER, status TEXT, session_id TEXT, trans_date TEXT)');
    const state = { today: '20261029' };
    const ctx = load(INDEX, {
        functions: ['countPastDraws'],
        globals: { supabase: { db }, getTodayString: () => state.today, activeLiveSession: null, LIVE_ID_RE },
    });
    const add = (line_id, draws, { status = 'waiting', session_id = null, trans_date = state.today } = {}) =>
        db.prepare('INSERT INTO slips (line_id, draws, status, session_id, trans_date) VALUES (?,?,?,?,?)').run(line_id, draws, status, session_id, trans_date);
    return { ctx, state, add, count: (id, opts) => ctx.countPastDraws(id, opts) };
}

test('no live: counts only items bought today', () => {
    const t = env();
    t.add('U1', 2); t.add('U1', 1, { trans_date: '20261028' }); t.add('U2', 5);
    assert.equal(t.count('U1'), 2);
});

test('live: counts this round + slips paid before the live started the same day, not other rounds', () => {
    const t = env();
    t.ctx.activeLiveSession = { id: 'LIVE_2', startDateStr: '20261029' };
    t.add('U1', 1, { session_id: 'LIVE_2' });
    t.add('U1', 2, { session_id: null });                      // paid before pressing start, same day
    t.add('U1', 4, { session_id: 'LIVE_1' });                  // an earlier round
    assert.equal(t.count('U1'), 3);
});

test('live that crosses midnight: slips paid before the live started (yesterday, no round id) still count', () => {
    const t = env();
    t.state.today = '20261029';                                // it is now past 00:00
    t.ctx.activeLiveSession = { id: 'LIVE_2', startDateStr: '20261028' };   // live began yesterday evening
    t.add('U1', 1, { session_id: null, trans_date: '20261028' });
    assert.equal(t.count('U1'), 1, 'pre-live slip of the start date must still count after midnight');
});

test('live: an unrelated old slip without round id never counts', () => {
    const t = env();
    t.ctx.activeLiveSession = { id: 'LIVE_2', startDateStr: '20261029' };
    t.add('U1', 3, { session_id: null, trans_date: '20261020' });
    assert.equal(t.count('U1'), 0);
});

test('merged round (v1.0.15): items bought in the earlier round count too', () => {
    const t = env();
    t.ctx.activeLiveSession = { id: 'LIVE_2', startDateStr: '20261029', mergeFrom: 'LIVE_1' };
    t.add('U1', 1, { session_id: 'LIVE_1' });
    t.add('U1', 1, { session_id: 'LIVE_2' });
    assert.equal(t.count('U1'), 2);
});

test('options: excludeRejected and excludeId', () => {
    const t = env();
    const a = t.add('U1', 1);
    t.add('U1', 2, { status: 'rejected' });
    assert.equal(t.count('U1'), 3);
    assert.equal(t.count('U1', { excludeRejected: true }), 1);
    assert.equal(t.count('U1', { excludeId: a.lastInsertRowid }), 2);
});
