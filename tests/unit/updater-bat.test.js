// tests/unit/updater-bat.test.js
// Review 2026-11-01 (owner: "แก้ต่อเลย"): updater.bat is the one file that OVERWRITES ITSELF while it runs. cmd.exe reads a
// .bat by byte offset, so after `xcopy` replaces updater.bat the RUNNING updater continues inside the NEW file at its old
// offset. Every shop since v1.0.10 runs the same updater (tests/fixtures/updater-v1.0.18.bat, git blob 238724f7, 2,168 B),
// which resumes at byte 1920 of whatever updater.bat the package carries. Found on a real Windows run:
//   - the v1.0.19 candidate (Thai comment + WMIC) made the old updater run "Applying update files" twice and print
//     "'4' is not recognized"; and once installed, on a UTF-8 console (chcp 65001) it did NOT apply the next update.
// Rules locked here: ASCII only, LF only, runs from a copy in %TEMP% (so it can never be cut by its own overwrite), a
// "legacy landing" exactly where the old updater resumes, no WMIC (removed from new Windows), lib/ backed up.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

const ROOT = process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..');
const NEW_BAT = fs.readFileSync(path.join(ROOT, 'updater.bat'));
const OLD_BAT = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'updater-v1.0.18.bat'));
const text = NEW_BAT.toString('latin1');

// where the old updater resumes: the byte right after its xcopy line
function oldResumeOffset() {
    const lines = OLD_BAT.toString('latin1').split('\n');
    let off = 0;
    for (const l of lines) {
        off += Buffer.byteLength(l, 'latin1') + 1;
        if (/^xcopy \/y \/e \/s \/i \/q /.test(l)) return off;
    }
    throw new Error('xcopy line not found in the fixture');
}

test('fixture is the exact updater every shop runs (v1.0.10 - v1.0.18)', () => {
    assert.equal(OLD_BAT.length, 2168);
    assert.equal(oldResumeOffset(), 1920);
});

test('updater.bat is ASCII only and LF only (any console code page, byte offsets stable)', () => {
    const bad = [...NEW_BAT].findIndex(b => b > 127);
    assert.equal(bad, -1, `non-ASCII byte at offset ${bad}`);
    assert.ok(!NEW_BAT.includes(13), 'CR found: the file must stay LF (see .gitattributes)');
});

test('an OLD updater that has just overwritten itself lands on a clean line that only cleans up and restarts', () => {
    const off = oldResumeOffset();
    assert.ok(NEW_BAT.length > off, 'the new updater must be longer than the landing offset');
    assert.equal(NEW_BAT[off - 1], 10, 'the byte before the landing must be a line end');
    const rest = text.slice(off);
    assert.match(rest, /^rem ===== LEGACY LANDING/, 'landing marker must start exactly at the resume offset');
    const landing = rest.slice(0, rest.indexOf('\n:main'));
    assert.match(landing, /start "" wscript\.exe "AutoQueueforLive\.vbs"/, 'landing restarts the program');
    assert.match(landing, /\nexit\b/, 'landing ends with exit');
    assert.doesNotMatch(landing, /xcopy|Expand-Archive|taskkill/, 'landing must not copy, extract or kill again');
    const gotoAt = text.indexOf('goto :main');
    assert.ok(gotoAt > 0 && gotoAt < off, 'normal runs jump over the landing');
    assert.ok(text.indexOf('\n:main') > off, ':main comes after the landing');
});

test('runs from a copy in %TEMP%, no WMIC, backs up lib/, keeps the merchant-data protection', () => {
    assert.match(text, /--from-temp/);
    assert.match(text, /%TEMP%\\aq_updater_run\.bat/);
    assert.doesNotMatch(text, /wmic/i, 'WMIC is removed from new Windows builds');
    assert.match(text, /Get-Date -Format yyyyMMdd_HHmmss/);
    assert.match(text, /xcopy \/y \/e \/i \/q lib "%BACKUP_DIR%\\lib"/);
    for (const p of ['data.sqlite', 'data.sqlite-shm', 'data.sqlite-wal', '.env']) assert.ok(text.includes(`del /f /q "%EXTRACT_DIR%\\${p}"`), p);
    assert.ok(text.includes('rmdir /s /q "%EXTRACT_DIR%\\public\\uploads"'));
});

