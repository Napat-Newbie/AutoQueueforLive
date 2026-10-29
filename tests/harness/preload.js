// tests/harness/preload.js
// Loaded with `node -r` ONLY by the test sandbox (tests/harness/sandbox.js). Never loaded in production.
// Goal: run the REAL index.js with zero outside-world side effects:
//   * every axios call is redirected to the local mock universe (tests/harness/mock-universe.js)
//   * child processes (cloudflared, powershell keep-awake, cmd updater, `start http://...`) are inert
//   * the `localtunnel` module is replaced by a stub (it would open a real public tunnel)
'use strict';
const Module = require('module');
const cp = require('child_process');
const { EventEmitter } = require('events');

const MOCK_URL = process.env.AQ_TEST_MOCK_URL;
if (!MOCK_URL) throw new Error('AQ_TEST_MOCK_URL is required for the test preload');

// ---- inert child processes -------------------------------------------------------------
function fakeChild() {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.stdin = { write() {}, end() {} };
    c.pid = 0;
    c.kill = () => true;
    c.unref = () => {};
    return c;
}
const blocked = [];
function note(kind, cmd, args) {
    blocked.push(`${kind}: ${cmd} ${Array.isArray(args) ? args.join(' ') : ''}`.trim());
}
cp.spawn = (cmd, args) => { note('spawn', cmd, args); return fakeChild(); };
cp.exec = (cmd, ...rest) => {
    note('exec', cmd);
    const cb = rest.find(x => typeof x === 'function');
    if (cb) setImmediate(() => cb(null, '', ''));
    return fakeChild();
};
cp.execSync = (cmd) => { note('execSync', cmd); return Buffer.from(''); };
cp.execFile = (cmd, ...rest) => {
    note('execFile', cmd);
    const cb = rest.find(x => typeof x === 'function');
    if (cb) setImmediate(() => cb(null, '', ''));
    return fakeChild();
};
global.__AQ_BLOCKED_PROCESSES = blocked;

// ---- module hooks ----------------------------------------------------------------------
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'localtunnel') {
        // never open a real public tunnel from a test
        return async function localtunnelStub() { throw new Error('localtunnel disabled in test sandbox'); };
    }
    const mod = realLoad.apply(this, arguments);
    if (request === 'axios' && mod && mod.interceptors && !mod.__aqTestPatched) {
        mod.__aqTestPatched = true;
        mod.interceptors.request.use((cfg) => {
            const original = mod.getUri(cfg);               // absolute URL incl. query string
            cfg.headers.set('x-aq-orig-url', original);
            cfg.url = `${MOCK_URL}/__proxy`;
            cfg.baseURL = undefined;
            cfg.params = undefined;
            cfg.proxy = false;
            return cfg;
        });
    }
    return mod;
};
