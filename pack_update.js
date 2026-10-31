const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const GITHUB_REPO = 'Napat-Newbie/AutoQueueforLive';

// ===== v1.0.19: ส่วนตรรกะที่เทสต์เข้าถึงได้ (ฉีดตัวโหลดได้ — tests/unit/pack-manifest.test.js) =====

// URL แบบ raw.githubusercontent ที่ commit A ถือไฟล์ zip — ตัวอัปเดตเดิม (ก่อน v1.0.10) บล็อก redirect
// ไป release-assets ได้ ทีมจึงใช้ raw URL เสมอ และเดิมต้องพิมพ์แก้ใน version.json เองหลัง commit A
function buildRawUrl(commitSha, version) {
    return `https://raw.githubusercontent.com/${GITHUB_REPO}/${commitSha}/releases/update_v${version}.zip`;
}

// แก้ downloadUrl ของ manifest เป็น raw URL ของ commit A — จะเขียนไฟล์ก็ต่อเมื่อดาวน์โหลดจริงแล้ว
// sha256 ตรงกับที่จดไว้เท่านั้น (ก่อนหน้านี้คนแกดาวน์โหลดมาเทียบเองด้วยมือ)
function rewriteManifest({ manifestPath, version, commitSha, download }) {
    try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.version !== version) {
            return { ok: false, message: `เวอร์ชันใน manifest (${manifest.version}) ไม่ตรงกับที่ขอ (${version}) — ห้ามแก้ไฟล์ผิดรุ่น` };
        }
        const url = buildRawUrl(commitSha, version);
        let bytes;
        try { bytes = download(url); }
        catch (e) { return { ok: false, message: `ดาวน์โหลด ${url} ไม่สำเร็จ: ${e.message} (commit A push แล้วหรือยัง?)` }; }
        if (!bytes || !bytes.length) return { ok: false, message: `ดาวน์โหลด ${url} ได้ไฟล์ว่าง (commit A push แล้วหรือยัง?)` };
        const sha = crypto.createHash('sha256').update(bytes).digest('hex');
        if (sha !== manifest.sha256) {
            return { ok: false, message: `sha256 ของไฟล์ที่โหลด (${sha.slice(0, 12)}…) ไม่ตรงกับ manifest (${String(manifest.sha256).slice(0, 12)}…) — ห้ามใช้ URL นี้` };
        }
        manifest.downloadUrl = url;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
        return { ok: true, message: url };
    } catch (e) { return { ok: false, message: e.message }; }
}