// ---------- real cmd.exe runs (Windows only; CI on Linux skips) ----------
const onWindows = process.platform === 'win32';
function binNodeRunning() {
    try { return /bin_node\.exe/i.test(execSync('tasklist /FI "IMAGENAME eq bin_node.exe"', { encoding: 'latin1' })); } catch (e) { return false; }
}
function scenario(installedBat, codePage) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-upd-'));
    const app = path.join(dir, 'app'), pkg = path.join(dir, 'pkg');
    const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
    w(path.join(app, 'updater.bat'), installedBat);
    w(path.join(app, 'index.js'), '// old index');
    w(path.join(app, 'lib', 'address.js'), '// old lib');
    w(path.join(app, 'data.sqlite'), 'SHOP DATA');
    w(path.join(app, '.env'), 'PORT=3000');
    w(path.join(app, 'AutoQueueforLive.vbs'), 'CreateObject("Scripting.FileSystemObject").CreateTextFile("restarted.marker").Close');
    fs.mkdirSync(path.join(app, 'updates'));
    w(path.join(pkg, 'updater.bat'), NEW_BAT);
    w(path.join(pkg, 'index.js'), '// NEW index');
    w(path.join(pkg, 'lib', 'address.js'), '// NEW lib');
    w(path.join(pkg, 'public', 'index.html'), '<html>NEW</html>');
    w(path.join(pkg, 'data.sqlite'), 'EVIL OVERWRITE');
    w(path.join(pkg, '.env'), 'PORT=EVIL');
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${pkg}\\*' -DestinationPath '${path.join(app, 'updates', 'update_incoming.zip')}'"`);
    const r = spawnSync('cmd.exe', ['/d', '/c', `chcp ${codePage} >nul & updater.bat 999999`], {
        cwd: app, encoding: 'latin1', timeout: 120000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { TEMP: dir, TMP: dir }),
    });
    const out = (r.stdout || '') + (r.stderr || '');
    const deadline = Date.now() + 8000;
    while (!fs.existsSync(path.join(app, 'restarted.marker')) && Date.now() < deadline) execSync('ping -n 2 127.0.0.1 >nul');
    const read = (p) => { try { return fs.readFileSync(path.join(app, p), 'utf8'); } catch (e) { return null; } };
    const backups = fs.existsSync(path.join(app, 'backups')) ? fs.readdirSync(path.join(app, 'backups')) : [];
    const result = {
        out, backups,
        restarted: fs.existsSync(path.join(app, 'restarted.marker')),
        index: read('index.js'), lib: read('lib/address.js'), html: read('public/index.html'),
        data: read('data.sqlite'), env: read('.env'),
        updaterIsNew: Buffer.compare(fs.readFileSync(path.join(app, 'updater.bat')), NEW_BAT) === 0,
        cleaned: !fs.existsSync(path.join(app, 'updates', 'update_incoming.zip')) && !fs.existsSync(path.join(app, 'updates', 'extracted')),
        backupLib: backups.some(b => fs.existsSync(path.join(app, 'backups', b, 'lib', 'address.js'))),
    };
    fs.rmSync(dir, { recursive: true, force: true });
    return result;
}
function assertApplied(r, label) {
    assert.ok(r.restarted, `${label}: program not restarted`);
    assert.equal(r.index, '// NEW index', `${label}: index.js not updated`);
    assert.equal(r.lib, '// NEW lib', `${label}: lib/ not updated`);
    assert.equal(r.html, '<html>NEW</html>', `${label}: public/ not updated`);
    assert.equal(r.data, 'SHOP DATA', `${label}: shop database touched`);
    assert.equal(r.env, 'PORT=3000', `${label}: .env touched`);
    assert.ok(r.updaterIsNew, `${label}: updater.bat not replaced`);
    assert.ok(r.cleaned, `${label}: update files left behind`);
    assert.doesNotMatch(r.out, /is not recognized|syntax of the command is incorrect|cyclic copy|Expand-Archive :/i, `${label}: cmd errors:\n${r.out}`);
    assert.equal((r.out.match(/Applying update files/g) || []).length, 1, `${label}: the copy step ran more than once:\n${r.out}`);
}

for (const cp of ['874', '437', '65001']) {
    test(`real cmd (chcp ${cp}): the updater every shop runs today applies a package carrying this updater.bat`, { skip: !onWindows && 'Windows only' }, (t) => {
        if (binNodeRunning()) return t.skip('bin_node.exe is running (the updater would kill it)');
        assertApplied(scenario(OLD_BAT, cp), `old->new cp${cp}`);
    });
    test(`real cmd (chcp ${cp}): this updater.bat applies the NEXT update (installed new -> new package)`, { skip: !onWindows && 'Windows only' }, (t) => {
        if (binNodeRunning()) return t.skip('bin_node.exe is running (the updater would kill it)');
        const r = scenario(NEW_BAT, cp);
        assertApplied(r, `new->new cp${cp}`);
        assert.ok(r.backups.some(b => /^auto_backup_\d{8}_\d{6}$/.test(b)), `backup folder name not locale-independent: ${r.backups}`);
        assert.ok(r.backupLib, 'lib/ was not backed up');
    });
}
