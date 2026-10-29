// tests/unit/frontend-live-stats.test.js
// The dashboard (public/index.html) must show the LIVE ROUND's numbers when the page is opened/reloaded during a live,
// not the per-date numbers. The real functions are cut out of index.html and run with a fake fetch/DOM.
// Override the file under test with AQ_TEST_INDEX_HTML (used to prove the test fails on the previous release).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_FILE = process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html');
const html = fs.readFileSync(HTML_FILE, 'utf8');

/** source of `function name(...) {...}` by balanced braces (the three functions under test have no braces in strings) */
function grab(name) {
    const start = html.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`function ${name} is missing from ${HTML_FILE}`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}

function makeEnv({ dateValue, today, liveSession, historyDelay, liveDelay }) {
    const src = ['loadHistory', 'loadLiveStatsIfLive', 'fetchLiveSessionStatus'].map(grab).join('\n');
    const rendered = [];
    const sleep = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
    const ctx = {
        console,
        window: {},
        document: { getElementById: id => id === 'historyDateInput' ? { value: dateValue } : null },
        getClientTodayStr: () => today,
        updateLiveUI: () => {},
        renderDashboard: d => rendered.push(d.tag),
        fetch: url => {
            if (url.startsWith('/api/stats/history')) return sleep(historyDelay, { ok: true, json: async () => ({ tag: 'history:' + url.split('=')[1] }) });
            if (url === '/api/stats/today') return sleep(liveDelay, { ok: true, json: async () => ({ tag: 'live-session-stats' }) });
            if (url === '/api/live_session/current') return sleep(1, { ok: true, json: async () => ({ success: true, session: liveSession }) });
            throw new Error('unexpected fetch ' + url);
        },
    };
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { ctx, rendered, settle: () => sleep(150) };
}

const live = { id: 'LIVE_1', startTime: 1 };
const pageLoad = ctx => { ctx.loadHistory(); ctx.fetchLiveSessionStatus(); };     // what the page does when it opens

test('live + today: a slow per-date answer must NOT overwrite the live-round numbers', async () => {
    const e = makeEnv({ dateValue: '2026-10-30', today: '20261030', liveSession: live, historyDelay: 60, liveDelay: 5 });
    pageLoad(e.ctx); await e.settle();
    assert.deepEqual(e.rendered, ['live-session-stats']);
});

test('live + today: even if the per-date answer arrives first, the final screen is the live round', async () => {
    const e = makeEnv({ dateValue: '2026-10-30', today: '20261030', liveSession: live, historyDelay: 1, liveDelay: 5 });
    pageLoad(e.ctx); await e.settle();
    assert.deepEqual(e.rendered, ['history:20261030', 'live-session-stats']);
});

test('not live: unchanged behaviour (per-date numbers only, live endpoint never called)', async () => {
    const e = makeEnv({ dateValue: '2026-10-30', today: '20261030', liveSession: null, historyDelay: 1, liveDelay: 5 });
    pageLoad(e.ctx); await e.settle();
    assert.deepEqual(e.rendered, ['history:20261030']);
});

test('live but the user is looking at another day: do not overwrite what they chose', async () => {
    const e = makeEnv({ dateValue: '2026-10-29', today: '20261030', liveSession: live, historyDelay: 1, liveDelay: 5 });
    pageLoad(e.ctx); await e.settle();
    assert.deepEqual(e.rendered, ['history:20261029']);
});

test('user picks another day while the live-round request is in flight: the stale live answer is dropped', async () => {
    const e = makeEnv({ dateValue: '2026-10-30', today: '20261030', liveSession: live, historyDelay: 1, liveDelay: 40 });
    pageLoad(e.ctx);
    await new Promise(r => setTimeout(r, 20));
    e.ctx.loadHistory();
    await e.settle();
    assert.deepEqual(e.rendered, ['history:20261030', 'history:20261030']);
});
