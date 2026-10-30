// tests/unit/floating-total-and-modals.test.js
// v1.0.17 (owner request): only the "total transferred" follows the screen, the top control panel is not frozen,
// and the two "what's in this update" windows scroll inside the screen instead of running past its edge.
// Real functions are cut out of public/index.html and run in a vm with small fakes. Look/feel is checked separately in a real browser.
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
const el = () => ({ innerText: '', classList: { s: new Set(), toggle(c, on) { if (on) this.s.add(c); else this.s.delete(c); }, has(c) { return this.s.has(c); } } });

test('the total on the floating badge always equals the total on the card', () => {
    const els = { totalAmount: el(), uniqueCustomers: el(), totalSlips: el(), totalDraws: el(), waitingQueuesCount: el(), floatingTotalAmount: el() };
    const ctx = { document: { getElementById: id => els[id] || null } };
    vm.createContext(ctx);
    vm.runInContext(grab('updateStatsUI'), ctx);
    ctx.updateStatsUI({ totalAmount: 8204, uniqueCustomers: 3, totalSlips: 5, totalDraws: 7, waitingCount: 2 });
    assert.equal(els.totalAmount.innerText, '8,204.00');
    assert.equal(els.floatingTotalAmount.innerText, '8,204.00');
    ctx.updateStatsUI({ totalAmount: 1234567.5, uniqueCustomers: 0, totalSlips: 0, totalDraws: 0, waitingCount: 0 });
    assert.equal(els.floatingTotalAmount.innerText, '1,234,567.50');
    // page without the badge (old markup) must not break the stats
    delete els.floatingTotalAmount;
    assert.doesNotThrow(() => ctx.updateStatsUI({ totalAmount: 1, uniqueCustomers: 0, totalSlips: 0, totalDraws: 0, waitingCount: 0 }));
});

test('the badge shows only while the real total card is off screen', () => {
    const card = {}, badge = el();
    let cb = null, observed = null;
    const ctx = {
        document: { querySelector: s => (s === '.metric-main-card' ? card : null), getElementById: id => (id === 'floatingTotal' ? badge : null) },
        IntersectionObserver: function (fn) { cb = fn; this.observe = (t) => { observed = t; }; },
    };
    vm.createContext(ctx);
    vm.runInContext(grab('setupFloatingTotal'), ctx);
    ctx.setupFloatingTotal();
    assert.equal(observed, card, 'watches the real total card');
    cb([{ isIntersecting: false }]);
    assert.equal(badge.classList.has('show'), true, 'card scrolled away: badge appears');
    cb([{ isIntersecting: true }]);
    assert.equal(badge.classList.has('show'), false, 'card visible again: badge hides');
    // browser without IntersectionObserver: nothing happens, no crash
    const ctx2 = { document: ctx.document };
    vm.createContext(ctx2); vm.runInContext(grab('setupFloatingTotal'), ctx2);
    assert.doesNotThrow(() => ctx2.setupFloatingTotal());
});

test('static: badge is fixed + click-through; control panel is not frozen; no copy-message buttons', () => {
    assert.match(html, /#floatingTotal\s*\{[^}]*position:\s*fixed[^}]*pointer-events:\s*none/);
    assert.ok(html.includes('id="floatingTotal"') && html.includes('id="floatingTotalAmount"'));
    assert.ok(!/\.live-control-panel\s*\{[^}]*position:\s*sticky/.test(html));
    assert.ok(!/topup-copy-btn|addr-copy-btn|buildTopupMessage|buildAddressRequestMessage|function copyText/.test(html), 'owner decision: no copy-message buttons anywhere');
});

test('static: both update windows keep inside the screen and their long lists scroll', () => {
    const block = (id) => { const a = html.indexOf(`id="${id}"`); assert.ok(a > 0, id); return html.slice(a, html.indexOf('<script>', a)); };
    const box = (b) => b.match(/<div class="modal-box" style="([^"]*)"/)[1];
    const ok = block('appUpdateSuccessModal');
    assert.match(box(ok), /max-height:\s*92vh/); assert.match(box(ok), /overflow-y:\s*auto/); assert.match(box(ok), /box-sizing:\s*border-box/, 'padding must not push the box past the screen');
    const list = ok.match(/<ul id="successModalChangelogList" style="([^"]*)"/)[1];
    assert.match(list, /max-height:\s*\d+vh/); assert.match(list, /overflow-y:\s*auto/);
    const before = html.slice(html.indexOf('id="appUpdateModal"'), html.indexOf('id="appUpdateSuccessModal"'));
    assert.match(box(before), /max-height:\s*92vh/); assert.match(box(before), /overflow-y:\s*auto/); assert.match(box(before), /box-sizing:\s*border-box/);
    const cl = before.match(/<div id="updateModalChangelogBox" style="([^"]*)"/)[1];
    assert.match(cl, /max-height:/); assert.match(cl, /overflow-y:\s*auto/);
});
