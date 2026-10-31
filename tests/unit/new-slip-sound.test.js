// tests/unit/new-slip-sound.test.js
// Phase B (owner request 2026-10-31, shop report "new queue, no sound"): the new-queue sound is louder/longer, a
// missed play_sound event (socket dropped) is covered by noticing new queue cards when the dashboard redraws,
// and a small pill shows whether the browser lets the page play sound yet.
// Real functions are cut out of public/index.html and run in a vm (no browser). What it cannot show: how it SOUNDS
// -- that is a manual step in tests/MANUAL_TEST_CHECKLIST.md.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(process.env.AQ_TEST_INDEX_HTML || path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');
function grabBlock(startToken) {
    const start = html.indexOf(startToken);
    if (start < 0) throw new Error(`"${startToken}" is missing from index.html`);
    let i = html.indexOf('{', start), depth = 0;
    for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    return html.slice(start, i);
}
const grab = (name) => grabBlock(`function ${name}(`);

function makeCtx() {
    const played = [];
    const ctx = { Date, Array, Set, Number, String, played };
    vm.createContext(ctx);
    vm.runInContext(grabBlock('const SOUND_PRESETS = {') + ';', ctx);
    vm.runInContext(`function playPreset(name) { played.push(name); }
        let __lastNewSlipSoundAt = 0; const __queueSeen = new Set();`, ctx);
    vm.runInContext(html.match(/const NEW_SLIP_SOUND_DEDUP_MS = \d+;/)[0], ctx);
    ['playNewSlipSound', 'newQueueSlipIds', 'soundStatusView'].forEach(n => vm.runInContext(grab(n), ctx));
    return ctx;
}
const run = (ctx, expr) => vm.runInContext(expr, ctx);

test('new-queue sound: three rising notes, louder and longer than the old two quick blips', () => {
    const ctx = makeCtx();
    const p = run(ctx, 'SOUND_PRESETS.newSlip');
    assert.equal(p.freqs.length, 3, 'three notes');
    assert.ok(p.freqs[0] < p.freqs[1] && p.freqs[1] < p.freqs[2], 'rising');
    assert.ok(p.volume >= 0.3, `volume ${p.volume} should be about 0.35 (was the 0.2 default)`);
    const total = p.durs.reduce((a, b) => a + b, 0);
    assert.ok(total >= 0.5, `total length ${total}s should be at least 0.5s (was 0.2s)`);
});

test('play_sound and the redraw that follows it ring ONCE (2-second dedup), a later slip rings again', () => {
    const ctx = makeCtx();
    assert.equal(run(ctx, 'playNewSlipSound()'), true);
    assert.equal(run(ctx, 'playNewSlipSound()'), false, 'same slip seen again by full_sync right after');
    assert.deepEqual(Array.from(ctx.played), ['newSlip']);
    run(ctx, '__lastNewSlipSoundAt = Date.now() - NEW_SLIP_SOUND_DEDUP_MS - 10');
    assert.equal(run(ctx, 'playNewSlipSound()'), true);
    assert.equal(ctx.played.length, 2);
});

test('new queue cards are noticed from the redraw itself (covers a lost play_sound event)', () => {
    const ctx = makeCtx();
    const seen = (data) => Array.from(run(ctx, `newQueueSlipIds(${JSON.stringify(data)}, __queueSeen)`));
    // first draw only remembers what is on screen (renderDashboard keeps quiet on the first draw)
    assert.deepEqual(seen({ queues: { waiting: [{ id: 1, slipIds: [1] }], called: [{ id: 2, slipIds: [2] }], skipped: [{ id: 3, slipIds: [3] }], abnormal_pending: [] } }), [1]);
    // nothing new -> nothing
    assert.deepEqual(seen({ queues: { waiting: [{ id: 1, slipIds: [1] }] } }), []);
    // a new customer in the waiting queue
    assert.deepEqual(seen({ queues: { waiting: [{ id: 1, slipIds: [1] }, { id: 4, slipIds: [4] }] } }), [4]);
    // an existing customer's card grows by a second slip
    assert.deepEqual(seen({ queues: { waiting: [{ id: 1, slipIds: [1, 5] }, { id: 4, slipIds: [4] }] } }), [5]);
    // the merchant moves a skipped card back to waiting: already known, no sound
    assert.deepEqual(seen({ queues: { waiting: [{ id: 3, slipIds: [3] }] } }), []);
    // a card waiting for the amount is not a queue yet ...
    assert.deepEqual(seen({ queues: { waiting: [{ id: 6, slipIds: [6], isPendingAmount: true }] } }), []);
    // ... but once it is upgraded (amount keyed / bank re-check passed) it is new
    assert.deepEqual(seen({ queues: { waiting: [{ id: 6, slipIds: [6] }] } }), [6]);
    // a card that shows up straight in another group (e.g. abnormal) is remembered but does not ring
    assert.deepEqual(seen({ queues: { abnormal_pending: [{ id: 7, slipIds: [7] }] } }), []);
});

test('sound status pill text: on / tap once to enable / not supported', () => {
    const ctx = makeCtx();
    assert.match(run(ctx, "soundStatusView('running').text"), /เปิดอยู่/);
    assert.match(run(ctx, "soundStatusView('suspended').text"), /กดหน้าจอ 1 ครั้ง/);
    assert.match(run(ctx, "soundStatusView(undefined).text"), /กดหน้าจอ 1 ครั้ง/);
    assert.match(run(ctx, "soundStatusView('unsupported').text"), /เล่นเสียงไม่ได้/);
});

test('wiring: redraw uses the new-card check, play_sound uses the dedup, top-up beep uses the unlocked audio', () => {
    const render = grab('renderDashboard');
    assert.match(render, /newQueueSlipIds\(data, __queueSeen\)/);
    assert.match(render, /playNewSlipSound\(\)/);
    assert.match(grabBlock("socket.on('play_sound'"), /playNewSlipSound\(\)/);
    const topup = grabBlock("socket.on('topup_needed'");
    assert.doesNotMatch(topup, /new Ctx\(\)/, 'a fresh AudioContext per beep can stay blocked by autoplay even after the merchant tapped');
    assert.match(topup, /playToneSequence\(/);
    assert.match(html, /id="soundStatusPill"/, 'the pill is on the page');
    assert.match(html, /addEventListener\(evt, \(\) => \{[\s\S]{0,200}__audioCtx\.resume\(\)/, 'audio is woken up again on focus / tab visible');
});