// ตัวโหลดจริง: curl.exe มากับ Windows 10+ (-f = โค้ด HTTP ผิดพลาดถือว่าล้ม ไม่เอา body 404 มาหลอก)
function downloadRawUrl(url) {
    return execSync(`curl -fsSL "${url}"`, { maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

// ===== ขั้นตอนแพ็คเดิม (ใช้ตอนตัด release เท่านั้น) =====

function usage() {
    console.log('วิธีใช้:');
    console.log('  แพ็ครุ่นใหม่:      node pack_update.js <เช่น 1.0.19> "รายการ 1; รายการ 2" [--publish]');
    console.log('  แก้ manifest หลัง commit A:  node pack_update.js rewrite-manifest <เวอร์ชัน> <commit-Sha ของ A>');
    console.log('     (จะดาวน์โหลดจริงมาเทียบ sha256 ให้ ผ่านจึงเขียน URL — แทนการพิมพ์แก้เองระหว่าง commit A กับ B)');
}

function runPack(targetVersion, rawChangelog, shouldPublish) {
    console.log(`📦 Packaging AutoQueueforLive Update v${targetVersion}...`);

    // 1. Update package.json version
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = targetVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
    console.log(`✅ Updated package.json version to ${targetVersion}`);

    // 2. Prepare staging directory
    const stagingDir = path.join(__dirname, 'releases', 'staging');
    const releasesDir = path.join(__dirname, 'releases');

    if (!fs.existsSync(releasesDir)) fs.mkdirSync(releasesDir, { recursive: true });
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    function copyFileSync(src, dest) {
        const targetDir = path.dirname(dest);
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(src, dest);
    }

    function copyFolderSync(from, to, excludes = []) {
        if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true });
        const entries = fs.readdirSync(from, { withFileTypes: true });
        for (let entry of entries) {
            if (excludes.includes(entry.name)) continue;
            const srcPath = path.join(from, entry.name);
            const destPath = path.join(to, entry.name);
            if (entry.isDirectory()) {
                copyFolderSync(srcPath, destPath, excludes);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }

    // Files to include
    // ⚠️ index.js ต้องใช้ keep_awake.js และโฟลเดอร์ sentinel/ ตอนเปิดโปรแกรม ถ้าไม่แนบไป เครื่องแม่ค้าจะเปิดโปรแกรมไม่ขึ้นหลังอัปเดต
    // ⚠️ v1.0.19: updater.bat ใหญ่ขึ้น (locale-safe backup name) — ตอนตรวจ zip ให้เทียบ "LF-only" ไม่ใช่ตัวเลขไบต์เดิม 2,168
    const filesToCopy = [
        'index.js',
        'db.js',
        'keep_awake.js',
        'package.json',
        'updater.bat',
        'run_background.bat',
        'AutoQueueforLive.vbs'
    ];

    filesToCopy.forEach(f => {
        const src = path.join(__dirname, f);
        if (fs.existsSync(src)) {
            copyFileSync(src, path.join(stagingDir, f));
        }
    });

    // Copy sentinel module (ไม่รวมไฟล์ข้อมูล runtime ของเครื่องผู้พัฒนา)
    if (fs.existsSync(path.join(__dirname, 'sentinel'))) {
        copyFolderSync(path.join(__dirname, 'sentinel'), path.join(stagingDir, 'sentinel'), ['proposals.json', 'README.md']);
    }

    // Copy public (exclude uploads, manual_images and developer telemetry to keep update tiny & private)
    copyFolderSync(path.join(__dirname, 'public'), path.join(stagingDir, 'public'), ['uploads', 'manual_images', 'agent_telemetry.json']);

    // Copy templates
    if (fs.existsSync(path.join(__dirname, 'templates'))) {
        copyFolderSync(path.join(__dirname, 'templates'), path.join(stagingDir, 'templates'));
    }

    // 3. Create zip file using PowerShell Compress-Archive
    const zipFileName = `update_v${targetVersion}.zip`;
    const zipFilePath = path.join(releasesDir, zipFileName);

    if (fs.existsSync(zipFilePath)) fs.unlinkSync(zipFilePath);

    console.log(`🗜️ Compressing files into ${zipFileName}...`);
    const psCommand = `powershell -NoProfile -Command "Compress-Archive -Path '${stagingDir}\\*' -DestinationPath '${zipFilePath}' -CompressionLevel Optimal"`;
    execSync(psCommand, { stdio: 'inherit' });

    // Get zip size
    const stats = fs.statSync(zipFilePath);
    const sizeKB = (stats.size / 1024).toFixed(1);
    // 🛡️ apply_update บนเครื่องแม่ค้าบังคับตรวจ SHA-256 ถ้า manifest ไม่มีค่านี้ จะติดตั้งอัปเดตไม่ได้
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(zipFilePath)).digest('hex');
    console.log(`🎉 Created ${zipFileName} (${sizeKB} KB)`);
    console.log(`🔐 SHA-256: ${sha256}`);

    // 4. Create version.json manifest (URL นี้คือค่าตั้งต้น — หลัง commit A ให้รัน `rewrite-manifest` ให้เป็น raw URL ที่ตรวจแล้ว)
    const manifest = {
        version: targetVersion,
        releaseDate: new Date().toISOString().split('T')[0],
        title: `AutoQueueforLive v${targetVersion}`,
        changelog: changelogList(rawChangelog),
        downloadUrl: `https://github.com/${GITHUB_REPO}/releases/download/v${targetVersion}/${zipFileName}`,
        fileSizeKB: parseFloat(sizeKB),
        sha256
    };

    const manifestPath = path.join(releasesDir, 'version.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`📄 Generated ${manifestPath}`);

    // Cleanup staging
    fs.rmSync(stagingDir, { recursive: true, force: true });

    console.log(`\n======================================================`);
    console.log(`🚀 Update Package Ready:`);
    console.log(`   - Archive: releases/${zipFileName} (${sizeKB} KB)`);
    console.log(`   - Manifest: releases/version.json`);
    console.log(`   - Direct Download: ${manifest.downloadUrl}`);
    console.log(`   - ขั้นถัดไป: commit A (zip+manifest) → push → node pack_update.js rewrite-manifest ${targetVersion} <Sha ของ A> → commit B`);
    console.log(`======================================================\n`);

    // 5. If --publish is specified, automatically publish to GitHub via GitHub CLI
    if (shouldPublish) {
        console.log(`🌐 Publishing release v${targetVersion} to GitHub (${GITHUB_REPO})...`);
        try {
            const ghExe = fs.existsSync('C:\\Program Files\\GitHub CLI\\gh.exe')
                ? 'C:\\Program Files\\GitHub CLI\\gh.exe'
                : 'gh';

            const notesFile = path.join(releasesDir, 'release_notes.txt');
            const notesText = `## 🚀 AutoQueueforLive v${targetVersion}\n\n### รายการที่ได้รับการปรับปรุง:\n` +
                changelogList(rawChangelog).map(c => `- ${c}`).join('\n');
            fs.writeFileSync(notesFile, notesText, 'utf8');

            const cmd = `"${ghExe}" release create v${targetVersion} "${zipFilePath}" "${manifestPath}" --repo ${GITHUB_REPO} --title "AutoQueueforLive v${targetVersion}" --notes-file "${notesFile}" --latest`;
            execSync(cmd, { stdio: 'inherit' });
            try { fs.unlinkSync(notesFile); } catch(e) {}

            console.log(`🎉 Release v${targetVersion} published successfully to GitHub!`);
            console.log(`👉 View: https://github.com/${GITHUB_REPO}/releases/tag/v${targetVersion}\n`);
        } catch (err) {
            // 🛡️ v1.0.19: เดิมแค่พิมพ์ error แล้วจบด้วยรหัส 0 (สำเร็จ) — CI/สคริปต์จึงไม่มีทางรู้ว่าล้ม
            console.error('❌ Failed to publish release to GitHub:', err.message);
            process.exit(1);
        }
    }
}

function changelogList(rawChangelog) {
    return String(rawChangelog).split(';').map(s => s.trim()).filter(Boolean);
}

function runRewriteManifest(version, commitSha) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) { console.error('❌ เวอร์ชันไม่ถูกต้อง'); process.exit(1); }
    if (!/^[0-9a-f]{7,40}$/i.test(commitSha)) { console.error('❌ commit SHA ไม่ถูกต้อง (ต้องเป็นเลขฐานสิบหก 7-40 ตัว)'); process.exit(1); }
    const manifestPath = path.join(__dirname, 'releases', 'version.json');
    console.log(`📝 ตรวจและแก้ manifest → raw URL ของ commit ${commitSha.slice(0, 10)}...`);
    const r = rewriteManifest({ manifestPath, version, commitSha, download: downloadRawUrl });
    if (!r.ok) { console.error('❌ ' + r.message); process.exit(1); }
    console.log(`✅ downloadUrl = ${r.message}`);
    console.log(`   (ดาวน์โหลดจริงมาเทียบ sha256 แล้วตรงกัน)`);
    console.log(`   ขั้นถัดไป: commit B → git tag v${version} <commit B> → gh release create v${version} "<zip>" "releases/version.json" --draft --verify-tag`);
}

// ===== CLI (โครงสร้างนี้ทำให้ require จากเทสต์ได้โดยไม่รันอะไร) =====
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args[0] === 'rewrite-manifest') {
        if (!args[1] || !args[2]) { usage(); process.exit(1); }
        runRewriteManifest(args[1], args[2]);
    } else {
        const targetVersion = args[0] && !args[0].startsWith('-') ? args[0] : null;
        if (!targetVersion || !/^\d+\.\d+\.\d+$/.test(targetVersion)) {
            // 🛡️ เดิมถ้าลืมใส่เวอร์ชันจะตั้งเป็น 1.0.1 อัตโนมัติ ทำให้ package.json ถอยเวอร์ชันโดยไม่ตั้งใจ
            console.error('❌ กรุณาระบุเวอร์ชันให้ชัดเจน เช่น: node pack_update.js 1.0.8 "รายการที่ 1; รายการที่ 2"');
            usage();
            process.exit(1);
        }
        const rawChangelog = args[1] && !args[1].startsWith('-')
            ? args[1]
            : '✨ ปรับปรุงแบบฟอร์ม Kerry Express (KEX) EasyShip สมบูรณ์แบบ 100%;⚡ ปรับปรุงระบบตรวจจับสลิปและสกัดที่อยู่ลูกค้าด้วย AI;🚀 เพิ่มระบบ Auto-Updater ตรวจสอบและอัปเดตเวอร์ชันได้ในคลิกเดียว;🛡️ ปรับปรุงความเสถียรและความปลอดภัยของฐานข้อมูลร้านค้า 100%';
        runPack(targetVersion, rawChangelog, args.includes('--publish') || args.includes('-p'));
    }
}

module.exports = { buildRawUrl, rewriteManifest, changelogList };
