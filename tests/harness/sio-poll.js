// tests/harness/sio-poll.js
// Minimal Socket.IO v4 client over HTTP long-polling (no socket.io-client in node_modules).
// Collects every event the server emits to a browser so system tests can assert what the dashboard would be told.
'use strict';

async function connectEvents(base) {
    const events = [];
    let stopped = false;
    const ac = new AbortController();
    const q = `${base}/socket.io/?EIO=4&transport=polling`;

    const hs = await (await fetch(q)).text();
    const sid = JSON.parse(hs.slice(hs.indexOf('{'))).sid;
    const url = `${q}&sid=${sid}`;
    const post = (body) => fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain;charset=UTF-8' }, signal: ac.signal });
    await post('40');   // connect to the default namespace

    (async () => {
        while (!stopped) {
            try {
                const text = await (await fetch(url, { signal: ac.signal })).text();
                for (const p of text.split('\x1e')) {
                    if (p === '2') { await post('3'); continue; }   // ping -> pong
                    if (p.startsWith('42')) {
                        try { const [name, data] = JSON.parse(p.slice(2)); events.push({ name, data }); } catch (e) { /* ignore */ }
                    }
                }
            } catch (e) {
                if (stopped) return;
                await new Promise(r => setTimeout(r, 100));
            }
        }
    })();

    return {
        events,
        named: (name) => events.filter(e => e.name === name),
        close() { stopped = true; try { ac.abort(); } catch (e) { /* ignore */ } },
    };
}

module.exports = { connectEvents };
