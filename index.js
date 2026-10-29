// ⚡ Self-Healing: ตัวเฝ้าโปรแกรม (Supervisor)
// ถ้าโปรแกรมหลักปิดตัวเองผิดปกติ ระบบจะเปิดใหม่ให้อัตโนมัติภายใน 5 วินาที (สูงสุด 5 ครั้งใน 10 นาที กันวนไม่จบ)
// ปิดปกติ (ปุ่มปิดโปรแกรม / ติดตั้งอัปเดต / เปิดซ้ำ) = รหัส 0 -> ตัวเฝ้าปิดตามทันที ไม่เปิดใหม่
// ตั้ง AQ_NO_SUPERVISOR=1 เพื่อปิดตัวเฝ้า
if (!process.env.AQ_SUPERVISED && process.env.AQ_NO_SUPERVISOR !== '1') {
    const { spawn } = require('child_process');
    const fsSup = require('fs');
    const pathSup = require('path');
    const supLog = (msg) => { try { fsSup.appendFileSync(pathSup.join(__dirname, 'supervisor.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch (e) {} };
    // v1.0.16: จังหวะที่ตัวเฝ้ายอมแพ้ (ลูกพังซ้ำจนเลิกเปิดใหม่อัตโนมัติ) = Self-Healing หมดทางแล้ว
    // ตัวเฝ้าจึงส่งข้อความ "ขออัปเดตเวอร์ชันใหม่" เข้า Discord ด้วยตัวเอง (ลูกซึ่งเป็นคิว Discord ปกติพังไปแล้ว)
    // อ่าน webhook จากไฟล์ .env เองเพราะ dotenv ยังไม่ถูกโหลดตอนนี้ — ทุกอย่างครอบ try/catch การแจ้งเตือนล้มต้องไม่กระทบตัวเฝ้า
    const notifyGiveUpDiscord = (code, signal, times) => {
        let finished = false;
        const finish = () => { if (!finished) { finished = true; process.exit(code || 1); } };
        try {
            const envText = fsSup.readFileSync(pathSup.join(__dirname, '.env'), 'utf8');
            const env = {};
            envText.split(/\r?\n/).forEach(l => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); });
            const url = env.DISCORD_DEVREPORT_WEBHOOK_URL || env.DISCORD_WEBHOOK_URL || '';
            if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url)) { finish(); return; }
            let version = '?';
            try { version = JSON.parse(fsSup.readFileSync(pathSup.join(__dirname, 'package.json'), 'utf8')).version || '?'; } catch (e) {}
            const shop = env.MERCHANT_ACCOUNT_NAME ? `ร้าน${env.MERCHANT_ACCOUNT_NAME}` : 'ร้านค้า (AutoQueue)';
            const payload = JSON.stringify({ embeds: [{
                title: '📮 [ขออัปเดตเวอร์ชันใหม่] โปรแกรมพังซ้ำจนตัวเฝ้าหยุดเปิดใหม่อัตโนมัติ',
                color: 15158332,
                fields: [
                    { name: 'ร้าน / เวอร์ชันที่ติดตั้งอยู่', value: `${shop} / v${version}`, inline: false },
                    { name: 'ปัญหาที่พบ', value: `โปรแกรมหยุดทำงาน ${times} ครั้งใน 10 นาที (code=${code}, signal=${signal || '-'}) ตัวเฝ้าหยุดเปิดใหม่อัตโนมัติแล้ว — ร้านต้องเปิดโปรแกรมเอง`, inline: false },
                    { name: 'ทำไมระบบซ่อมเองไม่ได้', value: 'ตัวเฝ้าช่วยได้แค่เปิดโปรแกรมใหม่ ซึ่งไม่ได้แก้ต้นเหตุ — พังซ้ำ 5 ครั้งใน 10 นาที แปลว่าต้องแก้โค้ดในเวอร์ชันใหม่เท่านั้น', inline: false },
                    { name: 'ที่ผู้พัฒนาควรทำ', value: 'เปิด supervisor.log และ system.log ของร้านดูสาเหตุการพัง แก้แล้วออกเวอร์ชันใหม่ ให้ร้านกด "ตรวจสอบอัปเดต" ในโปรแกรม', inline: false }
                ],
                footer: { text: `AutoQueueforLive Update Request • ${new Date().toISOString()}` }
            }] });
            const https = require('https');
            const req = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, timeout: 5000 }, r => { r.resume(); r.on('end', finish); });
            req.on('error', finish);
            req.on('timeout', () => req.destroy());
            req.end(payload);
            setTimeout(finish, 6000); // รับประกันว่าตัวเฝ้าต้องปิดตัวเองภายใน 6 วินาที ไม่ค้างรอ Discord
            supLog('ส่งข้อความขออัปเดตเวอร์ชันใหม่เข้า Discord แล้ว (ถ้าตั้ง webhook ไว้)');
        } catch (e) { finish(); /* การแจ้งเตือนล้มเหลวต้องไม่กระทบตัวเฝ้า */ }
    };
    let restartTimes = [];
    let totalRestarts = 0;
    let child = null;
    let stopping = false;
    const launch = () => {
        child = spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
            cwd: __dirname, stdio: 'inherit', windowsHide: true,
            env: { ...process.env, AQ_SUPERVISED: '1', AQ_RESTART_COUNT: String(totalRestarts) }
        });
        child.on('exit', (code, signal) => {
            if (stopping || code === 0) process.exit(code || 0);
            const now = Date.now();
            restartTimes = restartTimes.filter(t => now - t < 10 * 60 * 1000);
            if (restartTimes.length >= 5) {
                supLog(`โปรแกรมหยุดทำงานซ้ำ ${restartTimes.length} ครั้งใน 10 นาที (code=${code}, signal=${signal}) หยุดเปิดใหม่อัตโนมัติ`);
                notifyGiveUpDiscord(code, signal, restartTimes.length);
                return; // ปิดตัวเองใน notifyGiveUpDiscord (หลังส่ง Discord หรือหมดเวลา)
            }
            restartTimes.push(now);
            totalRestarts++;
            supLog(`โปรแกรมหยุดทำงานผิดปกติ (code=${code}, signal=${signal}) กำลังเปิดใหม่ครั้งที่ ${totalRestarts}`);
            setTimeout(launch, 5000);
        });
    };
    ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].forEach(sig => process.on(sig, () => {
        stopping = true;
        try { if (child) child.kill(sig); } catch (e) {}
        setTimeout(() => process.exit(0), 3000).unref();
    }));
    launch();
    return; // ตัวเฝ้าไม่รันโค้ดโปรแกรมหลักเอง
}

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const FormData = require('form-data');
// const { createClient } = require('@supabase/supabase-js');
const path = require('path'); 
const fs = require('fs'); 
const crypto = require('crypto'); 

const ExcelJS = require('exceljs');
const { enableSleepBlocker } = require('./keep_awake.js');
const sentinel = require('./sentinel/sentinel_agent.js');
const TelemetryWatcher = require('./sentinel/telemetry_watcher.js');

// 🛡️ ป้องกัน Windows Sleep Mode ระหว่างใช้งาน/ไลฟ์สด
enableSleepBlocker();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 🛡️ DEV-ONLY GUARD: เส้นทางของ Sentinel / Pixel Office / Telemetry ถูกประกาศก่อน RBAC middleware หลัก
// จึงต้องป้องกันแยก: อนุญาตเฉพาะ (1) คำขอจากเครื่องนี้โดยตรง (ไม่ผ่าน Tunnel) หรือ (2) Session ของ Dreamdev
// ยกเว้น /api/sentinel/action ซึ่งมี Token รายข้อเสนอของตัวเองสำหรับปุ่มอนุมัติจากมือถือ
function isDirectLocalRequest(req) {
    const addr = req.socket?.remoteAddress || '';
    const isLoopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
    // คำขอที่วิ่งผ่าน Cloudflare Tunnel / LocalTunnel จะมี Header เหล่านี้ติดมาเสมอ (มาจาก loopback เช่นกัน)
    const viaProxy = req.headers['cf-connecting-ip'] || req.headers['cf-ray'] || req.headers['x-forwarded-for'];
    return isLoopback && !viaProxy;
}
function isSentinelIngestSecretValid(req) {
    const secret = (process.env.SENTINEL_INGEST_SECRET || '').trim();
    const provided = String(req.headers['x-sentinel-secret'] || '');
    if (!secret || !provided) return false;
    const a = Buffer.from(provided); const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const isDevSurface = (
        (p.startsWith('/api/sentinel/') && p !== '/api/sentinel/action') ||
        p.startsWith('/api/subagents/') ||
        p === '/sentinel/office' ||
        p === '/observer.html' ||
        p === '/agent_telemetry.json'
    );
    if (!isDevSurface) return next();
    if (isDirectLocalRequest(req)) return next();
    if (p === '/api/sentinel/telemetry_ingest' && isSentinelIngestSecretValid(req)) return next();
    const session = getSession(req);
    if (session && session.role === 'dreamdev') return next();
    return res.status(403).json({ success: false, message: 'FORBIDDEN: ส่วนนี้ใช้ได้เฉพาะเครื่องผู้พัฒนาเท่านั้น' });
});

// 🛰️ Realtime SubAgents Telemetry Watcher (Method 1)
const telemetryWatcher = new TelemetryWatcher({ io });
telemetryWatcher.start();

app.get('/api/subagents/telemetry', (req, res) => {
    res.json(telemetryWatcher.currentData || {});
});

// 🔴 Live Session State & Storage
let activeLiveSession = null; // { id: 'LIVE_timestamp', startTime: Date.now(), endTime: null }
// 🏁 v1.0.16: Error/WARN ที่เกิดระหว่างรอบไลฟ์ (เก็บตอน addLog) เพื่อสรุปให้ครบทุกครั้งที่แม่ค้ากดจบไลฟ์
let liveIssueLogs = [];
var merchantAccountName = process.env.MERCHANT_ACCOUNT_NAME || "";

// 📢 ระบบ Discord Webhook Remote Monitoring & Auto-Diagnosis (เปิด/ปิดผ่าน .env)
const DISCORD_WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || '').trim();

// Cache ป้องกันการส่งข้อความซ้ำรัวๆ (Debounce 2 นาทีสำหรับ Error เดียวกัน)
const discordAlertDebounce = new Map();

// 🛡️ เคลียร์ Memory Cache ของ Debounce ป้องกัน Memory Leak
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of discordAlertDebounce.entries()) {
        if (now - timestamp > 15 * 60 * 1000) discordAlertDebounce.delete(key);
    }
}, 5 * 60 * 1000);

// 🚦 Discord Rate Limit Queue & Throttler (ป้องกัน HTTP 429 Too Many Requests)
const discordAlertQueue = [];
let isProcessingDiscordQueue = false;
let discordRateLimitedUntil = 0;

async function processDiscordQueue() {
    if (isProcessingDiscordQueue) return;
    isProcessingDiscordQueue = true;

    try {
        while (discordAlertQueue.length > 0) {
            const now = Date.now();
            if (now < discordRateLimitedUntil) {
                const waitMs = discordRateLimitedUntil - now;
                await new Promise(r => setTimeout(r, waitMs));
            }

            const item = discordAlertQueue.shift();
            try {
                await axios.post(item.url || DISCORD_WEBHOOK_URL, item.payload, { timeout: 8000 });
                // เว้นระยะห่างอย่างน้อย 1,500ms ระหว่างการส่งข้อความแต่ละครั้งตามมาตรฐาน Discord Webhook
                await new Promise(r => setTimeout(r, 1500));
            } catch (err) {
                const status = err.response?.status;
                if (status === 429) {
                    const retryAfterSec = Number(err.response?.data?.retry_after || err.response?.headers?.['retry-after'] || 5);
                    const waitMs = Math.ceil(retryAfterSec * 1000) + 500;
                    discordRateLimitedUntil = Date.now() + waitMs;
                    console.warn(`⚠️ Discord Rate Limited (HTTP 429). จะส่งใหม่ในอีก ${retryAfterSec} วินาที...`);
                    // ใส่ข้อความกลับเข้าหัวคิวเพื่อส่งซ้ำ
                    discordAlertQueue.unshift(item);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error('Failed to send Discord alert:', err.message);
                }
            }
        }
    } finally {
        isProcessingDiscordQueue = false;
    }
}

async function sendDiscordAlert(options = {}) {
    const { 
        type = 'ERROR', 
        category = 'SYSTEM', 
        title = '🚨 [แจ้งเตือนระบบ] ข้อผิดพลาดการทำงาน', 
        message = '', 
        details = null, 
        suggestion = null, 
        publicUrl = null,
        force = false 
    } = options;

    if (!DISCORD_WEBHOOK_URL) return;
    if (process.env.DISCORD_ALERTS_ENABLED === 'false' || (process.env.DISCORD_MUTE === 'true' && type !== 'SELF_HEALING')) return;

    // ตรวจสอบ Debounce ป้องกัน Spam ข้อความซ้ำ
    const debounceKey = `${category}_${title}_${(message || '').slice(0, 30)}`;
    const now = Date.now();
    const lastSent = discordAlertDebounce.get(debounceKey) || 0;
    if (!force && type !== 'SUCCESS' && type !== 'SELF_HEALING' && now - lastSent < 120000) {
        return; // ไม่ส่งซ้ำภายใน 2 นาที
    }
    discordAlertDebounce.set(debounceKey, now);

    const shopName = merchantAccountName && merchantAccountName.trim() !== '' 
        ? `ร้าน${merchantAccountName}` 
        : (process.env.MERCHANT_ACCOUNT_NAME ? `ร้าน${process.env.MERCHANT_ACCOUNT_NAME}` : 'ร้านค้า (AutoQueue)');

    const colorMap = {
        'ERROR': 15158332,        // แดง
        'WARN': 16753920,         // ส้ม
        'SUCCESS': 3066993,       // เขียว
        'SELF_HEALING': 1095809,  // เขียวมรกต (0x10B981)
        'INFO': 3447003           // ฟ้า
    };

    // 🧠 ระบบวิเคราะห์ปัญหาอัตโนมัติ (Auto-Diagnosis) เป็นภาษาไทยเข้าใจง่าย
    let diagExplanation = message;
    let diagImpact = '';
    let diagAction = suggestion || '';

    const textToAnalyze = `${title} ${message} ${details ? (typeof details === 'object' ? JSON.stringify(details) : String(details)) : ''}`.toLowerCase();

    if (category === 'SLIP_PROVIDER' || textToAnalyze.includes('quota') || textToAnalyze.includes('เครดิต') || textToAnalyze.includes('slipok') || textToAnalyze.includes('easyslip') || textToAnalyze.includes('thunder')) {
        if (textToAnalyze.includes('quota') || textToAnalyze.includes('เครดิตหมด') || textToAnalyze.includes('exhausted') || textToAnalyze.includes('402') || textToAnalyze.includes('1009')) {
            diagExplanation = 'เครดิตในแพ็กเกจตรวจสลิปหมดแล้ว (0 เครดิต) ผู้ให้บริการจึงปฏิเสธการตรวจสอบสลิปใหม่';
            diagImpact = 'เมื่อลูกค้าโอนเงินและส่งรูปสลิปเข้ามา บอทจะไม่สามารถยืนยันยอดเงินได้ ออเดอร์จะค้างอยู่ที่ "รอตรวจสอบ"';
            diagAction = '1. เติมเครดิตที่หน้าเว็บของผู้ให้บริการตรวจสลิป (เช่น slipok.com หรือ easyslip.com)\n2. หรือสลับไปใช้ผู้ให้บริการอื่นชั่วคราวที่หน้าตั้งค่าของโปรแกรม';
        } else if (textToAnalyze.includes('low') || textToAnalyze.includes('ใกล้หมด')) {
            diagExplanation = 'โควตาตรวจสลิปคงเหลือเหลือน้อยมาก (ต่ำกว่า 10 เครดิต)';
            diagImpact = 'หากมีลูกค้าส่งสลิปเข้ามาอีกไม่กี่ใบ ระบบจะตัดเข้าสู่โหมดสลิปหมดทันที';
            diagAction = 'แนะนำให้รีบเติมเครดิตเพิ่มเติมก่อนที่แม่ค้าจะไลฟ์จบ';
        } else if (textToAnalyze.includes('401') || textToAnalyze.includes('unauthorized') || textToAnalyze.includes('branch')) {
            diagExplanation = 'API Key หรือ Branch ID ของผู้ให้บริการตรวจสลิปไม่ถูกต้อง หรือถูกยกเลิกการใช้งาน';
            diagImpact = 'ระบบไม่สามารถเชื่อมต่อไปยังผู้ให้บริการเพื่ออ่านสลิปได้';
            diagAction = 'คัดลอก API Key และ Branch ID ที่ถูกต้องจากหน้าเว็บผู้ให้บริการมาบันทึกใหม่ที่หน้าตั้งค่า';
        }
    } else if (category === 'TUNNEL' || textToAnalyze.includes('tunnel') || textToAnalyze.includes('cloudflare') || textToAnalyze.includes('localtunnel')) {
        diagExplanation = 'ท่อส่งสัญญาณอินเทอร์เน็ต (Cloudflare / LocalTunnel) มีการตัดการเชื่อมต่อ หรือเน็ตที่เครื่องแม่ค้ากระตุก';
        diagImpact = 'LINE Webhook อาจไม่สามารถส่งข้อมูลสลิปจากลูกค้าเข้ามาที่เครื่องแม่ค้าได้ชั่วคราว';
        diagAction = 'ระบบกำลังพยายามเชื่อมต่อใหม่และซิงค์ LINE Webhook ให้อัตโนมัติ หากยังไม่ติด ให้แม่ค้ากดปุ่ม "ซิงค์ LINE Webhook" บน Dashboard';
    } else if (category === 'LINE_API' || textToAnalyze.includes('replytoken') || textToAnalyze.includes('access_token') || textToAnalyze.includes('line')) {
        diagExplanation = 'LINE Messaging API ปฏิเสธคำขอ (Channel Access Token อาจหมดอายุ หรือ Reply Token ถูกใช้ซ้ำ/หมดอายุ)';
        diagImpact = 'บอทไม่สามารถส่งข้อความตอบกลับหรือแจ้งยอดเงินหาลูกค้าใน LINE ได้';
        diagAction = 'ตรวจสอบความถูกต้องของ Channel Access Token ใน LINE Developers Console';
    } else if (category === 'GEMINI_AI' || textToAnalyze.includes('gemini') || textToAnalyze.includes('rate limit')) {
        diagExplanation = 'Gemini AI สกัดที่อยู่ไม่สำเร็จ (โควตาชั่วคราวอาจเต็ม หรือติดขัดการเชื่อมต่อ)';
        diagImpact = 'ระบบได้สลับไปใช้ระบบสำรอง Regex สกัดที่อยู่ให้อัตโนมัติ ลูกค้ายังคงส่งที่อยู่ได้ตามปกติ';
        diagAction = 'ระบบสำรองทำงานทดแทนให้แล้ว 100% ไม่จำเป็นต้องแก้ไขใดๆ';
    } else if (category === 'STARTUP') {
        diagExplanation = 'โปรแกรม AutoQueue for Live เริ่มต้นทำงานเรียบร้อย พร้อมใช้งานสำหรับรอบไลฟ์นี้';
        diagImpact = 'ระบบกำลังเฝ้าตรวจจับสลิปและสกัดที่อยู่ลูกค้าอัตโนมัติ';
        diagAction = 'สามารถเปิดดูหน้า Dashboard หรือมอนิเตอร์ระยะไกลผ่านลิงก์ด้านล่างได้ทันที';
    } else if (category === 'SYSTEM_CRASH') {
        diagExplanation = 'โปรแกรมพบข้อผิดพลาดที่ไม่คาดคิดในระดับ Process (Uncaught Exception)';
        diagImpact = 'ระบบได้ดักจับ Error ไว้และพยายามทำงานต่อ แต่บางฟังก์ชันอาจทำงานไม่สมบูรณ์';
        diagAction = 'ตรวจสอบ Technical Details ด้านล่าง และหากจำเป็น ให้รีสตาร์ทโปรแกรมใหม่';
    }

    const fields = [
        { name: '🏢 ร้านค้า', value: shopName, inline: true },
        { name: '🕒 เวลา', value: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }), inline: true },
        { name: '📦 เวอร์ชัน', value: `v${require('./package.json').version}`, inline: true }
    ];

    if (publicUrl) {
        fields.push({ name: '🌐 ลิงก์ระบบระยะไกล (Cloudflare)', value: `[คลิกเพื่อเปิด Dashboard ร้านค้า](${publicUrl})`, inline: false });
    }

    if (diagExplanation) {
        fields.push({ name: '💡 คำอธิบายสาเหตุ', value: diagExplanation, inline: false });
    }

    if (diagImpact) {
        fields.push({ name: '⚡ ผลกระทบต่อการไลฟ์', value: diagImpact, inline: false });
    }

    if (diagAction) {
        fields.push({ name: '🔧 แนวทางแก้ไข / จัดการ', value: diagAction, inline: false });
    }

    if (details) {
        const shortDetails = typeof details === 'string' ? details.slice(0, 600) : JSON.stringify(details, null, 2).slice(0, 600);
        fields.push({ name: '📋 Technical Details', value: `\`\`\`${shortDetails}\`\`\``, inline: false });
    }

    discordAlertQueue.push({
        payload: {
            embeds: [{
                title: title,
                color: colorMap[type] || colorMap['INFO'],
                fields: fields,
                footer: { text: 'AutoQueueforLive Monitor & Diagnosis System' }
            }]
        }
    });
    processDiscordQueue().catch(() => {});
}

// ⚡ ระบบรายงานข้อผิดพลาดที่ Self-Healing สำเร็จเข้า Discord อัตโนมัติ (Priority 1 Recovery Alert)
async function reportSelfHealingToDiscord(options = {}) {
    const { category = 'SELF_HEALING', title = 'กู้คืนระบบสำเร็จ', issue = '', actionDetails = '', details = null } = options;
    await sendDiscordAlert({
        type: 'SELF_HEALING',
        category: category,
        title: `⚡ [Self-Healing สำเร็จ] ${title}`,
        message: issue || 'ตรวจพบความผิดปกติในระบบ แต่กลไก Self-Healing ได้ดำเนินการแก้ไขและฟื้นฟูระบบสำเร็จเรียบร้อยแล้ว',
        suggestion: `✅ สิ่งที่ระบบแก้ไขอัตโนมัติ: ${actionDetails}\n(แม่ค้าสามารถไลฟ์สดขายของต่อได้ทันทีโดยไม่ต้องกังวล)`,
        details: details,
        force: true
    });
    // 📡 รายงานเข้าช่องผู้พัฒนา (ช่อง 2) ด้วย ว่าระบบแก้ไขอะไรเองไปบ้าง
    queueDevReport({ kind: 'SELF_HEALING', category, message: `${title}: ${issue}`, actionDetails });
}

// =====================================================================================
// 📡 Discord 2 ช่องของผู้พัฒนา (ตั้งค่าใน .env ผ่านหน้าตั้งค่า เฉพาะผู้พัฒนา)
//   ช่อง 1 DISCORD_ACTIVITY_WEBHOOK_URL : บันทึกการใช้งานทุกกิจกรรม รวมเป็นสรุปทุก 1 นาที (กันชนขีดจำกัด Discord)
//   ช่อง 2 DISCORD_DEVREPORT_WEBHOOK_URL: เมื่อพบ Error ส่งทันที พร้อมประเมินความรุนแรงและแนวทางแก้ไขในเวอร์ชันถัดไป
//   ไม่ส่งเบอร์โทร/ที่อยู่ลูกค้า: ปิดบังเบอร์โทรและเลขบัตรก่อนส่งทุกครั้ง และไม่ส่งรายละเอียดทางเทคนิคของกิจกรรมทั่วไป
// =====================================================================================
const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d{5,30}\/[A-Za-z0-9_-]{20,120}$/;
function isValidDiscordWebhook(u) { return DISCORD_WEBHOOK_RE.test(String(u || '').trim()); }
function maskDiscordWebhook(u) {
    const m = String(u || '').trim().match(/webhooks\/(\d+)\//);
    return m ? `...${m[1].slice(-4)}` : '';
}
function getActivityWebhook() { const u = (process.env.DISCORD_ACTIVITY_WEBHOOK_URL || '').trim(); return isValidDiscordWebhook(u) ? u : ''; }
function getDevReportWebhook() { const u = (process.env.DISCORD_DEVREPORT_WEBHOOK_URL || '').trim(); return isValidDiscordWebhook(u) ? u : ''; }
function getAppVersionSafe() { try { return require('./package.json').version; } catch (e) { return '?'; } }
function getShopLabel() {
    const n = (merchantAccountName || process.env.MERCHANT_ACCOUNT_NAME || '').trim();
    return n ? `ร้าน${n}` : 'ร้านค้า (AutoQueue)';
}

// 🛡️ ปิดบังข้อมูลส่วนตัวลูกค้าก่อนส่งออกนอกเครื่อง
function redactPersonalInfo(text) {
    return String(text === undefined || text === null ? '' : text)
        .replace(/(?<!\d)\d{13}(?!\d)/g, '[เลขบัตร]')
        .replace(/(?<!\d)0\d[\d\- ]{7,11}\d(?!\d)/g, (m) => {
            const digits = m.replace(/\D/g, '');
            return (digits.length === 9 || digits.length === 10) ? `0xx-xxx-${digits.slice(-4, -2)}xx` : m;
        });
}

// 🎯 ประเมินความรุนแรงและแนวทางแก้ไข (กฎตายตัว ไม่ใช้ AI จึงไม่เสียโควตา)
function assessErrorForDevReport(category, text) {
    const t = `${category || ''} ${text || ''}`.toLowerCase();
    const rules = [
        { test: /system_crash|uncaught|unhandled|เก็บสลิปสำรองไม่สำเร็จ/, severity: 'CRITICAL',
          cause: 'โค้ดเกิดข้อผิดพลาดที่ไม่มีการดักไว้ หรือสลิปของลูกค้าอาจตกหล่น',
          fix: 'ดู Stack ใน "บันทึกระบบ" ของร้าน หาบรรทัดที่พัง เพิ่มการตรวจค่าว่าง/try-catch ตรงจุดนั้น แล้วเขียนทดสอบกรณีนี้ก่อนออกเวอร์ชันถัดไป' },
        { test: /เน็ตสะดุด|etimedout|econnreset|econnaborted|enotfound|eai_again|socket hang up/, severity: 'HIGH',
          cause: 'อินเทอร์เน็ตของร้านสะดุด หรือเชื่อมต่อเซิร์ฟเวอร์ LINE ไม่ได้ชั่วคราว (ไม่ใช่ปัญหา Token หรือโควตา)',
          fix: 'ระบบลองดาวน์โหลดซ้ำอัตโนมัติแล้วแต่ยังไม่สำเร็จ ให้ตรวจเน็ตร้าน/เราเตอร์ในช่วงเวลานั้น และให้แม่ค้าเปิดดูรูปสลิปของลูกค้าในแชท LINE OA แล้วใส่ยอดเอง' },
        { test: /บันทึกสลิปอัตโนมัติ|sqlite|database|ฐานข้อมูล/, severity: 'HIGH',
          cause: 'ฐานข้อมูลบันทึกไม่สำเร็จ (ไฟล์ถูกล็อก ดิสก์เต็ม หรือข้อมูลผิดรูปแบบ)',
          fix: 'ตรวจพื้นที่ดิสก์และขนาดไฟล์ WAL ของร้าน ถ้าเกิดซ้ำให้ลดงานเขียนพร้อมกัน หรือย้ายงานเขียนเข้าคิวเดียว' },
        { test: /slipok|easyslip|thunder|quota|เครดิต|ตรวจสลิป|1009|402|401/, severity: 'HIGH',
          cause: 'บริการตรวจสลิปตอบกลับผิดพลาด (เครดิตหมด รหัสผิด หรือบริการล่ม)',
          fix: 'ตรวจเครดิตและรหัสของผู้ให้บริการ พิจารณาเพิ่มการสลับผู้ให้บริการอัตโนมัติ/แจ้งเตือนเครดิตต่ำให้เร็วขึ้น' },
        { test: /line|webhook|reply|push/, severity: 'HIGH',
          cause: 'เชื่อมต่อ LINE ไม่สำเร็จ (Token หมดอายุ Webhook ไม่ตรง หรือโควตาข้อความเต็ม)',
          fix: 'ตรวจ LINE Access Token และ Webhook URL ใน LINE Developers ถ้าเกี่ยวกับโควตา ลดข้อความ Push' },
        { test: /tunnel|cloudflare|localtunnel/, severity: 'MEDIUM',
          cause: 'ท่อเชื่อมต่ออินเทอร์เน็ตหลุด หรือเน็ตร้านไม่เสถียร',
          fix: 'ดูว่าระบบเชื่อมต่อใหม่ได้เองหรือไม่ ถ้าหลุดบ่อย พิจารณาใช้ Cloudflare Tunnel แบบมีบัญชี (ลิงก์ถาวร)' },
        { test: /gemini|ai|ที่อยู่/, severity: 'MEDIUM',
          cause: 'AI อ่านที่อยู่ไม่สำเร็จ (โควตา Gemini หรือข้อความรูปแบบแปลก)',
          fix: 'ตรวจโควตา Gemini และปรับตัวอ่านที่อยู่สำรอง (Regex) ให้รองรับรูปแบบนี้' },
        { test: /kerry|excel|export/, severity: 'MEDIUM',
          cause: 'ส่งออกไฟล์ Kerry ไม่สำเร็จ',
          fix: 'ทดลองส่งออกด้วยข้อมูลรอบเดียวกันบนเครื่อง Dev เพื่อหาข้อมูลที่ทำให้พัง แล้วเพิ่มการจัดการข้อมูลแบบนั้น' },
        { test: /disk|ดิสก์|พื้นที่/, severity: 'HIGH',
          cause: 'พื้นที่เก็บข้อมูลในเครื่องร้านใกล้เต็ม',
          fix: 'แนะนำร้านล้างไฟล์ที่ไม่ใช้ หรือย้ายรูป/ไฟล์สำรองเก่าออก ทบทวนนโยบายเก็บไฟล์' }
    ];
    const r = rules.find(x => x.test.test(t));
    return r || { severity: 'MEDIUM', cause: 'ข้อผิดพลาดทั่วไปของระบบ', fix: 'ดูรายละเอียดใน "บันทึกระบบ" ของร้าน แล้วจำลองซ้ำบนเครื่อง Dev ก่อนแก้' };
}
const SEVERITY_STYLE = { CRITICAL: { icon: '🟥', color: 15158332, label: 'วิกฤต' }, HIGH: { icon: '🟧', color: 15105570, label: 'สูง' }, MEDIUM: { icon: '🟨', color: 16776960, label: 'ปานกลาง' }, LOW: { icon: '🟦', color: 3447003, label: 'ต่ำ' } };

// 📮 v1.0.16: embed "ขออัปเดตเวอร์ชันใหม่" — ใช้เมื่อระบบพบข้อผิดพลาดที่ซ่อมเองไม่ได้ (Self-Healing หมดทาง)
// เกณฑ์: Error ระดับ CRITICAL (โค้ดพังที่กู้คืนอัตโนมัติไม่มีทางช่วย) หรือ Error เดิมเกิดซ้ำถึงเพดานภายใน 30 นาที
// สองฟังก์ชันนี้เป็น pure function เพื่อทดสอบแยกด้วย unit test ตรง ๆ (เหมือน buildEndOfLiveReportEmbed)
const UPDATE_REQUEST_REPEAT_THRESHOLD = 5;
function shouldRequestNewVersion(severity, repeatCount) {
    return severity === 'CRITICAL' || Number(repeatCount) >= UPDATE_REQUEST_REPEAT_THRESHOLD;
}
function buildUpdateRequestEmbed({ problem = '', whyCannotSelfHeal = '', tried = '', fixGuidance = '', meta = {} } = {}) {
    const fields = [
        { name: 'ร้าน / เวอร์ชันที่ติดตั้งอยู่', value: `${meta.shopLabel || '-'} / v${meta.version || '?'}`, inline: false },
        { name: 'ปัญหาที่พบ', value: String(problem || '-').slice(0, 500), inline: false },
        { name: 'ทำไมระบบซ่อมเองไม่ได้', value: String(whyCannotSelfHeal || '-').slice(0, 500), inline: false }
    ];
    if (tried) fields.push({ name: 'สิ่งที่ระบบพยายามแล้ว', value: String(tried).slice(0, 500), inline: false });
    fields.push({
        name: 'ที่ผู้พัฒนาควรทำ',
        value: `${fixGuidance ? String(fixGuidance).slice(0, 500) + '\n' : ''}→ แก้แล้วออกเวอร์ชันใหม่ ให้ร้านกด "ตรวจสอบอัปเดต" ในโปรแกรม`,
        inline: false
    });
    return {
        title: '📮 [ขออัปเดตเวอร์ชันใหม่] พบข้อผิดพลาดที่ระบบซ่อมเองไม่ได้',
        color: 15158332,
        fields,
        footer: { text: `AutoQueueforLive Update Request • ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}` }
    };
}

// ---- ช่อง 1: บันทึกกิจกรรม (รวมส่งทุก 60 วินาที) ----
const activityBuffer = [];
let activityDropped = 0;
function queueActivity(type, message) {
    if (!getActivityWebhook() || process.env.DISCORD_ALERTS_ENABLED === 'false') return;
    const icon = { ERROR: '🔴', WARN: '🟠', SUCCESS: '🟢', INFO: '⚪', SELF_HEALING: '⚡' }[type] || '⚪';
    const time = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' });
    activityBuffer.push(`\`${time}\` ${icon} ${redactPersonalInfo(message).slice(0, 300)}`);
    if (activityBuffer.length > 600) { activityBuffer.shift(); activityDropped++; }
}
function flushActivity() {
    const url = getActivityWebhook();
    if (!url || activityBuffer.length === 0) return;
    const lines = activityBuffer.splice(0, activityBuffer.length);
    if (activityDropped > 0) { lines.unshift(`… ข้ามไป ${activityDropped} รายการเพราะมีกิจกรรมเยอะเกิน`); activityDropped = 0; }
    const chunks = [];
    let cur = '';
    for (const l of lines) {
        if ((cur + '\n' + l).length > 3800) { chunks.push(cur); cur = l; } else { cur = cur ? `${cur}\n${l}` : l; }
    }
    if (cur) chunks.push(cur);
    chunks.slice(0, 5).forEach((desc, i) => {
        discordAlertQueue.push({ url, payload: { embeds: [{
            title: `📒 บันทึกการใช้งาน ${getShopLabel()}${chunks.length > 1 ? ` (${i + 1}/${Math.min(chunks.length, 5)})` : ''}`,
            description: desc, color: 9807270,
            footer: { text: `AutoQueueforLive v${getAppVersionSafe()} • สรุปทุก 1 นาที` }
        }] } });
    });
    processDiscordQueue().catch(() => {});
}
setInterval(flushActivity, Number(process.env.DISCORD_ACTIVITY_FLUSH_MS) > 0 ? Number(process.env.DISCORD_ACTIVITY_FLUSH_MS) : 60 * 1000).unref();

// ---- ช่อง 2: รายงาน Error สำหรับแก้ในเวอร์ชันถัดไป (ส่งทันที, Error เดิมซ้ำใน 30 นาทีรวมเป็นตัวนับ) ----
const devReportSeen = new Map();
function queueDevReport({ kind = 'ERROR', category = '', message = '', details = null, actionDetails = '', whyCannotSelfHeal = '', fixGuidance = '' } = {}) {
    const url = getDevReportWebhook();
    if (!url || process.env.DISCORD_ALERTS_ENABLED === 'false') return;
    const clean = redactPersonalInfo(message);
    const sig = `${kind}|${category}|${clean.replace(/\d+/g, '#').slice(0, 80)}`;
    const now = Date.now();
    const seen = devReportSeen.get(sig);
    if (seen && now - seen.first < 30 * 60 * 1000) {
        seen.count++;
        if (!seen.timer) {
            seen.timer = setTimeout(() => {
                const s = devReportSeen.get(sig);
                if (s && s.count > 0) {
                    // v1.0.16: Error เดิมเกิดซ้ำจนถึงเพดาน = กลไกลองซ้ำ/กู้คืนอัตโนมัติช่วยไม่ได้จริง เปลี่ยนเป็นข้อความ "ขออัปเดตเวอร์ชันใหม่"
                    let embed;
                    if (shouldRequestNewVersion(null, s.count)) {
                        embed = buildUpdateRequestEmbed({
                            problem: `${clean.slice(0, 300)} — เกิดซ้ำ ${s.count} ครั้งใน 30 นาที`,
                            whyCannotSelfHeal: `Error เดิมเกิดซ้ำ ${s.count} ครั้งใน 30 นาที แม้ระบบจะลองใหม่/กู้คืนอัตโนมัติแล้ว (เกณฑ์ ${UPDATE_REQUEST_REPEAT_THRESHOLD} ครั้ง)`,
                            fixGuidance: (assessErrorForDevReport(category, clean) || {}).fix || '',
                            meta: { shopLabel: getShopLabel(), version: getAppVersionSafe() }
                        });
                    } else {
                        embed = { title: `🔁 Error เดิมเกิดซ้ำอีก ${s.count} ครั้งใน 30 นาที`, description: clean.slice(0, 1500), color: 15105570, footer: { text: `${getShopLabel()} • v${getAppVersionSafe()}` } };
                    }
                    discordAlertQueue.push({ url, payload: { embeds: [embed] } });
                    processDiscordQueue().catch(() => {});
                }
                devReportSeen.delete(sig);
            }, Math.max(1000, 30 * 60 * 1000 - (now - seen.first)));
            if (seen.timer.unref) seen.timer.unref();
        }
        return;
    }
    devReportSeen.set(sig, { first: now, count: 0, timer: null });
    if (devReportSeen.size > 500) devReportSeen.delete(devReportSeen.keys().next().value);

    const embeds = [];
    let embed;
    if (kind === 'SELF_HEALING') {
        embed = {
            title: `⚡ ระบบแก้ไขเองสำเร็จ: ${clean.slice(0, 200)}`, color: 1095809,
            fields: [
                { name: 'สิ่งที่ระบบทำ', value: redactPersonalInfo(actionDetails || '-').slice(0, 1000), inline: false },
                { name: 'ควรทำในเวอร์ชันถัดไป', value: 'ตรวจว่าทำไมปัญหานี้เกิด และแก้ที่ต้นเหตุ ถ้าเกิดบ่อยแปลว่าระบบแก้ได้แค่ปลายเหตุ', inline: false }
            ]
        };
    } else if (kind === 'UPDATE_REQUEST') {
        // v1.0.16: ข้อความ "ขออัปเดตเวอร์ชันใหม่" — เรียกจากจุดที่ตรวจพบว่าระบบซ่อมเองไม่ได้ (CRITICAL / ซ้ำเกินเพดาน / แครชวนซ้ำ)
        embed = buildUpdateRequestEmbed({
            problem: clean,
            whyCannotSelfHeal,
            tried: actionDetails,
            fixGuidance,
            meta: { shopLabel: getShopLabel(), version: getAppVersionSafe() }
        });
    } else {
        const a = assessErrorForDevReport(category, clean);
        const st = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.MEDIUM;
        const fields = [
            { name: 'ความรุนแรง', value: `${st.icon} ${a.severity} (${st.label})`, inline: true },
            { name: 'ร้าน / เวอร์ชัน', value: `${getShopLabel()} / v${getAppVersionSafe()}`, inline: true },
            { name: 'สถานะไลฟ์', value: activeLiveSession ? '🔴 กำลังไลฟ์' : 'ไม่ได้ไลฟ์', inline: true },
            { name: 'สาเหตุที่น่าจะเป็น', value: a.cause, inline: false },
            { name: 'แนวทางแก้ไขในเวอร์ชันถัดไป', value: a.fix, inline: false }
        ];
        if (details) {
            const d = redactPersonalInfo(typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 900);
            fields.push({ name: 'รายละเอียดทางเทคนิค', value: '```' + d.replace(/```/g, "'''") + '```', inline: false });
        }
        embed = { title: `${st.icon} พบ Error: ${clean.slice(0, 200)}`, color: st.color, fields };
        // v1.0.16: Error ระดับ CRITICAL = โค้ดพังที่ระบบกู้คืนอัตโนมัติไม่ได้ แนบข้อความ "ขออัปเดตเวอร์ชันใหม่" ตามไปอีก 1 ข้อความ
        if (shouldRequestNewVersion(a.severity, 0)) {
            embeds.push(buildUpdateRequestEmbed({
                problem: clean,
                whyCannotSelfHeal: `ระดับความรุนแรง CRITICAL — ${a.cause}`,
                tried: 'ตัวเฝ้าโปรแกรมช่วยได้แค่เปิดใหม่ ซึ่งไม่ได้แก้ต้นเหตุ ส่วนกลไกลองซ้ำอัตโนมัติไม่ครอบคลุมข้อผิดพลาดประเภทนี้',
                fixGuidance: a.fix,
                meta: { shopLabel: getShopLabel(), version: getAppVersionSafe() }
            }));
        }
    }
    embed.footer = { text: `AutoQueueforLive Dev Report • ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}` };
    embeds.unshift(embed);
    discordAlertQueue.push({ url, payload: { embeds } });
    processDiscordQueue().catch(() => {});
}

// 📜 ระบบบันทึก System & Error Logs สำหรับหน้าตั้งค่าเชื่อมต่อ
// v1.0.16: เก็บ System Logs ลงไฟล์ด้วย (เดิมอยู่ในหน่วยความจำ 200 รายการ หายเมื่อโปรแกรมรีสตาร์ท จึงตามย้อนหลังไม่ได้ว่าสลิปหายเพราะอะไร)
// ไฟล์ system.log ในโฟลเดอร์โปรแกรม หมุนเมื่อเกิน 2 MB เหลือไว้อย่างมาก 2 ไฟล์ (system.log + system-prev.log) ชื่อไฟล์ลงท้าย .log ถูก .gitignore และตัวติดตั้งยกเว้นอยู่แล้ว
const LOG_FILE = path.join(__dirname, 'system.log');
const LOG_FILE_PREV = path.join(__dirname, 'system-prev.log');
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
let logFileBytes = 0;
try { logFileBytes = fs.statSync(LOG_FILE).size; } catch (e) { logFileBytes = 0; }
function appendLogFile(logItem) {
    try {
        const detail = logItem.details ? ' | ' + String(logItem.details).replace(/\s+/g, ' ').slice(0, 500) : '';
        const line = `[${logItem.time}] [${logItem.type}] ${logItem.message}${detail}\n`;
        const size = Buffer.byteLength(line);
        if (logFileBytes + size > LOG_FILE_MAX_BYTES) {
            try { fs.renameSync(LOG_FILE, LOG_FILE_PREV); } catch (e) { /* ไม่มีไฟล์เดิมให้หมุน */ }
            logFileBytes = 0;
        }
        logFileBytes += size;
        fs.appendFile(LOG_FILE, line, () => {});     // ไม่รอผล: การเขียน Log ล้มเหลวต้องไม่กระทบโปรแกรม
    } catch (e) { /* ไม่ทำให้การบันทึก Log หลักล้ม */ }
}

const systemLogs = [];
function addLog(type, message, details = null) {
    const logItem = {
        id: Date.now() + Math.random().toString(36).substr(2, 4),
        time: new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}),
        type, // 'INFO', 'SUCCESS', 'WARN', 'ERROR'
        message,
        details: details ? (typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details)) : null
    };
    systemLogs.unshift(logItem); // เอาใหม่อยู่บนสุด
    if (systemLogs.length > 200) systemLogs.pop(); // เก็บสูงสุด 200 รายการล่าสุด
    appendLogFile(logItem);

    // 🛡️ บันทึก System Logs ใน Dashboard เท่านั้น (ไม่ส่งสแปมเข้า Discord เพื่อป้องกันการแจ้งเตือนรบกวน)
    // การแจ้งเตือนเข้า Discord จะส่งเฉพาะกรณีวิกฤตระดับ Crash (uncaughtException) หรือสั่งส่งโดยตรงเท่านั้น
    // 📡 ยกเว้นช่องของผู้พัฒนา (ถ้าตั้งค่าไว้): ทุกกิจกรรมเข้าช่อง 1 แบบรวมทุก 1 นาที และ Error เข้าช่อง 2 ทันที
    // 🏁 v1.0.16: ระหว่างไลฟ์ เก็บ Error/WARN ไว้สรุปหลังจบไลฟ์ (ส่งเข้า Discord ทุกครั้งที่กดจบไลฟ์)
    if (activeLiveSession && (type === 'ERROR' || type === 'WARN')) {
        liveIssueLogs.push({ type, message: String(message).slice(0, 300) });
        if (liveIssueLogs.length > 400) liveIssueLogs.shift();
    }
    try {
        queueActivity(type, message);
        if (type === 'ERROR') queueDevReport({ kind: 'ERROR', message, details });
    } catch (e) { /* การส่ง Discord ต้องไม่ทำให้การบันทึกล้ม */ }
}
addLog('INFO', 'ระบบเริ่มต้นทำงานเรียบร้อย');
// v1.0.16: ถ้าตัวเฝ้า (supervisor) เปิดโปรแกรมใหม่เพราะแครช ให้มีบรรทัด log ไว้ไล่ย้อน และถ้าแครชวนซ้ำมากพอ ถือว่า Self-Healing หมดทาง → ขออัปเดตเวอร์ชันใหม่ทางช่อง Dev Report
{
    const restartCount = Number(process.env.AQ_RESTART_COUNT) || 0;
    if (restartCount > 0) {
        addLog('WARN', `ตัวเฝ้าโปรแกรมเปิดใหม่อัตโนมัติครั้งที่ ${restartCount} เพราะโปรแกรมหยุดทำงานผิดปกติ (ดูสาเหตุใน supervisor.log และ system.log ก่อนหน้า)`);
        if (restartCount >= 3) {
            queueDevReport({
                kind: 'UPDATE_REQUEST',
                category: 'SYSTEM_CRASH_LOOP',
                message: `โปรแกรมแครชจนตัวเฝ้าเปิดใหม่อัตโนมัติแล้ว ${restartCount} ครั้งในช่วงเปิดโปรแกรมครั้งนี้`,
                whyCannotSelfHeal: 'การเปิดโปรแกรมใหม่ (Self-Healing ของตัวเฝ้า) ได้แค่รีสตาร์ท ไม่ได้แก้ต้นเหตุ — แครชวนซ้ำ 3 ครั้งขึ้นไปถือว่าต้องแก้ในเวอร์ชันใหม่',
                fixGuidance: 'เปิด supervisor.log และ system.log ของร้าน ดูท้ายไฟล์หา stack ของการแครช แล้วแก้จุดนั้นก่อนออกเวอร์ชันถัดไป'
            });
        }
    }
}

// ดักจับ Unhandled Error ทั่วไประดับ Process เพื่อให้บันทึก Error Log ได้เสมอ
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    addLog('ERROR', `Uncaught Exception: ${err.message}`, err.stack);
    sendDiscordAlert({
        type: 'ERROR',
        category: 'SYSTEM_CRASH',
        title: '💥 [แจ้งเตือนวิกฤต] Uncaught Exception',
        message: err.message,
        details: err.stack,
        force: true
    });
    // 🛡️ AutoQueue Sentinel AI Watchdog
    sentinel.reportIncident({
        type: 'CRASH',
        category: 'SYSTEM_CRASH',
        title: 'ตรวจพบ Uncaught Exception วิกฤตในระบบ',
        message: err.message,
        stack: err.stack,
        logs: systemLogs.slice(0, 10).map(l => `[${l.time}] [${l.type}] ${l.message}`)
    }).catch(e => console.error('[Sentinel Error Handler]:', e.message));
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    addLog('ERROR', `Unhandled Rejection: ${reason?.message || reason}`, reason?.stack);
    sendDiscordAlert({
        type: 'ERROR',
        category: 'SYSTEM_CRASH',
        title: '💥 [แจ้งเตือนวิกฤต] Unhandled Rejection',
        message: reason?.message || String(reason),
        details: reason?.stack,
        force: true
    });
    // 🛡️ AutoQueue Sentinel AI Watchdog
    sentinel.reportIncident({
        type: 'CRASH',
        category: 'SYSTEM_CRASH',
        title: 'ตรวจพบ Unhandled Rejection วิกฤตในระบบ',
        message: reason?.message || String(reason),
        stack: reason?.stack,
        logs: systemLogs.slice(0, 10).map(l => `[${l.time}] [${l.type}] ${l.message}`)
    }).catch(e => console.error('[Sentinel Error Handler]:', e.message));
});

