// lib/updaterValidation.js
// v1.0.20 (P5: 1.6): ตัวตรวจความถูกต้องของการอัปเดตระบบ
'use strict';

const DEFAULT_MANIFEST_URL = 'https://github.com/Napat-Newbie/AutoQueueforLive/releases/latest/download/version.json';

function compareVersions(v1, v2) {
    const p1 = (v1 || '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
    const p2 = (v2 || '').replace(/[^0-9.]/g, '').split('.').map(n => parseInt(n) || 0);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const num1 = p1[i] || 0;
        const num2 = p2[i] || 0;
        if (num1 > num2) return 1;
        if (num1 < num2) return -1;
    }
    return 0;
}

function isUpdateUrlAllowed(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();

    // บังคับต้องเป็น HTTPS จากโดเมนทางการของ GitHub Repository เท่านั้น
    if (!trimmed.startsWith('https://')) return false;

    try {
        const parsed = new URL(trimmed);
        const hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname;

        // อนุญาตเฉพาะโดเมนทางการของ GitHub และต้องเป็น Repository AutoQueueforLive เท่านั้น
        const isOfficialGitHub = (
            (hostname === 'github.com' && pathname.startsWith('/Napat-Newbie/AutoQueueforLive/')) ||
            (hostname === 'raw.githubusercontent.com' && pathname.startsWith('/Napat-Newbie/AutoQueueforLive/')) ||
            (hostname === 'objects.githubusercontent.com' && pathname.includes('AutoQueueforLive')) ||
            // GitHub ย้ายไฟล์ release ไปโดเมนนี้ (ต.ค. 2026) อนุญาตเฉพาะไฟล์ของ repo นี้ (repo id 1419733580)
            (hostname === 'release-assets.githubusercontent.com' && pathname.startsWith('/github-production-release-asset/1419733580/'))
        );

        return isOfficialGitHub;
    } catch (e) {
        return false;
    }
}

function updaterEnv(env) {
    const out = Object.assign({}, env || {});
    delete out.AQ_SUPERVISED;
    delete out.AQ_RESTART_COUNT;
    return out;
}

module.exports = {
    compareVersions,
    DEFAULT_MANIFEST_URL,
    isUpdateUrlAllowed,
    updaterEnv
};
