const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GITHUB_REPO = 'Napat-Newbie/AutoQueueforLive';

// Usage: node pack_update.js [version] ["Changelog 1; Changelog 2; ..."] [--publish]
const targetVersion = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
if (!targetVersion || !/^\d+\.\d+\.\d+$/.test(targetVersion)) {
    // 🛡️ เดิมถ้าลืมใส่เวอร์ชันจะตั้งเป็น 1.0.1 อัตโนมัติ ทำให้ package.json ถอยเวอร์ชันโดยไม่ตั้งใจ
    console.error('❌ กรุณาระบุเวอร์ชันให้ชัดเจน เช่น: node pack_update.js 1.0.8 "รายการที่ 1; รายการที่ 2"');
    process.exit(1);
}
const rawChangelog = process.argv[3] && !process.argv[3].startsWith('-') 
    ? process.argv[3] 
    : '✨ ปรับปรุงแบบฟอร์ม Kerry Express (KEX) EasyShip สมบูรณ์แบบ 100%;⚡ ปรับปรุงระบบตรวจจับสลิปและสกัดที่อยู่ลูกค้าด้วย AI;🚀 เพิ่มระบบ Auto-Updater ตรวจสอบและอัปเดตเวอร์ชันได้ในคลิกเดียว;🛡️ ปรับปรุงความเสถียรและความปลอดภัยของฐานข้อมูลร้านค้า 100%';

const shouldPublish = process.argv.includes('--publish') || process.argv.includes('-p');
const changelogList = rawChangelog.split(';').map(s => s.trim()).filter(Boolean);

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
const sha256 = require('crypto').createHash('sha256').update(fs.readFileSync(zipFilePath)).digest('hex');
console.log(`🎉 Created ${zipFileName} (${sizeKB} KB)`);
console.log(`🔐 SHA-256: ${sha256}`);

// 4. Create version.json manifest
const manifest = {
    version: targetVersion,
    releaseDate: new Date().toISOString().split('T')[0],
    title: `AutoQueueforLive v${targetVersion}`,
    changelog: changelogList,
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
            changelogList.map(c => `- ${c}`).join('\n');
        fs.writeFileSync(notesFile, notesText, 'utf8');

        const cmd = `"${ghExe}" release create v${targetVersion} "${zipFilePath}" "${manifestPath}" --repo ${GITHUB_REPO} --title "AutoQueueforLive v${targetVersion}" --notes-file "${notesFile}" --latest`;
        execSync(cmd, { stdio: 'inherit' });
        try { fs.unlinkSync(notesFile); } catch(e) {}

        console.log(`🎉 Release v${targetVersion} published successfully to GitHub!`);
        console.log(`👉 View: https://github.com/${GITHUB_REPO}/releases/tag/v${targetVersion}\n`);
    } catch(err) {
        console.error('❌ Failed to publish release to GitHub:', err.message);
    }
}