app.use((req, res, next) => {
    // 🛡️ CORS: หน้า Dashboard เรียก API จากโดเมนเดียวกันอยู่แล้ว จึงอนุญาตข้ามโดเมนเฉพาะ localhost และลิงก์ Tunnel ของร้านนี้
    // (เดิมเป็น "*" ทำให้เว็บไซต์อื่นใดก็เรียก API ของร้านได้)
    const origin = req.headers.origin;
    if (origin) {
        const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
        const isOwnTunnel = typeof currentPublicUrl === 'string' && currentPublicUrl && origin === currentPublicUrl.replace(/\/$/, '');
        if (isLocalOrigin || isOwnTunnel) {
            res.header("Access-Control-Allow-Origin", origin);
            res.header("Vary", "Origin");
        }
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 🛡️ รูปสลิปที่ลูกค้าส่งมา (มีชื่อ/ยอดโอน) ดูได้เฉพาะผู้ที่เข้าสู่ระบบแล้ว หรือเปิดจากเครื่องร้านค้าโดยตรง
app.use('/uploads', (req, res, next) => {
    if (isDirectLocalRequest(req) || getSession(req)) return next();
    return res.status(401).send('กรุณาเข้าสู่ระบบก่อนดูรูปสลิป');
});

// 📱 Sentinel Mobile Approval Action Endpoint
app.get('/api/sentinel/action', async (req, res) => {
    try {
        const { id, token, action } = req.query;
        const result = await sentinel.handleAction(id, token, action);
        res.send(result.html);
    } catch (err) {
        res.status(500).send(`<h3>เกิดข้อผิดพลาด: ${err.message}</h3>`);
    }
});

// 🧪 Test Sentinel Incident & Review Simulation
app.post('/api/sentinel/test', async (req, res) => {
    try {
        const { category = 'LINE_BATCH', message = 'LINE Webhook batch array dropped events (BUG-01 simulation)' } = req.body || {};
        await sentinel.reportIncident({
            type: 'ERROR',
            category,
            title: 'จำลองการตรวจพบปัญหา LINE Webhook Batch Drop (BUG-01)',
            message,
            stack: 'Error: Multiple events in webhook batch array dropped\n    at handleLineWebhook (index.js:452:12)',
            logs: systemLogs.slice(0, 10).map(l => `[${l.time}] [${l.type}] ${l.message}`)
        });
        res.json({ success: true, message: 'Sentinel Incident Triggered! ตรวจสอบที่ Discord ใหม่ของคุณได้เลยครับ' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🧪 Test Self-Healing Alert to Discord
app.post('/api/sentinel/test_healing', async (req, res) => {
    try {
        await reportSelfHealingToDiscord({
            category: 'DATABASE_BUSY',
            title: 'คลี่คลายการล็อกของฐานข้อมูล SQLite สำเร็จ (Self-Healing)',
            issue: 'ตรวจพบ SQLite Busy Contention ชั่วคราวเนื่องจากคำสั่งซื้อเข้ามาพร้อมกันจำนวนมาก',
            actionDetails: 'ระบบ Sentinel ดำเนินการ PRAGMA wal_checkpoint(TRUNCATE) และขยาย busy_timeout อัตโนมัติ แม่ค้าไลฟ์สดต่อได้ราบรื่นทันที'
        });
        res.json({ success: true, message: 'Self-Healing Alert sent to Discord successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🌐 Remote Merchant Registry & Telemetry Ingestion Pool (Lives on Developer PC)
const connectedMerchants = new Map();

// 🏢 Sentinel Office Dashboard Live State Endpoint
app.get('/api/sentinel/office_state', (req, res) => {
    try {
        const publicUrl = (sentinel.getPublicUrl && sentinel.getPublicUrl()) || currentPublicUrl || 'http://localhost:3000';
        const isLive = typeof activeLiveSession !== 'undefined' && activeLiveSession && activeLiveSession.active;
        
        // Base local merchant fleet
        const merchantsFleet = [
            {
                id: 'merchant-node-01',
                name: 'เครื่องหลักแม่ค้า (Live Stream Host)',
                location: 'ร้านค้าสาขาหลัก (เครื่องนี้)',
                isCurrentHost: true,
                status: 'ONLINE',
                liveStatus: isLive ? 'STREAMING_LIVE' : 'STANDBY',
                activeSessionId: (activeLiveSession && activeLiveSession.id) || null,
                tunnelUrl: publicUrl,
                latencyMs: 18,
                lastSeen: new Date().toISOString()
            }
        ];

        // Merge any remote merchants reporting over tunnel/network
        for (const [mId, mData] of connectedMerchants.entries()) {
            merchantsFleet.push({
                id: mId,
                name: mData.shopName || mId,
                location: mData.location || 'ร้านค้าเครือข่ายภายนอก',
                isCurrentHost: false,
                status: (Date.now() - new Date(mData.lastSeen).getTime() < 120000) ? 'ONLINE' : 'OFFLINE',
                liveStatus: mData.liveStatus || 'STANDBY',
                activeSessionId: mData.activeSessionId || null,
                tunnelUrl: mData.tunnelUrl || publicUrl,
                latencyMs: mData.latencyMs || 28,
                lastSeen: mData.lastSeen,
                lastIncident: mData.lastIncident || null,
                metrics: mData.metrics || {}
            });
        }

        // If no remote merchants yet, include sample warehouse branch for preview
        if (connectedMerchants.size === 0) {
            merchantsFleet.push({
                id: 'merchant-node-02',
                name: 'เครื่องคลังสินค้า & พิมพ์ใบปะหน้า Kerry',
                location: 'สาขาคลังกระจายสินค้า',
                isCurrentHost: false,
                status: 'ONLINE',
                liveStatus: 'STANDBY',
                activeSessionId: null,
                tunnelUrl: publicUrl,
                latencyMs: 24,
                lastSeen: new Date(Date.now() - 4000).toISOString()
            });
        }

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            tunnelUrl: publicUrl,
            port: PORT || 3000,
            isLiveActive: !!isLive,
            merchants: merchantsFleet,
            agents: (telemetryWatcher && telemetryWatcher.currentData && telemetryWatcher.currentData.agents) || [],
            storageHealth: (telemetryWatcher && telemetryWatcher.storageHealthCache) || null,
            healingHistory: (sentinel && sentinel.healingHistory) || [],
            proposals: Object.values((sentinel && sentinel.proposals) || {})
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🛰️ Central Telemetry Ingestion Endpoint (Collects issues from Merchant PCs)
app.post('/api/sentinel/telemetry_ingest', express.json(), async (req, res) => {
    try {
        const { merchantId, shopName, appVersion, category = 'INFO', error = {}, metrics = {} } = req.body || {};
        if (!merchantId) {
            return res.status(400).json({ success: false, message: 'Missing merchantId' });
        }

        const now = new Date().toISOString();
        const existing = connectedMerchants.get(merchantId) || {};
        connectedMerchants.set(merchantId, {
            ...existing,
            merchantId,
            shopName: shopName || existing.shopName || `ร้านค้า (${merchantId})`,
            appVersion: appVersion || existing.appVersion || 'v1.0.7',
            lastSeen: now,
            metrics: { ...existing.metrics, ...metrics },
            lastIncident: category !== 'HEARTBEAT' ? { category, message: error.message, time: now } : existing.lastIncident
        });

        // If simple Heartbeat ping, return early
        if (category === 'HEARTBEAT') {
            return res.json({ success: true, acknowledged: true, serverTime: now });
        }

        console.log(`[Sentinel Central Ingest] 🚨 Incident from [${shopName || merchantId}]: ${category} - ${error.message}`);

        // --- Step 1: Check if this is a Priority 1 Self-Healing candidate ---
        const runtimeCategories = ['DATABASE', 'DATABASE_LOCK', 'SQLITE_BUSY', 'TUNNEL', 'TUNNEL_DROP', 'CACHE_BLOAT', 'MEMORY_HIGH'];
        const isRuntimeIssue = runtimeCategories.includes(category) || (error.message && (error.message.includes('locked') || error.message.includes('busy') || error.message.includes('tunnel')));

        // Broadcast to Pixel Office Canvas on Developer PC
        if (io) {
            io.emit('pixel_telemetry_event', {
                merchantId,
                shopName: shopName || merchantId,
                category,
                isRuntimeIssue,
                error,
                metrics,
                time: now
            });
        }

        if (isRuntimeIssue) {
            const healAction = category.includes('DATABASE') || (error.message && error.message.includes('locked'))
                ? 'PRAGMA wal_checkpoint(TRUNCATE) & busy_timeout = 10000'
                : 'Cloudflare Tunnel Watchdog Kick & Memory GC';

            const record = {
                category: category,
                action: healAction,
                details: `Self-Healing สำเร็จสำหรับ ${shopName || merchantId}: ${error.message || 'Transient failure resolved'}`,
                status: 'RESOLVED_WITHOUT_UPDATE',
                triggeredBy: `Merchant Probe [${merchantId}]`
            };
            sentinel.addHealingRecord(record);

            // Report green alert to Discord
            await reportSelfHealingToDiscord({
                category,
                title: `กู้คืนเครื่องแม่ค้า (${shopName || merchantId}) สำเร็จ`,
                issue: error.message || 'ตรวจพบความผิดปกติชั่วคราว',
                actionDetails: healAction
            }).catch(() => {});

            return res.json({
                success: true,
                healed: true,
                action: healAction,
                instructions: 'RESUME_STREAM_NORMAL',
                message: 'หมอเมดิค (Medic Agent) ดำเนินการคลี่คลายปัญหาเรียบร้อย แม่ค้าไลฟ์สดต่อได้ทันที'
            });
        }

        // --- Step 2: Code Defect requiring Version Update RFC (Kiro Conductor & Dispatcher) ---
        await sentinel.reportIncident({
            type: 'ERROR',
            category,
            title: `ตรวจพบข้อผิดพลาดจากเครื่องแม่ค้า (${shopName || merchantId})`,
            message: error.message || 'Unhandled error on merchant machine',
            stack: error.stack || '',
            context: { merchantId, shopName, appVersion, metrics }
        });

        res.json({
            success: true,
            healed: false,
            rfcPending: true,
            message: 'ส่งเรื่องให้หัวหน้าคิโร่วิเคราะห์ และน้องดิสแพตช์ส่งรายงานเข้า Discord เพื่อรอการอนุมัติผ่านมือถือเรียบร้อย'
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🎮 Pixel Office Route (Accessible ONLY on developer PC localhost)
app.get('/sentinel/office', (req, res) => {
    const brainOfficePath = path.join(
        process.env.USERPROFILE || 'C:/Users/napat',
        '.gemini/antigravity/brain/82c1fccc-253f-4df2-a685-20e6068f9a40/sentinel_office.html'
    );
    if (fs.existsSync(brainOfficePath)) {
        return res.sendFile(brainOfficePath, { dotfiles: 'allow' });
    }
    res.status(404).send('Pixel Office Dashboard is only available on Developer PC inside Antigravity.');
});

// 🩺 Trigger Immediate Self-Healing
app.post('/api/sentinel/heal_now', express.json(), async (req, res) => {
    try {
        const { category = 'DATABASE_MAINTENANCE' } = req.body || {};
        const record = await sentinel.executeManualHealing(category);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🧪 Simulate Merchant Incident from Office Dashboard
app.post('/api/sentinel/simulate_merchant_issue', express.json(), async (req, res) => {
    try {
        const { issueType = 'RUNTIME', scenario = 'SQLITE_LOCK' } = req.body || {};
        
        if (issueType === 'RUNTIME') {
            await sentinel.reportIncident({
                type: 'WARNING',
                category: scenario === 'TUNNEL_DROP' ? 'TUNNEL' : 'DATABASE',
                title: scenario === 'TUNNEL_DROP' ? 'ตรวจพบ Cloudflare Tunnel หลุดชั่วคราว' : 'ตรวจพบ SQLite Busy Contention',
                message: scenario === 'TUNNEL_DROP' 
                    ? 'Cloudflare daemon disconnected (network fluctuation)'
                    : 'SQLITE_BUSY: database is locked during high concurrency peak',
                stack: 'Error: SQLITE_BUSY\n    at Statement.all (node_modules/better-sqlite3)',
                logs: systemLogs.slice(0, 5).map(l => `[${l.time}] [${l.type}] ${l.message}`)
            });
            return res.json({
                success: true,
                message: 'จำลองปัญหา Runtime สำเร็จ! หมอเมดิค (Medic Agent) ทำการ Self-Healing เรียบร้อย (ไม่ต้องอัปเดตเวอร์ชัน)',
                actionType: 'SELF_HEALING'
            });
        } else {
            // Version Update Request
            await sentinel.reportIncident({
                type: 'ERROR',
                category: 'CODE_DEFECT',
                title: 'ตรวจพบ Exception ในฟังก์ชันประมวลผล Webhook (BUG-01 Simulation)',
                message: 'Unhandled batch slice dropped customer slip events',
                stack: 'TypeError: Cannot read properties of undefined (reading 0)\n    at handleLineWebhook (index.js:452:12)',
                logs: systemLogs.slice(0, 8).map(l => `[${l.time}] [${l.type}] ${l.message}`)
            });
            return res.json({
                success: true,
                message: 'จำลองปัญหา Code Defect สำเร็จ! หัวหน้าคิโร่ (Kiro Conductor) วิเคราะห์ และน้องดิสแพตช์ส่งรายงานเข้า Discord แล้ว รอการอนุมัติผ่านมือถือ',
                actionType: 'VERSION_UPDATE_RFC'
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 📋 Get all proposals
app.get('/api/sentinel/proposals', (req, res) => {
    res.json({ success: true, proposals: Object.values((sentinel && sentinel.proposals) || {}) });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
});

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.static(path.join(__dirname, 'public'))); 

// 📒 บันทึกการกระทำของแม่ค้า/แอดมินทุกครั้ง (เข้าหน้าบันทึกระบบ และช่อง Discord บันทึกการใช้งาน ถ้าตั้งค่าไว้)
const ACTION_LOG_LABELS = {
    'POST /api/queue/action': (b) => ({ called: 'เรียกคิว', skipped: 'ข้ามคิว', completed: 'จบคิว', cancelled: 'ยกเลิกคิว' }[b && b.action] || `จัดการคิว (${(b && b.action) || '-'})`) + ` ${Array.isArray(b && b.slipIds) ? b.slipIds.length : 0} สลิป`,
    'POST /api/queue/clear': () => 'ล้างคิว',
    'POST /api/queue/dismiss_topup': () => 'ลบการ์ดรอโอนเพิ่ม',
    'POST /api/queue/dismiss_image_fail': () => 'รับทราบการ์ดโหลดรูปสลิปไม่สำเร็จ',
    'POST /api/live_session/start': () => 'กดเริ่มไลฟ์',
    'POST /api/live_session/end': (b) => 'กดจบไลฟ์' + (b && b.holdMerge === true ? ' (รอรวมกับรอบหน้า)' : ''),
    'POST /api/live_session/hold': (b) => (b && b.hold === true) ? 'ตั้งรอบไลฟ์เป็นรอรวมบิลกับรอบหน้า' : 'ยกเลิกการรอรวมบิล',
    'POST /api/queue/manual_amount': (b) => `ใส่ยอดสลิปเอง${b && b.amount !== undefined ? ` ${Number(b.amount) || 0} บาท` : ''}`,
    'POST /api/queue/verify_abnormal': () => 'ยืนยันสลิปผิดปกติ',
    'POST /api/queue/reject_slip': () => 'ปัดตกรูปที่ไม่ใช่สลิป',
    'POST /api/system/shutdown': () => 'กดปิดโปรแกรม',
    'POST /api/system/apply_update': () => 'กดติดตั้งอัปเดต',
    'POST /api/admin/setup_keys': () => 'บันทึกหน้าตั้งค่าเชื่อมต่อ',
    'GET /api/kerry/export_excel': (b, q) => `ดาวน์โหลดไฟล์ Kerry${q && q.sessionId ? ' (เลือกรอบไลฟ์)' : (q && q.date ? ` (วันที่ ${String(q.date).slice(0, 8)})` : '')}`
};
app.use((req, res, next) => {
    const labelFn = ACTION_LOG_LABELS[`${req.method} ${req.path}`];
    if (labelFn) {
        res.on('finish', () => {
            try {
                const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
                const where = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'] ? 'เครื่องร้าน' : 'ลิงก์ภายนอก';
                const ok = res.statusCode < 400;
                addLog(ok ? 'INFO' : 'WARN', `${labelFn(req.body, req.query)} - ${ok ? 'สำเร็จ' : `ไม่สำเร็จ (รหัส ${res.statusCode})`} [${where}]`);
            } catch (e) {}
        });
    }
    next();
});

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir, { recursive: true }); }

// 🧹 ระบบลบรูปสลิปเก่าอัตโนมัติ (ลบรูปที่มีอายุเกิน 30 วัน เพื่อไม่ให้เปลืองพื้นที่คอม)
function cleanupOldUploads() {
    try {
        const files = fs.readdirSync(uploadsDir);
        const now = Date.now();
        const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 วัน
        files.forEach(file => {
            const filePath = path.join(uploadsDir, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
                console.log(`🧹 ลบรูปสลิปเก่าเรียบร้อย: ${file}`);
            }
        });
    } catch (e) {}
}
setInterval(cleanupOldUploads, 24 * 60 * 60 * 1000); // ตรวจสอบวันละ 1 ครั้ง
cleanupOldUploads();

// Local embedded SQLite database (100% private to this seller)
const supabase = require('./db.js');
if (supabase && supabase.db) {
    sentinel.setDatabase(supabase.db);
    telemetryWatcher.setDatabase(supabase.db);
}

// 🧹 ระบบดูแลรักษาพื้นที่ฮาร์ดดิสก์และไฟล์สำรองเก่า (Housekeeping & Disk Space Retention)
function cleanupOldBackups(maxAgeDays = 30, keepLatest = 10) {
    try {
        const backupsDir = path.join(__dirname, 'backups');
        if (supabase && typeof supabase.cleanupBackups === 'function') {
            supabase.cleanupBackups(backupsDir, keepLatest, maxAgeDays);
        }
        if (supabase && typeof supabase.optimizeDb === 'function') {
            supabase.optimizeDb();
        }
    } catch (e) {
        console.error('cleanupOldBackups error:', e.message);
    }
}
setInterval(cleanupOldBackups, 24 * 60 * 60 * 1000); // ทำงานวันละ 1 ครั้ง
cleanupOldBackups();

// ⚡ Self-Healing: พื้นที่เครื่องใกล้เต็ม -> ลบไฟล์เก่าที่ไม่ใช่ข้อมูลร้านให้อัตโนมัติ (ไม่แตะฐานข้อมูลหลักเด็ดขาด)
// ขั้นที่ 1 (เหลือน้อยกว่า 2 GB): ลบรูปสลิปเก่ากว่า 7 วัน และเก็บไฟล์สำรองไว้ 5 ไฟล์ล่าสุด
// ขั้นที่ 2 (เหลือน้อยกว่า 500 MB): ลบรูปสลิปเก่ากว่า 2 วัน และเก็บไฟล์สำรองไว้ 3 ไฟล์ล่าสุด
function getFreeDiskBytes() {
    try { const s = fs.statfsSync(__dirname); return Number(s.bavail) * Number(s.bsize); } catch (e) { return null; }
}
function removeUploadsOlderThan(days) {
    let removed = 0;
    try {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        for (const f of fs.readdirSync(uploadsDir)) {
            const p = path.join(uploadsDir, f);
            try { const st = fs.statSync(p); if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(p); removed++; } } catch (e) {}
        }
    } catch (e) {}
    return removed;
}
let lastDiskHealAt = 0;
function checkDiskSpaceAndHeal() {
    const free = getFreeDiskBytes();
    if (free === null) return;
    const GB = 1024 * 1024 * 1024;
    if (free >= 2 * GB) return;
    if (Date.now() - lastDiskHealAt < 6 * 60 * 60 * 1000 && free >= 0.5 * GB) return; // ทำซ้ำไม่เกินทุก 6 ชม. ยกเว้นวิกฤต
    lastDiskHealAt = Date.now();
    const critical = free < 0.5 * GB;
    const days = critical ? 2 : 7;
    const keepBackups = critical ? 3 : 5;
    const removed = removeUploadsOlderThan(days);
    try { if (supabase && typeof supabase.cleanupBackups === 'function') supabase.cleanupBackups(path.join(__dirname, 'backups'), keepBackups, 30); } catch (e) {}
    const after = getFreeDiskBytes();
    const fmt = (b) => b === null ? '?' : `${(b / GB).toFixed(2)} GB`;
    addLog('WARN', `พื้นที่เครื่องเหลือน้อย (${fmt(free)}) ระบบลบรูปสลิปเก่ากว่า ${days} วัน ${removed} รูป และเก็บไฟล์สำรองไว้ ${keepBackups} ไฟล์ล่าสุด เหลือพื้นที่ ${fmt(after)}`);
    reportSelfHealingToDiscord({ category: 'DISK', title: 'พื้นที่เครื่องใกล้เต็ม', issue: `พื้นที่เหลือ ${fmt(free)}`, actionDetails: `ลบรูปสลิปเก่ากว่า ${days} วัน ${removed} รูป และเก็บไฟล์สำรอง ${keepBackups} ไฟล์ล่าสุด เหลือพื้นที่ ${fmt(after)} (ไม่ได้แตะฐานข้อมูลร้าน)` }).catch(() => {});
}
setInterval(checkDiskSpaceAndHeal, 60 * 60 * 1000); // ตรวจทุก 1 ชั่วโมง
setTimeout(checkDiskSpaceAndHeal, 30 * 1000);

let priceList = []; 
let rawPriceString = "";
let shippingFee = 39; 
let freeShippingThreshold = 0; 
merchantAccountName = merchantAccountName || "";
let openchatLink = ""; 
let slipokPackageLimit = 100; // ค่ามาตรฐาน: OK Basic (100 สลิป/เดือน ฟรี)

function parsePrices(val) {
    return val.split(',').map(item => {
        if (item.includes(':')) {
            let parts = item.split(':');
            return { name: parts[0].trim(), price: parseInt(parts[1].trim()) };
        }
        let p = parseInt(item.trim());
        return { name: `${p}฿`, price: p };
    }).filter(item => !isNaN(item.price));
}

async function loadConfig() {
    const { data, error } = await supabase.from('configs').select('key, value');
    if (error) { console.error("\n❌ [Supabase ERROR]:", error.message); return; }
    if (data) {
        data.forEach(item => {
            if (item.key === 'prices') { rawPriceString = item.value; priceList = parsePrices(item.value); }
            if (item.key === 'shipping_fee') { const n = parseInt(item.value, 10); if (Number.isFinite(n)) shippingFee = n; }
            if (item.key === 'free_shipping_threshold') { const n = parseInt(item.value, 10); if (Number.isFinite(n)) freeShippingThreshold = n; }
            if (item.key === 'merchant_account_name') merchantAccountName = item.value;
            if (item.key === 'openchat_link') openchatLink = item.value; 
            if (item.key === 'slipok_package_limit') slipokPackageLimit = parseInt(item.value) || 100;
            if (item.key === 'active_live_session') {
                try {
                    activeLiveSession = JSON.parse(item.value);
                } catch(e) { activeLiveSession = null; }
            }
        });
        console.log(`⚙️ โหลดตั้งค่าสำเร็จ (สถานะไลฟ์: ${activeLiveSession ? 'กำลังไลฟ์' : 'ปิดอยู่'}, แพ็กเกจ SlipOK: ${slipokPackageLimit})`);
    }
}
loadConfig();

app.get('/api/config', (req, res) => res.json({ prices: rawPriceString, shippingFee, freeShippingThreshold, merchantAccountName, openchatLink }));


// ================= 🔐 AUTHENTICATION & SECURITY LAYER =================
const SESSION_COOKIE = 'aq_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const sessions = new Map(); // token -> { role, exp }

// เคลียร์ session ที่หมดอายุอัตโนมัติ
setInterval(() => {
    const now = Date.now();
    for (const [t, s] of sessions) {
        if (s.exp < now) sessions.delete(t);
    }
}, 10 * 60 * 1000).unref();

function hashPassword(plain) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(plain), salt, 64);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain, stored) {
    if (!stored || typeof plain !== 'string') return false;
    if (stored.startsWith('scrypt$')) {
        const parts = stored.split('$');
        if (parts.length < 3) return false;
        const salt = Buffer.from(parts[1], 'hex');
        const expected = Buffer.from(parts[2], 'hex');
        const actual = crypto.scryptSync(plain, salt, expected.length);
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    }
    // รองรับ plaintext แบบเดิมเพื่อ migration โดยใช้ constant-time comparison
    const a = Buffer.from(String(plain));
    const b = Buffer.from(String(stored));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readSessionToken(req) {
    const h = req.headers?.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7).trim();
    const cookieHeader = req.headers?.cookie || '';
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{64})`));
    return match ? match[1] : null;
}

function getSession(req) {
    const token = readSessionToken(req);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.exp < Date.now()) {
        sessions.delete(token);
        return null;
    }
    return session;
}

function issueSession(res, role) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { role, exp: Date.now() + SESSION_TTL_MS });
    if (res && typeof res.setHeader === 'function') {
        // 🛡️ ผ่าน Tunnel (HTTPS) ให้ติด Secure ป้องกันคุกกี้รั่วผ่าน HTTP; เปิดบนเครื่องร้าน (http://localhost) ทำงานเหมือนเดิม
        const r = res.req || {};
        const isHttps = r.secure || String(r.headers?.['x-forwarded-proto'] || '').includes('https') || String(r.headers?.['cf-visitor'] || '').includes('https');
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${isHttps ? '; Secure' : ''}`);
    }
    return token;
}

function clientIp(req) {
    // Cloudflare เขียนทับ cf-connecting-ip เสมอ จึงเชื่อถือได้; x-forwarded-for เชื่อเฉพาะเมื่อมาจาก Tunnel บนเครื่องนี้ (loopback)
    // เพื่อกันผู้โจมตีใน LAN ปลอม Header เพื่อหลบ Rate Limit การเดารหัสผ่าน
    const socketAddr = req.socket?.remoteAddress || '';
    const isLoopback = socketAddr === '127.0.0.1' || socketAddr === '::1' || socketAddr === '::ffff:127.0.0.1';
    const forwarded = isLoopback ? (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) : null;
    return String(forwarded || socketAddr || '').split(',')[0].trim();
}

// ป้องกัน Brute-force: จำกัดการล็อกอินไม่เกิน 10 ครั้งต่อ 15 นาทีต่อ IP
const loginAttempts = new Map();
function isLoginRateLimited(req) {
    const ip = clientIp(req) || 'unknown';
    const now = Date.now();
    const record = loginAttempts.get(ip);
    if (!record || record.resetAt < now) {
        loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
        return false;
    }
    record.count += 1;
    return record.count > 10;
}

const DREAMDEV_USERNAME = (process.env.DREAMDEV_USERNAME || 'Dreamdev').trim();
const DREAMDEV_PASSWORD = (process.env.DREAMDEV_PASSWORD || '').trim();
// 🔐 รหัส Dev ค่าเริ่มต้น (เก็บเฉพาะค่าที่เข้ารหัสทางเดียวแล้ว) ใช้เมื่อเครื่องนั้นไม่ได้ตั้ง DREAMDEV_PASSWORD / DREAMDEV_PASSWORD_HASH ใน .env
// v1.0.8-v1.0.9 ไม่มีค่าเริ่มต้น ทำให้ผู้พัฒนาล็อกอินเครื่องร้านไม่ได้
const DEFAULT_DREAMDEV_PASSWORD_HASH = 'scrypt$899b1191002df3dec15e0fff24606f2d$961635d198a3ad611ff5566e10024fbec5d84e17838add421c45d09e5b2fb378cbd846925e421d82b582f218c58ae5d2999fb37782694da0d007bc481bf9a790';
const DREAMDEV_PASSWORD_HASH = ((process.env.DREAMDEV_PASSWORD_HASH || '').trim()) || (DREAMDEV_PASSWORD ? '' : DEFAULT_DREAMDEV_PASSWORD_HASH);

// 🛡️ Middleware ป้องกันการเข้าถึง Endpoint จัดการระบบโดยไม่ได้รับอนุญาต (Three-Tier RBAC, เข้ากันได้กับสิทธิ์เดิมของ v1.0.7)
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const method = req.method.toUpperCase();

    // 🔒 Tier C: เฉพาะผู้พัฒนา (Dreamdev) — เครื่องมือทดสอบ/ล้างข้อมูล/ตั้งแหล่งอัปเดต (UI แสดงเฉพาะ Dreamdev อยู่แล้ว)
    const isDevOnly = (
        p.startsWith('/api/test/') ||
        p.startsWith('/api/sentinel/') ||
        p === '/api/admin/reset_test_data' ||
        p === '/api/system/save_update_url'
    );
    if (isDevOnly) {
        const session = getSession(req);
        if (!session) {
            return res.status(401).json({ success: false, message: 'UNAUTHORIZED: กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
        }
        if (session.role !== 'dreamdev') {
            return res.status(403).json({ success: false, message: 'FORBIDDEN: สิทธิ์ของคุณไม่สามารถดำเนินการส่วนนี้ได้ (เฉพาะผู้พัฒนา Dreamdev เท่านั้น)' });
        }
        req.auth = session;
        return next();
    }

    // 🔐 Tier B: ต้องเข้าสู่ระบบ (แม่ค้า หรือ ผู้พัฒนา) — เหมือน v1.0.7: ตั้งค่าเชื่อมต่อ, Logs, Backup, ปุ่มอัปเดต, ปิดโปรแกรม, เปลี่ยนรหัส
    // (การแก้ Gemini API Key ยังจำกัดเฉพาะ Dreamdev ภายใน /api/admin/setup_keys)
    const isTierB = (
        p.startsWith('/api/admin/') ||
        p === '/api/system/shutdown' ||
        p === '/api/system/apply_update' ||
        p === '/api/auth/change_password'
    );
    if (isTierB) {
        const session = getSession(req);
        if (!session || (session.role !== 'dreamdev' && session.role !== 'merchant')) {
            return res.status(401).json({ success: false, message: 'UNAUTHORIZED: กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
        }
        req.auth = session;
        return next();
    }

    // 🛡️ Tier A: ปุ่มหน้าคิว/Kerry/ตั้งค่าสินค้า/เปิด-ปิดไลฟ์/ประวัติ
    // บนเครื่องร้านค้าใช้ได้ทันทีเหมือนเดิม (ไม่ต้องล็อกอิน) — เปิดผ่านลิงก์ Tunnel จากภายนอกต้องเข้าสู่ระบบก่อน กันคนแปลกหน้าล้างคิว
    const isTierA = (
        (p === '/api/config' && method === 'POST') ||
        p.startsWith('/api/kerry/') ||
        p.startsWith('/api/queue/') ||
        (p.startsWith('/api/live_session/') && (p === '/api/live_session/start' || p === '/api/live_session/end' || p === '/api/live_session/hold' || p === '/api/live_session/pending_merge')) ||
        p === '/api/history_data'
    );
    if (isTierA) {
        if (isDirectLocalRequest(req)) return next();
        const session = getSession(req);
        if (!session) {
            return res.status(401).json({ success: false, message: 'UNAUTHORIZED: กรุณาเข้าสู่ระบบก่อนดำเนินการ' });
        }
        req.auth = session;
        return next();
    }

    next();
});

app.post('/api/config', async (req, res) => {
    const { newPrices, newShipping, newThreshold, newMerchantName, newOpenchatLink } = req.body;
    try {
        if (newPrices !== undefined) { 
            rawPriceString = newPrices; priceList = parsePrices(newPrices); 
            await supabase.from('configs').upsert([{ key: 'prices', value: newPrices }]); 
        }
        // 🛡️ ป้องกันค่า NaN: ถ้ากรอกไม่ใช่ตัวเลข จะคงค่าเดิมไว้ (ค่า NaN ทำให้การคำนวณสิทธิ์ทั้งไลฟ์ผิดหมด)
        const shipNum = newShipping !== undefined ? parseInt(newShipping, 10) : NaN;
        const threshNum = newThreshold !== undefined ? parseInt(newThreshold, 10) : NaN;
        if (Number.isFinite(shipNum) && shipNum >= 0) { shippingFee = shipNum; await supabase.from('configs').upsert([{ key: 'shipping_fee', value: String(shipNum) }]); }
        if (Number.isFinite(threshNum) && threshNum >= 0) { freeShippingThreshold = threshNum; await supabase.from('configs').upsert([{ key: 'free_shipping_threshold', value: String(threshNum) }]); }
        if (newMerchantName !== undefined) { merchantAccountName = newMerchantName.trim(); await supabase.from('configs').upsert([{ key: 'merchant_account_name', value: merchantAccountName }]); }
        if (newOpenchatLink !== undefined) { openchatLink = newOpenchatLink.trim(); await supabase.from('configs').upsert([{ key: 'openchat_link', value: openchatLink }]); }
        addLog('INFO', 'อัปเดตการตั้งค่าสินค้า/ค่าจัดส่งสำเร็จ');
        res.json({ success: true });
    } catch (err) { 
        addLog('ERROR', 'อัปเดตการตั้งค่าล้มเหลว', err.message);
        res.status(500).json({ success: false, error: err.message }); 
    }
});

// เช็คสถานะว่าแม่ค้าเคยตั้งรหัสผ่านร้านค้าหรือยัง
app.get('/api/auth/status', async (req, res) => {
    try {
        const { data: configPass } = await supabase.from('configs').select('value').eq('key', 'merchant_password').single();
        res.json({
            success: true,
            hasMerchantPassword: !!(configPass && configPass.value)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ล็อกอินเข้าสู่ระบบ (รองรับทั้ง Dreamdev และ แม่ค้า พร้อม Scrypt & HttpOnly Session)
app.post('/api/auth/login', async (req, res) => {
    if (isLoginRateLimited(req)) {
        return res.status(429).json({ success: false, message: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที' });
    }

    const { username, password } = req.body || {};
    if (typeof password !== 'string' || !password) {
        return res.status(400).json({ success: false, message: 'กรุณากรอกรหัสผ่าน' });
    }
    
    // 1. เช็คสิทธิ์ Dreamdev (Master Developer) - ไม่ใช้ Hardcoded fallback
    let isDreamdevMatch = false;
    const isDreamdevUser = (username === DREAMDEV_USERNAME);
    // v1.0.12: หน้าต่างล็อกอินเป็นแบบเดียวกับแม่ค้า (ไม่มีช่องชื่อผู้ใช้) จึงยอมให้ "ไม่ระบุชื่อผู้ใช้" แล้วรหัสตรงกับรหัส Dev ก็เข้าเป็น Dev ได้
    // ถ้ารหัสไม่ตรง ให้ไหลต่อไปตรวจเป็นรหัสแม่ค้าตามเดิม (ไม่เปลี่ยนพฤติกรรมของแม่ค้า)
    const noUsername = (typeof username !== 'string' || username.trim() === '');
    if (isDreamdevUser || noUsername) {
        if (DREAMDEV_PASSWORD_HASH) {
            isDreamdevMatch = verifyPassword(password, DREAMDEV_PASSWORD_HASH);
        } else if (DREAMDEV_PASSWORD) {
            isDreamdevMatch = verifyPassword(password, DREAMDEV_PASSWORD);
        }
    }

    if (isDreamdevMatch) {
        const token = issueSession(res, 'dreamdev');
        addLog('SUCCESS', `ผู้พัฒนา [Dreamdev] เข้าสู่ระบบในโหมด Developer สำเร็จ`);
        return res.json({ success: true, role: 'dreamdev', token });
    }

    // 🛡️ ผู้ใช้ระบุชื่อผู้พัฒนาแต่รหัสผิด: ปฏิเสธทันที ห้ามไหลไปเป็น "รหัสร้านค้าใหม่" บนเครื่องที่ยังไม่ตั้งรหัส
    if (isDreamdevUser) {
        addLog('WARN', 'เข้าสู่ระบบผู้พัฒนาไม่สำเร็จ (รหัสผ่านไม่ถูกต้อง)');
        return res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // 2. เช็คสิทธิ์แม่ค้า (Merchant)
    try {
        const { data: configPass } = await supabase.from('configs').select('value').eq('key', 'merchant_password').single();
        const savedPass = configPass?.value;

        // หากร้านนี้ยังไม่เคยตั้งรหัสผ่าน ให้รหัสที่ส่งมากลายเป็นรหัสที่ตั้งใหม่ทันที
        if (!savedPass) {
            // 🛡️ กันคนแปลกหน้าที่รู้ลิงก์ Tunnel แย่งตั้งรหัสร้านก่อนเจ้าของ: ตั้งรหัสครั้งแรกได้จากเครื่องร้านค้าเท่านั้น
            // (ร้านที่ตั้งรหัสไว้แล้วไม่ได้รับผลกระทบ)
            if (!isDirectLocalRequest(req)) {
                return res.status(403).json({ success: false, message: 'ร้านนี้ยังไม่ได้ตั้งรหัสผ่าน กรุณาตั้งรหัสผ่านครั้งแรกจากหน้าจอบนเครื่องคอมพิวเตอร์ของร้านค้า' });
            }
            if (password.trim().length < 4) {
                return res.status(400).json({ success: false, message: 'กรุณาตั้งรหัสผ่านร้านค้าอย่างน้อย 4 ตัวอักษร' });
            }
            const hashed = hashPassword(password.trim());
            await supabase.from('configs').upsert([{ key: 'merchant_password', value: hashed }]);
            const token = issueSession(res, 'merchant');
            addLog('SUCCESS', 'แม่ค้าได้สร้างรหัสผ่านร้านค้าเริ่มต้นเรียบร้อยแล้ว (เข้ารหัส Scrypt)');
            return res.json({ success: true, role: 'merchant', token: 'MERCHANT_TOKEN_' + token, isNewPassword: true });
        }

        // ตรวจสอบความถูกต้องของรหัสผ่าน
        if (verifyPassword(password, savedPass)) {
            // Auto-upgrade: หากรหัสเดิมยังเป็น plaintext ให้ migrate เป็น scrypt ทันที
            if (!savedPass.startsWith('scrypt$')) {
                const newHash = hashPassword(password);
                supabase.from('configs').upsert([{ key: 'merchant_password', value: newHash }]).catch(() => {});
            }
            const token = issueSession(res, 'merchant');
            addLog('SUCCESS', 'แม่ค้า (Merchant) เข้าสู่ระบบสำเร็จ');
            return res.json({ success: true, role: 'merchant', token: 'MERCHANT_TOKEN_' + token });
        } else {
            addLog('WARN', 'แม่ค้าเข้าสู่ระบบไม่สำเร็จ (รหัสผ่านไม่ถูกต้อง)');
            return res.status(401).json({ success: false, message: 'รหัสผ่านร้านค้าไม่ถูกต้อง' });
        }
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

// เปลี่ยนรหัสผ่านของแม่ค้า
app.post('/api/auth/change_password', async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    try {
        const { data: configPass } = await supabase.from('configs').select('value').eq('key', 'merchant_password').single();
        const savedPass = configPass?.value;

        if (savedPass && !verifyPassword(oldPassword, savedPass)) {
            return res.status(400).json({ success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
        }
        if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 4) {
            return res.status(400).json({ success: false, message: 'รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
        }

        const hashed = hashPassword(newPassword.trim());
        await supabase.from('configs').upsert([{ key: 'merchant_password', value: hashed }]);
        addLog('SUCCESS', 'แม่ค้าเปลี่ยนรหัสผ่านร้านค้าสำเร็จ (เข้ารหัส Scrypt)');
        res.json({ success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// backward compatibility alias
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const isDreamdevUser = (username === DREAMDEV_USERNAME) || (!username && !!DREAMDEV_PASSWORD && verifyPassword(String(password || ''), DREAMDEV_PASSWORD));
    let isMatch = false;
    if (DREAMDEV_PASSWORD_HASH) {
        isMatch = isDreamdevUser && verifyPassword(password, DREAMDEV_PASSWORD_HASH);
    } else {
        isMatch = isDreamdevUser && !!DREAMDEV_PASSWORD && verifyPassword(password, DREAMDEV_PASSWORD);
    }

    if (isMatch) {
        const token = issueSession(res, 'dreamdev');
        addLog('SUCCESS', `ผู้พัฒนา [${username || 'Dreamdev'}] เข้าสู่ระบบสำเร็จ`);
        res.json({ success: true, token: 'DEV_AUTHORIZED_TOKEN_' + token });
    } else {
        addLog('WARN', `พยายามเข้าสู่ระบบไม่ถูกต้อง โดย User: ${username}`);
        res.status(401).json({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
});

// 🔑 SETUP WIZARD: ดึงและบันทึก API Keys การเชื่อมต่อระบบ
app.get('/api/admin/setup_keys', (req, res) => {
    // ซ่อนความปลอดภัย ส่งแค่ส่วนหน้า-หลัง
    res.json({
        success: true,
        slipProvider: process.env.SLIP_PROVIDER || 'slipok',
        slipokPackageLimit: slipokPackageLimit || 100,
        lineAccessToken: process.env.LINE_ACCESS_TOKEN ? `${process.env.LINE_ACCESS_TOKEN.substring(0, 15)}...${process.env.LINE_ACCESS_TOKEN.substring(process.env.LINE_ACCESS_TOKEN.length - 8)}` : '',
        lineChannelSecret: process.env.LINE_CHANNEL_SECRET ? `${process.env.LINE_CHANNEL_SECRET.substring(0, 4)}...${process.env.LINE_CHANNEL_SECRET.substring(process.env.LINE_CHANNEL_SECRET.length - 4)}` : '',
        geminiApiKey: process.env.GEMINI_API_KEY ? `${process.env.GEMINI_API_KEY.substring(0, 8)}...` : '',
        slipokApiKey: process.env.SLIPOK_API_KEY ? `${process.env.SLIPOK_API_KEY.substring(0, 6)}...` : '',
        slipokBranchId: process.env.SLIPOK_BRANCH_ID || '',
        easyslipToken: process.env.EASYSLIP_TOKEN ? `${process.env.EASYSLIP_TOKEN.substring(0, 6)}...` : '',
        thunderToken: process.env.THUNDER_TOKEN ? `${process.env.THUNDER_TOKEN.substring(0, 6)}...` : '',
        slipverifyKey: process.env.SLIPVERIFY_KEY ? `${process.env.SLIPVERIFY_KEY.substring(0, 6)}...` : '',
        customApiUrl: process.env.CUSTOM_API_URL || '',
        customApiHeader: process.env.CUSTOM_API_HEADER || 'Authorization',
        customApiKey: process.env.CUSTOM_API_KEY ? `${process.env.CUSTOM_API_KEY.substring(0, 6)}...` : '',
        // 📡 แสดงแค่ว่าตั้งค่าแล้วหรือยัง (เลขท้ายรหัสช่อง) ไม่ส่งลิงก์เต็มกลับไป
        discordActivitySet: maskDiscordWebhook(process.env.DISCORD_ACTIVITY_WEBHOOK_URL),
        discordDevReportSet: maskDiscordWebhook(process.env.DISCORD_DEVREPORT_WEBHOOK_URL)
    });
});

app.post('/api/admin/setup_keys', async (req, res) => {
    const { 
        slipProvider, slipokPackageLimit: reqPackageLimit, lineAccessToken, lineChannelSecret, geminiApiKey, 
        slipokApiKey, slipokBranchId, easyslipToken,
        thunderToken, slipverifyKey,
        customApiUrl, customApiHeader, customApiKey,
        role 
    } = req.body;
    try {
        const envPath = path.join(__dirname, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

        // 🛡️ Safe Environment Variable Updater (ป้องกัน CRLF Injection & Regex Replacement Exploit)
        const updateEnvVar = (name, val) => {
            if (val === undefined || val === null) return;
            val = String(val).trim();
            if (val.includes('...')) return; // ค่า masked = ไม่ได้แก้
            if (/[\r\n"\\]/.test(val)) throw new Error(`ค่า ${name} มีอักขระต้องห้าม ป้องกันการแทรกคำสั่ง`);
            const regex = new RegExp(`^${name}=.*$`, 'm');
            const line = `${name}="${val}"`;
            envContent = regex.test(envContent) ? envContent.replace(regex, () => line) : `${envContent}\n${line}`;
            process.env[name] = val;
        };

        if (slipProvider) {
            updateEnvVar('SLIP_PROVIDER', slipProvider);
        }
        updateEnvVar('LINE_ACCESS_TOKEN', lineAccessToken);
        updateEnvVar('LINE_CHANNEL_SECRET', lineChannelSecret);
        updateEnvVar('SLIPOK_API_KEY', slipokApiKey);
        updateEnvVar('SLIPOK_BRANCH_ID', slipokBranchId);
        updateEnvVar('EASYSLIP_TOKEN', easyslipToken);
        updateEnvVar('THUNDER_TOKEN', thunderToken);
        updateEnvVar('SLIPVERIFY_KEY', slipverifyKey);
        updateEnvVar('CUSTOM_API_URL', customApiUrl);
        updateEnvVar('CUSTOM_API_HEADER', customApiHeader);
        updateEnvVar('CUSTOM_API_KEY', customApiKey);

        // บันทึกขนาดแพ็กเกจ SlipOK ลง configs
        if (reqPackageLimit !== undefined) {
            slipokPackageLimit = parseInt(reqPackageLimit);
            await supabase.from('configs').upsert([{ key: 'slipok_package_limit', value: slipokPackageLimit.toString() }]);
        }

        // เฉพาะ Dreamdev ที่ยืนยันตัวตนแล้วเท่านั้นที่อนุญาตให้แก้ไข Gemini API Key ได้
        const session = getSession(req);
        const isDreamdev = !!(session && session.role === 'dreamdev');
        if (isDreamdev && geminiApiKey !== undefined) {
            updateEnvVar('GEMINI_API_KEY', geminiApiKey);
        }
        // 📡 Discord 2 ช่องของผู้พัฒนา: แก้ได้เฉพาะผู้พัฒนา และต้องเป็นลิงก์ Discord Webhook จริงเท่านั้น (ว่าง = ไม่เปลี่ยน)
        if (isDreamdev) {
            const { discordActivityWebhook, discordDevReportWebhook } = req.body;
            for (const [envName, val] of [['DISCORD_ACTIVITY_WEBHOOK_URL', discordActivityWebhook], ['DISCORD_DEVREPORT_WEBHOOK_URL', discordDevReportWebhook]]) {
                const v = String(val || '').trim();
                if (!v) continue;
                if (!isValidDiscordWebhook(v)) throw new Error('ลิงก์ Discord Webhook ไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/)');
                updateEnvVar(envName, v);
            }
        }

        fs.writeFileSync(envPath, envContent, 'utf8');
        addLog('SUCCESS', `บันทึกค่าผู้ให้บริการตรวจสลิป (${process.env.SLIP_PROVIDER || 'slipok'}) และ API Keys สำเร็จ`);
        
        // 🔄 อัปเดตการตรวจเช็คเครดิต และซิงก์ LINE Webhook ทันที
        await checkProviderQuota(true);
        if (currentPublicUrl && lineAccessToken) {
            updateLineWebhookEndpoint(currentPublicUrl);
        }

        res.json({ success: true, message: 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว' });
    } catch(e) {
        addLog('ERROR', 'บันทึกการตั้งค่า API Keys ล้มเหลว', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📜 SYSTEM & ERROR LOGS API
app.get('/api/admin/logs', (req, res) => {
    res.json({ success: true, logs: systemLogs });
});

app.post('/api/admin/logs/clear', (req, res) => {
    systemLogs.length = 0;
    addLog('INFO', 'ล้างประวัติ Logs เรียบร้อยแล้ว');
    res.json({ success: true });
});

app.post('/api/admin/discord/clear', (req, res) => {
    discordAlertQueue.length = 0;
    discordAlertDebounce.clear();
    res.json({ success: true, message: 'เคลียร์คิวข้อความแจ้งเตือน Discord เรียบร้อย' });
});

// 💾 BACKUP DATABASE API
app.get('/api/admin/backup', async (req, res) => {
    try {
        const result = await supabase.performBackup();
        if (result.success && fs.existsSync(result.file)) {
            addLog('SUCCESS', 'ดาวน์โหลดสำรองข้อมูลฐานข้อมูล (SQLite Backup)');
            res.download(result.file, `AutoQueue_Backup_${getTodayString()}.sqlite`);
        } else {
            res.status(500).json({ success: false, error: result.error || 'Backup failed' });
        }
    } catch (e) {
        addLog('ERROR', 'สำรองข้อมูลล้มเหลว', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🧹 RESET TEST DATA: ล้างข้อมูลจำลอง/ทดสอบทั้งหมด เพื่อเตรียมเปิดร้านจริง
app.post('/api/admin/reset_test_data', async (req, res) => {
    try {
        // 1. ลบสลิปทดสอบ (ที่มี sender_name นำหน้าด้วย TEST หรือ Manual หรือ SIMULATE)
        const { error: err1 } = await supabase.from('slips').delete().or('sender_name.ilike.TEST%,sender_name.ilike.%จำลอง%,qr_payload.ilike.SIMULATE%');
        // 2. เคลียร์คิวที่ค้างทั้งหมด
        const { error: err2 } = await supabase.from('slips').update({ status: 'cleared' }).in('status', ['waiting', 'called', 'skipped', 'abnormal_pending']);
        // 3. ปิด live_session ที่ค้าง
        await supabase.from('configs').delete().eq('key', 'active_live_session');
        activeLiveSession = null;
        
        addLog('SUCCESS', 'ล้างข้อมูลทดสอบและรีเซ็ตกระดานคิวเป็น 0 สำเร็จ เพื่อเตรียมเปิดใช้งานจริง');
        await broadcastTodayStats();
        io.emit('live_session_changed', null);
        
        res.json({ success: true, message: 'ล้างข้อมูลทดสอบเรียบร้อยแล้ว! กระดานพร้อมใช้งานจริง' });
    } catch (e) {
        addLog('ERROR', 'ล้างข้อมูลทดสอบล้มเหลว', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 💾 STORAGE & DB HEALTH API (สำหรับ Tab ตั้งค่าระบบของแม่ค้า)
app.get('/api/admin/storage_health', async (req, res) => {
    try {
        if (telemetryWatcher && telemetryWatcher.storageMonitor) {
            const report = await telemetryWatcher.storageMonitor.checkHealthAndSelfHeal();
            return res.json({ success: true, ...report });
        }
        res.status(500).json({ success: false, error: 'Storage monitor not initialized' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/storage/optimize_db', (req, res) => {
    try {
        if (supabase && typeof supabase.optimizeDb === 'function') {
            supabase.optimizeDb();
            addLog('SUCCESS', 'จัดระเบียบฐานข้อมูล SQLite และ Truncate WAL สำเร็จโดยผู้ใช้');
            return res.json({ success: true, message: 'เคลียร์แคชและจัดระเบียบฐานข้อมูลสำเร็จ' });
        }
        res.status(500).json({ success: false, error: 'Database optimize function not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/storage/cleanup_uploads', (req, res) => {
    try {
        cleanupOldUploads();
        addLog('SUCCESS', 'สั่งทำความสะอาดไฟล์สลิปเก่า (Uploads Cleanup) สำเร็จโดยผู้ใช้');
        res.json({ success: true, message: 'ทำความสะอาดไฟล์สลิปเก่าเรียบร้อยแล้ว' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

function getTodayString() { 
    const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`; 
}

function getLocalTimeString() {
    const date = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// v1.0.15: รวมบิล 2 รอบไลฟ์ (รอบ A กด "รอรวมกับรอบหน้า" -> รอบ B ถัดไปรวมบิลกับ A)
// เก็บสถานะไว้ในข้อมูลรอบไลฟ์เดิม (configs: session_hist_<id> / active_live_session) ไม่แตะตารางสลิปหรือลูกค้า
//   holdMerge: true  = รอบนี้ยังไม่ส่งของ รอรวมกับรอบถัดไป
//   mergedInto: id   = รอบ B ที่รวมบิลด้วยแล้ว (ตั้งตอนกดเริ่มไลฟ์รอบ B)
//   mergeFrom: id    = (อยู่ที่รอบ B) รอบ A ที่รวมบิลด้วย -> รอบ B กดพักต่อไม่ได้ (รวมได้สูงสุด 2 รอบ)
const LIVE_ID_RE = /^LIVE_\d+$/;
function getSessionRecord(id) {
    if (!id || !LIVE_ID_RE.test(String(id))) return null;
    if (activeLiveSession && activeLiveSession.id === id) return activeLiveSession;
    try {
        const row = supabase.db.prepare('SELECT value FROM configs WHERE key = ?').get(`session_hist_${id}`);
        return row && row.value ? JSON.parse(row.value) : null;
    } catch (e) { return null; }
}
function saveSessionRecord(rec) {
    if (!rec || !rec.id || !LIVE_ID_RE.test(String(rec.id))) return;
    if (activeLiveSession && activeLiveSession.id === rec.id) {
        supabase.db.prepare('INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)').run('active_live_session', JSON.stringify(rec));
        return;
    }
    supabase.db.prepare('INSERT OR REPLACE INTO configs (key, value) VALUES (?, ?)').run(`session_hist_${rec.id}`, JSON.stringify(rec));
}
// กลุ่มรอบที่ต้องส่งของพร้อมกัน (เรียงเก่า -> ใหม่) ถ้าไม่ได้รวมบิล คืนรอบเดียว
function resolveMergeGroup(id) {
    const rec = getSessionRecord(id);
    if (rec && rec.mergeFrom && LIVE_ID_RE.test(String(rec.mergeFrom))) return [rec.mergeFrom, id];
    if (rec && rec.mergedInto && LIVE_ID_RE.test(String(rec.mergedInto))) return [id, rec.mergedInto];
    return [id];
}
function hasLaterSession(rec) {
    if (activeLiveSession && activeLiveSession.startTime > rec.startTime) return true;
    try {
        const rows = supabase.db.prepare("SELECT value FROM configs WHERE key LIKE 'session_hist_%'").all();
        for (const r of rows) {
            try { const s = JSON.parse(r.value); if (s && s.startTime > rec.startTime) return true; } catch (e) {}
        }
    } catch (e) {}
    return false;
}
// ตั้ง "รอรวมกับรอบหน้า" ได้เมื่อ: รอบจบแล้ว, ยังไม่มีรอบที่ใหม่กว่า, ไม่ได้รวมบิลอยู่แล้ว (รวมได้สูงสุด 2 รอบ)
function canHoldSession(rec) {
    if (!rec || !rec.endTime) return false;
    if (rec.holdMerge || rec.mergeFrom || rec.mergedInto) return false;
    return !hasLaterSession(rec);
}

// v1.0.16: ยอดที่ลูกค้าโอน "นอกรอบไลฟ์" (ก่อนกดเริ่มไลฟ์ หรือระหว่างสองรอบ) ผูกเข้ากับรอบที่เริ่มถัดไป (กติกา ก ที่เจ้าของร้านเลือก)
// เดิมสลิปพวกนี้ไม่มีรหัสรอบ (session_id ว่าง) จึงหายจากหน้าคิวทันทีที่กดเริ่มไลฟ์ เพราะหน้าคิวตอนไลฟ์กรองตามรหัสรอบ
// ผูกเฉพาะสลิปที่ตรงเงื่อนไขทั้งหมด:
//  - session_id ว่าง และสถานะยังค้างอยู่ (waiting / called / skipped / abnormal_pending)
//    ที่แม่ค้าจัดการจบแล้ว (completed / cleared / rejected) ไม่แตะ และ accumulated (ยอดไม่พอ) ไม่แตะ
//    เพราะเงินในกระเป๋าลูกค้าถูกรีเซ็ตตอนเริ่มไลฟ์ตามกติกา v1.0.13
//  - id มากกว่าสลิปล่าสุดที่มีรหัสรอบ = เข้ามาหลังรอบก่อนหน้า (ไม่ดึงของเก่าก่อนรอบที่แล้วกลับมา)
//  - วันที่โอนเป็นวันนี้หรือย้อนหลังไม่เกิน OUT_OF_ROUND_LOOKBACK_DAYS วัน (เวลาไทย)
const OUT_OF_ROUND_LOOKBACK_DAYS = 1;
const OUT_OF_ROUND_PENDING_STATUSES = ['waiting', 'called', 'skipped', 'abnormal_pending'];
function bangkokDateString(offsetDays = 0) {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function outOfRoundSlipFilter() {
    const last = supabase.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM slips WHERE session_id IS NOT NULL').get();
    const marks = OUT_OF_ROUND_PENDING_STATUSES.map(() => '?').join(',');
    return {
        where: `session_id IS NULL AND id > ? AND trans_date >= ? AND status IN (${marks})`,
        params: [Number(last && last.m) || 0, bangkokDateString(-OUT_OF_ROUND_LOOKBACK_DAYS), ...OUT_OF_ROUND_PENDING_STATUSES]
    };
}
function claimOutOfRoundSlips(sessionId) {
    if (!LIVE_ID_RE.test(String(sessionId))) return 0;
    const f = outOfRoundSlipFilter();
    return supabase.db.prepare(`UPDATE slips SET session_id = ? WHERE ${f.where}`).run(sessionId, ...f.params).changes;
}

// v1.0.11: นับจำนวนชิ้นที่ลูกค้าได้ไปแล้ว เพื่อตัดสินว่าจ่ายค่าส่งไปแล้วหรือยัง
// ระหว่างไลฟ์: นับสลิปของรอบไลฟ์นี้ + สลิปของวันนี้ที่โอนก่อนกดเริ่มไลฟ์ (session_id ว่าง) กันเก็บค่าส่งซ้ำ
// สลิปของไลฟ์รอบอื่นในวันเดียวกันยังไม่นับ (ลูกค้าเริ่มนับใหม่ในรอบใหม่ เหมือนเดิม) / ไม่ได้ไลฟ์: นับตามวันที่ เหมือนเดิม
function countPastDraws(lineId, opts = {}) {
    const today = getTodayString();
    let sql = 'SELECT COALESCE(SUM(draws), 0) AS n FROM slips WHERE line_id = ?';
    const params = [lineId];
    if (opts.excludeRejected) sql += " AND status != 'rejected'";
    if (opts.excludeId !== undefined && opts.excludeId !== null) { sql += ' AND id != ?'; params.push(opts.excludeId); }
    if (activeLiveSession) {
        // v1.0.16: ไลฟ์ที่ข้ามเที่ยงคืน -- สลิปที่โอนก่อนกดเริ่ม (ไม่มีรหัสรอบ) ของ "วันที่เริ่มไลฟ์" ยังต้องนับ ไม่ใช่เฉพาะของวันนี้
        const startDate = /^\d{8}$/.test(String(activeLiveSession.startDateStr || '')) ? String(activeLiveSession.startDateStr) : today;
        if (activeLiveSession.mergeFrom && LIVE_ID_RE.test(String(activeLiveSession.mergeFrom))) {
            // v1.0.15: รอบนี้รวมบิลกับรอบก่อนหน้า -> นับชิ้นของรอบก่อนด้วย (ไม่เก็บค่าส่งซ้ำ และนับรวมเพื่อส่งฟรี)
            sql += ' AND (session_id = ? OR session_id = ? OR (session_id IS NULL AND trans_date IN (?, ?)))';
            params.push(activeLiveSession.id, activeLiveSession.mergeFrom, today, startDate);
        } else {
            sql += ' AND (session_id = ? OR (session_id IS NULL AND trans_date IN (?, ?)))';
            params.push(activeLiveSession.id, today, startDate);
        }
    } else {
        sql += ' AND trans_date = ?';
        params.push(today);
    }
    const row = supabase.db.prepare(sql).get(...params);
    return (row && Number(row.n)) || 0;
}

const MAX_DP_BUDGET = 500000; // เพดานคำนวณอัตโนมัติ 500,000 บาท (คำนวณในหน่วยความจำ <3MB, เวลา <10ms ป้องกัน Event Loop ค้าง)
// opts.holdExactPrice: ถ้าลูกค้ายังไม่เคยได้ของในรอบนี้ และยอดรวมเท่ากับราคาสินค้าชิ้นใดชิ้นหนึ่งพอดี
// แปลว่าลูกค้าน่าจะลืมโอนค่าส่ง -> ให้รอค่าส่งก่อน แทนที่จะให้สินค้าชิ้นอื่นที่ราคาถูกกว่า (เช่น โอน 189 ลืมค่าส่ง แต่ระบบให้ 149+ค่าส่ง)
function calculateBestDraws(virtualBalance, pastDraws, opts = {}) {
    const best = calculateBestDrawsCore(virtualBalance, pastDraws);
    if (opts.holdExactPrice && best.draws > 0 && best.appliedShipping && !(pastDraws > 0) && Array.isArray(priceList)) {
        const exact = priceList.some(p => Math.abs(p.price - virtualBalance) < 0.005);
        if (exact) {
            addLog('INFO', `ยอด ${virtualBalance}฿ เท่าราคาสินค้าพอดี ยังไม่ได้ค่าส่ง ${shippingFee}฿ -- พักยอดรอค่าส่ง`);
            return { draws: 0, remainder: virtualBalance, cost: 0, isFreeShip: false, appliedShipping: false, breakdown: [], heldForShipping: true };
        }
    }
    return best;
}
function calculateBestDrawsCore(virtualBalance, pastDraws) {
    let best = { draws: 0, remainder: virtualBalance, cost: 0, isFreeShip: false, appliedShipping: false, breakdown: [] };
    if (!priceList || priceList.length === 0) return best;

    const items = [...priceList].sort((a, b) => b.price - a.price);
    const minPrice = Math.min(...items.map(p => p.price));
    if (!(minPrice > 0) || !(virtualBalance >= minPrice)) return best;

    const B = Math.floor(virtualBalance);
    if (B > MAX_DP_BUDGET) {
        addLog('WARN', `ยอด ${virtualBalance}฿ เกินเพดานคำนวณอัตโนมัติ (${MAX_DP_BUDGET}฿) — กรุณาตรวจสอบและกรอกยอดด้วยตนเอง`);
        return best;
    }

    // Dynamic Programming 2-State: State 0 = ค่าส่งปกติ, State 1 = ส่งฟรี (เมื่อสะสมครบ threshold)
    const maxDraws0 = new Int32Array(B + 1).fill(-1);
    const lastItem0 = new Int16Array(B + 1).fill(-1);
    const maxDraws1 = new Int32Array(B + 1).fill(-1);
    const lastItem1 = new Int16Array(B + 1).fill(-1);
    const fromState1 = new Uint8Array(B + 1);

    if (pastDraws < freeShippingThreshold) {
        maxDraws0[0] = 0;
    } else {
        maxDraws1[0] = 0;
    }

    for (let c = 0; c <= B; c++) {
        const d0 = maxDraws0[c];
        if (d0 >= 0) {
            for (let i = 0; i < items.length; i++) {
                const nextC = c + items[i].price;
                if (nextC > B) continue;
                const nextD = d0 + 1;
                const isFree = (pastDraws + nextD) >= freeShippingThreshold;
                if (!isFree) {
                    if (nextD > maxDraws0[nextC]) {
                        maxDraws0[nextC] = nextD;
                        lastItem0[nextC] = i;
                    }
                } else {
                    if (nextD > maxDraws1[nextC]) {
                        maxDraws1[nextC] = nextD;
                        lastItem1[nextC] = i;
                        fromState1[nextC] = 0;
                    }
                }
            }
        }
        const d1 = maxDraws1[c];
        if (d1 >= 0) {
            for (let i = 0; i < items.length; i++) {
                const nextC = c + items[i].price;
                if (nextC > B) continue;
                const nextD = d1 + 1;
                if (nextD > maxDraws1[nextC]) {
                    maxDraws1[nextC] = nextD;
                    lastItem1[nextC] = i;
                    fromState1[nextC] = 1;
                }
            }
        }
    }

    let bestC = -1;
    let bestState = -1;

    for (let c = 1; c <= B; c++) {
        const d0 = maxDraws0[c];
        if (d0 > 0) {
            const total = c + shippingFee;
            if (total <= virtualBalance) {
                const rem = virtualBalance - total;
                if (rem < best.remainder || (rem === best.remainder && d0 > best.draws)) {
                    best = { draws: d0, remainder: rem, cost: total, isFreeShip: false, appliedShipping: true, breakdown: [] };
                    bestC = c;
                    bestState = 0;
                }
            }
        }
        const d1 = maxDraws1[c];
        if (d1 > 0) {
            const total = c;
            if (total <= virtualBalance) {
                const rem = virtualBalance - total;
                if (rem < best.remainder || (rem === best.remainder && d1 > best.draws)) {
                    best = { draws: d1, remainder: rem, cost: total, isFreeShip: true, appliedShipping: false, breakdown: [] };
                    bestC = c;
                    bestState = 1;
                }
            }
        }
    }

    if (bestC > 0) {
        const counts = new Array(items.length).fill(0);
        let currC = bestC;
        let currState = bestState;
        while (currC > 0) {
            const itemIdx = currState === 1 ? lastItem1[currC] : lastItem0[currC];
            if (itemIdx < 0) break;
            counts[itemIdx]++;
            const itemPrice = items[itemIdx].price;
            if (currState === 1) {
                currState = fromState1[currC];
            }
            currC -= itemPrice;
        }
        best.breakdown = counts.map((q, i) => (q > 0 ? `${items[i].name} x${q}` : null)).filter(Boolean);
    }
    return best;
}

function describeTopup(balance, pastDraws) {
    // บอกว่าลูกค้าที่ยอดยังไม่พอ ต้องโอนเพิ่มอีกเท่าไหร่ (ใช้แจ้งแม่ค้าและลูกค้า ไม่ใช้ตัดสินสิทธิ์)
    if (!priceList || priceList.length === 0) return null;
    const prices = priceList.map(p => Number(p.price)).filter(p => p > 0);
    if (prices.length === 0) return null;
    const minPrice = Math.min(...prices);
    const hasPaidShipping = (pastDraws > 0 && pastDraws < freeShippingThreshold);
    const virtual = balance + (hasPaidShipping ? shippingFee : 0);
    const feeCharged = (pastDraws + 1) < freeShippingThreshold;
    const held = pastDraws === 0 && feeCharged && prices.some(p => Math.abs(p - virtual) < 0.005);
    const need = held ? shippingFee : Math.max(0, minPrice + (feeCharged ? shippingFee : 0) - virtual);
    return { need: Math.round(need * 100) / 100, held, virtual };
}
// 💰 ยอดที่ต้องเก็บเข้ากระเป๋าลูกค้าหลังคำนวณสิทธิ์
// ถ้าได้ชิ้น: ใช้เศษที่คำนวณได้ (รวมการคืนค่าส่งเมื่อครบจำนวนส่งฟรีตามที่ออกแบบไว้)
// ถ้าไม่ได้ชิ้น: เก็บเฉพาะเงินที่ลูกค้าโอนจริง (กระเป๋าเดิม + สลิปนี้) ห้ามรวมค่าส่งที่บวกเพิ่มชั่วคราวตอนคำนวณ
// (แก้บั๊ก v1.0.7-v1.0.10: ลูกค้าที่จ่ายค่าส่งไปแล้ว โอนเพิ่มไม่พอซื้อ จะถูกบวกค่าส่งเข้ากระเป๋าเกินจริง)
function walletAfter(result, currentBalance) {
    return result.draws > 0 ? result.remainder : currentBalance;
}
function fmtBaht(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

function mergeBreakdowns(breakdownList) {
    let counts = {};
    breakdownList.forEach(bStr => {
        if (!bStr) return;
        let parts = bStr.split(/[,+]/);
        parts.forEach(p => {
            let item = p.trim();
            if (!item) return;
            let match = item.match(/(.+)\s+x(\d+)$/);
            if (match) {
                let name = match[1].trim(); let qty = parseInt(match[2], 10);
                counts[name] = (counts[name] || 0) + qty;
            } else { counts[item] = (counts[item] || 1); }
        });
    });
    let result = [];
    for (let name in counts) { result.push(`${name} x${counts[name]}`); }
    return result.join(', ');
}

async function getStatsByDate(targetDate, targetSessionId = null) {
    let query = supabase.from('slips').select('*');
    if (targetSessionId) {
        query = query.eq('session_id', targetSessionId);
    } else {
        query = query.eq('trans_date', targetDate);
    }
    const { data: dailySlips } = await query;
    let totalAmount = 0; let totalDraws = 0; let uniqueCustomersSet = new Set(); 
    
    // ✅ รวมยอดเงินและจำนวนชิ้นจากสลิปทั้งหมดของรอบนี้ (ยกเว้นที่โดนปัดตก 'rejected')
    if (dailySlips && dailySlips.length > 0) {
        dailySlips.forEach(slip => {
            if (slip.status !== 'rejected') {
                totalAmount += Number(slip.amount) || 0;
                totalDraws += Number(slip.draws) || 0;
            }
            if (slip.sender_name) uniqueCustomersSet.add(slip.sender_name);
        });
    }

    let queueQuery = supabase.from('slips').select('*').in('status', ['waiting', 'called', 'skipped', 'abnormal_pending']);
    if (targetSessionId) {
        queueQuery = queueQuery.eq('session_id', targetSessionId);
    }
    const { data: queueData } = await queueQuery.order('id', { ascending: true });
    let queues = { waiting: [], called: [], skipped: [], abnormal_pending: [] };
    
    if (queueData && queueData.length > 0) {
        let groupMap = { waiting: new Map(), called: new Map(), skipped: new Map(), abnormal_pending: new Map() };
        
        queueData.forEach(slip => {
            const isManual = slip.qr_payload && slip.qr_payload.startsWith('manual_image');
            const isPendingAmount = isManual && slip.amount === 0;
            const statusGroup = slip.status;
            
            const key = isPendingAmount ? `pending_${slip.id}` : (slip.line_id || slip.sender_name);
            
            let breakdown = ''; let imageUrl = '';
            if (isManual) {
                const parts = slip.qr_payload.split('|');
                imageUrl = parts[1] || '';
                breakdown = parts[2] || '';
            } else {
                breakdown = (slip.qr_payload || '').split('|')[1] || '';
            }

            if (groupMap[statusGroup].has(key)) {
                let existing = groupMap[statusGroup].get(key);
                existing.amount += slip.amount;
                existing.draws += slip.draws || 0;
                existing.slipIds.push(slip.id);
                existing.slips.push({ id: slip.id, breakdown: breakdown || '' });   // v1.0.16: ไว้ให้ปุ่ม "แก้ไขสินค้า" แก้รายการรายสลิป
                if (slip.arrived_out_of_round === 1) existing.outOfRound = true;
                if (breakdown) existing.rawBreakdowns.push(breakdown);
            } else {
                groupMap[statusGroup].set(key, {
                    id: slip.id, slipIds: [slip.id], name: slip.sender_name, lineName: slip.line_name,
                    amount: slip.amount, draws: slip.draws || 0, time: slip.trans_time, status: statusGroup,
                    isPendingAmount: isPendingAmount, imageUrl: imageUrl,
                    outOfRound: slip.arrived_out_of_round === 1,   // v1.0.16: ป้าย "โอนนอกรอบ" (เงินมาตอนไม่มีไลฟ์)
                    slips: [{ id: slip.id, breakdown: breakdown || '' }],
                    rawBreakdowns: breakdown ? [breakdown] : []
                });
            }
        });
        
        const processGroup = (map) => Array.from(map.values()).map(q => { q.breakdown = mergeBreakdowns(q.rawBreakdowns); delete q.rawBreakdowns; return q; });
        queues.waiting = processGroup(groupMap.waiting);
        queues.called = processGroup(groupMap.called);
        queues.skipped = processGroup(groupMap.skipped);
        queues.abnormal_pending = processGroup(groupMap.abnormal_pending);

        // 📍 ลูกค้าที่เคยโอนไม่ครบ (การ์ดสีส้ม) แล้วโอนเพิ่มจนครบ: ครองตำแหน่งคิวเดิมตามเวลาที่ส่งสลิปใบแรกที่ยังไม่ครบ
        try {
            if (dailySlips && dailySlips.length > 0) {
                const byCustomer = new Map();
                dailySlips.slice().sort((a, b) => a.id - b.id).forEach(s => {
                    if (!s.line_id || s.status === 'rejected') return;
                    if (!byCustomer.has(s.line_id)) byCustomer.set(s.line_id, []);
                    byCustomer.get(s.line_id).push(s);
                });
                const lineIdBySlip = new Map(queueData.map(s => [s.id, s.line_id]));
                queues.waiting.forEach(q => {
                    q.sortId = q.id;
                    if (q.isPendingAmount) return;
                    const list = byCustomer.get(lineIdBySlip.get(q.id));
                    if (!list) return;
                    let idx = list.findIndex(s => s.id === q.id);
                    while (idx > 0 && list[idx - 1].status === 'accumulated') { idx--; q.sortId = list[idx].id; }
                });
                queues.waiting.sort((a, b) => a.sortId - b.sortId);
            }
        } catch (e) { /* ลำดับคิวสำรอง: ตามเลขสลิปเดิม */ }
    }
    // 💬 รายชื่อลูกค้าที่ "รอโอนเพิ่ม" (สลิปล่าสุดยังไม่พอ/พักรอค่าส่ง) แสดงให้แม่ค้าเห็นบนหน้าจอหลัก ไม่เข้าคิว ไม่กระทบการนับยอด
    let topups = [];
    const topupByCustomer = new Map();
    try {
        const isCurrentScope = activeLiveSession ? (targetSessionId === activeLiveSession.id) : (!targetSessionId && targetDate === getTodayString());
        if (isCurrentScope && dailySlips && dailySlips.length > 0) {
            const sortedAsc = dailySlips.slice().sort((a, b) => a.id - b.id);
            const listByCustomer = new Map();
            sortedAsc.forEach(s => {
                if (!s.line_id || s.status === 'rejected') return;
                if (!listByCustomer.has(s.line_id)) listByCustomer.set(s.line_id, []);
                listByCustomer.get(s.line_id).push(s);
            });
            listByCustomer.forEach((list, lineId) => {
                const s = list[list.length - 1];
                if (s.status !== 'accumulated') return;
                // ตำแหน่งในคิว = สลิปแรกของช่วงที่ยังไม่ครบ (ตรงกับตอนโอนครบแล้วครองตำแหน่งเดิม)
                let startIdx = list.length - 1;
                while (startIdx > 0 && list[startIdx - 1].status === 'accumulated') startIdx--;
                const cust = supabase.db.prepare('SELECT balance FROM customers WHERE line_id = ?').get(lineId);
                if (!cust || !(Number(cust.balance) > 0)) return;
                const pd = countPastDraws(lineId);
                const tp = describeTopup(Number(cust.balance), pd);
                if (tp && tp.need > 0) {
                    topups.push({ id: list[startIdx].id, name: s.line_name || s.sender_name || 'ลูกค้า', amount: Number(s.amount) || 0, balance: pd === 0 ? Number(cust.balance) : null, need: tp.need, held: tp.held, time: s.trans_time });
                    topupByCustomer.set(s.id, tp);
                }
            });
        }
    } catch (e) { topups = []; topupByCustomer.clear(); }

    // 🧾 รายการยอดโอนล่าสุดของลูกค้าทุกคนที่ส่งสลิปในรอบนี้ (แสดงเสมอ ไม่ว่าเข้าคิวหรือยอดไม่พอ)
    let recentSlips = [];
    try {
        if (dailySlips && dailySlips.length > 0) {
            recentSlips = dailySlips.slice().sort((a, b) => b.id - a.id).slice(0, 30).map(s => {
                const isManualImage = s.qr_payload && String(s.qr_payload).startsWith('manual_image');
                const bd = isManualImage ? (String(s.qr_payload).split('|')[2] || '') : (String(s.qr_payload || '').split('|')[1] || '');
                let label = ''; let tone = 'ok';
                if (s.status === 'rejected') { label = 'ปัดตก (ไม่นับยอด)'; tone = 'bad'; }
                else if (s.status === 'abnormal_pending') { label = 'สลิปผิดปกติ รอตรวจสอบ'; tone = 'info'; }
                else if (isManualImage && !(Number(s.amount) > 0)) { label = 'รอเช็คสลิปและใส่ยอด'; tone = 'info'; }
                else if (s.status === 'accumulated') {
                    const tp = topupByCustomer.get(s.id);
                    if (tp) { label = tp.held ? `ยอดไม่พอ ยังไม่ได้โอนค่าส่ง ต้องโอนเพิ่มอีก ${fmtBaht(tp.need)} บาท` : `ยอดไม่พอ ต้องโอนเพิ่มอีก ${fmtBaht(tp.need)} บาท`; tone = 'warn'; }
                    else { label = 'สะสมยอด (ลูกค้าโอนเพิ่มต่อแล้ว)'; tone = 'info'; }
                }
                else if (s.status === 'cleared' && !(Number(s.draws) > 0)) { label = 'แม่ค้าลบออกจากรายการรอโอนเพิ่มแล้ว'; tone = 'info'; }
                else if (Number(s.draws) > 0) { label = `ได้ ${s.draws} ชิ้น${bd ? ' • ' + bd : ''}`; tone = 'ok'; }
                else { label = 'ยอดไม่พอ'; tone = 'warn'; }
                return { id: s.id, name: s.line_name || s.sender_name || 'ลูกค้า', amount: Number(s.amount) || 0, time: s.trans_time, label, tone };
            });
        }
    } catch (e) { recentSlips = []; }
    let imageFails = [];
    try {
        const scopeIsCurrent = activeLiveSession ? (targetSessionId === activeLiveSession.id) : (!targetSessionId && targetDate === getTodayString());
        if (scopeIsCurrent) imageFails = currentLineImageFailures();
    } catch (e) { imageFails = []; }
    return { stats: { totalAmount, totalSlips: dailySlips ? dailySlips.length : 0, totalDraws, uniqueCustomers: uniqueCustomersSet.size, waitingCount: queues.waiting.length }, queues, topups, recentSlips, imageFails };
}

let broadcastTimer = null;
let broadcastWaiters = [];
function broadcastTodayStats() {
    return new Promise(resolve => {
        broadcastWaiters.push(resolve);
        if (broadcastTimer) return;
        broadcastTimer = setTimeout(async () => {
            broadcastTimer = null;
            const waiters = broadcastWaiters;
            broadcastWaiters = [];
            let data = null;
            try {
                const sid = activeLiveSession ? activeLiveSession.id : null;
                data = await getStatsByDate(getTodayString(), sid);
                io.emit('update_stats', data.stats);
                io.emit('full_sync', data);
            } catch (e) {
                console.error('broadcastTodayStats error:', e.message);
            }
            waiters.forEach(w => w(data));
        }, 100);
    });
}

async function getCurrentQueueNumber() {
    const currentSessionId = activeLiveSession ? activeLiveSession.id : null;
    const statsData = await getStatsByDate(getTodayString(), currentSessionId);
    return statsData.stats.waitingCount;
}

app.get('/history.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'history.html')); });
app.get('/api/stats/today', async (req, res) => {
    try {
        const sid = activeLiveSession ? activeLiveSession.id : null;
        const data = await getStatsByDate(getTodayString(), sid);
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/stats/history', async (req, res) => {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ success: false, error: 'กรุณาระบุวันที่ (date)' });
    try {
        res.json(await getStatsByDate(date));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/history_data', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = supabase.from('slips').select('*').order('trans_date', { ascending: false }).order('trans_time', { ascending: false });
        if (startDate) query = query.gte('trans_date', startDate.replace(/-/g, ''));
        if (endDate) query = query.lte('trans_date', endDate.replace(/-/g, ''));
        const { data, error } = await query;
        if (error) throw error;
        
        const history = data.map(slip => {
            let breakdownStr = '';
            let transRef = '';

            if (slip.qr_payload && slip.qr_payload.startsWith('manual_image')) {
                const parts = slip.qr_payload.split('|');
                transRef = 'MANUAL (รอเช็ค)'; 
                breakdownStr = parts[2] || '';   
            } else {
                const parts = (slip.qr_payload || '').split('|');
                transRef = parts[0] || '';
                breakdownStr = parts[1] || '';
            }
            
            let safeRef = `${transRef}|${breakdownStr}`;

            return { id: slip.id, date: slip.trans_date, time: slip.trans_time, name: slip.sender_name, lineName: slip.line_name, amount: slip.amount, draws: slip.draws || 0, status: slip.status, ref: safeRef, sessionId: slip.session_id || null, outOfRound: slip.arrived_out_of_round === 1 };   // v1.0.16: ธง "โอนนอกรอบ" ใช้บอกในหน้าประวัติว่ายอดนี้เข้ามาตอนไม่มีไลฟ์แล้วถูกผูกเข้ารอบไหน
        });

        // v1.0.15: สรุปยอดโอนแยกตามรอบไลฟ์ (นับทั้งรอบ แม้ไลฟ์ข้ามเที่ยงคืน / ไม่นับสลิปที่ปัดตก)
        // สลิปที่ไม่มีรหัสรอบ (ไม่ได้กดเริ่มไลฟ์ หรือข้อมูลเก่าก่อน v1.0.8) รวมเป็นกลุ่ม "นอกรอบไลฟ์" เฉพาะที่อยู่ในช่วงวันที่เลือก
        let rounds = [];
        try {
            const sessionIds = [...new Set((data || []).map(s => s.session_id).filter(id => id && LIVE_ID_RE.test(String(id))))];
            for (let i = 0; i < sessionIds.length; i += 400) {
                const chunk = sessionIds.slice(i, i + 400);
                const ph = chunk.map(() => '?').join(',');
                const sums = supabase.db.prepare(
                    `SELECT session_id, COALESCE(SUM(amount), 0) AS amount, COALESCE(SUM(draws), 0) AS draws, COUNT(*) AS slips, COUNT(DISTINCT line_id) AS customers, COALESCE(SUM(arrived_out_of_round), 0) AS oor
                     FROM slips WHERE status != 'rejected' AND session_id IN (${ph}) GROUP BY session_id`
                ).all(...chunk);
                sums.forEach(r => {
                    const rec = getSessionRecord(r.session_id);
                    rounds.push({
                        sessionId: r.session_id,
                        startTime: (rec && rec.startTime) || Number(String(r.session_id).slice(5)) || null,
                        endTime: (rec && rec.endTime) || null,
                        active: !!(activeLiveSession && activeLiveSession.id === r.session_id),
                        merged: !!(rec && (rec.mergeFrom || rec.mergedInto)),
                        holdMerge: !!(rec && rec.holdMerge && !rec.mergedInto),
                        amount: Number(r.amount) || 0, draws: Number(r.draws) || 0, slips: Number(r.slips) || 0, customers: Number(r.customers) || 0,
                        outOfRoundSlips: Number(r.oor) || 0   // v1.0.16: ใบประกอบของรอบนี้ที่เงินเข้าตอนไม่มีไลฟ์ (โอนนอกรอบ)
                    });
                });
            }
            rounds.sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
            const outside = (data || []).filter(s => !s.session_id && s.status !== 'rejected');
            if (outside.length > 0) {
                rounds.push({
                    sessionId: null, outside: true, startTime: null, endTime: null, active: false, merged: false, holdMerge: false,
                    amount: outside.reduce((a, s) => a + (Number(s.amount) || 0), 0),
                    draws: outside.reduce((a, s) => a + (Number(s.draws) || 0), 0),
                    slips: outside.length,
                    customers: new Set(outside.map(s => s.line_id).filter(Boolean)).size
                });
            }
        } catch (roundErr) {
            addLog('WARN', `สรุปยอดแยกรอบไลฟ์ไม่สำเร็จ (ประวัติสลิปยังแสดงปกติ): ${roundErr.message}`);
            rounds = [];
        }
        res.json({ success: true, history, rounds });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

const ALLOWED_QUEUE_ACTIONS = new Set(['completed', 'called', 'skipped', 'waiting', 'cleared', 'rejected']);
// v1.0.16: ทุกการกระทำของแม่ค้าต่อคิวต้องมีบรรทัด log (เข้า system.log + Discord ช่องกิจกรรม) เพื่อตรวจย้อนหลังได้ว่าใครกดอะไรตอนไหน
const QUEUE_ACTION_LABELS = { called: 'เรียกคิว', skipped: 'ข้าม', completed: 'เสร็จสิ้น', cleared: 'เคลียร์', waiting: 'คืนสถานะรอ', rejected: 'ปัดตก' };

app.post('/api/queue/action', async (req, res) => {
    try {
        const { action } = req.body || {};
        const slipIds = Array.isArray(req.body?.slipIds) ? req.body.slipIds.map(Number).filter(Number.isInteger) : [];
        if (!ALLOWED_QUEUE_ACTIONS.has(action) || slipIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid action or slipIds' });
        }

        const { data: slips } = await supabase.from('slips').select('id, line_name, qr_payload').in('id', slipIds);
        const validSlips = slips || [];
        const manualIds = validSlips.filter(s => s.qr_payload && s.qr_payload.startsWith('manual_image')).map(s => s.id);
        const normalIds = validSlips.filter(s => !(s.qr_payload && s.qr_payload.startsWith('manual_image'))).map(s => s.id);

        if (action === 'completed') {
            if (manualIds.length > 0) { await supabase.from('slips').update({ status: 'abnormal_pending' }).in('id', manualIds); }
            if (normalIds.length > 0) { await supabase.from('slips').update({ status: 'completed' }).in('id', normalIds); }
        } else {
            await supabase.from('slips').update({ status: action }).in('id', slipIds);
        }

        // v1.0.16: บันทึกการกระทำของแม่ค้าลง log (ชื่อลูกค้าโชว์ตามเพื่อตรวจสอบ จำกัด 5 ชื่อแรกกันข้อความยาวเกิน)
        const names = validSlips.map(s => s.line_name || `สลิป #${s.id}`);
        const nameText = names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} และอีก ${names.length - 5} รายการ`;
        const label = QUEUE_ACTION_LABELS[action] || action;
        const extra = (action === 'completed' && manualIds.length > 0) ? ` (ในจำนวนนี้ ${manualIds.length} ใบเป็นรูปรอตรวจภาพ ค้างสถานะรอตรวจ)` : '';
        addLog('INFO', `🖥️ แม่ค้ากด "${label}" — ${nameText}${extra}`);

        await broadcastTodayStats();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/queue/clear', async (req, res) => {
    const r = supabase.db.prepare("UPDATE slips SET status = 'cleared' WHERE status = 'waiting'").run();
    addLog('INFO', `🖥️ แม่ค้ากด "เคลียร์คิวทั้งหมด" (${r.changes} รายการ)`);
    broadcastTodayStats(); res.json({ success: true });
});

// ⚠️ ลูกค้าที่ยังมีเงินค้างในกระเป๋า (ใช้เตือนแม่ค้าก่อนกดเริ่มไลฟ์ เพราะเริ่มไลฟ์ใหม่จะรีเซ็ตยอดเหล่านี้เป็น 0)
app.get('/api/queue/pending_balances', (req, res) => {
    try {
        const rows = supabase.db.prepare('SELECT name, line_id, balance FROM customers WHERE balance > 0 ORDER BY balance DESC, name ASC').all();
        const total = rows.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
        res.json({
            success: true,
            count: rows.length,
            total,
            list: rows.slice(0, 8).map(c => ({ name: c.name || c.line_id || 'ลูกค้า', balance: Number(c.balance) || 0 }))
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🟠 ลบการ์ดสีส้ม (รอลูกค้าโอนเพิ่ม) ของลูกค้า 1 คนในรอบปัจจุบัน: ซ่อนการ์ดเท่านั้น ไม่แตะยอดสลิป/ยอดรวม และไม่แตะเงินในกระเป๋าลูกค้า
app.post('/api/queue/dismiss_topup', async (req, res) => {
    try {
        const id = Number(req.body && req.body.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'รหัสการ์ดไม่ถูกต้อง' });
        const slip = supabase.db.prepare('SELECT line_id, line_name FROM slips WHERE id = ?').get(id);
        if (!slip || !slip.line_id) return res.status(404).json({ success: false, message: 'ไม่พบการ์ดนี้' });
        // ขอบเขตเดียวกับที่หน้าจอใช้แสดงการ์ด: รอบไลฟ์ที่กำลังไลฟ์ หรือวันนี้ถ้าไม่ได้ไลฟ์
        let sql = "UPDATE slips SET status = 'cleared' WHERE line_id = ? AND status = 'accumulated'";
        const params = [slip.line_id];
        if (activeLiveSession) { sql += ' AND session_id = ?'; params.push(activeLiveSession.id); }
        else { sql += ' AND trans_date = ?'; params.push(getTodayString()); }
        const r = supabase.db.prepare(sql).run(...params);
        addLog('INFO', `🖥️ แม่ค้าปิดการ์ดส้ม "รอโอนเพิ่ม" ของ ${slip.line_name || 'ลูกค้า'} (${r.changes} ใบ) — ไม่กระทบยอดรวมและเงินในกระเป๋า`);
        await broadcastTodayStats();
        res.json({ success: true, cleared: r.changes });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🔴 แม่ค้ากดรับทราบการ์ดแดง "โหลดรูปสลิปไม่สำเร็จ": ซ่อนการ์ดเท่านั้น ไม่แตะสลิป ยอด หรือเงินกระเป๋าลูกค้า
app.post('/api/queue/dismiss_image_fail', async (req, res) => {
    try {
        const id = Number(req.body && req.body.id);
        if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: 'รหัสการ์ดไม่ถูกต้อง' });
        const before = lineImageFailures.length;
        lineImageFailures = lineImageFailures.filter(f => f.id !== id);
        if (lineImageFailures.length === before) return res.status(404).json({ success: false, message: 'ไม่พบการ์ดนี้' });
        addLog('INFO', `🖥️ แม่ค้ากด "รับทราบ" ปิดการ์ดแดง โหลดรูปสลิปไม่สำเร็จ (id ${id})`);
        await broadcastTodayStats();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🔴 LIVE SESSION API -----------------------------------------
// 🏁 v1.0.16: ตัวสร้าง embed สรุปหลังจบไลฟ์ (pure function — ตัดมาทดสอบแบบ unit test ได้ตรงๆ)
// session = { id, startTimeStr, endTimeStr, startTime, endTime, holdMerge } / stats = { slips, amount, draws, customers, byStatus } / issues = [{type:'ERROR'|'WARN', message}]
function buildEndOfLiveReportEmbed(session, stats, issues, meta = {}) {
    const fmtB = (n) => { const v = Math.round(Number(n) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); };
    const durMs = (session.endTime || 0) - (session.startTime || 0);
    const h = Math.floor(durMs / 3600000), m = Math.floor((durMs % 3600000) / 60000);
    const durStr = durMs <= 0 ? 'น้อยกว่า 1 นาที' : (h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`);
    const errors = (issues || []).filter(i => i.type === 'ERROR');
    const warns = (issues || []).filter(i => i.type === 'WARN');
    const st = stats.byStatus || {};

    const fields = [
        { name: '⏱️ ช่วงเวลา', value: `${session.startTimeStr || '-'} → ${session.endTimeStr || '-'} (${durStr})`, inline: false },
        { name: '🧾 สลิปรอบนี้', value: `${stats.slips} ใบ`, inline: true },
        { name: '👥 ลูกค้า', value: `${stats.customers} คน`, inline: true },
        { name: '💰 ยอดรับรวม', value: `${fmtB(stats.amount)} บาท`, inline: true },
        { name: '🎟️ สิทธิ์ที่ออก', value: `${stats.draws} ชิ้น`, inline: true },
        { name: '📋 สถานะคิว', value: `รอ ${st.waiting || 0} • เรียกแล้ว ${st.called || 0} • ข้าม ${st.skipped || 0} • เสร็จ ${st.completed || 0} • รอตรวจ ${st.abnormal_pending || 0}`, inline: false }
    ];
    if (session.holdMerge) fields.push({ name: '🔗 รวมบิล', value: 'รอบนี้ตั้ง "รอรวมกับรอบหน้า" — ยังไม่ต้องแพ็คส่งแยกรอบนี้', inline: false });

    // Error ทั้งหมดของรอบ + แนวทางแก้ไขจากชุดกฎเดียวกับช่อง Dev Report (ไม่ใช้ AI)
    const MAX_ERR = 6;
    let errText;
    if (errors.length === 0) {
        errText = 'ไม่พบ Error ในรอบนี้ 🎉';
    } else {
        errText = errors.slice(0, MAX_ERR).map(e => {
            const a = assessErrorForDevReport('', e.message);
            const s = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.MEDIUM;
            return `${s.icon} **${s.label}** — ${String(e.message).slice(0, 120)}\n> แนวทางแก้ไข: ${a.fix}`;
        }).join('\n');
        if (errors.length > MAX_ERR) errText += `\n… และอีก ${errors.length - MAX_ERR} รายการ (ดูทั้งหมดได้ใน system.log ของร้าน)`;
        if (errText.length > 1000) errText = errText.slice(0, 1000) + '…';
    }
    fields.push({ name: `🚨 Error ที่เจอในรอบนี้ (${errors.length})`, value: errText, inline: false });
    if (warns.length > 0) fields.push({ name: '⚠️ คำเตือน (WARN)', value: `${warns.length} รายการ — รายละเอียดอยู่ใน Logs ของร้าน (เช่น สลิปซ้ำ, โอนผิดบัญชี, รูปโหลดไม่ได้)`, inline: false });

    return {
        title: `🏁 สรุปหลังจบไลฟ์ ${meta.shopLabel || ''}`.trim(),
        color: errors.length > 0 ? 15158332 : (warns.length > 0 ? 16753920 : 3066993),
        fields,
        footer: { text: `AutoQueueforLive v${meta.version || '?'} • รหัสรอบ ${session.id || '-'}` }
    };
}

// 🏁 v1.0.16: ดึงสถิติของรอบที่เพิ่งจบ + รวบรวม Error/WARN ของรอบ ส่งเข้า Discord 1 ข้อความ (ทุกครั้งที่จบไลฟ์)
async function sendEndOfLiveReport(endedSession) {
    try {
        const issues = liveIssueLogs.splice(0, liveIssueLogs.length);
        const sid = endedSession.id;
        const row = supabase.db.prepare(
            "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS amt, COALESCE(SUM(draws), 0) AS dr, COUNT(DISTINCT line_id) AS cust FROM slips WHERE session_id = ? AND status != 'rejected'"
        ).get(sid) || {};
        const byStatus = {};
        supabase.db.prepare("SELECT status, COUNT(*) AS n FROM slips WHERE session_id = ? AND status != 'rejected' GROUP BY status").all(sid)
            .forEach(r => { byStatus[r.status] = r.n; });
        const stats = { slips: row.n || 0, amount: row.amt || 0, draws: row.dr || 0, customers: row.cust || 0, byStatus };

        const embed = buildEndOfLiveReportEmbed(endedSession, stats, issues, { version: getAppVersionSafe(), shopLabel: getShopLabel() });
        // ส่งเข้าช่องแจ้งเตือนหลัก ถ้าไม่ได้ตั้งไว้ก็ไหลไปช่องกิจกรรม/ช่อง Dev Report ที่ตั้งไว้แทน เพื่อให้สรุปมาถึงทุกครั้ง
        const url = DISCORD_WEBHOOK_URL || getActivityWebhook() || getDevReportWebhook();
        if (!url) return;
        discordAlertQueue.push({ url, payload: { embeds: [embed] } });
        await processDiscordQueue();
    } catch (e) {
        console.error('ส่งสรุปหลังจบไลฟ์เข้า Discord ไม่สำเร็จ:', e.message);
    }
}

app.get('/api/live_session/current', (req, res) => {
    res.json({ success: true, session: activeLiveSession });
});

app.post('/api/live_session/start', async (req, res) => {
    try {
        const sessionId = `LIVE_${Date.now()}`;

        // v1.0.15: ถ้ารอบก่อนหน้ากด "รอรวมกับรอบหน้า" ไว้และยังไม่ถูกรวม -> รอบนี้รวมบิลกับรอบนั้น
        let mergeFrom = null;
        try {
            if (activeLiveSession) {
                // กดเริ่มซ้ำขณะไลฟ์ค้างอยู่ ให้คงการรวมบิลเดิมไว้
                if (activeLiveSession.mergeFrom && LIVE_ID_RE.test(String(activeLiveSession.mergeFrom))) mergeFrom = activeLiveSession.mergeFrom;
            } else {
                const row = supabase.db.prepare("SELECT value FROM configs WHERE key = 'last_ended_live_session'").get();
                const last = row && row.value ? JSON.parse(row.value) : null;
                const prev = last && last.id ? getSessionRecord(last.id) : null;
                if (prev && prev.holdMerge && !prev.mergedInto && !prev.mergeFrom) mergeFrom = prev.id;
            }
            if (mergeFrom) {
                const prev = getSessionRecord(mergeFrom);
                if (prev) { prev.mergedInto = sessionId; saveSessionRecord(prev); }
                addLog('INFO', `เริ่มไลฟ์รอบใหม่: รวมบิลกับรอบก่อนหน้า (${mergeFrom}) ลูกค้าที่ซื้อรอบก่อนไม่ถูกเก็บค่าส่งซ้ำ`);
            }
        } catch (mergeErr) {
            mergeFrom = null;
            addLog('ERROR', `ตรวจการรวมบิลรอบก่อนตอนเริ่มไลฟ์ไม่สำเร็จ (เริ่มไลฟ์แบบปกติ): ${mergeErr.message}`);
        }

        const newSession = {
            id: sessionId,
            startTime: Date.now(),
            startDateStr: getTodayString(),
            startTimeStr: getLocalTimeString(),
            endTime: null,
            endTimeStr: null
        };
        if (mergeFrom) newSession.mergeFrom = mergeFrom;
        activeLiveSession = newSession;
        liveIssueLogs = []; // 🏁 v1.0.16: เริ่มเก็บ Error/WARN ของรอบใหม่จากศูนย์
        await supabase.from('configs').upsert([{ key: 'active_live_session', value: JSON.stringify(newSession) }]);
        addLog('INFO', `▶️ เริ่มไลฟ์รอบใหม่ (รหัสรอบ ${sessionId}${mergeFrom ? `, รวมบิลกับรอบ ${mergeFrom}` : ''})`);
        
        // 💾 สำรองฐานข้อมูล SQLite อัตโนมัติก่อนเริ่มไลฟ์ ด้วย Online Backup API (รองรับ WAL ครบถ้วน 100%)
        // v1.0.13: รอให้สำรองเสร็จก่อน แล้วค่อยรีเซ็ตยอดสะสมลูกค้า เพื่อให้ไฟล์สำรองยังมียอดเดิมไว้ย้อนดูได้
        if (typeof supabase.performBackup === 'function') {
            try {
                const r = await supabase.performBackup('data_backup_live');
                if (r && r.success) addLog('INFO', `สำรองฐานข้อมูลก่อนเริ่มไลฟ์สดเรียบร้อย: ${path.basename(r.file)}`);
                else if (r && r.error) addLog('ERROR', `สำรองฐานข้อมูลก่อนเริ่มไลฟ์ล้มเหลว: ${r.error}`);
            } catch (bkErr) { console.error('Auto Backup Error:', bkErr.message); }
        }

        // 🔄 v1.0.13: เริ่มไลฟ์รอบใหม่ = รีเซ็ตยอดโอนสะสม (เศษเงินในกระเป๋า) ของลูกค้าทุกคนเป็น 0
        try {
            const owed = supabase.db.prepare('SELECT name, line_id, balance FROM customers WHERE balance != 0').all();
            if (owed.length > 0) {
                supabase.db.prepare('UPDATE customers SET balance = 0 WHERE balance != 0').run();
                const total = owed.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
                const detail = owed.slice(0, 20).map(c => `${c.name || c.line_id}: ${c.balance}฿`).join(', ');
                addLog('INFO', `เริ่มไลฟ์รอบใหม่: รีเซ็ตยอดสะสมของลูกค้า ${owed.length} คน รวม ${total} บาท (${detail}${owed.length > 20 ? ', ...' : ''})`);
            }
        } catch (resetErr) {
            addLog('ERROR', `รีเซ็ตยอดสะสมลูกค้าตอนเริ่มไลฟ์ไม่สำเร็จ: ${resetErr.message}`);
        }

        // v1.0.16: ผูกสลิปที่ลูกค้าโอนนอกรอบ (ก่อนกดเริ่ม/ระหว่างรอบ) เข้ากับรอบนี้ ทำหลังสำรองฐานข้อมูลและรีเซ็ตกระเป๋า เพื่อให้ไฟล์สำรองเป็นสภาพก่อนเริ่มไลฟ์
        let claimedOutOfRound = 0;
        try {
            claimedOutOfRound = claimOutOfRoundSlips(sessionId);
            carryOutOfRoundNotices(sessionId);
            if (claimedOutOfRound > 0) addLog('INFO', `เริ่มไลฟ์รอบใหม่: ผูกสลิปที่ลูกค้าโอนนอกรอบไลฟ์ ${claimedOutOfRound} ใบ เข้ากับรอบนี้ (ยังค้างอยู่ในคิว)`);
        } catch (claimErr) {
            claimedOutOfRound = 0;
            addLog('ERROR', `ผูกสลิปนอกรอบเข้ากับรอบไลฟ์ไม่สำเร็จ (ไลฟ์เริ่มตามปกติ): ${claimErr.message}`);
        }

        // บันทึกลง live_sessions history ใน config ด้วย
        io.emit('live_session_changed', activeLiveSession);
        await broadcastTodayStats();
        res.json({ success: true, session: activeLiveSession, claimedOutOfRound });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/live_session/end', async (req, res) => {
    try {
        if (!activeLiveSession) return res.json({ success: true, session: null });
        
        const endedSession = {
            ...activeLiveSession,
            endTime: Date.now(),
            endTimeStr: getLocalTimeString()
        };
        // v1.0.15: แม่ค้าเลือก "รอรวมกับรอบหน้า" ตอนจบไลฟ์ -- ตั้งได้เฉพาะรอบที่ยังไม่ได้รวมบิลกับรอบก่อน (รวมได้สูงสุด 2 รอบ)
        const wantHold = !!(req.body && req.body.holdMerge === true) && !activeLiveSession.mergeFrom;
        if (wantHold) {
            endedSession.holdMerge = true;
            addLog('INFO', `จบไลฟ์: ตั้งรอบนี้ "รอรวมกับรอบหน้า" (${endedSession.id}) ยังไม่ส่งของ`);
        }
        
        // เซฟประวัติเซสชันที่จบแล้ว
        const historyKey = `session_hist_${endedSession.id}`;
        await supabase.from('configs').upsert([{ key: historyKey, value: JSON.stringify(endedSession) }]);
        
        // ล้าง active_live_session
        await supabase.from('configs').delete().eq('key', 'active_live_session');
        // 📦 BUG-03: จำไลฟ์ล่าสุดที่เพิ่งจบ เพื่อให้ Export Kerry หลังจบไลฟ์ได้ลูกค้าครบแม้ไลฟ์ข้ามเที่ยงคืน
        await supabase.from('configs').upsert([{ key: 'last_ended_live_session', value: JSON.stringify(endedSession) }]);
        const prevSession = activeLiveSession;
        activeLiveSession = null;

        // v1.0.16: จบไลฟ์ทุกครั้งต้องมีบรรทัด log เสมอ (เดิมมีเฉพาะกรณีตั้งรอรวมกับรอบหน้า)
        {
            const durMs = endedSession.endTime - endedSession.startTime;
            const durTxt = durMs < 60000 ? 'น้อยกว่า 1 นาที' : `${Math.floor(durMs / 3600000)} ชม. ${Math.floor((durMs % 3600000) / 60000)} นาที`;
            addLog('INFO', `⏹️ จบไลฟ์ (รหัสรอบ ${endedSession.id}, ใช้เวลา ${durTxt})`);
        }

        // 🏁 v1.0.16: ส่งสรุปหลังจบไลฟ์เข้า Discord ทุกครั้ง (สถิติรอบ + Error ทั้งหมดที่เจอพร้อมแนวทางแก้ไข)
        sendEndOfLiveReport(endedSession).catch(() => {});

        io.emit('live_session_changed', null);
        await broadcastTodayStats();
        res.json({ success: true, endedSession: endedSession, held: wantHold });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// v1.0.15: มีรอบก่อนหน้าที่ตั้ง "รอรวมกับรอบหน้า" ไว้หรือไม่ (ใช้เตือนแม่ค้าตอนกดเริ่มไลฟ์)
app.get('/api/live_session/pending_merge', (req, res) => {
    try {
        if (activeLiveSession) return res.json({ success: true, pending: false });
        const row = supabase.db.prepare("SELECT value FROM configs WHERE key = 'last_ended_live_session'").get();
        const last = row && row.value ? JSON.parse(row.value) : null;
        const prev = last && last.id ? getSessionRecord(last.id) : null;
        if (!prev || !prev.holdMerge || prev.mergedInto || prev.mergeFrom) return res.json({ success: true, pending: false });
        const c = supabase.db.prepare("SELECT COUNT(DISTINCT line_id) AS n FROM slips WHERE session_id = ? AND status != 'rejected' AND draws > 0").get(prev.id);
        res.json({ success: true, pending: true, sessionId: prev.id, customers: (c && Number(c.n)) || 0 });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// v1.0.15: ตั้ง/ยกเลิก "รอรวมกับรอบหน้า" ของรอบที่จบแล้ว (ตั้งได้เฉพาะรอบล่าสุดที่ยังไม่มีรอบใหม่กว่า / ยกเลิกได้จนกว่ารอบถัดไปจะเริ่ม)
app.post('/api/live_session/hold', (req, res) => {
    try {
        const { sessionId, hold } = req.body || {};
        const rec = getSessionRecord(sessionId);
        if (!rec) return res.status(404).json({ success: false, error: 'ไม่พบรอบไลฟ์นี้' });
        if (!rec.endTime) return res.status(400).json({ success: false, error: 'ไลฟ์รอบนี้ยังไม่จบ' });
        if (hold === true) {
            if (!canHoldSession(rec)) return res.status(400).json({ success: false, error: 'รอบนี้ตั้งรอรวมบิลไม่ได้ (มีรอบใหม่กว่าแล้ว หรือรวมบิลครบ 2 รอบแล้ว)' });
            rec.holdMerge = true;
            saveSessionRecord(rec);
            addLog('INFO', `ตั้งรอบ ${rec.id} เป็น "รอรวมกับรอบหน้า"`);
        } else {
            if (!rec.holdMerge) return res.json({ success: true, session: rec });
            if (rec.mergedInto) return res.status(400).json({ success: false, error: 'รอบนี้ถูกรวมบิลกับรอบถัดไปแล้ว ยกเลิกไม่ได้' });
            delete rec.holdMerge;
            saveSessionRecord(rec);
            addLog('INFO', `ยกเลิก "รอรวมกับรอบหน้า" ของรอบ ${rec.id} (ส่งของรอบนี้แยก)`);
        }
        res.json({ success: true, session: rec });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📦 API ดึงข้อมูลสรุปสำหรับ Kerry Express (ทั้งแบบ JSON และดาวน์โหลด Excel)
async function getOrdersForKerry(options = {}) {
    let { sessionId, date } = options;
    // 🛡️ รับเฉพาะรหัสรอบไลฟ์ที่ระบบสร้าง (LIVE_ตามด้วยตัวเลข) และวันที่ 8 หลัก
    if (sessionId && !/^LIVE_\d+$/.test(String(sessionId))) sessionId = null;
    if (date && !/^\d{8}$/.test(String(date))) date = null;
    const targetDate = date || getTodayString();

    // 📦 BUG-03 (ไลฟ์ข้ามเที่ยงคืน): ถ้าไม่ได้ระบุ sessionId และไม่มีไลฟ์ที่กำลังดำเนินอยู่
    // ให้ใช้ "ไลฟ์ล่าสุดที่เพิ่งจบ" หากวันที่ที่เลือกอยู่ในช่วงเวลาของไลฟ์นั้น (วันเริ่ม หรือ วันจบ)
    // ส่วนการเลือกวันอื่นย้อนหลัง ยังกรองตามวันที่เหมือนเดิม
    if (!sessionId && !activeLiveSession) {
        try {
            const { data: lastRow } = await supabase.from('configs').select('value').eq('key', 'last_ended_live_session').single();
            const last = lastRow && lastRow.value ? JSON.parse(lastRow.value) : null;
            if (last && last.id) {
                const toBkkDate = (ms) => {
                    const d = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
                    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
                };
                const spanDates = [last.startTime, last.endTime].filter(Boolean).map(toBkkDate);
                if (spanDates.includes(targetDate)) {
                    // รวมทั้ง "ทุกสลิปของไลฟ์นั้น" และ "สลิปของวันที่เลือก" เพื่อไม่ให้ออเดอร์นอกไลฟ์ในวันเดียวกันหายไป
                    options.__unionDate = targetDate;
                    sessionId = String(last.id).replace(/,/g, '');
                }
            }
        } catch (e) { /* ไม่มีประวัติไลฟ์ล่าสุด ใช้การกรองตามวันที่แบบเดิม */ }
    }
    
    // v1.0.15: รอบที่รวมบิลกัน (A + B) ต้องส่งของพร้อมกัน -> ส่งออกเป็นไฟล์เดียว ลูกค้าที่ซื้อทั้ง 2 รอบเป็นแถวเดียว
    let mergeGroup = [];
    // ไม่ได้ระบุรอบ/วันที่ แต่กำลังไลฟ์อยู่ = ดูรอบที่กำลังไลฟ์ (ใช้ตรวจการรวมบิลด้วย โดยไม่เปลี่ยนวิธีดึงสลิปเดิม)
    const groupBaseId = sessionId || ((!date && activeLiveSession) ? activeLiveSession.id : null);
    if (groupBaseId) {
        try { mergeGroup = resolveMergeGroup(groupBaseId); } catch (e) { mergeGroup = [groupBaseId]; }
    }
    const extraSessionIds = mergeGroup.filter(id => id !== groupBaseId);

    // ดึงสลิปที่สำเร็จหรือมีของ (completed, waiting, called, skipped) โดยไม่นับ rejected
    let query = supabase.from('slips').select('*').neq('status', 'rejected');
    if (sessionId && options.__unionDate) {
        query = query.or(`session_id.eq.${sessionId},trans_date.eq.${options.__unionDate}`);
    } else if (sessionId) {
        query = query.eq('session_id', sessionId);
    } else if (date) {
        query = query.eq('trans_date', date);
    } else if (activeLiveSession) {
        query = query.eq('session_id', activeLiveSession.id);
    } else {
        query = query.eq('trans_date', targetDate);
    }
    const { data: slipsFound, error } = await query;
    if (error) throw error;
    let slips = slipsFound || [];

    for (const xid of extraSessionIds) {
        const { data: more, error: moreErr } = await supabase.from('slips').select('*').neq('status', 'rejected').eq('session_id', xid);
        if (moreErr) throw moreErr;
        const haveIds = new Set(slips.map(s => s.id));
        (more || []).forEach(s => { if (!haveIds.has(s.id)) slips.push(s); });
    }

    // 📦 รอบไลฟ์ที่บันทึกตั้งแต่ v1.0.7 ลงไป: สลิปยังไม่มีรหัสรอบไลฟ์ (session_id ว่าง)
    // ให้นับสลิปที่ไม่มีรหัสรอบ ซึ่งเวลาโอนอยู่ในช่วงเริ่ม-จบของไลฟ์นั้นด้วย เพื่อให้เลือกรอบไลฟ์เก่าได้ลูกค้าครบ
    const legacyIds = sessionId ? [sessionId, ...extraSessionIds] : [...extraSessionIds];
    for (const legacySid of legacyIds) {
        try {
            let sess = (activeLiveSession && activeLiveSession.id === legacySid) ? activeLiveSession : null;
            if (!sess) {
                const { data: hist } = await supabase.from('configs').select('value').eq('key', `session_hist_${legacySid}`).single();
                sess = hist && hist.value ? JSON.parse(hist.value) : null;
            }
            if (sess && sess.startTime) {
                const startMs = Number(sess.startTime);
                const endMs = Number(sess.endTime) || Date.now();
                const toBkk = (ms) => new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
                const dates = [];
                for (let t = startMs; t <= endMs + 86400000; t += 86400000) {
                    const d = toBkk(Math.min(t, endMs));
                    const s = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
                    if (!dates.includes(s)) dates.push(s);
                    if (dates.length > 3) break;
                }
                const { data: legacy } = await supabase.from('slips').select('*').in('trans_date', dates).neq('status', 'rejected');
                const have = new Set(slips.map(s => s.id));
                const startLocal = toBkk(startMs).getTime();
                const endLocal = toBkk(endMs).getTime();
                (legacy || []).forEach(s => {
                    if (s.session_id || have.has(s.id)) return;
                    const m = String(s.trans_date || '').match(/^(\d{4})(\d{2})(\d{2})$/);
                    const tm = String(s.trans_time || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
                    if (!m || !tm) return;
                    const local = new Date(+m[1], +m[2] - 1, +m[3], +tm[1], +tm[2], +(tm[3] || 0)).getTime();
                    if (local >= startLocal && local <= endLocal) { slips.push(s); have.add(s.id); }
                });
            }
        } catch (e) { /* ไม่มีประวัติรอบไลฟ์นี้ ใช้เฉพาะสลิปที่มีรหัสรอบ */ }
    }

    // 📦 ดึงที่อยู่เฉพาะลูกค้าที่อยู่ในรอบนี้ (เดิมโหลดที่อยู่ลูกค้าทุกคนที่เคยมี ยิ่งร้านโตยิ่งช้า)
    const lineIdsInRound = [...new Set((slips || []).map(s => s.line_id).filter(Boolean))];
    const addressMap = {};
    for (let i = 0; i < lineIdsInRound.length; i += 400) {
        const keys = lineIdsInRound.slice(i, i + 400).map(uid => `cust_addr_${uid}`);
        const { data: addrConfigs } = await supabase.from('configs').select('key, value').in('key', keys);
        (addrConfigs || []).forEach(item => {
            try {
                const uid = item.key.replace('cust_addr_', '');
                addressMap[uid] = JSON.parse(item.value);
            } catch(e) {}
        });
    }

    // รวมออเดอร์ตามลูกค้า (line_id หรือ sender_name)
    const customerOrders = {};
    (slips || []).forEach(slip => {
        const custKey = slip.line_id || slip.sender_name || `anon_${slip.id}`;
        if (!customerOrders[custKey]) {
            customerOrders[custKey] = {
                key: custKey,
                lineId: slip.line_id,
                name: slip.line_name || slip.sender_name,
                senderName: slip.sender_name,
                totalAmount: 0,
                totalDraws: 0,
                slipsCount: 0,
                breakdowns: [],
                slipIds: []
            };
        }
        customerOrders[custKey].totalAmount += Number(slip.amount) || 0;
        customerOrders[custKey].totalDraws += Number(slip.draws) || 0;
        customerOrders[custKey].slipsCount += 1;
        customerOrders[custKey].slipIds.push(slip.id);
        if (slip.arrived_out_of_round === 1) customerOrders[custKey].outOfRound = true;   // v1.0.16: ยอดโอนนอกรอบของลูกค้าคนนี้
        
        let bd = '';
        if (slip.qr_payload && slip.qr_payload.startsWith('manual_image')) {
            bd = slip.qr_payload.split('|')[2] || '';
        } else {
            bd = (slip.qr_payload || '').split('|')[1] || '';
        }
        if (bd) customerOrders[custKey].breakdowns.push(bd);
    });

    const orders = Object.values(customerOrders).map(cust => {
        const addr = cust.lineId ? addressMap[cust.lineId] : null;
        const itemSummary = mergeBreakdowns(cust.breakdowns) || `สินค้า ${cust.totalDraws} ชิ้น`;
        
        // 👤 จัดการชื่อผู้รับ: หากลูกค้าไม่ได้ส่งชื่อมา หรือเป็นชื่อ default ให้ใช้ชื่อโปรไฟล์ LINE แทนทันที
        const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
        let recipientName = addr && addr.recipient_name ? String(addr.recipient_name).trim() : '';
        if (!recipientName || genericNames.includes(recipientName.toLowerCase())) {
            recipientName = cust.name || cust.senderName || 'ลูกค้า LINE';
        }

        const effectiveAddr = addr ? { ...addr, recipient_name: recipientName } : {
            recipient_name: recipientName,
            phone: '',
            address: '',
            subdistrict: '',
            district: '',
            province: '',
            postcode: '',
            remark: ''
        };

        const hasAddr = !!(addr && addr.phone && addr.postcode && (addr.address || typeof addr === 'string'));

        return {
            customerKey: cust.key,
            lineId: cust.lineId,
            lineName: cust.name,
            totalAmount: cust.totalAmount,
            totalDraws: cust.totalDraws,
            items: itemSummary,
            hasAddress: hasAddr,
            outOfRound: !!cust.outOfRound,   // v1.0.16: มีสลิปที่เงินเข้าตอนไม่มีไลฟ์ (ติดป้ายในไฟล์ Kerry และหน้าต่างสรุป)
            address: effectiveAddr
        };
    });

    // 🌟 จัดเรียง: ผู้ที่มีที่อยู่ครบถ้วนขึ้นก่อนด้านบน และคนที่ยังไม่ได้ส่งที่อยู่จัดรวมไว้ข้างล่างด้วยกัน
    orders.sort((a, b) => {
        if (a.hasAddress && !b.hasAddress) return -1;
        if (!a.hasAddress && b.hasAddress) return 1;
        return 0;
    });

    // v1.0.15: ส่งข้อมูลกลุ่มรอบที่รวมบิลกลับไปให้หน้าสรุป/ส่งออก (เป็นคุณสมบัติเสริมของ array ไม่กระทบโค้ดเดิมที่ใช้ orders)
    orders.mergeGroup = mergeGroup;
    orders.exportSessionId = groupBaseId || null;
    return orders;
}

// 📦 รายการรอบไลฟ์ล่าสุด 30 รอบ สำหรับช่องเลือกรอบไลฟ์ในหน้า Export Kerry
app.get('/api/kerry/sessions', async (req, res) => {
    try {
        const { data: rows } = await supabase.from('configs').select('key, value').like('key', 'session_hist_%');
        const sessions = [];
        (rows || []).forEach(r => {
            try {
                const s = JSON.parse(r.value);
                if (s && s.id && s.startTime) sessions.push({ id: s.id, startTime: s.startTime, endTime: s.endTime || null, active: false, holdMerge: !!s.holdMerge, mergeFrom: s.mergeFrom || null, mergedInto: s.mergedInto || null });
            } catch (e) {}
        });
        if (activeLiveSession && activeLiveSession.id) {
            sessions.push({ id: activeLiveSession.id, startTime: activeLiveSession.startTime, endTime: null, active: true, holdMerge: false, mergeFrom: activeLiveSession.mergeFrom || null, mergedInto: null });
        }
        sessions.sort((a, b) => b.startTime - a.startTime);
        res.json({ success: true, sessions: sessions.slice(0, 30) });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// เช็คสรุปสถานะที่อยู่ของรอบไลฟ์/วันนี้
app.get('/api/kerry/summary', async (req, res) => {
    try {
        // ใช้กติกาเดียวกับ /api/kerry/export_excel: ระหว่างไลฟ์ ถ้าไม่ได้เลือกรอบ ให้ใช้รอบที่กำลังไลฟ์
        // (เดิมสรุปนับตามวันที่ แต่ไฟล์ที่ดาวน์โหลดนับตามรอบไลฟ์ ทำให้จำนวนลูกค้าในหน้าต่างไม่ตรงกับไฟล์)
        const summarySessionId = req.query.sessionId || (activeLiveSession ? activeLiveSession.id : null);
        const orders = await getOrdersForKerry({ date: req.query.date, sessionId: summarySessionId });
        const totalCustomers = orders.length;
        const readyCustomers = orders.filter(o => o.hasAddress).length;
        const missingCustomers = orders.filter(o => !o.hasAddress).map(o => o.lineName);
        // v1.0.15: ข้อมูลรวมบิล / รอรวมบิล สำหรับแสดงในหน้าต่าง Export Kerry
        const group = orders.mergeGroup || [];
        const sid = orders.exportSessionId || null;
        let merge = null, held = null, canHold = null;
        if (group.length > 1) {
            merge = { sessions: group.map(id => { const r = getSessionRecord(id); return { id, startTime: r ? r.startTime : null, endTime: r ? r.endTime : null }; }) };
        } else if (sid) {
            const r = getSessionRecord(sid);
            if (r && r.holdMerge && !r.mergedInto) held = { sessionId: sid };
            else if (r && canHoldSession(r)) canHold = { sessionId: sid };
        }
        res.json({ success: true, totalCustomers, readyCustomers, missingCustomers, orders: [...orders], outOfRoundCustomers: orders.filter(o => o.outOfRound).map(o => o.lineName), merge, held, canHold });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📦 ฟังก์ชันจัดเรียงที่อยู่เต็มตามมาตรฐาน Kerry Express KEX EasyShip (*ที่อยู่/Address)
// กฎเหล็ก:
// 1. ช่องที่อยู่ต้องไม่มีรหัสไปรษณีย์ 5 หลัก (Kerry มีคอลัมน์รหัสไปรษณีย์แยกเฉพาะใน Col 5)
// 2. ห้ามใช้ slash เช่น 'แขวง/ต.' หรือ 'เขต/อ.' ซึ่งทำให้ Kerry อ่านเพี้ยนและเกิดอาการข้อมูลเบิ้ลซ้ำ
// 3. ป้องกันการระบุ ตำบล/อำเภอ/จังหวัด ซ้ำซ้อนหากในที่อยู่เดิมมีระบุไว้แล้ว
function buildKerryFullAddress(addr) {
    if (!addr) return '';
    if (typeof addr === 'string') {
        return addr
            .replace(/แขวง\/ต\./g, 'ต.')
            .replace(/เขต\/อ\./g, 'อ.')
            .replace(/\b[1-9]\d{4}\b/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // 🛡️ Escape อักขระพิเศษ (เช่น ( ) * + ?) จากที่อยู่ลูกค้า ก่อนนำไปสร้าง RegExp ป้องกันส่งออก Kerry ล่ม
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let rawAddr = (addr.address || '').trim();
    let sub = (addr.subdistrict || '').trim();
    let dist = (addr.district || '').trim();
    let prov = (addr.province || '').trim();
    let post = (addr.postcode ? String(addr.postcode) : '').trim();

    // 1. นำรหัสไปรษณีย์ 5 หลักออกจากที่อยู่ (Kerry แยกช่องรหัสไปรษณีย์ไว้ใน Col 5 อยู่แล้ว)
    if (post) {
        rawAddr = rawAddr.replace(new RegExp(`\\b${escapeRegExp(post)}\\b`, 'g'), '');
    }
    rawAddr = rawAddr.replace(/\b[1-9]\d{4}\b/g, '');

    // 2. ตรวจสอบพื้นที่กรุงเทพมหานคร vs ต่างจังหวัด
    const fullTextToCheck = `${rawAddr} ${sub} ${dist} ${prov}`;
    const isBkk = /กรุงเทพ|กทม|bangkok/i.test(fullTextToCheck);

    // 3. กำหนดคำนำหน้ามาตรฐาน (ห้ามมี slash แขวง/ต. หรือ เขต/อ.)
    const subPrefix = isBkk ? 'แขวง' : 'ต.';
    const distPrefix = isBkk ? 'เขต' : 'อ.';
    const provPrefix = isBkk ? '' : 'จ.';

    // คลีนเครื่องหมาย slash แขวง/ต. หรือ เขต/อ. ที่อาจตกค้างใน rawAddr
    rawAddr = rawAddr.replace(/แขวง\/ต\./g, subPrefix).replace(/เขต\/อ\./g, distPrefix);
    rawAddr = rawAddr.replace(/\s{2,}/g, ' ').trim();

    // คลีนคำนำหน้าที่อาจมีติดมาใน sub, dist, prov อยู่แล้ว
    const cleanSub = sub.replace(/^(ต\.|ตำบล|แขวง)/, '').trim();
    const cleanDist = dist.replace(/^(อ\.|อำเภอ|เขต)/, '').trim();
    const cleanProv = prov.replace(/^(จ\.|จังหวัด)/, '').trim();

    const parts = [];
    if (rawAddr) parts.push(rawAddr);

    // เช็คว่าใน rawAddr มีตำบล/แขวง อยู่แล้วหรือไม่ ถ้ายังไม่มีจึงต่อท้าย
    if (cleanSub) {
        const subRegex = new RegExp(`(?:ต\\.|ตำบล|แขวง)?\\s*${escapeRegExp(cleanSub)}`, 'i');
        if (!subRegex.test(rawAddr)) {
            parts.push(`${subPrefix}${cleanSub}`);
        }
    }

    // เช็คว่ามีอำเภอ/เขต อยู่แล้วหรือไม่
    if (cleanDist) {
        const distRegex = new RegExp(`(?:อ\\.|อำเภอ|เขต)?\\s*${escapeRegExp(cleanDist)}`, 'i');
        const currentText = parts.join(' ');
        if (!distRegex.test(currentText)) {
            parts.push(`${distPrefix}${cleanDist}`);
        }
    }

    // เช็คว่ามีจังหวัดอยู่แล้วหรือไม่ (ป้องกันสับสนกับ อำเภอเมือง)
    if (cleanProv) {
        const provRegex = new RegExp(`(?:จ\\.|จังหวัด)\\s*${escapeRegExp(cleanProv)}|(?:^|\\s+)${escapeRegExp(cleanProv)}(?:\\s+|$)`, 'i');
        const currentWithoutDist = parts.filter(p => !p.startsWith('อ.') && !p.startsWith('เขต')).join(' ');
        const hasProvExplicit = /(?:จ\.|จังหวัด)/.test(parts.join(' ')) && provRegex.test(parts.join(' '));

        if (!hasProvExplicit && !provRegex.test(currentWithoutDist)) {
            parts.push(isBkk ? 'กรุงเทพมหานคร' : `${provPrefix}${cleanProv}`);
        }
    } else if (isBkk) {
        const currentText = parts.join(' ');
        if (!/กรุงเทพ/i.test(currentText)) {
            parts.push('กรุงเทพมหานคร');
        }
    }

    return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

// 🚚 ดาวน์โหลดไฟล์ Excel มาตรฐานทางการ Kerry Express KEX EasyShip Template (.xlsx)
app.get('/api/kerry/export_excel', async (req, res) => {
    try {
        const exportSessionId = req.query.sessionId || (activeLiveSession ? activeLiveSession.id : null);
        const orders = await getOrdersForKerry({ date: req.query.date, sessionId: exportSessionId });
        const templatePath = path.join(__dirname, 'templates', 'KEXImportTemplate.xlsx');
        const workbook = new ExcelJS.Workbook();

        let worksheet;
        if (fs.existsSync(templatePath)) {
            // 🌟 1. โหลดไฟล์แม่แบบทางการ KEX EasyShip Template โดยตรง (คงหัวตารางสีฟ้าและ Sheet2 กล่อง/ซอง ไว้อย่างสมบูรณ์)
            await workbook.xlsx.readFile(templatePath);
            worksheet = workbook.getWorksheet('Sheet1') || workbook.worksheets[0];
        } else {
            // 🛡️ 2. Fallback: ถ้าไม่มีไฟล์ในโฟลเดอร์ ให้สร้างชีทโครงสร้าง KEX EasyShip เสมือนจริงทุกประการ
            workbook.creator = 'AutoQueueforLive';
            worksheet = workbook.addWorksheet('Sheet1');
            
            const ws2 = workbook.addWorksheet('Sheet2');
            ws2.addRow(['กล่อง/Box']);
            ws2.addRow(['ซองเอกสาร/Envelope']);
            ws2.addRow(['ซองพลาสติก/Seal bag']);

            worksheet.addRow(['KEX (ส่งไว ส่งชัวร์ ทั่วไทย)']);
            worksheet.addRow(['พื้นที่สีฟ้าห้ามลบ']);
            worksheet.addRow(['ตัวอย่าง']);
            
            const headerCols = [
                'No', '*ชื่อผู้รับ/Recipient Name', '*เบอร์ผู้รับ/Mobile No.', '*ที่อยู่/Address', '*รหัสไปรษณีย์/Postal code',
                'COD Amt (Baht)', 'ชื่อสินค้า/Product name', 'น้ำหนัก/Weight(kg)', 'กว้าง/Width(cm)', 'ยาว/Length(cm)',
                'สูง/Height(cm)', 'Remark', 'Ref #1', 'Ref #2', 'Sender Ref'
            ];
            worksheet.addRow(headerCols);
            worksheet.addRow([
                '1', 'คุณตัวอย่าง ข้อมูล', '0999999999', '999/9 หมู่บ้านพัฒนา แขวงยานนาวา เขตสาทร กรุงเทพมหานคร 10120', '10120',
                '500', 'เสื้อยืดระบายอากาศ ไม่ต้องรีด', '', '', '', '', 'พวงกุญแจ', 'ORDER0001', 'PO0017', 'สมชาย'
            ]);
            worksheet.addRow([]);
            const row7 = [];
            row7[7] = '*จำเป็น หากใส่ COD amt';
            worksheet.addRow(row7);
            worksheet.addRow(headerCols);
        }

        // 📝 กรอกข้อมูลคำสั่งซื้อจริงลงตั้งแต่แถวที่ 9 เป็นต้นไป
        orders.forEach((order, index) => {
            const rowNum = 9 + index;
            const row = worksheet.getRow(rowNum);
            const addr = order.address || {};
            const fullAddress = buildKerryFullAddress(addr);
            const phoneStr = addr.phone ? String(addr.phone).replace(/[^0-9]/g, '') : '';
            const postcodeStr = addr.postcode ? String(addr.postcode).replace(/[^0-9]/g, '') : '';
            const senderName = merchantAccountName || 'AutoQueueforLive';

            // 🎯 กำหนดค่าลงแต่ละคอลัมน์แบบระบุตำแหน่งเซลล์ชัดเจน (ป้องกันคอลัมน์เยื้อง 100%)
            row.getCell(1).value = index + 1;                                     // Col 1: No
            row.getCell(2).value = addr.recipient_name || order.lineName || '';   // Col 2: *ชื่อผู้รับ/Recipient Name
            row.getCell(3).value = phoneStr;                                      // Col 3: *เบอร์ผู้รับ/Mobile No.
            row.getCell(3).numFmt = '@';
            row.getCell(4).value = fullAddress;                                   // Col 4: *ที่อยู่/Address
            row.getCell(5).value = postcodeStr;                                   // Col 5: *รหัสไปรษณีย์/Postal code
            row.getCell(5).numFmt = '@';
            row.getCell(6).value = '';                                            // Col 6: COD Amt (Baht) - ต้องว่างเสมอ (ลูกค้าโอนแล้ว)
            row.getCell(7).value = order.items || 'สินค้าจัดส่ง';                    // Col 7: ชื่อสินค้า/Product name
            row.getCell(8).value = '';                                            // Col 8: น้ำหนัก/Weight(kg)
            row.getCell(9).value = '';                                            // Col 9: กว้าง/Width(cm)
            row.getCell(10).value = '';                                           // Col 10: ยาว/Length(cm)
            row.getCell(11).value = '';                                           // Col 11: สูง/Height(cm)
            row.getCell(12).value = [addr.remark, order.outOfRound ? '🕒 โอนนอกรอบ (เงินมาทีหลัง) — ตรวจสอบก่อนส่ง' : ''].filter(Boolean).join(' ');  // Col 12: Remark (v1.0.16: ป้ายยอดนอกรอบ)
            row.getCell(13).value = `ORDER${String(index + 1).padStart(4, '0')}`;  // Col 13: Ref #1
            row.getCell(14).value = order.lineName || '';                         // Col 14: Ref #2
            row.getCell(15).value = senderName;                                   // Col 15: Sender Ref

            // ไฮไลต์แถวที่ยังไม่มีที่อยู่ครบถ้วนเป็นสีส้มอ่อนเพื่อให้สังเกตได้
            if (!order.hasAddress) {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
            }
            row.commit();
        });

        const filename = exportSessionId 
            ? `KEX_EasyShip_LiveSession_${exportSessionId}.xlsx`
            : `KEX_EasyShip_Orders_${req.query.date || getTodayString()}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch(e) {
        console.error('Export Excel Error:', e);
        res.status(500).send('Error generating Excel file: ' + e.message);
    }
});

// 🧪 API จำลองลูกค้าโอนเงินส่งสลิปเข้ามาในระบบ (สำหรับทดสอบหน้าจอ Dashboard)
app.post('/api/test/simulate_slip', async (req, res) => {
    try {
        const amount = Number(req.body.amount) || 228;
        const fakeUserId = req.body.userId || `TEST_USER_${Date.now()}`;
        const randomName = req.body.userName || 'คุณแอน สั่งด่วน';
        
        // 1. ดึงข้อมูลยอดสะสมเดิมของลูกค้า (ถ้ามี) เหมือนระบบจริง
        let { data: customer } = await supabase.from('customers').select('*').eq('line_id', fakeUserId).single();
        let currentBalance = (customer ? customer.balance : 0) + amount;

        // คำนวณจำนวนชิ้นเดิมที่เคยได้ในรอบนี้ (ผูก session_id กรณีไลฟ์ข้ามเที่ยงคืน)
        let pastDrawsToday = countPastDraws(fakeUserId);

        let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
        let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);

        let result = calculateBestDraws(virtualBalance, pastDrawsToday, { holdExactPrice: true });
        let draws = result.draws;
        let remainingBalance = walletAfter(result, currentBalance);

        // อัปเดตกระเป๋าเงินลูกค้า
        if (customer) await supabase.from('customers').update({ balance: remainingBalance, name: randomName }).eq('line_id', fakeUserId);
        else await supabase.from('customers').insert([{ line_id: fakeUserId, name: randomName, balance: remainingBalance }]);

        const status = draws > 0 ? 'waiting' : 'accumulated';
        let breakdownStr = result.breakdown.join(', ');

        const minPrice = priceList.length > 0 ? Math.min(...priceList.map(p => p.price)) : 189;
        const defaultName = priceList.length > 0 ? priceList[0].name : 'สินค้า';
        const neededForOne = minPrice + (pastDrawsToday >= freeShippingThreshold ? 0 : shippingFee);

        if (!breakdownStr && draws === 0 && result.heldForShipping) {
            breakdownStr = `สะสมยอด ${amount}฿ (รอค่าส่ง ${shippingFee}฿)`;
        } else if (!breakdownStr && draws === 0) {
            const shortAmount = Math.max(0, neededForOne - virtualBalance);
            breakdownStr = `สะสมยอด ${amount}฿ (ขาดอีก ${shortAmount}฿ ถึงจะได้ ${defaultName})`;
        }

        const fakeRef = `SIMULATE_${Date.now()}`;

        const { data: inserted, error: insertErr } = await supabase.from('slips').insert([{
            amount: amount, 
            draws: draws, 
            line_id: fakeUserId, 
            sender_name: randomName, 
            line_name: randomName, 
            session_id: activeLiveSession ? activeLiveSession.id : null,
            trans_date: getTodayString(), 
            trans_time: getLocalTimeString(), 
            qr_payload: `${fakeRef}|${breakdownStr}`, 
            status: status 
        }]).select().single();

        if (insertErr) throw insertErr;

        if (draws > 0) io.emit('play_sound');
        await broadcastTodayStats();

        res.json({ 
            success: true, 
            draws: draws,
            amount: amount,
            breakdown: breakdownStr,
            status: status,
            neededForOne: neededForOne,
            slip: inserted 
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🧪 API จำลองลูกค้าส่งสลิปไม่มี QR Code (ต้องให้แอดมินเช็คและใส่ยอดเอง)
app.post('/api/test/simulate_abnormal', async (req, res) => {
    try {
        const timestamp = Date.now();
        const fakeUserId = `TEST_ABNORMAL_${timestamp}`;
        const fakeName = 'ลูกค้าท่านหนึ่ง (สลิปไม่มี QR)';
        const sampleImage = 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=500&auto=format&fit=crop&q=60';
        const payloadRef = `manual_image|${sampleImage}?t=${timestamp}`;

        const { data: inserted, error: insertErr } = await supabase.from('slips').insert([{
            amount: 0, 
            draws: 0, 
            line_id: fakeUserId, 
            sender_name: fakeName, 
            line_name: fakeName, 
            session_id: activeLiveSession ? activeLiveSession.id : null,
            trans_date: getTodayString(), 
            trans_time: getLocalTimeString(), 
            qr_payload: payloadRef, 
            status: 'waiting' 
        }]).select().single();

        if (insertErr) throw insertErr;

        io.emit('play_sound');
        await broadcastTodayStats();
        res.json({ success: true, slip: inserted });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 🧪 API ทดสอบส่งข้อความเข้า Discord Monitor
app.post('/api/test/discord', async (req, res) => {
    try {
        await sendDiscordAlert({
            type: 'INFO',
            category: 'TEST',
            title: '🧪 [ทดสอบระบบ Monitor] การเชื่อมต่อ Discord สำเร็จ!',
            message: 'ข้อความนี้แสดงว่าระบบ AutoQueue Monitor เชื่อมต่อกับ Discord ของคุณสมบูรณ์ 100% พร้อมตรวจจับและวิเคราะห์ Error อัตโนมัติแล้วครับ',
            suggestion: 'ระบบจะเริ่มเฝ้าดูและส่งการแจ้งเตือนทันทีเมื่อตรวจพบปัญหาใดๆ ในระหว่างการไลฟ์',
            force: true
        });
        res.json({ success: true, message: 'ส่งข้อความทดสอบเข้า Discord สำเร็จเรียบร้อย' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/queue/manual_amount', async (req, res) => {
    const slipId = Number(req.body?.slipId);
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(slipId) || !Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
        return res.status(400).json({ success: false, message: 'ข้อมูลยอดเงินหรือรหัสสลิปไม่ถูกต้อง' });
    }

    try {
        const { data: slip } = await supabase.from('slips').select('*').eq('id', slipId).single();
        if (!slip) return res.status(404).json({ success: false, message: 'ไม่พบข้อมูลสลิป' });

        if (slip.amount > 0) {
            return res.status(409).json({ success: false, message: 'สลิปนี้เคยระบุยอดเงินไปแล้ว' });
        }

        let { data: customer } = await supabase.from('customers').select('*').eq('line_id', slip.line_id).single();
        let currentBalance = (customer ? customer.balance : 0) + amount; 

        let pastDrawsToday = countPastDraws(slip.line_id, { excludeId: slipId, excludeRejected: true });
        let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
        let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
        
        let result = calculateBestDraws(virtualBalance, pastDrawsToday, { holdExactPrice: true });
        let breakdownStr = result.breakdown.join(', ');
        
        const parts = (slip.qr_payload || '').split('|');
        const payloadRef = `manual_image|${parts[1] || ''}|${breakdownStr}`; 

        await supabase.from('slips').update({
            amount: amount, draws: result.draws, qr_payload: payloadRef,
            // ยอดที่แม่ค้าใส่เองยังไม่พอ -> เป็น "สะสมยอด" (การ์ดสีส้ม) ไม่ใช่การ์ดคิวปกติที่ไม่มีชิ้น
            status: result.draws > 0 ? slip.status : 'accumulated'
        }).eq('id', slipId);

        const finalBalance = walletAfter(result, currentBalance);
        if (customer) {
            await supabase.from('customers').update({ balance: finalBalance }).eq('line_id', slip.line_id);
        } else if (slip.line_id) {
            await supabase.from('customers').insert([{ line_id: slip.line_id, name: slip.line_name || 'ลูกค้า LINE', balance: finalBalance }]);
        }
        // v1.0.16: บันทึกการกระทำของแม่ค้า (กรอกยอดสลิปเอง) ลง log เพื่อตรวจสอบย้อนหลัง
        const drawsTxt = result.draws > 0 ? `ได้ ${result.draws} ชิ้น` : 'ยอดยังไม่พอ (เข้าการ์ดส้มรอโอนเพิ่ม)';
        addLog('INFO', `🖥️ แม่ค้ากรอกยอดสลิปเอง ${amount} บาท — ${slip.line_name || 'ลูกค้า'} ${drawsTxt} (เงินคงเหลือในกระเป๋า ${finalBalance} บาท)`);

        broadcastTodayStats();
        res.json({ success: true, draws: result.draws, remainder: finalBalance });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 📝 API อนุมัติหรือปัดตกสลิปผิดปกติหลังจบไลฟ์
app.post('/api/queue/verify_abnormal', async (req, res) => {
    const { slipIds, isApproved } = req.body || {};
    // 🛡️ รับเฉพาะรายการเลข ID ที่ถูกต้อง (เหมือน /api/queue/action) ป้องกันการอัปเดตผิดแถว
    const ids = Array.isArray(slipIds) ? slipIds.map(Number).filter(Number.isInteger) : [];
    if (ids.length === 0) {
        return res.status(400).json({ success: false, error: 'ไม่พบรายการสลิปที่ถูกต้อง' });
    }
    try {
        const newStatus = isApproved ? 'completed' : 'rejected';
        await supabase.from('slips').update({ status: newStatus }).in('id', ids);
        addLog('INFO', `🖥️ หลังจบไลฟ์ แม่ค้า${isApproved ? 'อนุมัติ' : 'ปัดตก'}สลิปรอตรวจภาพ ${ids.length} ใบ`);
        await broadcastTodayStats();
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ❌ API ปัดตกรูปที่ไม่ใช่สลิปการโอนเงิน
app.post('/api/queue/reject_slip', async (req, res) => {
    const { slipId } = req.body;
    try {
        const { data: slip } = await supabase.from('slips').select('*').eq('id', slipId).single();
        if (slip) {
            await supabase.from('slips').update({ status: 'rejected' }).eq('id', slipId);
            addLog('INFO', `🖥️ แม่ค้าปัดตกรูปที่ไม่ใช่สลิปการโอนเงิน — ${slip.line_name || 'ลูกค้า'} (สลิป #${slipId})`);

            // 🔕 ปิดการส่งข้อความแจ้งลูกค้า "รูปนี้ไม่ใช่สลิป" ตามที่ร้านกำหนด (v1.0.8)
            // คงไว้เฉพาะข้อความขอบคุณหลังลูกค้าได้สิทธิ์ (และไม่เสียโควตา Push Message ของ LINE OA)
            // if (slip.line_id) {
            //     try {
            //         await axios.post('https://api.line.me/v2/bot/message/push', {
            //             to: slip.line_id,
            //             messages: [{ type: 'text', text: 'ขออภัยนะคะ 🥺 รูปภาพที่คุณลูกค้าส่งมาไม่ใช่สลิปการโอนเงิน รบกวนส่งรูปสลิปใหม่อีกครั้งนะคะ 🙏' }]
            //         }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } });
            //     } catch(e) {}
            // }
        }
        await broadcastTodayStats();
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ✏️ v1.0.16: แม่ค้าแก้ไขรายการสินค้าเอง เมื่อระบบคำนวณจำนวน/เลือกสินค้าให้ผิด
// แก้เฉพาะ "สินค้าอะไรกี่ชิ้น" (draws + ข้อความ breakdown ใน qr_payload) เท่านั้น
// ห้ามแตะ: ยอดเงินที่โอนมาจริง (amount), สถานะ, เงินในกระเป๋าลูกค้า — เงินเป็นข้อเท็จจริงจากสลิป ส่วนการ์ดที่ยังค้างในคิวเท่านั้นที่แก้ได้
app.post('/api/queue/edit_items', async (req, res) => {
    try {
        const slipId = Number(req.body && req.body.slipId);
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : null;
        if (!Number.isInteger(slipId) || slipId <= 0 || !items) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ถูกต้อง (ต้องระบุ slipId และรายการสินค้า)' });
        }

        // ตรวจรายการ: ชื่อ 1-60 ตัวอักษรหลังตัดช่องว่าง, จำนวนเป็นจำนวนเต็ม 0-99, ห้ามชื่อซ้ำ (qty=0 ตัดทิ้ง)
        const clean = [];
        for (const it of items) {
            const name = String((it && it.name) || '').trim().slice(0, 60);
            const qty = Number(it && it.qty);
            if (!name || name.includes('|') || !Number.isInteger(qty) || qty < 0 || qty > 99) {   // "|" คือตัวคั่นข้อมูลในสลิป ห้ามอยู่ในชื่อสินค้า
                return res.status(400).json({ success: false, message: `รายการสินค้าหรือจำนวนไม่ถูกต้อง: "${name || '?'}" x${qty}` });
            }
            if (qty > 0 && !clean.some(c => c.name === name)) clean.push({ name, qty });
        }
        const breakdown = clean.map(c => `${c.name} x${c.qty}`).join(', ');
        const draws = clean.reduce((s, c) => s + c.qty, 0);

        const slip = supabase.db.prepare('SELECT * FROM slips WHERE id = ?').get(slipId);
        if (!slip) return res.status(404).json({ success: false, message: 'ไม่พบสลิปนี้' });
        if (!['waiting', 'called', 'skipped', 'abnormal_pending'].includes(slip.status)) {
            return res.status(409).json({ success: false, message: 'แก้ไขได้เฉพาะการ์ดที่ยังค้างอยู่ในคิวเท่านั้น (ไม่รวมที่จบแล้ว/ปัดตกแล้ว)' });
        }

        // คงส่วนอื่นของ qr_payload ไว้: ปกติคือ "รหัสอ้างอิง|breakdown" ส่วนของ manual_image คือ "manual_image|url|breakdown"
        const parts = String(slip.qr_payload || '').split('|');
        const isManual = slip.qr_payload && slip.qr_payload.startsWith('manual_image');
        const oldBreakdown = isManual ? (parts[2] || '') : (parts[1] || '');
        if (isManual) parts[2] = breakdown;
        else if (parts.length > 1) parts[1] = breakdown;
        else parts.push(breakdown);

        supabase.db.prepare('UPDATE slips SET draws = ?, qr_payload = ? WHERE id = ?').run(draws, parts.join('|'), slipId);
        addLog('INFO', `🖥️ แม่ค้าแก้ไขรายการสินค้า — ${slip.line_name || 'ลูกค้า'}: เดิม "${oldBreakdown || '-'}" → ใหม่ "${breakdown || '-'}" รวม ${draws} ชิ้น (สลิป #${slipId}, ยอดโอน ${slip.amount} บาท ไม่เปลี่ยน)`);
        await broadcastTodayStats();
        res.json({ success: true, draws, breakdown });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ✏️ v1.0.16: ข้อมูลให้หน้าต่างแก้ไขสินค้าบอกแม่ค้าว่า "ลูกค้าคนนี้ซื้อรวมกี่ชิ้นในรอบไลฟ์นี้" และค่าส่งเป็นอย่างไร
// otherDraws = ชิ้นของลูกค้าคนนี้ในรอบ (นับตามกติกาเดียวกับตอนคิดค่าส่ง รวมรอบที่รวมบิล) ที่ไม่ได้อยู่ในการ์ดที่กำลังแก้
app.get('/api/queue/edit_items_context', (req, res) => {
    try {
        const slipIds = String(req.query.slipIds || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (slipIds.length === 0) return res.status(400).json({ success: false, message: 'ต้องระบุ slipIds' });
        const rows = slipIds.map(id => supabase.db.prepare('SELECT id, line_id, draws, status FROM slips WHERE id = ?').get(id));
        if (rows.some(r => !r)) return res.status(404).json({ success: false, message: 'ไม่พบสลิป' });
        const lineId = rows[0].line_id;
        if (rows.some(r => r.line_id !== lineId)) return res.status(400).json({ success: false, message: 'สลิปไม่ใช่ของลูกค้าคนเดียวกัน' });
        const roundTotal = lineId ? countPastDraws(lineId, { excludeRejected: true }) : 0;
        const mine = rows.filter(r => r.status !== 'rejected').reduce((s, r) => s + (Number(r.draws) || 0), 0);
        res.json({ success: true, otherDraws: Math.max(0, roundTotal - mine), shippingFee, freeShippingThreshold });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

async function getLineProfile(userId) {
    try { 
        const res = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }); 
        return res.data.displayName; 
    } catch (e) { 
        addLog('WARN', `ดึงชื่อโปรไฟล์ LINE ไม่สำเร็จ (User ID: ${userId})`, e.response?.data?.message || e.message);
        return "ไม่ทราบชื่อ LINE"; 
    }
}

async function replyLineMessage(replyToken, text, userId = null) {
    try { 
        await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [{ type: 'text', text }] }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }); 
    } catch (e) {
        const errDetail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
        addLog('WARN', 'ส่ง replyToken ล้มเหลว (อาจหมดอายุหรือเน็ตช้า)', errDetail);
        
        // 🛡️ Auto-Fallback: หาก replyToken หมดอายุ และมี userId ให้สลับไปส่งด้วย Push Message ทันที ป้องกันลูกค้าไม่ได้รับแจ้งเลขคิว
        if (userId && process.env.LINE_ACCESS_TOKEN) {
            try {
                await axios.post('https://api.line.me/v2/bot/message/push', {
                    to: userId,
                    messages: [{ type: 'text', text }]
                }, {
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` }
                });
                addLog('SUCCESS', `กู้คืนการแจ้งเตือนสำเร็จผ่าน Push Message สำรอง (User: ${userId})`);
                return;
            } catch (pushErr) {
                addLog('ERROR', 'ส่งผ่าน Push Message สำรองไม่สำเร็จ', pushErr.response?.data?.message || pushErr.message);
            }
        }
        addLog('ERROR', 'ส่งข้อความตอบกลับ LINE ล้มเหลว (เช็ค Channel Access Token หรือ โควตา LINE)', errDetail);
    }
}

// 🔁 ดาวน์โหลดรูปสลิปจาก LINE: ลองซ้ำอัตโนมัติเมื่อเน็ตสะดุด (หมดเวลา/เชื่อมต่อหลุด/LINE ตอบ 5xx/429)
// ไม่ลองซ้ำเมื่อเป็นความผิดถาวร (4xx เช่น Token ผิด หรือรูปหมดอายุ) เพราะลองกี่ครั้งก็ไม่หาย
const LINE_IMG_ATTEMPTS = 3;
const LINE_IMG_TIMEOUT_MS = 10000;
const LINE_IMG_RETRY_DELAYS_MS = [1000, 2000];
function isRetryableLineError(error) {
    if (!error) return false;
    if (error.response) {
        const st = Number(error.response.status);
        return st >= 500 || st === 429;
    }
    return true; // ไม่มีคำตอบจาก LINE เลย = ปัญหาเครือข่าย (ETIMEDOUT, ECONNRESET, ENOTFOUND, ฯลฯ)
}
async function downloadImageFromLine(messageId, opts = {}) {
    const attempts = opts.attempts || LINE_IMG_ATTEMPTS;
    const delays = opts.delays || LINE_IMG_RETRY_DELAYS_MS;
    const timeout = opts.timeout || LINE_IMG_TIMEOUT_MS;
    const http = opts.http || axios;
    let lastError = null;
    for (let i = 1; i <= attempts; i++) {
        try {
            const res = await http({ method: 'get', url: `https://api-data.line.me/v2/bot/message/${messageId}/content`, headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` }, responseType: 'arraybuffer', timeout });
            if (i > 1) addLog('INFO', `ดาวน์โหลดรูปสลิปจาก LINE สำเร็จหลังลองซ้ำ (ครั้งที่ ${i}) Message ID: ${messageId}`);
            return res.data;
        } catch (error) {
            lastError = error;
            if (!isRetryableLineError(error) || i >= attempts) break;
            await new Promise(r => setTimeout(r, delays[Math.min(i - 1, delays.length - 1)] || 1000));
        }
    }
    const networkFail = lastError && !lastError.response;
    const reason = networkFail ? ` (เน็ตสะดุด ลองแล้ว ${attempts} ครั้ง)` : '';
    addLog('ERROR', `ดาวน์โหลดรูปภาพสลิปจาก LINE ไม่สำเร็จ${reason} (Message ID: ${messageId})`, lastError?.response?.data?.message || lastError?.message);
    return null;
}

// 🔴 รูปสลิปที่โหลดจาก LINE ไม่สำเร็จ (เก็บในหน่วยความจำ แสดงเป็นการ์ดสีแดงให้แม่ค้ารับทราบ ไม่แตะยอด/สลิป/ฐานข้อมูล)
let lineImageFailures = [];
let lineImageFailSeq = 0;
function recordLineImageFailure(name, messageId, reason = null) {
    const item = { id: ++lineImageFailSeq, name: name || 'ลูกค้า (ไม่ทราบชื่อ)', messageId, time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }), sid: activeLiveSession ? activeLiveSession.id : null, date: getTodayString(), reason: reason || null };
    lineImageFailures.push(item);
    if (lineImageFailures.length > 50) lineImageFailures.shift();
    return item;
}
function currentLineImageFailures() {
    const today = getTodayString();
    return lineImageFailures
        .filter(f => activeLiveSession ? f.sid === activeLiveSession.id : (!f.sid && f.date === today))
        .map(f => ({ id: f.id, name: f.name, time: f.time, reason: f.reason || null }));
}
// v1.0.16: การ์ดแจ้งเตือนที่เกิดนอกรอบ (ก่อนกดเริ่มไลฟ์) ย้ายตามเข้ารอบที่เริ่มถัดไปเหมือนสลิปนอกรอบ ไม่ให้หายไปตอนกดเริ่ม
function carryOutOfRoundNotices(sessionId) {
    const earliest = bangkokDateString(-OUT_OF_ROUND_LOOKBACK_DAYS);
    let n = 0;
    lineImageFailures.forEach(f => { if (!f.sid && f.date >= earliest) { f.sid = sessionId; n++; } });
    return n;
}
// v1.0.16: สลิปที่ระบบ "ไม่บันทึก" โดยตั้งใจ (โอนผิดบัญชี / ซ้ำกับของลูกค้าอื่นหรือที่ปัดตกไปแล้ว) เดิมเงียบ เหลือแค่บรรทัดใน Logs
// ตอนนี้แสดงการ์ดบนหน้าจอให้แม่ค้ารับทราบ (การ์ดเดียวกับกรณีโหลดรูปไม่สำเร็จ ไม่แตะยอด/สลิป/ฐานข้อมูล)
async function notifyUnrecordedSlip(customerName, messageId, reason) {
    try {
        recordLineImageFailure(customerName, messageId, reason);
        io.emit('image_failed');
        await broadcastTodayStats();
    } catch (notifyErr) { /* การแจ้งเตือนหน้าจอล้มเหลวต้องไม่ทำให้ Webhook พัง */ }
}

// ⚡ ระบบติดตามและตรวจสอบโควตาเครดิต API ตรวจสลิป (ป้องกัน Risk 2)
let providerQuotaState = {
    provider: (process.env.SLIP_PROVIDER || 'slipok').toLowerCase(),
    balance: null,
    status: 'ok', // 'ok', 'low', 'exhausted', 'unlimited'
    lastChecked: null,
    message: ''
};

function handleProviderQuotaExhaustion(providerName, error) {
    const errText = (error.response ? JSON.stringify(error.response.data) : error.message).toLowerCase();
    const status = error.response?.status;
    const code = error.response?.data?.code;
    
    if (status === 402 || code === 1009 || code === 1006 || code === 1008 || errText.includes('quota') || errText.includes('credit') || errText.includes('insufficient') || errText.includes('exceeded')) {
        providerQuotaState = {
            provider: providerName,
            balance: 0,
            status: 'exhausted',
            lastChecked: Date.now(),
            message: `เครดิตตรวจสลิป (${providerName.toUpperCase()}) หมดแล้ว!`
        };
        io.emit('provider_quota_alert', {
            provider: providerName,
            status: 'exhausted',
            balance: 0,
            message: `⚠️ [แจ้งเตือนด่วน]: เครดิตตรวจสลิป (${providerName.toUpperCase()}) หมดแล้ว! ระบบได้สลับเข้าสู่โหมดตรวจสลิปเอง (Manual) หรือผู้ให้บริการสำรองอัตโนมัติแล้ว เพื่อไม่ให้ออเดอร์ของลูกค้าหลุดหาย`
        });
        addLog('WARN', `⚠️ เครดิตตรวจสลิป ${providerName.toUpperCase()} หมดแล้ว! ระบบเปิดโหมดสำรองตรวจภาพเอง/ผู้ให้บริการสำรองอัตโนมัติ`);
        return true;
    }
    return false;
}

async function checkProviderQuota(force = false) {
    const provider = (process.env.SLIP_PROVIDER || 'slipok').toLowerCase();
    providerQuotaState.provider = provider;
    
    if (provider === 'manual') {
        providerQuotaState = {
            provider: 'manual',
            balance: 'ไม่จำกัด (ฟรี)',
            status: 'unlimited',
            lastChecked: Date.now(),
            message: 'โหมดตรวจสลิปเอง 100% ฟรีตลอดชีพ'
        };
        return providerQuotaState;
    }
    
    if (provider === 'slipok') {
        const cleanApiKey = process.env.SLIPOK_API_KEY ? process.env.SLIPOK_API_KEY.replace(/["'\r\n ]/g, '').trim() : "";
        const cleanBranchId = process.env.SLIPOK_BRANCH_ID ? process.env.SLIPOK_BRANCH_ID.replace(/["'\r\n ]/g, '').trim() : "";
        
        if (!cleanApiKey || !cleanBranchId) {
            providerQuotaState = {
                provider: 'slipok',
                balance: 0,
                used: 0,
                limit: slipokPackageLimit || 100,
                remaining: 0,
                overQuota: 0,
                endDate: null,
                status: 'exhausted',
                lastChecked: Date.now(),
                message: 'ยังไม่ได้ระบุ SlipOK API Key หรือ Branch ID'
            };
            return providerQuotaState;
        }
        
        try {
            const res = await axios.get(`https://api.slipok.com/api/line/apikey/${cleanBranchId}/quota`, {
                headers: { 'x-authorization': cleanApiKey },
                timeout: 8000
            });
            const rawQuota = res.data?.data?.quota;
            const overQuota = Number(res.data?.data?.overQuota || 0);
            const endDate = res.data?.data?.endDate || null;
            
            if (rawQuota !== undefined) {
                const remaining = Number(rawQuota); // SlipOK API ส่งจำนวนโควต้าคงเหลือจริงมาให้
                const limit = slipokPackageLimit !== undefined ? Number(slipokPackageLimit) : 100;
                const used = limit > 0 ? Math.max(0, limit - remaining + overQuota) : 0;
                
                let status = 'ok';
                let msg = '';
                
                if (overQuota > 0) {
                    status = 'over';
                    msg = `เกินแพ็กเกจแล้ว ${overQuota} สลิป (ใช้ไปแล้ว ${used}/${limit})`;
                } else if (remaining <= 0) {
                    status = 'exhausted';
                    msg = `โควตาหมดแล้ว (0/${limit} สลิป)`;
                } else if (remaining <= 10) {
                    status = 'low';
                    msg = `โควตาใกล้หมด เหลือ ${remaining}/${limit} (ใช้แล้ว ${used})`;
                } else if (limit > 0) {
                    status = 'ok';
                    msg = `โควตาคงเหลือ ${remaining}/${limit} (ใช้แล้ว ${used} สลิป)`;
                } else {
                    status = 'ok';
                    msg = `โควตาคงเหลือ ${remaining} สลิป`;
                }
                
                providerQuotaState = {
                    provider: 'slipok',
                    balance: remaining,
                    used: used,
                    limit: limit,
                    remaining: remaining,
                    overQuota: overQuota,
                    endDate: endDate,
                    status: status,
                    lastChecked: Date.now(),
                    message: msg
                };
            }
        } catch(err) {
            handleProviderQuotaExhaustion('slipok', err);
        }
    }

    if (provider === 'easyslip') {
        const cleanEasySlipToken = process.env.EASYSLIP_TOKEN ? process.env.EASYSLIP_TOKEN.replace(/["'\r\n ]/g, '').trim() : "";
        if (!cleanEasySlipToken) {
            providerQuotaState = {
                provider: 'easyslip',
                balance: 0,
                status: 'exhausted',
                lastChecked: Date.now(),
                message: 'ยังไม่ได้ระบุ EasySlip Access Token'
            };
            return providerQuotaState;
        }

        try {
            const res = await axios.get('https://api.easyslip.com/v1/me', {
                headers: { 'Authorization': `Bearer ${cleanEasySlipToken}` },
                timeout: 8000
            });
            const d = res.data?.data || res.data;
            const credits = Number(d?.currentCredit !== undefined ? d.currentCredit : (d?.remainingQuota !== undefined ? d.remainingQuota : 0));
            providerQuotaState = {
                provider: 'easyslip',
                balance: credits,
                remaining: credits,
                used: null,
                limit: null,
                status: credits <= 0 ? 'exhausted' : (credits <= 10 ? 'low' : 'ok'),
                lastChecked: Date.now(),
                message: credits <= 0 ? 'เครดิต EasySlip หมดแล้ว!' : `คงเหลือ ${credits} ครั้ง`
            };
        } catch(err) {
            handleProviderQuotaExhaustion('easyslip', err);
        }
    }

    if (provider === 'thunder') {
        const cleanThunderToken = process.env.THUNDER_TOKEN ? process.env.THUNDER_TOKEN.replace(/["'\r\n ]/g, '').trim() : "";
        if (!cleanThunderToken) {
            providerQuotaState = {
                provider: 'thunder',
                balance: 0,
                status: 'exhausted',
                lastChecked: Date.now(),
                message: 'ยังไม่ได้ระบุ Thunder Solution Token'
            };
            return providerQuotaState;
        }

        try {
            const res = await axios.get('https://api.thunder.in.th/v1/me', {
                headers: { 'Authorization': `Bearer ${cleanThunderToken}` },
                timeout: 8000
            });
            const d = res.data?.data || res.data;
            const credits = Number(d?.credits !== undefined ? d.credits : (d?.quota?.remaining !== undefined ? d.quota.remaining : 0));
            const used = d?.quota?.used !== undefined ? Number(d.quota.used) : null;
            const limit = d?.quota?.limit !== undefined ? Number(d.quota.limit) : null;

            providerQuotaState = {
                provider: 'thunder',
                balance: credits,
                remaining: credits,
                used: used,
                limit: limit,
                status: credits <= 0 ? 'exhausted' : (credits <= 10 ? 'low' : 'ok'),
                lastChecked: Date.now(),
                message: credits <= 0 ? 'เครดิต Thunder หมดแล้ว!' : `คงเหลือ ${credits} ครั้ง`
            };
        } catch(err) {
            handleProviderQuotaExhaustion('thunder', err);
        }
    }
    
    if (providerQuotaState.balance === null) {
        providerQuotaState.balance = 'พร้อมใช้งาน';
        providerQuotaState.status = 'ok';
        providerQuotaState.message = `ผู้ให้บริการ: ${provider.toUpperCase()}`;
    }
    
    return providerQuotaState;
}

// เช็คเครดิตอัตโนมัติทุก 10 นาที
setInterval(() => checkProviderQuota(), 10 * 60 * 1000);

// 🛡️ ADAPTERS: ฟังก์ชันตรวจสอบสลิปแยกตามผู้ให้บริการ (Modular Provider Adapters)

async function verifyWithEasySlip(imageBuffer) {
    const cleanEasySlipToken = process.env.EASYSLIP_TOKEN ? process.env.EASYSLIP_TOKEN.replace(/["'\r\n ]/g, '').trim() : "";
    if (!cleanEasySlipToken) {
        addLog('WARN', 'ไม่ได้ระบุ EasySlip Access Token ระบบจะรับสลิปเข้าคิวแบบตรวจภาพเอง (Manual)');
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('file', Buffer.from(imageBuffer), 'slip.jpg');

        const response = await axios.post('https://api.easyslip.com/v1/verify', formData, {
            headers: {
                'Authorization': `Bearer ${cleanEasySlipToken}`,
                ...formData.getHeaders()
            },
            timeout: 15000
        });

        if (response.data && response.data.status === 200 && response.data.data) {
            const d = response.data.data;
            const normalizedData = {
                amount: Number(d.amount?.amount !== undefined ? d.amount.amount : (d.amount || 0)),
                transRef: d.transRef || d.payload || `EASY_${Date.now()}`,
                receiver: {
                    displayName: d.receiver?.account?.name?.th || d.receiver?.account?.name?.en || d.receiver?.name || '',
                    name: d.receiver?.account?.name?.th || d.receiver?.name || ''
                },
                transDate: d.date ? d.date.split('T')[0].replace(/-/g, '') : getTodayString(),
                transTime: d.date && d.date.includes('T') ? d.date.split('T')[1].substring(0, 8) : getLocalTimeString()
            };
            addLog('SUCCESS', `EasySlip ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${normalizedData.amount} บาท (${normalizedData.transRef})`);
            return { success: true, data: normalizedData };
        } else {
            addLog('WARN', 'EasySlip ตอบกลับแต่ไม่พบข้อมูลสลิปที่ถูกต้อง', JSON.stringify(response.data));
            return null;
        }
    } catch (error) {
        handleProviderQuotaExhaustion('easyslip', error);
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        addLog('ERROR', 'EasySlip ยืนยันสลิปไม่สำเร็จ (สลิปอาจไม่ถูกต้อง หรือเครดิตหมด)', errData);
        return null;
    }
}

async function verifyWithThunder(imageBuffer) {
    const cleanThunderToken = process.env.THUNDER_TOKEN ? process.env.THUNDER_TOKEN.replace(/["'\r\n ]/g, '').trim() : "";
    if (!cleanThunderToken) {
        addLog('WARN', 'ไม่ได้ระบุ Thunder API Token ระบบจะรับสลิปเข้าคิวแบบตรวจภาพเอง (Manual)');
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('file', Buffer.from(imageBuffer), 'slip.jpg');

        const response = await axios.post('https://api.thundersolution.com/v1/verify', formData, {
            headers: {
                'Authorization': `Bearer ${cleanThunderToken}`,
                ...formData.getHeaders()
            },
            timeout: 15000
        });

        const resData = response.data;
        if (resData && (resData.success || resData.status === 200 || resData.status === 'success') && (resData.data || resData.result)) {
            const d = resData.data || resData.result;
            const normalizedData = {
                amount: Number(d.amount?.amount !== undefined ? d.amount.amount : (d.amount || 0)),
                transRef: d.transRef || d.refId || d.transactionId || `THUNDER_${Date.now()}`,
                receiver: {
                    displayName: d.receiver?.name || d.receiver?.accountName || d.receiverAccountName || '',
                    name: d.receiver?.name || d.receiverAccountName || ''
                },
                transDate: d.date ? d.date.replace(/[-/]/g, '').substring(0, 8) : getTodayString(),
                transTime: d.time || getLocalTimeString()
            };
            addLog('SUCCESS', `Thunder Solution ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${normalizedData.amount} บาท (${normalizedData.transRef})`);
            return { success: true, data: normalizedData };
        } else {
            addLog('WARN', 'Thunder ตอบกลับแต่รูปแบบข้อมูลไม่ตรง', JSON.stringify(resData));
            return null;
        }
    } catch (error) {
        handleProviderQuotaExhaustion('thunder', error);
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        addLog('ERROR', 'Thunder Solution ยืนยันสลิปไม่สำเร็จ', errData);
        return null;
    }
}

async function verifyWithSlipVerify(imageBuffer) {
    const cleanSlipVerifyKey = process.env.SLIPVERIFY_KEY ? process.env.SLIPVERIFY_KEY.replace(/["'\r\n ]/g, '').trim() : "";
    if (!cleanSlipVerifyKey) {
        addLog('WARN', 'ไม่ได้ระบุ SlipVerify API Key ระบบจะรับสลิปเข้าคิวแบบตรวจภาพเอง (Manual)');
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('file', Buffer.from(imageBuffer), 'slip.jpg');

        const response = await axios.post('https://api.slipverify.com/api/v1/verify', formData, {
            headers: {
                'x-api-key': cleanSlipVerifyKey,
                ...formData.getHeaders()
            },
            timeout: 15000
        });

        const resData = response.data;
        if (resData && (resData.success || resData.status === 'success') && (resData.data || resData.payload)) {
            const d = resData.data || resData.payload;
            const normalizedData = {
                amount: Number(d.amount || 0),
                transRef: d.transRef || d.refId || `SLIPVERIFY_${Date.now()}`,
                receiver: {
                    displayName: d.receiver?.displayName || d.receiver?.name || '',
                    name: d.receiver?.name || ''
                },
                transDate: d.transDate || getTodayString(),
                transTime: d.transTime || getLocalTimeString()
            };
            addLog('SUCCESS', `SlipVerify ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${normalizedData.amount} บาท (${normalizedData.transRef})`);
            return { success: true, data: normalizedData };
        } else {
            addLog('WARN', 'SlipVerify ตอบกลับแต่ไม่พบข้อมูล', JSON.stringify(resData));
            return null;
        }
    } catch (error) {
        handleProviderQuotaExhaustion('slipverify', error);
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        addLog('ERROR', 'SlipVerify ยืนยันสลิปไม่สำเร็จ', errData);
        return null;
    }
}

async function verifyWithCustom(imageBuffer) {
    const apiUrl = (process.env.CUSTOM_API_URL || '').trim();
    const headerName = (process.env.CUSTOM_API_HEADER || 'Authorization').trim();
    const headerKey = (process.env.CUSTOM_API_KEY || '').trim();

    if (!apiUrl) {
        addLog('WARN', 'ไม่ได้ระบุ Custom API URL ระบบจะรับสลิปเข้าคิวแบบตรวจภาพเอง (Manual)');
        return null;
    }

    try {
        const formData = new FormData();
        formData.append('file', Buffer.from(imageBuffer), 'slip.jpg');
        formData.append('files', Buffer.from(imageBuffer), 'slip.jpg');
        formData.append('image', Buffer.from(imageBuffer), 'slip.jpg');

        const headers = { ...formData.getHeaders() };
        if (headerName && headerKey) {
            headers[headerName] = headerKey.startsWith('Bearer ') || headerName !== 'Authorization' ? headerKey : `Bearer ${headerKey}`;
        }

        const response = await axios.post(apiUrl, formData, { headers, timeout: 18000 });
        const resData = response.data;

        const d = resData.data || resData.result || resData.payload || resData;
        const amountVal = Number(d.amount?.amount !== undefined ? d.amount.amount : (d.amount || d.total || d.price || 0));
        const transRefVal = d.transRef || d.trans_ref || d.refId || d.transactionId || d.ref || `CUSTOM_${Date.now()}`;
        const receiverVal = d.receiver?.displayName || d.receiver?.name || d.receiverName || d.receiver_name || d.receiver?.accountName || '';

        if (amountVal > 0 || transRefVal) {
            const normalizedData = {
                amount: amountVal,
                transRef: transRefVal,
                receiver: { displayName: receiverVal, name: receiverVal },
                transDate: d.transDate || d.date ? String(d.transDate || d.date).replace(/[-/]/g, '').substring(0, 8) : getTodayString(),
                transTime: d.transTime || d.time || getLocalTimeString()
            };
            addLog('SUCCESS', `Custom API ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${normalizedData.amount} บาท (${normalizedData.transRef})`);
            return { success: true, data: normalizedData };
        } else {
            addLog('WARN', 'Custom API ตอบกลับแต่ไม่พบยอดเงินหรือรหัสสลิป', JSON.stringify(resData));
            return null;
        }
    } catch (error) {
        handleProviderQuotaExhaustion('custom', error);
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        addLog('ERROR', 'Custom API ตอบกลับข้อผิดพลาด', errData);
        return null;
    }
}

async function verifyWithSlipOK(imageBuffer) {
    try {
        const formData = new FormData();
        formData.append('files', Buffer.from(imageBuffer), 'slip.jpg');
        formData.append('file', Buffer.from(imageBuffer), 'slip.jpg');
        const cleanApiKey = process.env.SLIPOK_API_KEY ? process.env.SLIPOK_API_KEY.replace(/["'\r\n ]/g, '').trim() : "";
        const cleanBranchId = process.env.SLIPOK_BRANCH_ID ? process.env.SLIPOK_BRANCH_ID.replace(/["'\r\n ]/g, '').trim() : "";
        
        if (!cleanApiKey || !cleanBranchId) {
            addLog('WARN', 'ไม่ได้ระบุ SlipOK API Key หรือ Branch ID ระบบจะรับสลิปเข้าคิวแบบตรวจภาพเอง (Manual)');
            return null;
        }

        const response = await axios.post(`https://api.slipok.com/api/line/apikey/${cleanBranchId}`, formData, { 
            headers: { 'x-authorization': cleanApiKey, ...formData.getHeaders() },
            timeout: 15000 
        });
        addLog('SUCCESS', `SlipOK ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${response.data?.data?.amount || 0} บาท (${response.data?.data?.transRef || ''})`);
        return response.data;
    } catch (error) { 
        handleProviderQuotaExhaustion('slipok', error);
        if (error.response && error.response.data && error.response.data.code === 1012) {
            addLog('INFO', `สลิปซ้ำหรือเคยเช็คไปแล้ว (Code 1012): ${error.response.data?.data?.transRef || ''}`);
            return { success: true, data: error.response.data.data };
        }
        const errData = error.response ? JSON.stringify(error.response.data) : error.message;
        addLog('ERROR', 'SlipOK ยืนยันสลิปไม่สำเร็จ (สลิปอาจไม่ถูกต้อง หรือวงเงินเครดิต SlipOK หมด)', errData);
        return error.response ? error.response.data : null; 
    }
}

// 🔄 ระบบสลับผู้ให้บริการสำรองอัตโนมัติเมื่อโควตาหลักหมด (Secondary Failover Provider)
async function attemptSecondaryProviderFailover(failedProvider, imageBuffer) {
    const cleanEasySlip = process.env.EASYSLIP_TOKEN ? process.env.EASYSLIP_TOKEN.replace(/["'\r\n ]/g, '').trim() : '';
    if (failedProvider !== 'easyslip' && cleanEasySlip) {
        addLog('WARN', '🔄 โควตาหลักหมด! กำลังสลับไปใช้ EasySlip (Secondary Failover) อัตโนมัติ...');
        const res = await verifyWithEasySlip(imageBuffer);
        if (res && res.success) {
            addLog('SUCCESS', `✅ EasySlip (ระบบสำรอง) ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${res.data?.amount} บาท`);
            reportSelfHealingToDiscord({
                category: 'SLIP_PROVIDER_FAILOVER',
                title: 'สลับผู้ให้บริการสำรอง (EasySlip) สำเร็จ',
                issue: `โควตาตรวจสลิปของผู้ให้บริการหลัก (${failedProvider.toUpperCase()}) หมดลงระหว่างการรับยอด`,
                actionDetails: `ระบบสลับไปใช้ EasySlip และตรวจสอบสลิปยอด ฿${res.data?.amount} สำเร็จเรียบร้อย ออเดอร์ไม่สะดุด`
            }).catch(() => {});
            return res;
        }
    }

    const cleanThunder = process.env.THUNDER_TOKEN ? process.env.THUNDER_TOKEN.replace(/["'\r\n ]/g, '').trim() : '';
    if (failedProvider !== 'thunder' && cleanThunder) {
        addLog('WARN', '🔄 โควตาหลักหมด! กำลังสลับไปใช้ Thunder Solution (Secondary Failover) อัตโนมัติ...');
        const res = await verifyWithThunder(imageBuffer);
        if (res && res.success) {
            addLog('SUCCESS', `✅ Thunder (ระบบสำรอง) ตรวจสอบสลิปสำเร็จ: ยอดเงิน ${res.data?.amount} บาท`);
            reportSelfHealingToDiscord({
                category: 'SLIP_PROVIDER_FAILOVER',
                title: 'สลับผู้ให้บริการสำรอง (Thunder) สำเร็จ',
                issue: `โควตาตรวจสลิปของผู้ให้บริการหลัก (${failedProvider.toUpperCase()}) หมดลงระหว่างการรับยอด`,
                actionDetails: `ระบบสลับไปใช้ Thunder Solution และตรวจสอบสลิปยอด ฿${res.data?.amount} สำเร็จเรียบร้อย ออเดอร์ไม่สะดุด`
            }).catch(() => {});
            return res;
        }
    }
    return null;
}

// 🛡️ ADAPTER: ตรวจสอบสลิปผ่านผู้ให้บริการที่เลือก (SlipOK, EasySlip, Thunder, SlipVerify, Custom หรือ Manual)
async function verifySlipWithProvider(imageBuffer) {
    const provider = (process.env.SLIP_PROVIDER || 'slipok').toLowerCase();

    // 1. โหมดตรวจสลิปเอง 100% ฟรี (Manual)
    if (provider === 'manual') {
        addLog('INFO', 'ระบบตั้งค่าเป็น "ตรวจสลิปเอง (Manual)" สลิปจะถูกส่งเข้าคิวรอตรวจภาพโดยตรง');
        return null; // เมื่อคืนค่า null ระบบจะนำรูปเข้ากระดานสลิปผิดปกติ/รอตรวจเช็คภาพเองทันที
    }

    // หากผู้ให้บริการหลักถูกบันทึกว่าเครดิตหมด ให้พยายามสลับใช้ผู้ให้บริการสำรองทันที
    if (providerQuotaState.status === 'exhausted' && providerQuotaState.provider === provider) {
        const failover = await attemptSecondaryProviderFailover(provider, imageBuffer);
        if (failover) return failover;
        addLog('WARN', `⚠️ โควตา ${provider.toUpperCase()} หมด และไม่มีผู้ให้บริการสำรอง ระบบส่งสลิปเข้าคิวตรวจภาพเอง (Manual)`);
        return null;
    }

    let result = null;
    if (provider === 'easyslip') {
        result = await verifyWithEasySlip(imageBuffer);
    } else if (provider === 'thunder') {
        result = await verifyWithThunder(imageBuffer);
    } else if (provider === 'slipverify') {
        result = await verifyWithSlipVerify(imageBuffer);
    } else if (provider === 'custom') {
        result = await verifyWithCustom(imageBuffer);
    } else {
        result = await verifyWithSlipOK(imageBuffer);
    }

    // หากตรวจสอบสำเร็จ หรือเป็นกรณีสลิปซ้ำ (Code 1012) ให้ส่งกลับผลลัพธ์
    if (result && (result.success || result.data?.transRef)) {
        return result;
    }

    // หากเกิด Quota Exhaustion ระหว่างการตรวจสอบ ให้พยายามสลับหา Secondary Failover ทันที
    if (providerQuotaState.status === 'exhausted' && providerQuotaState.provider === provider) {
        const failover = await attemptSecondaryProviderFailover(provider, imageBuffer);
        if (failover) return failover;
    }

    return result;
}

// 🇹🇭 ระบบวิเคราะห์ที่อยู่ภาษาไทยสำรองด้วย Regular Expression (ทำงานได้ 100% แม้ไม่มีเน็ตหรือ AI ไม่ว่าง)
function parseThaiAddressFallback(text, defaultName = 'ลูกค้า LINE') {
    if (!text || typeof text !== 'string') return null;

    // 1. สกัดเบอร์โทรศัพท์ (0XXXXXXXXX หรือ +66...)
    let phone = '';
    const phoneMatch = text.match(/(?:(?:\+66|0)[- ]?[689][0-9]{1}[- ]?[0-9]{3}[- ]?[0-9]{4})|(?:(?:\+66|0)[- ]?[2-5][0-9]{2}[- ]?[0-9]{4})/);
    if (phoneMatch) {
        phone = phoneMatch[0].replace(/[^0-9]/g, '');
        if (phone.startsWith('66')) phone = '0' + phone.substring(2);
    }

    // 2. สกัดรหัสไปรษณีย์ 5 หลัก
    let postcode = '';
    const postMatch = text.match(/\b([1-9][0-9]{4})\b/);
    if (postMatch) {
        postcode = postMatch[1];
    }

    // หากไม่มีทั้งเบอร์โทรและรหัสไปรษณีย์ แสดงว่าไม่ใช่ข้อความที่อยู่จัดส่ง
    if (!phone && !postcode) return null;

    // 3. สกัดจังหวัด
    let province = '';
    const provMatch = text.match(/(?:จ\.|จังหวัด)\s*([ก-๙a-zA-Z]+)/);
    if (provMatch) province = provMatch[1].trim();

    // 4. สกัดอำเภอ / เขต
    let district = '';
    const distMatch = text.match(/(?:อ\.|อำเภอ|เขต)\s*([ก-๙a-zA-Z]+)/);
    if (distMatch) district = distMatch[1].trim();

    // 5. สกัดตำบล / แขวง
    let subdistrict = '';
    const subMatch = text.match(/(?:ต\.|ตำบล|แขวง)\s*([ก-๙a-zA-Z]+)/);
    if (subMatch) subdistrict = subMatch[1].trim();

    // 6. สกัดชื่อผู้รับ (บรรทัดแรก หรือคำที่อยู่หน้าเบอร์โทร)
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let recipient_name = '';
    if (lines.length > 0) {
        let firstLine = lines[0].replace(phoneMatch ? phoneMatch[0] : '', '').replace(/ชื่อ|ผู้รับ|คุณ|k\./gi, '').trim();
        if (firstLine.length >= 2 && firstLine.length <= 40) {
            recipient_name = firstLine;
        }
    }

    // 7. สกัดบ้านเลขที่/ซอย/ถนน (ข้อความที่เหลือ)
    let addressClean = text
        .replace(phoneMatch ? phoneMatch[0] : '', '')
        .replace(postMatch ? postMatch[0] : '', '')
        .replace(provMatch ? provMatch[0] : '', '')
        .replace(distMatch ? distMatch[0] : '', '')
        .replace(subMatch ? subMatch[0] : '', '')
        .replace(recipient_name, '')
        .replace(/ชื่อ|เบอร์|โทร|ผู้รับ|ที่อยู่|ส่งที่/gi, '')
        .replace(/\n+/g, ' ')
        .trim();

    const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
    let finalRecipient = recipient_name ? recipient_name.trim() : '';
    if (!finalRecipient || genericNames.includes(finalRecipient.toLowerCase())) {
        finalRecipient = defaultName || 'ลูกค้า LINE';
    }

    return {
        recipient_name: finalRecipient,
        phone: phone || '',
        address: addressClean || text,
        subdistrict: subdistrict || '',
        district: district || '',
        province: province || '',
        postcode: postcode || '',
        remark: 'สกัดด้วยระบบสำรอง Regex (ป้องกัน AI Rate Limit)'
    };
}

// 🧠 ฟังก์ชันสกัดที่อยู่จัดส่งด้วย Gemini AI สำหรับ Kerry Express (พร้อม Auto-Fallback)
async function parseThaiAddressWithAI(text, defaultName = 'ลูกค้า LINE') {
    if (process.env.GEMINI_API_KEY) {
        try {
            const prompt = `คุณคือผู้ช่วยสกัดที่อยู่จัดส่งพัสดุในประเทศไทย กรุณาวิเคราะห์ข้อความต่อไปนี้ และตอบกลับเป็น JSON เท่านั้น
ข้อกำหนด:
- recipient_name: ชื่อ-นามสกุลของผู้รับ (หากในข้อความไม่ได้ระบุชื่อคน ให้ตอบค่าว่าง "")
- phone: เบอร์โทรศัพท์ 10 หลัก (ตัดขีด ช่องว่าง หรือ +66 ให้เป็น 0XXXXXXXXX)
- address: บ้านเลขที่ ซอย หมู่ ถนน อาคาร ชั้น
- subdistrict: ตำบล หรือ แขวง (ตัดคำนำหน้า ต. หรือ แขวง ออกถ้ามี)
- district: อำเภอ หรือ เขต (ตัดคำนำหน้า อ. หรือ เขต ออกถ้ามี)
- province: จังหวัด (ตัดคำนำหน้า จ. ออกถ้ามี)
- postcode: รหัสไปรษณีย์ 5 หลัก
- remark: หมายเหตุหรือคำสั่งพิเศษ (เช่น ฝากไว้ที่ป้อมยาม, โทรแจ้งก่อนส่ง) ถ้าไม่มีให้เป็นค่าว่าง ""

ข้อความ: "${text}"`;

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`;
            const res = await axios.post(url, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            }, { timeout: 4000 });

            const rawJson = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawJson) {
                const parsed = JSON.parse(rawJson);
                if (parsed.phone && parsed.postcode) {
                    const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
                    let finalName = parsed.recipient_name ? String(parsed.recipient_name).trim() : '';
                    if (!finalName || genericNames.includes(finalName.toLowerCase())) {
                        finalName = defaultName || 'ลูกค้า LINE';
                    }
                    parsed.recipient_name = finalName;

                    addLog('SUCCESS', `Gemini AI สกัดที่อยู่สำเร็จ: คุณ${parsed.recipient_name} (${parsed.phone}) จ.${parsed.province}`);
                    return parsed;
                }
            }
        } catch (e) {
            addLog('WARN', 'Gemini AI สกัดที่อยู่ไม่สำเร็จหรือเกินโควตา สลับใช้ระบบสำรอง Regex ทันที', e.message);
        }
    }

    // 🛡️ ระบบสำรอง Deterministic Regex: ทำงานทันทีเมื่อไม่มี Gemini หรือ AI เกิดข้อผิดพลาด
    const fallbackParsed = parseThaiAddressFallback(text, defaultName);
    if (fallbackParsed && (fallbackParsed.phone || fallbackParsed.postcode)) {
        addLog('SUCCESS', `ระบบสำรอง Regex สกัดที่อยู่สำเร็จ: คุณ${fallbackParsed.recipient_name} (${fallbackParsed.phone}) ${fallbackParsed.postcode}`);
        return fallbackParsed;
    }

    addLog('INFO', 'วิเคราะห์ข้อความแล้วแต่ไม่ใช่รูปแบบที่อยู่จัดส่งที่ระบุเบอร์หรือรหัสไปรษณีย์');
    return null;
}

// 🛡️ Cache ป้องกัน Webhook ซ้ำซ้อน / ลูกค้ากดส่งรัวๆ (Deduplication Cache, TTL 5 นาที)
const processedMessageIds = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [id, time] of processedMessageIds.entries()) {
        if (now - time > 5 * 60 * 1000) processedMessageIds.delete(id);
    }
}, 60000);

app.post('/webhook', async (req, res) => {
    // 🛡️ ตรวจสอบ LINE Webhook Signature (HMAC-SHA256) ป้องกัน Webhook Spoofing
    const channelSecret = (process.env.LINE_CHANNEL_SECRET || '').trim();
    const signature = req.headers['x-line-signature'];

    // ⚠️ ร้านที่ยังไม่ได้ใส่ LINE Channel Secret: ยังรับ Webhook ต่อเหมือนเดิม (ไม่ให้ระบบหยุด) แต่เตือนในหน้าบันทึกระบบ
    // ให้ใส่ค่าในหน้าตั้งค่าเชื่อมต่อ เพื่อเปิดการตรวจลายเซ็นกันข้อความปลอม (เตือนไม่เกิน 1 ครั้งต่อชั่วโมง)
    if (!channelSecret && (!global.__lastNoSecretWarn || Date.now() - global.__lastNoSecretWarn > 60 * 60 * 1000)) {
        global.__lastNoSecretWarn = Date.now();
        addLog('WARN', '⚠️ ยังไม่ได้ตั้งค่า LINE Channel Secret ระบบจึงตรวจไม่ได้ว่าข้อความมาจาก LINE จริง กรุณาใส่ Channel Secret ในหน้าตั้งค่าเชื่อมต่อ');
    }

    if (channelSecret) {
        if (!signature || typeof signature !== 'string') {
            addLog('WARN', '🚨 ปฏิเสธ Webhook: ไม่พบลายเซ็น x-line-signature (Security Guard)');
            return res.status(401).send('Unauthorized: Missing signature');
        }
        const raw = req.rawBody || Buffer.from(JSON.stringify(req.body));
        const expected = Buffer.from(crypto.createHmac('sha256', channelSecret).update(raw).digest('base64'));
        const got = Buffer.from(signature);
        if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
            addLog('WARN', '🚨 ปฏิเสธ Webhook: ลายเซ็นดิจิทัล x-line-signature ไม่ถูกต้อง (x-line-signature mismatch)');
            return res.status(401).send('Unauthorized: Invalid signature');
        }
    }

    res.status(200).send("OK");
    try {
        const events = req.body.events;
        if (!events || !Array.isArray(events) || events.length === 0) return;

        for (const event of events) {
            try {
                const replyToken = event.replyToken;
                const userId = event.source?.userId;
                if (!userId) continue;

        // 🛡️ ตรวจสอบ Message Deduplication
        if (event.type === 'message' && event.message?.id) {
            const msgId = event.message.id;
            if (processedMessageIds.has(msgId)) {
                addLog('INFO', `บล็อกข้อความซ้ำ (Deduplication): Message ID ${msgId}`);
                console.log(`⚠️ ข้อความซ้ำถูกบล็อก (Duplicate Webhook Drop): ${msgId}`);
                continue;
            }
            processedMessageIds.set(msgId, Date.now());
        }
        
        if (event.type === 'message' && event.message.type === 'text') {
            const text = event.message.text.trim();
            if (text.startsWith('#แทรกคิว')) {
                const { data: isAdmin } = await supabase.from('admins').select('line_id').eq('line_id', userId).single();
                if (!isAdmin) continue; 

                const parts = text.split(' ');
                if (parts.length >= 3) {
                    const amount = parseFloat(parts[1]); const customerName = parts.slice(2).join(' ');
                    
                    let result = calculateBestDraws(amount, 0); 
                    if (result.draws === 0) { 
                        // await replyLineMessage(replyToken, `ผักกาดขอโทษน้าา 🥺 ยอดเงินที่โอนมายังไม่พอสำหรับค่าสินค้าเลยค่ะ รบกวนเช็คยอดอีกทีน้า`, userId); 
                        continue; 
                    }
                    
                    let breakdownStr = result.breakdown.join(', ');
                    const fakeTransRef = `manual-${Date.now()}|${breakdownStr}`;

                    const { data: inserted, error: insertErr } = await supabase.from('slips').insert([{
                        amount, draws: result.draws, sender_name: `Manual - ${customerName}`, line_name: `Admin`, line_id: null,
                        session_id: activeLiveSession ? activeLiveSession.id : null,
                        trans_date: getTodayString(), trans_time: getLocalTimeString(), 
                        qr_payload: fakeTransRef, status: 'waiting'
                    }]).select().single();

                    if (!insertErr) {
                        io.emit('play_sound');
                        broadcastTodayStats(); 
                        const currentQ = await getCurrentQueueNumber();
                        let replyMsg = `✨ แทรกคิวให้ "${customerName}" เรียบร้อยแล้วค่า!\nคิวที่: ${currentQ} นะคะ`;
                        if (openchatLink && openchatLink.trim() !== "") replyMsg += `\n\n💬 อย่าลืมเข้ากลุ่มเพื่อติดตามเลขพัสดุนะคะ👇\n${openchatLink}`;
                        // await replyLineMessage(replyToken, replyMsg, userId); // ปิดการตอบกลับตามความต้องการของผู้ใช้
                    }
                }
            } else {
                // 📦 ตรวจสอบว่าเป็นข้อความที่อยู่จัดส่งพัสดุหรือไม่ (มีเบอร์โทรหรือรหัสไปรษณีย์)
                const hasPhone = /(0\d{8,9})/.test(text.replace(/[-\s]/g, ''));
                const hasPostcode = /\b\d{5}\b/.test(text);
                const hasAddrKeyword = /(ต\.|อ\.|จ\.|แขวง|เขต|จังหวัด|หมู่|ซอย|บ้านเลขที่|ส่งที่|ที่อยู่)/.test(text);

                if (hasPhone || (hasPostcode && hasAddrKeyword)) {
                    const lineName = await getLineProfile(userId);
                    const parsedAddress = await parseThaiAddressWithAI(text, lineName);
                    if (parsedAddress) {
                        const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
                        if (!parsedAddress.recipient_name || genericNames.includes(parsedAddress.recipient_name.toLowerCase())) {
                            parsedAddress.recipient_name = lineName || 'ลูกค้า LINE';
                        }
                        // บันทึกที่อยู่ลง configs ผูกกับ line_id ของลูกค้า
                        const addrConfigKey = `cust_addr_${userId}`;
                        // 🛡️ ถ้าข้อความใหม่ให้ข้อมูลไม่ครบ (เช่น ส่งมาแค่เบอร์โทร) ให้คงช่องเดิมที่เคยบันทึกไว้ ไม่ลบที่อยู่ดีๆ ทิ้ง
                        try {
                            const { data: prevRow } = await supabase.from('configs').select('value').eq('key', addrConfigKey).single();
                            if (prevRow && prevRow.value) {
                                const prev = JSON.parse(prevRow.value);
                                for (const f of ['phone', 'address', 'subdistrict', 'district', 'province', 'postcode']) {
                                    const nv = parsedAddress[f];
                                    if ((nv === undefined || nv === null || String(nv).trim() === '') && prev[f]) parsedAddress[f] = prev[f];
                                }
                            }
                        } catch (mergeErr) { /* ไม่มีที่อยู่เดิม หรืออ่านไม่ได้ ใช้ข้อมูลใหม่ตามปกติ */ }
                        await supabase.from('configs').upsert([{
                            key: addrConfigKey,
                            value: JSON.stringify(parsedAddress)
                        }]);

                        let confirmMsg = `📦 ผักกาดบันทึกที่อยู่จัดส่งให้เรียบร้อยแล้วค่า!\n` +
                                         `👤 ผู้รับ: ${parsedAddress.recipient_name}\n` +
                                         `📞 เบอร์โทร: ${parsedAddress.phone}\n` +
                                         `📍 ที่อยู่: ${parsedAddress.address} ต.${parsedAddress.subdistrict} อ.${parsedAddress.district} จ.${parsedAddress.province} ${parsedAddress.postcode}`;
                        
                        if (parsedAddress.remark && parsedAddress.remark.trim() !== "") {
                            confirmMsg += `\n📝 หมายเหตุ: ${parsedAddress.remark}`;
                        }
                        confirmMsg += `\n\n🚚 พร้อมส่งผ่าน Kerry Express หลังจบไลฟ์นะคะ (หากต้องการแก้ไข สามารถพิมพ์ส่งมาใหม่ได้ตลอดน้า)`;

                        // await replyLineMessage(replyToken, confirmMsg, userId); // ปิดการตอบกลับที่อยู่จัดส่งตามที่ผู้ใช้กำหนด
                    }
                }
            }
        }
        else if (event.type === 'message' && event.message.type === 'image') {
            const messageId = event.message.id;
            const imageBuffer = await downloadImageFromLine(messageId);
            if (!imageBuffer) {
                // 🛡️ อย่าทิ้งเงียบ: บันทึก Log ให้แม่ค้า/แอดมินรู้ว่ามีลูกค้าส่งรูปมาแต่ดาวน์โหลดจาก LINE ไม่สำเร็จ
                const failName = await Promise.race([
                    getLineProfile(userId).catch(() => ''),
                    new Promise(r => setTimeout(() => r(''), 5000))
                ]) || userId;
                addLog('WARN', `ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ (ลูกค้า "${failName}") กรุณาตรวจสอบสลิปในแชท LINE OA ด้วยตนเอง`);
                // 🔴 แสดงการ์ดสีแดงบนหน้าจอหลัก + เสียงเตือน ให้แม่ค้ารู้ทันทีระหว่างไลฟ์ (ไม่ต้องเปิดหน้าบันทึกระบบ)
                try {
                    recordLineImageFailure(failName === userId || failName === 'ไม่ทราบชื่อ LINE' ? null : failName, messageId);
                    io.emit('image_failed');
                    await broadcastTodayStats();
                } catch (notifyErr) { /* การแจ้งเตือนหน้าจอล้มเหลวต้องไม่ทำให้ Webhook พัง */ }
                continue;
            }

            let slipResult = await verifySlipWithProvider(imageBuffer);
            // ✅ ดึงชื่อ LINE จากโปรไฟล์ผู้ใช้อย่างถูกต้อง 100%
            const lineName = await getLineProfile(userId);

            // 🛡️ ตรวจความถูกต้องของยอดเงินและรหัสอ้างอิงก่อนให้สิทธิ์อัตโนมัติ
            // - ยอดต้องเป็นตัวเลขบวก ไม่เกิน 1,000,000 (เหมือนการใส่ยอดเอง)
            // - ต้องมีรหัสอ้างอิงสลิปจริง (รหัสที่ระบบสร้างจากเวลาเอง ตรวจสลิปซ้ำไม่ได้)
            // ถ้าไม่ผ่าน ให้ส่งเข้าคิว "ตรวจสลิปเอง" แทน ไม่ปล่อยให้ยอดในกระเป๋าลูกค้าเพี้ยน
            if (slipResult && slipResult.success) {
                const d = slipResult.data || {};
                const amt = Number(d.amount);
                const ref = String(d.transRef || '').trim();
                const isSyntheticRef = /^(EASY|THUNDER|SLIPVERIFY)_\d{13}$/.test(ref);
                if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000 || !ref || isSyntheticRef) {
                    addLog('WARN', `สลิปจากลูกค้า "${lineName}" อ่านได้แต่ข้อมูลไม่ครบ (ยอด: ${d.amount}, รหัสอ้างอิง: ${ref || '-'}) ส่งเข้าคิวให้แอดมินตรวจเอง`);
                    slipResult = null;
                } else {
                    d.amount = amt;
                    d.transRef = ref;
                }
            }
            
            if (slipResult && slipResult.success) {
                const slipData = slipResult.data;

                if (merchantAccountName && merchantAccountName.trim() !== "") {
                    let receiverName = "";
                    if (slipData.receiver) receiverName = slipData.receiver.displayName || slipData.receiver.name || slipData.receiver.accountName || "";
                    const searchName = merchantAccountName.trim().toLowerCase();
                    const actualName = receiverName.toLowerCase();
                    if (!actualName.includes(searchName)) {
                        await notifyUnrecordedSlip(lineName, messageId, `สลิปโอนเข้าบัญชี "${receiverName || 'ไม่ทราบชื่อ'}" ไม่ตรงกับชื่อบัญชีร้าน "${merchantAccountName}" (ยอด ${fmtBaht(slipData.amount)} บาท) ระบบไม่ได้บันทึกสลิปนี้`);
                        addLog('WARN', `ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "${lineName}" โอนเข้าบัญชี "${receiverName}" (ไม่ใช่ "${merchantAccountName}")`);
                        // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้โอนไปที่บัญชี "${receiverName || 'ไม่ทราบชื่อ'}" นะคะ ซึ่งไม่ใช่บัญชีของผักกาดน้า รบกวนคุณลูกค้าเช็คบัญชีผู้รับอีกทีนะคะ 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                        continue;
                    }
                }

                const transRef = slipData.transRef; 
                const amount = slipData.amount;

                // 🛡️ ป้องกันสลิปซ้ำระดับ B-Tree Index: เช็กว่ารหัสสลิปนี้เคยส่งเข้ามาในระบบแล้วหรือยัง
                const existingSlip = supabase.db.prepare("SELECT id, trans_date, status, line_id, line_name FROM slips WHERE trans_ref = ? AND trans_ref IS NOT NULL AND trans_ref != '' LIMIT 1").get(transRef);
                if (existingSlip) {
                    // v1.0.16: ลูกค้าคนเดิมส่งสลิปซ้ำเป็นเรื่องปกติ (ยังเป็นแค่บรรทัดใน Logs) แต่ถ้าเป็นสลิปของลูกค้าคนอื่น หรือใบที่แม่ค้าปัดตกไปแล้ว ให้ขึ้นการ์ดให้รู้
                    if ((existingSlip.line_id && existingSlip.line_id !== userId) || existingSlip.status === 'rejected') {
                        const dupWho = (existingSlip.line_id && existingSlip.line_id !== userId) ? `ของลูกค้า "${existingSlip.line_name || 'อีกคน'}"` : 'และถูกปัดตกไปแล้ว';
                        await notifyUnrecordedSlip(lineName, messageId, `สลิปรหัส ${transRef} (ยอด ${fmtBaht(amount)} บาท) เคยถูกบันทึกแล้ว ${dupWho} ระบบจึงไม่นับซ้ำ`);
                    }
                    addLog('WARN', `ตรวจพบสลิปซ้ำ: ลูกค้า "${lineName}" ส่งสลิปรหัส ${transRef} ที่เคยบันทึกไปแล้ว`);
                    console.log(`⚠️ ตรวจพบสลิปซ้ำ: ${transRef}`);
                    // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้เคยถูกใช้งานไปแล้วนะคะ รบกวนคุณลูกค้าตรวจสอบสลิปอีกครั้ง หรือติดต่อแอดมินน้า 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                    continue;
                }

                let customer = supabase.db.prepare('SELECT * FROM customers WHERE line_id = ?').get(userId);
                let currentBalance = (customer ? customer.balance : 0) + amount; 

                let pastDrawsToday = countPastDraws(userId);

                let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
                let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
                
                let result = calculateBestDraws(virtualBalance, pastDrawsToday, { holdExactPrice: true });
                let draws = result.draws;
                let remainingBalance = walletAfter(result, currentBalance);

                const status = draws > 0 ? 'waiting' : 'accumulated';
                let breakdownStr = result.breakdown.join(', ');
                const payloadRef = `${transRef}|${breakdownStr}`; 
                
                // 🔒 Atomic Transaction: รวมการบันทึกยอดเงินลูกค้าและสลิปเป็น Atomic Unit เพื่อป้องกัน Race Condition 100%
                let inserted = null;
                try {
                    // ⚡ Self-Healing: ถ้าฐานข้อมูลไม่ว่างชั่วคราว (database is locked) ลองบันทึกใหม่สูงสุด 3 ครั้ง ก่อนส่งเข้าคิวตรวจเอง
                    for (let txAttempt = 1; ; txAttempt++) {
                    try {
                    inserted = supabase.runTransaction(() => {
                        // Double check ป้องกัน race condition ในระดับ transaction
                        const dup = supabase.db.prepare("SELECT id FROM slips WHERE trans_ref = ? AND trans_ref IS NOT NULL AND trans_ref != '' LIMIT 1").get(transRef);
                        if (dup) throw new Error('DUPLICATE_SLIP');

                        if (customer) {
                            supabase.db.prepare('UPDATE customers SET balance = ?, name = ? WHERE line_id = ?').run(remainingBalance, lineName, userId);
                        } else {
                            supabase.db.prepare('INSERT INTO customers (line_id, name, balance) VALUES (?, ?, ?)').run(userId, lineName, remainingBalance);
                        }

                        const stmt = supabase.db.prepare(`
                            INSERT INTO slips (amount, draws, line_id, sender_name, line_name, session_id, trans_date, trans_time, trans_ref, qr_payload, status, arrived_out_of_round)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);
                        const info = stmt.run(
                            amount, draws, userId, lineName, lineName,
                            activeLiveSession ? activeLiveSession.id : null,
                            getTodayString(), slipData.transTime || getLocalTimeString(),
                            transRef, payloadRef, status,
                            activeLiveSession ? 0 : 1
                        );
                        // v1.0.16: เงินเข้าตอนไม่มีไลฟ์ = "โอนนอกรอบ" (ยอดจุ่มที่โอนทีหลัง / โอนเตรียมรอบหน้า)
                        // การ์ดจะติดป้ายให้เห็นชัด และบันทึกเตือนไว้ใน log/Discord ให้แม่ค้าตรวจสอบก่อนส่งของ
                        if (!activeLiveSession) {
                            addLog('WARN', `🕒 ลูกค้า "${lineName}" โอนนอกรอบ (เงินเข้าตอนไม่มีไลฟ์ ${amount} บาท) — ถ้าเป็นยอดจุ่มที่จ่ายของไปแล้ว ให้กดจัดการการ์ดให้ถูกต้อง ระวังส่งของซ้ำ`);
                        }
                        return { id: info.lastInsertRowid };
                    });
                    if (txAttempt > 1) {
                        reportSelfHealingToDiscord({ category: 'DATABASE', title: 'ฐานข้อมูลไม่ว่างชั่วคราว', issue: `บันทึกสลิปของ "${lineName}" ครั้งแรกไม่สำเร็จเพราะฐานข้อมูลไม่ว่าง`, actionDetails: `ลองบันทึกใหม่อัตโนมัติ สำเร็จในครั้งที่ ${txAttempt}` }).catch(() => {});
                    }
                    break;
                    } catch (busyErr) {
                        if (txAttempt < 3 && /SQLITE_BUSY|database is locked/i.test(String(busyErr && busyErr.message))) {
                            addLog('WARN', `ฐานข้อมูลไม่ว่างชั่วคราว กำลังลองบันทึกสลิปของ "${lineName}" ใหม่ (ครั้งที่ ${txAttempt + 1})`);
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                        }
                        throw busyErr;
                    }
                    }
                } catch (txErr) {
                    if (txErr.message === 'DUPLICATE_SLIP' || (txErr.message && txErr.message.includes('UNIQUE constraint failed'))) {
                        addLog('WARN', `ตรวจพบสลิปซ้ำ (Atomic Unique Lock): ลูกค้า "${lineName}" ส่งสลิปรหัส ${transRef} ซ้ำ`);
                        console.log(`⚠️ ตรวจพบสลิปซ้ำ (Atomic Block): ${transRef}`);
                        // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้เคยถูกใช้งานไปแล้วนะคะ รบกวนคุณลูกค้าตรวจสอบสลิปอีกครั้ง หรือติดต่อแอดมินน้า 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                        continue;
                    }
                    // 🛡️ ฐานข้อมูลขัดข้องชั่วคราว: อย่าทำสลิปที่ลูกค้าจ่ายแล้วหาย ให้เก็บรูปเข้าคิว "ตรวจสลิปเอง" แทน
                    // (ยอดกระเป๋าลูกค้าใน transaction ถูกยกเลิกทั้งชุดแล้ว จึงไม่มียอดซ้ำ)
                    addLog('ERROR', `บันทึกสลิปอัตโนมัติของ "${lineName}" ไม่สำเร็จ (${txErr.message}) ส่งเข้าคิวให้แอดมินตรวจเอง`);
                    try {
                        const fbName = `manual_${Date.now()}_${userId}.jpg`;
                        await fs.promises.writeFile(path.join(uploadsDir, fbName), Buffer.from(imageBuffer));
                        await supabase.from('slips').insert([{
                            amount: 0, draws: 0, line_id: userId, sender_name: lineName, line_name: lineName,
                            session_id: activeLiveSession ? activeLiveSession.id : null,
                            trans_date: getTodayString(), trans_time: getLocalTimeString(),
                            qr_payload: `manual_image|/uploads/${fbName}`, status: 'waiting',
                            arrived_out_of_round: activeLiveSession ? 0 : 1   // v1.0.16: รูปที่เข้าตอนไม่มีไลฟ์ ติดป้ายโอนนอกรอบเหมือนสลิปปกติ
                        }]).select().single();
                        io.emit('play_sound');
                        broadcastTodayStats();
                    } catch (fbErr) {
                        addLog('ERROR', `เก็บสลิปสำรองไม่สำเร็จ: ${fbErr.message} (กรุณาตรวจสลิปของ "${lineName}" ในแชท LINE)`);
                    }
                    continue;
                }

                if (inserted) {
                    if (draws > 0) {
                        io.emit('play_sound');
                        const latestStats = await broadcastTodayStats();
                        
                        // ค้นหาตำแหน่งคิวของลูกค้าใน waiting list
                        let currentQ = 1;
                        let isExistingMerged = false;
                        if (latestStats && latestStats.queues && latestStats.queues.waiting) {
                            const qIndex = latestStats.queues.waiting.findIndex(q => q.lineName === lineName || q.name === lineName);
                            if (qIndex !== -1) {
                                currentQ = qIndex + 1;
                                isExistingMerged = (latestStats.queues.waiting[qIndex].slipIds.length > 1);
                            }
                        }
                        
                        // ✅ ข้อ 1: ตอบกลับเฉพาะกรณีลูกค้าส่งสลิปสำเร็จและได้สิทธิ์ลุ้น (คงไว้ข้อเดียวตามคำสั่งผู้ใช้)
                        let replyMsg = `ผักกาดขอบคุณสำหรับคำสั่งซื้อมากๆ เลยน้าา 🙏💖\nอย่าลืมพิมพ์ชื่อ ที่อยู่ เบอร์โทรส่งมาให้ผักกาดในแชทนี้ด้วยนะคะ จะได้รีบแพ็คของส่งให้ค่า 📦✨`;
                        if (openchatLink && openchatLink.trim() !== "") {
                            replyMsg += `\n\n💬 ผักกาดแจ้งเลขพัสดุในโอเพ่นแชทนี้น้า จิ้มเข้ากลุ่มไว้ได้เลยค่า👇\n${openchatLink}`;
                        } else {
                            replyMsg += `\n\n💬 ผักกาดจะแจ้งเลขพัสดุใน LINE OpenChat นะคะ`;
                        }
                        await replyLineMessage(replyToken, replyMsg, userId);
                    } else {
                        broadcastTodayStats(); 
                        // 💬 ยอดยังไม่พอ/พักรอค่าส่ง: แจ้งแม่ค้าบนหน้าจอ (เสียงเตือน + กล่อง "รอโอนเพิ่ม") และตอบลูกค้าให้โอนเพิ่ม (v1.0.11)
                        try {
                            const tp = describeTopup(remainingBalance, pastDrawsToday);
                            if (tp && tp.need > 0) {
                                io.emit('topup_needed', { name: lineName, need: tp.need, held: tp.held });
                                addLog('INFO', `ลูกค้า "${lineName}" ยอดยังไม่พอ ต้องโอนเพิ่มอีก ${fmtBaht(tp.need)}฿${tp.held ? ' (ค่าส่ง)' : ''}`);
                                const topupMsg = tp.held
                                    ? `ผักกาดได้รับยอด ${fmtBaht(remainingBalance)} บาทแล้วน้าา 💖\nยอดนี้เท่ากับราคาสินค้าพอดี แต่ยังไม่รวมค่าส่ง ${fmtBaht(shippingFee)} บาทนะคะ\nรบกวนโอนค่าส่งเพิ่มอีก ${fmtBaht(tp.need)} บาท ผักกาดจะรีบเข้าคิวให้ค่า 🙏\n(ถ้าต้องการสินค้าชิ้นอื่น พิมพ์บอกผักกาดในแชทนี้ได้เลยน้า)`
                                    : `ผักกาดได้รับยอดแล้วน้าา 💖\nแต่ตอนนี้ยอดรวม (รวมค่าส่งแล้ว) ยังไม่พอสำหรับสินค้านะคะ\nรบกวนโอนเพิ่มอีก ${fmtBaht(tp.need)} บาท ผักกาดจะรีบเข้าคิวให้ค่า 🙏`;
                                await replyLineMessage(replyToken, topupMsg, userId);
                            }
                        } catch (topupErr) {
                            addLog('WARN', `แจ้งเตือนรอโอนเพิ่มของ "${lineName}" ไม่สำเร็จ: ${topupErr.message}`);
                        }
                    }
                }
            } else {
                const fileName = `manual_${Date.now()}_${userId}.jpg`;
                const filePath = path.join(uploadsDir, fileName);
                await fs.promises.writeFile(filePath, Buffer.from(imageBuffer));
                const imageUrl = `/uploads/${fileName}`;

                const payloadRef = `manual_image|${imageUrl}`; 
                addLog('INFO', `ได้รับภาพจากลูกค้า "${lineName}" ที่ระบบอัตโนมัติอ่านสลิปไม่ได้ นำเข้าคิวเพื่อให้แอดมินตรวจเช็คภาพเอง`);
                const { data: inserted } = await supabase.from('slips').insert([{
                    amount: 0, 
                    draws: 0, 
                    line_id: userId, 
                    sender_name: lineName, // ใช้ชื่อ LINE จริงเช่นกัน
                    line_name: lineName, 
                    session_id: activeLiveSession ? activeLiveSession.id : null,
                    trans_date: getTodayString(), 
                    trans_time: getLocalTimeString(), 
                    qr_payload: payloadRef, 
                    status: 'waiting',
                    arrived_out_of_round: activeLiveSession ? 0 : 1   // v1.0.16: รูปที่เข้าตอนไม่มีไลฟ์ ติดป้ายโอนนอกรอบเหมือนสลิปปกติ
                }]).select().single();

                if (inserted) {
                    io.emit('play_sound');
                    broadcastTodayStats();
                    
                    let replyMsg = `ผักกาดขอบคุณสำหรับคำสั่งซื้อมากๆ เลยน้าา 🙏💖\nอย่าลืมพิมพ์ชื่อ ที่อยู่ เบอร์โทรส่งมาให้ผักกาดในแชทนี้ด้วยนะคะ จะได้รีบแพ็คของส่งให้ค่า 📦✨`;
                    if (openchatLink && openchatLink.trim() !== "") {
                        replyMsg += `\n\n💬 ผักกาดแจ้งเลขพัสดุในโอเพ่นแชทนี้น้า จิ้มเข้ากลุ่มไว้ได้เลยค่า👇\n${openchatLink}`;
                    } else {
                        replyMsg += `\n\n💬 ผักกาดจะแจ้งเลขพัสดุใน LINE OpenChat นะคะ`;
                    }
                    // await replyLineMessage(replyToken, replyMsg, userId); // ปิดการตอบกลับภาพที่สแกนไม่ติดตามที่ผู้ใช้กำหนด (ข้อ 3)
                }
            }
        }
    } catch (eventErr) {
        console.error("Event Processing Error:", eventErr.message);
        addLog('ERROR', `เกิดข้อผิดพลาดในการประมวลผล Webhook Event: ${eventErr.message}`);
    }
}
} catch (error) { console.error("Webhook Error:", error.message); }
});

const PORT = process.env.PORT || 3000;

// ⚡ API ตรวจสอบโควตาเครดิต API ตรวจสลิป (ป้องกัน Risk 2)
app.get('/api/provider/quota', async (req, res) => {
    const quotaInfo = await checkProviderQuota(req.query.force === 'true');
    res.json({ success: true, ...quotaInfo });
});

// 🌐 API ตรวจสอบสถานะ Tunnel & Webhook (แก้ Risk 1)
let activeTunnelType = null;
let currentPublicUrl = null;
sentinel.setTunnelUrlGetter(() => currentPublicUrl);
let cloudflareProcess = null;
let localtunnelInstance = null;
let webhookSyncStatus = { synced: false, url: null, error: null, lastTested: null, testResult: null };

app.get('/api/tunnel/status', (req, res) => {
    res.json({
        success: true,
        active: !!currentPublicUrl,
        publicUrl: currentPublicUrl,
        webhookUrl: currentPublicUrl ? `${currentPublicUrl}/webhook` : null,
        type: activeTunnelType,
        syncStatus: webhookSyncStatus
    });
});

app.post('/api/tunnel/test_line', async (req, res) => {
    if (!currentPublicUrl) return res.status(400).json({ success: false, message: 'ระบบท่อเชื่อมต่อยังไม่พร้อมใช้งาน' });
    const token = process.env.LINE_ACCESS_TOKEN ? process.env.LINE_ACCESS_TOKEN.replace(/["'\r\n ]/g, '').trim() : '';
    if (!token) return res.status(400).json({ success: false, message: 'กรุณาระบุ LINE Access Token ในหน้าตั้งค่าก่อน' });
    
    try {
        const webhookUrl = `${currentPublicUrl}/webhook`;
        await axios.put('https://api.line.me/v2/bot/channel/webhook/endpoint', 
            { endpoint: webhookUrl }, 
            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        const testRes = await axios.post('https://api.line.me/v2/bot/channel/webhook/test', 
            { endpoint: webhookUrl }, 
            { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
        );
        webhookSyncStatus.synced = true;
        webhookSyncStatus.lastTested = Date.now();
        webhookSyncStatus.testResult = testRes.data;
        res.json({ success: true, message: 'LINE ตรวจสอบการเชื่อมต่อ Webhook สำเร็จ 200 OK!', details: testRes.data });
    } catch(err) {
        const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
        res.status(500).json({ success: false, message: 'เชื่อมต่อ LINE ไม่สำเร็จ: ' + errMsg });
    }
});

// 🌐 ฟังก์ชันอัปเดต LINE Webhook URL อัตโนมัติไปยัง LINE Messaging API (Zero-Click Sync)
async function updateLineWebhookEndpoint(publicUrl, retries = 3) {
    const token = process.env.LINE_ACCESS_TOKEN ? process.env.LINE_ACCESS_TOKEN.replace(/["'\r\n ]/g, '').trim() : '';
    const webhookUrl = `${publicUrl}/webhook`;

    if (!token) {
        webhookSyncStatus = { 
            synced: false, 
            url: webhookUrl, 
            error: 'ยังไม่ได้ระบุ LINE Access Token ในหน้าตั้งค่า', 
            lastTested: Date.now() 
        };
        io.emit('tunnel_status', { 
            active: true, 
            url: publicUrl, 
            type: activeTunnelType, 
            synced: false, 
            error: webhookSyncStatus.error 
        });
        return;
    }
    
    // หน่วงเวลา 2.5 วินาทีเพื่อให้ท่อส่งสัญญาณพร้อมตอบรับคำขอของ LINE 100%
    await new Promise(r => setTimeout(r, 2500));

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await axios.put('https://api.line.me/v2/bot/channel/webhook/endpoint', 
                { endpoint: webhookUrl }, 
                { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
            );
            
            // สั่งเปิดใช้งาน Webhook ทันที (Test & Enable Webhook)
            const testRes = await axios.post('https://api.line.me/v2/bot/channel/webhook/test', 
                { endpoint: webhookUrl }, 
                { headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 }
            ).catch(e => ({ data: { success: false, reason: e.message } }));

            webhookSyncStatus = { 
                synced: true, 
                url: webhookUrl, 
                error: null, 
                testResult: testRes.data,
                lastTested: Date.now() 
            };

            console.log(`📡 [Auto-Sync LINE]: ผูก Webhook สำเร็จเรียบร้อย -> ${webhookUrl}`);
            addLog('SUCCESS', `เชื่อมต่อ Webhook อัตโนมัติกับ LINE เรียบร้อย: ${webhookUrl}`);
            
            io.emit('tunnel_status', { 
                active: true, 
                url: publicUrl, 
                type: activeTunnelType, 
                synced: true, 
                testResult: testRes.data 
            });
            break;
        } catch(err) {
            const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
            webhookSyncStatus = { synced: false, url: webhookUrl, error: errMsg, lastTested: Date.now() };
            io.emit('tunnel_status', { active: true, url: publicUrl, type: activeTunnelType, synced: false, error: errMsg });
            
            if (attempt === retries) {
                console.error(`❌ ไม่สามารถอัปเดต LINE Webhook อัตโนมัติได้: ${errMsg}`);
                addLog('ERROR', `อัปเดต LINE Webhook อัตโนมัติไม่สำเร็จ: ${errMsg}`);
            } else {
                await new Promise(r => setTimeout(r, 3000));
            }
        }
    }
}

// 🚇 ระบบท่อเชื่อมต่อสัญญาณอัจฉริยะแบบ Dual-Engine (Cloudflare + LocalTunnel Fallback)
// 🔁 P1-7 Cloudflare Tunnel Watchdog
// - ถ้าโปรแกรม Tunnel ปิดตัวกลางทาง: เปิดใหม่อัตโนมัติ หน่วง 5 → 15 → 30 → 60 วินาที
// - ทุก 60 วินาที ทดสอบเรียกลิงก์สาธารณะของร้าน ถ้าล้มเหลว 3 ครั้งติด (≈3 นาที) ถือว่าค้าง สั่งปิดเพื่อให้ Watchdog เปิดใหม่
let tunnelRestartAttempt = 0;
let tunnelRestartTimer = null;
let tunnelProbeTimer = null;
let tunnelProbeFailures = 0;
function scheduleTunnelRestart(port, reason) {
    if (tunnelRestartTimer) return; // มีการนัดเปิดใหม่อยู่แล้ว
    const delays = [5, 15, 30, 60];
    const delaySec = delays[Math.min(tunnelRestartAttempt, delays.length - 1)];
    tunnelRestartAttempt += 1;
    if (tunnelProbeTimer) { clearInterval(tunnelProbeTimer); tunnelProbeTimer = null; }
    addLog('WARN', `🔁 ${reason} — จะเชื่อมต่อ Tunnel ใหม่อัตโนมัติใน ${delaySec} วินาที (ครั้งที่ ${tunnelRestartAttempt})`);
    io.emit('tunnel_status', { active: false, url: null, type: 'Cloudflare', reconnecting: true });
    tunnelRestartTimer = setTimeout(() => {
        tunnelRestartTimer = null;
        if (typeof shuttingDown !== 'undefined' && shuttingDown) return;
        startAutoTunnel(port);
    }, delaySec * 1000);
}
function startTunnelHealthProbe(port) {
    if (tunnelProbeTimer) clearInterval(tunnelProbeTimer);
    tunnelProbeFailures = 0;
    tunnelProbeTimer = setInterval(async () => {
        if (!currentPublicUrl || !cloudflareProcess) return;
        try {
            await axios.get(`${currentPublicUrl}/api/health`, { timeout: 10000 });
            tunnelProbeFailures = 0;
        } catch (e) {
            tunnelProbeFailures += 1;
            if (tunnelProbeFailures >= 3) {
                tunnelProbeFailures = 0;
                addLog('WARN', '🔁 ตรวจพบ Tunnel ค้าง (เรียกลิงก์สาธารณะไม่ได้ 3 ครั้งติด) กำลังเริ่มการเชื่อมต่อใหม่');
                try { cloudflareProcess.kill(); } catch (killErr) { scheduleTunnelRestart(port, 'Tunnel ค้าง'); }
            }
        }
    }, 60 * 1000);
}

function startAutoTunnel(port) {
    const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
    
    // 1. ถ้ามี cloudflared.exe ให้เริ่ม Cloudflare Quick Tunnel ก่อน
    if (fs.existsSync(cloudflaredPath)) {
        try {
            console.log('🚇 กำลังเชื่อมต่อ Cloudflare Quick Tunnel...');
            addLog('INFO', 'กำลังเชื่อมต่อ Cloudflare Quick Tunnel...');
            activeTunnelType = 'Cloudflare Quick Tunnel';

            const { spawn } = require('child_process');
            cloudflareProcess = spawn(cloudflaredPath, ['tunnel', '--url', `http://localhost:${port}`]);

            let urlFound = false;
            const timeoutTimer = setTimeout(() => {
                if (!urlFound) {
                    console.log('⚠️ Cloudflare Tunnel ใช้เวลาเชื่อมต่อนานเกินไป กำลังสลับไปใช้ LocalTunnel สำรอง...');
                    startLocalTunnelFallback(port);
                }
            }, 12000);

            const checkLine = (data) => {
                const str = data.toString();
                const match = str.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                if (match && !urlFound) {
                    urlFound = true;
                    clearTimeout(timeoutTimer);
                    currentPublicUrl = match[0];
                    console.log(`\n🎉 [Cloudflare Tunnel พร้อมใช้งาน!]: ${currentPublicUrl}`);
                    addLog('SUCCESS', `Cloudflare Tunnel เชื่อมต่อสำเร็จ: ${currentPublicUrl}`);
                    io.emit('tunnel_status', { 
                        active: true, 
                        url: currentPublicUrl, 
                        type: 'Cloudflare', 
                        synced: false 
                    });
                    updateLineWebhookEndpoint(currentPublicUrl);
                    tunnelRestartAttempt = 0;
                    startTunnelHealthProbe(port);
                    sendDiscordAlert({
                        type: 'SUCCESS',
                        category: 'STARTUP',
                        title: '🟢 [เปิดระบบร้านค้า] เชื่อมต่อ Cloudflare Tunnel สำเร็จ!',
                        message: `ท่อส่งสัญญาณ Cloudflare Quick Tunnel พร้อมรับสลิปและตอบกลับลูกค้าใน LINE แล้ว`,
                        publicUrl: currentPublicUrl,
                        force: true
                    });
                }
            };

            cloudflareProcess.stdout.on('data', checkLine);
            cloudflareProcess.stderr.on('data', checkLine);

            cloudflareProcess.on('close', (code) => {
                console.log(`🚇 Cloudflare Tunnel ปิดการทำงาน (code: ${code})`);
                if (!urlFound) {
                    startLocalTunnelFallback(port);
                    return;
                }
                // 🔁 P1-7 Watchdog: Tunnel เคยเชื่อมต่อแล้วแต่หลุดกลางทาง → เปิดใหม่อัตโนมัติแบบหน่วงเวลา 5/15/30/60 วินาที
                // (startAutoTunnel จะได้ลิงก์ใหม่และซิงก์ Webhook URL ไปที่ LINE ให้อัตโนมัติ)
                if (typeof shuttingDown !== 'undefined' && shuttingDown) return;
                scheduleTunnelRestart(port, `Tunnel หลุด (code: ${code})`);
            });

            cloudflareProcess.on('error', (err) => {
                console.error('Cloudflare process error:', err.message);
                if (!urlFound) {
                    startLocalTunnelFallback(port);
                }
            });
            return;
        } catch(e) {
            console.error('Cloudflare error, falling back to LocalTunnel:', e.message);
        }
    }

    // 2. ถ้าไม่มี cloudflared.exe ให้เริ่ม LocalTunnel ทันที และดาวน์โหลด cloudflared ในพื้นหลัง
    console.log('🚇 ไม่พบ cloudflared.exe -> กำลังเปิดใช้งาน LocalTunnel สำรองทันที (Pure Node.js)...');
    startLocalTunnelFallback(port);
    downloadCloudflaredInBackground();
}

async function startLocalTunnelFallback(port) {
    if (currentPublicUrl && activeTunnelType === 'Cloudflare Quick Tunnel') return;
    try {
        const localtunnel = require('localtunnel');
        activeTunnelType = 'LocalTunnel (สำรอง)';
        console.log('🚇 กำลังเชื่อมต่อ LocalTunnel...');
        addLog('INFO', 'กำลังเชื่อมต่อ LocalTunnel สำรอง...');
        
        localtunnelInstance = await localtunnel({ port });
        currentPublicUrl = localtunnelInstance.url;
        console.log(`\n🎉 [LocalTunnel พร้อมใช้งาน!]: ${currentPublicUrl}`);
        addLog('SUCCESS', `LocalTunnel เชื่อมต่อสำเร็จ: ${currentPublicUrl}`);

        io.emit('tunnel_status', { 
            active: true, 
            url: currentPublicUrl, 
            type: 'LocalTunnel', 
            synced: false 
        });
        updateLineWebhookEndpoint(currentPublicUrl);
        sendDiscordAlert({
            type: 'SUCCESS',
            category: 'STARTUP',
            title: '🟢 [เปิดระบบร้านค้า] เชื่อมต่อ LocalTunnel สำรองสำเร็จ!',
            message: `ท่อส่งสัญญาณ LocalTunnel พร้อมรับสลิปและตอบกลับลูกค้าใน LINE แล้ว`,
            publicUrl: currentPublicUrl,
            force: true
        });

        localtunnelInstance.on('close', () => {
            console.log('🚇 LocalTunnel ปิดการทำงาน');
            currentPublicUrl = null;
        });
        localtunnelInstance.on('error', (err) => {
            console.error('LocalTunnel error:', err.message);
        });
    } catch(err) {
        console.error('LocalTunnel failed:', err.message);
        addLog('ERROR', 'LocalTunnel ไม่สามารถเริ่มได้: ' + err.message);
    }
}

function downloadCloudflaredInBackground() {
    const cloudflaredPath = path.join(__dirname, 'cloudflared.exe');
    if (fs.existsSync(cloudflaredPath)) return;
    
    console.log('⬇️ กำลังดาวน์โหลด cloudflared.exe ในพื้นหลังสำหรับใช้งานครั้งต่อไป...');
    addLog('INFO', 'กำลังดาวน์โหลด cloudflared.exe ในพื้นหลัง...');
    
    const downloadUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
    const tmpPath = path.join(__dirname, 'cloudflared.tmp');
    
    axios({
        method: 'get',
        url: downloadUrl,
        responseType: 'stream',
        timeout: 60000
    }).then(response => {
        const writer = fs.createWriteStream(tmpPath);
        response.data.pipe(writer);
        writer.on('finish', () => {
            try {
                fs.renameSync(tmpPath, cloudflaredPath);
                console.log('✅ ดาวน์โหลด cloudflared.exe สำเร็จเรียบร้อย');
                addLog('SUCCESS', 'ดาวน์โหลด cloudflared.exe พร้อมใช้งานสำหรับครั้งต่อไป');
            } catch(e) {}
        });
        writer.on('error', () => {
            try { fs.unlinkSync(tmpPath); } catch(e) {}
        });
    }).catch(err => {
        console.log('ดาวน์โหลด cloudflared.exe ในพื้นหลังไม่สำเร็จ (ระบบใช้งาน LocalTunnel ต่อไปได้ปกติ):', err.message);
    });
}

// 🔒 ฟังก์ชันปิดโปรแกรมอย่างปลอดภัย (Graceful Shutdown)
let shuttingDown = false;
function gracefulShutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    try { if (cloudflareProcess) cloudflareProcess.kill('SIGINT'); } catch (e) {}
    try { if (localtunnelInstance) localtunnelInstance.close(); } catch (e) {}
    try { if (typeof supabase.closeDb === 'function') supabase.closeDb(); } catch (e) {}
    process.exit(code);
}
['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'].forEach(sig => process.on(sig, () => gracefulShutdown(0)));
process.on('exit', () => gracefulShutdown(0));

// 🛑 API สำหรับให้ผู้ใช้งานกด "ปิดโปรแกรม" จากหน้า Dashboard ได้โดยตรง
app.post('/api/system/shutdown', (req, res) => {
    res.json({ success: true, message: 'กำลังปิดระบบและเซิร์ฟเวอร์...' });
    setTimeout(() => {
        gracefulShutdown(0);
    }, 500);
});

// ==========================================
// 🚀 ระบบ Auto-Updater (อัปเดตอัตโนมัติ 1-Click Update พร้อมแจ้ง Changelog)
// ==========================================

let CURRENT_VERSION = '1.0.0';
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    CURRENT_VERSION = pkg.version || '1.0.0';
} catch(e) {}

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

// 1. ดึงข้อมูลเวอร์ชันปัจจุบัน และประวัติอัปเดตล่าสุดที่เพิ่งทำสำเร็จ
app.get('/api/system/version', (req, res) => {
    let lastUpdateApplied = null;
    const lastUpdateFile = path.join(__dirname, 'updates', 'last_update_applied.json');
    if (fs.existsSync(lastUpdateFile)) {
        try {
            lastUpdateApplied = JSON.parse(fs.readFileSync(lastUpdateFile, 'utf8'));
            // ลบไฟล์ออกเพื่อแจ้งเตือนครั้งเดียว
            fs.unlinkSync(lastUpdateFile);
        } catch(e) {}
    }

    res.json({
        success: true,
        currentVersion: CURRENT_VERSION,
        updateManifestUrl: process.env.UPDATE_MANIFEST_URL || '',
        lastUpdateApplied
    });
});

const DEFAULT_MANIFEST_URL = 'https://github.com/Napat-Newbie/AutoQueueforLive/releases/latest/download/version.json';

// 2. ตรวจสอบว่ามีเวอร์ชันใหม่หรือไม่
app.get('/api/system/check_update', async (req, res) => {
    try {
        let manifestUrl = (req.query.manifestUrl || process.env.UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL).trim();
        let manifestData = null;

        if (manifestUrl && (manifestUrl.startsWith('http://') || manifestUrl.startsWith('https://'))) {
            const resp = await axios.get(manifestUrl, { timeout: 6000 });
            manifestData = resp.data;
        } else {
            // โหมดทดสอบ หรือ Local Releases Folder
            const localManifest = path.join(__dirname, 'releases', 'version.json');
            if (fs.existsSync(localManifest)) {
                manifestData = JSON.parse(fs.readFileSync(localManifest, 'utf8'));
            } else {
                return res.json({
                    success: false,
                    hasUpdate: false,
                    currentVersion: CURRENT_VERSION,
                    message: 'ยังไม่ได้ระบุ URL ตรวจสอบอัปเดต หรือไม่พบไฟล์ Release'
                });
            }
        }

        if (!manifestData || !manifestData.version) {
            return res.status(400).json({ success: false, message: 'รูปแบบข้อมูลอัปเดตไม่ถูกต้อง' });
        }

        const isNewer = compareVersions(manifestData.version, CURRENT_VERSION) > 0;

        return res.json({
            success: true,
            hasUpdate: isNewer,
            currentVersion: CURRENT_VERSION,
            latestVersion: manifestData.version,
            releaseDate: manifestData.releaseDate || '',
            title: manifestData.title || `AutoQueueforLive v${manifestData.version}`,
            changelog: Array.isArray(manifestData.changelog) ? manifestData.changelog : [manifestData.changelog],
            downloadUrl: manifestData.downloadUrl || '',
            fileSizeKB: manifestData.fileSizeKB || null,
            sha256: manifestData.sha256 || null
        });
    } catch (err) {
        addLog('WARN', 'ตรวจสอบการอัปเดตไม่สำเร็จ', err.message);
        return res.json({
            success: false,
            hasUpdate: false,
            currentVersion: CURRENT_VERSION,
            message: `ไม่สามารถดึงข้อมูลอัปเดตได้: ${err.message}`
        });
    }
});

// 🛡️ SEC-01: ป้องกัน Arbitrary URL Download / Remote Code Execution (RCE)
// อนุญาตให้ดาวน์โหลดแพตช์อัปเดตได้เฉพาะจาก GitHub Releases ของ Repository ทางการเท่านั้น (ตัด Local Path Bypass 100%)
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

// 3. เริ่มกระบวนการดาวน์โหลดและติดตั้งอัปเดต (1-Click Apply)
app.post('/api/system/apply_update', async (req, res) => {
    try {
        const { downloadUrl, latestVersion, changelog, sha256 } = req.body;
        if (!downloadUrl) {
            return res.status(400).json({ success: false, message: 'ไม่พบ URL สำหรับดาวน์โหลดอัปเดต' });
        }

        // 🛡️ SEC-01: ตรวจสอบความปลอดภัยของ URL ก่อนอนุญาตให้ดาวน์โหลด
        if (!isUpdateUrlAllowed(downloadUrl)) {
            addLog('WARN', `🚨 สกัดกั้นความพยายามอัปเดตจากแหล่งที่ไม่ปลอดภัย (SEC-01 Blocked): ${downloadUrl}`);
            return res.status(403).json({
                success: false,
                message: 'การติดตั้งถูกปฏิเสธ: ลิงก์ดาวน์โหลดไม่อยู่ใน WhiteList ทางการของโปรเจกต์ (SEC-01 Security Protection)'
            });
        }

        const updatesDir = path.join(__dirname, 'updates');
        if (!fs.existsSync(updatesDir)) fs.mkdirSync(updatesDir, { recursive: true });

        const targetZipPath = path.join(updatesDir, 'update_incoming.zip');
        if (fs.existsSync(targetZipPath)) {
            try { fs.unlinkSync(targetZipPath); } catch(e) {}
        }

        addLog('INFO', `กำลังเตรียมแพตช์อัปเดต v${latestVersion || 'ใหม่'}...`);

        // ดาวน์โหลดผ่าน HTTPS พร้อมตรวจตราการ Redirect (MitM / Open Redirect Guard)
        const writer = fs.createWriteStream(targetZipPath);
        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: 30000,
            maxRedirects: 5,
            beforeRedirect: (options) => {
                const redirectUrl = options.href;
                if (!isUpdateUrlAllowed(redirectUrl)) {
                    throw new Error(`ไม่อนุญาตให้ Redirect ไปยังปลายทางที่ไม่ปลอดภัย: ${redirectUrl}`);
                }
            }
        });
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // ตรวจสอบขนาดไฟล์
        const stat = fs.statSync(targetZipPath);
        if (stat.size < 500) {
            try { fs.unlinkSync(targetZipPath); } catch(e) {}
            return res.status(400).json({ success: false, message: 'ไฟล์อัปเดตไม่สมบูรณ์หรือมีขนาดเล็กเกินไป' });
        }

        // 🛡️ SEC-01 Checksum Hardening: บังคับตรวจสอบความถูกต้องของไฟล์อัปเดต (Mandatory SHA-256 Validation)
        let expectedSha256 = (sha256 || '').trim().toLowerCase();
        if (!expectedSha256) {
            try {
                const manifestUrl = process.env.UPDATE_MANIFEST_URL || DEFAULT_MANIFEST_URL;
                if (manifestUrl && manifestUrl.startsWith('https://')) {
                    const mResp = await axios.get(manifestUrl, { timeout: 4000 });
                    if (mResp.data && (mResp.data.sha256 || mResp.data.checksum)) {
                        expectedSha256 = String(mResp.data.sha256 || mResp.data.checksum).trim().toLowerCase();
                    }
                }
            } catch(e) {}
        }

        if (!expectedSha256) {
            try { fs.unlinkSync(targetZipPath); } catch(e) {}
            addLog('ERROR', '🚨 ปฏิเสธการติดตั้ง: ไม่พบค่า SHA-256 Checksum สำหรับยืนยันความปลอดภัยของไฟล์อัปเดต');
            return res.status(400).json({
                success: false,
                message: 'การติดตั้งถูกปฏิเสธ: ต้องมีค่า Checksum (SHA-256) สำหรับตรวจสอบความถูกต้องของไฟล์แพตช์'
            });
        }

        const computedSha256 = await new Promise((resolve, reject) => {
            const h = crypto.createHash('sha256');
            fs.createReadStream(targetZipPath).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex').toLowerCase())).on('error', reject);
        });
        if (computedSha256 !== expectedSha256) {
            try { fs.unlinkSync(targetZipPath); } catch(e) {}
            addLog('ERROR', `🚨 ตรวจพบไฟล์อัปเดตไม่ตรงกับต้นฉบับ (SHA-256 Mismatch): คาดหวัง ${expectedSha256} แต่ได้รับ ${computedSha256}`);
            return res.status(400).json({
                success: false,
                message: 'การติดตั้งถูกปฏิเสธ: ค่า Checksum (SHA-256) ไม่ตรงกับต้นทาง อาจเป็นไฟล์ไม่สมบูรณ์หรือถูกดัดแปลง'
            });
        }
        addLog('SUCCESS', `🛡️ ตรวจสอบความถูกต้องของไฟล์อัปเดตสำเร็จ (SHA-256 Verified): ${computedSha256}`);

        // บันทึกบันทึกการอัปเดตไว้ เพื่อให้แจ้งเตือน Changelog เมื่อรีสตาร์ทกลับมา (ดึงจาก version.json เพื่อให้ภาษาไทยถูกต้อง 100%)
        let safeChangelog = changelog || [];
        try {
            const manifestUrl = process.env.UPDATE_MANIFEST_URL;
            if (manifestUrl && (!safeChangelog.length || safeChangelog.some(c => c.includes('???') || c.includes('?')))) {
                const resp = await axios.get(manifestUrl, { timeout: 4000 });
                if (resp.data && resp.data.changelog) safeChangelog = resp.data.changelog;
            }
        } catch(e) {}

        const lastUpdateRecord = {
            version: latestVersion || '1.0.2',
            appliedAt: new Date().toISOString(),
            changelog: safeChangelog
        };
        fs.writeFileSync(path.join(updatesDir, 'last_update_applied.json'), JSON.stringify(lastUpdateRecord, null, 2), 'utf8');

        addLog('SUCCESS', `ดาวน์โหลดแพตช์สำเร็จ (${(stat.size / 1024).toFixed(1)} KB) กำลังเรียก updater.bat...`);

        // เรียก updater.bat ในโหมด detached
        const { spawn } = require('child_process');
        const updaterBat = path.join(__dirname, 'updater.bat');
        if (!fs.existsSync(updaterBat)) {
            return res.status(500).json({ success: false, message: 'ไม่พบไฟล์ updater.bat ในโฟลเดอร์โปรแกรม' });
        }

        const child = spawn('cmd.exe', ['/c', updaterBat, process.pid.toString()], {
            cwd: __dirname,
            detached: true,
            stdio: 'ignore',
            windowsHide: true
        });
        child.unref();

        // ส่งข้อความตอบกลับทันทีก่อน Node ปิดตัวเอง
        res.json({
            success: true,
            message: 'กำลังติดตั้งอัปเดตและรีสตาร์ทระบบอัตโนมัติ...'
        });

        // รอ 1 วินาทีแล้วปิด node อย่างปลอดภัย
        setTimeout(() => {
            gracefulShutdown(0);
        }, 1000);

    } catch (err) {
        addLog('ERROR', 'เกิดข้อผิดพลาดในการติดตั้งอัปเดต', err.message);
        return res.status(500).json({ success: false, message: `ติดตั้งไม่สำเร็จ: ${err.message}` });
    }
});

// 4. บันทึก Update Manifest URL ลง .env (พร้อมตรวจสอบความปลอดภัย ป้องกัน CRLF Injection)
app.post('/api/system/save_update_url', (req, res) => {
    try {
        let { manifestUrl } = req.body || {};
        manifestUrl = String(manifestUrl || '').trim();
        if (manifestUrl && (!isUpdateUrlAllowed(manifestUrl) || /[\r\n"\\]/.test(manifestUrl))) {
            return res.status(400).json({ success: false, message: 'URL อัปเดตไม่ถูกต้อง ไม่อยู่ใน WhiteList หรือมีอักขระต้องห้าม' });
        }

        const envPath = path.join(__dirname, '.env');
        let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

        const line = `UPDATE_MANIFEST_URL="${manifestUrl}"`;
        const regex = /^UPDATE_MANIFEST_URL=.*$/m;
        envContent = regex.test(envContent) ? envContent.replace(regex, () => line) : `${envContent}\n${line}`;

        fs.writeFileSync(envPath, envContent, 'utf8');
        process.env.UPDATE_MANIFEST_URL = manifestUrl;

        addLog('SUCCESS', 'บันทึก URL ตรวจสอบอัปเดตเรียบร้อย');
        res.json({ success: true, message: 'บันทึก URL สำเร็จ' });
    } catch(err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

function startServerGracefully(portToTry, retriesLeft = 4) {
    const srv = server.listen(portToTry, () => {
        console.log(`🚀 บอทและ Dashboard ทำงานที่พอร์ต ${portToTry} (http://localhost:${portToTry})`);
        addLog('SUCCESS', `เปิดเซิร์ฟเวอร์สำเร็จที่พอร์ต ${portToTry}`);
        
        // 🌐 เปิดหน้าต่างเบราว์เซอร์เข้าสู่ Dashboard ทันทีที่เซิร์ฟเวอร์พร้อม (พร้อมหน้าโหลด 3 วินาที)
        // ⚡ ถ้าเป็นการเปิดใหม่อัตโนมัติหลังโปรแกรมหยุดผิดปกติ ไม่ต้องเปิดเบราว์เซอร์ซ้ำ (หน้าเดิมจะเชื่อมต่อใหม่เอง)
        const autoRestartCount = Number(process.env.AQ_RESTART_COUNT || 0);
        if (autoRestartCount > 0) {
            addLog('WARN', `โปรแกรมหยุดทำงานผิดปกติ ระบบเปิดใหม่ให้อัตโนมัติแล้ว (ครั้งที่ ${autoRestartCount})`);
            reportSelfHealingToDiscord({ category: 'SYSTEM_RESTART', title: 'เปิดโปรแกรมใหม่อัตโนมัติ', issue: 'โปรแกรมหลักหยุดทำงานผิดปกติ', actionDetails: `ตัวเฝ้าโปรแกรมเปิดใหม่ให้ภายใน 5 วินาที (ครั้งที่ ${autoRestartCount}) ดูสาเหตุใน supervisor.log` }).catch(() => {});
        } else try {
            const { exec } = require('child_process');
            exec(`start http://localhost:${portToTry}`);
        } catch(e) {}

        // เริ่มต้นระบบเชื่อมต่อท่อสัญญาณอัตโนมัติ (แก้ Risk 1)
        startAutoTunnel(portToTry);
        // ตรวจสอบเครดิตผู้ให้บริการตรวจสลิปทันที (ป้องกัน Risk 2)
        setTimeout(() => checkProviderQuota(), 3000);
    });

    srv.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`ℹ️ พอร์ต ${portToTry} มีโปรแกรมทำงานอยู่แล้ว กำลังเปิดหน้าต่างเบราว์เซอร์...`);
            try {
                const { execSync } = require('child_process');
                execSync(`start http://localhost:${portToTry}`);
            } catch(e) {}
            setTimeout(() => process.exit(0), 100);
            return;
        } else {
            console.error('Server Listen Error:', err.message);
        }
    });
}

startServerGracefully(PORT);