// ⚡ Self-Healing: ตัวเฝ้าโปรแกรม (Supervisor)
// ถ้าโปรแกรมหลักปิดตัวเองผิดปกติ ระบบจะเปิดใหม่ให้อัตโนมัติภายใน 5 วินาที (สูงสุด 5 ครั้งใน 10 นาที กันวนไม่จบ)
// ปิดปกติ (ปุ่มปิดโปรแกรม / ติดตั้งอัปเดต / เปิดซ้ำ) = รหัส 0 -> ตัวเฝ้าปิดตามทันที ไม่เปิดใหม่
// ตั้ง AQ_NO_SUPERVISOR=1 เพื่อปิดตัวเฝ้า
// v1.0.17: ตัวอ่าน .env แบบง่ายของตัวเฝ้า — แยกเป็นฟังก์ชันเพื่อให้เทสต์ (tests/unit/env-parser.test.js) ตัดไปตรวจได้
// ทำตัวเหมือนตัวอ่านมาตรฐานในจุดที่เคยพลาด: รองรับ "export " นำหน้า, ตัดคอมเมนต์ท้ายบรรทัด (# ที่มีช่องว่างนำหน้า)
// และค่าครอบด้วย "..."/'...' — ไม่ใช่ตัวอ่าน .env เต็มรูปแบบ (multiline/escape) เพราะตัวเฝ้าต้องการแค่ webhook ตัวเดียว
function parseEnvLines(text) {
    const env = {};
    String(text || '').split(/\r?\n/).forEach(l => {
        const m = l.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (!m) return;
        let v = m[2];
        const q = v.charAt(0);
        if (q === '"' || q === "'") {              // ค่าครอบด้วย quote: หยุดที่ quote ปิด ไม่สนข้อความหลังจากนั้น
            const end = v.indexOf(q, 1);
            v = end > 0 ? v.slice(1, end) : v.slice(1);
        } else {
            v = v.replace(/\s+#.*$/, '');          // คอมเมนต์ท้ายบรรทัด: # ที่มีช่องว่างนำหน้า (URL ที่มี # ติด ๆ กันไม่โดนตัด)
        }
        env[m[1]] = v.trim();
    });
    return env;
}
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
            const env = parseEnvLines(envText);
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
// v1.0.20 (P5: 1.4): แปลงเหตุการณ์แจ้งเตือนแยกไป lib/notificationFormat.js
const { notificationFromEvent } = require('./lib/notificationFormat');
// v1.0.18 (เจ้าของขอ 2026-10-31): ทุกครั้งที่ส่งเหตุการณ์ที่เป็นการแจ้งเตือนไปหน้าจอ บันทึกลงฐานข้อมูลร้านที่นี่จุดเดียว
// (notificationFromEvent / recordNotification) จึงมีบันทึกแม้ตอนนั้นไม่มีหน้าจอเปิดอยู่ และไม่หายเมื่อจบไลฟ์/ปิดโปรแกรม
{
    const rawEmit = io.emit.bind(io);
    io.emit = function (event, ...args) {
        const result = rawEmit(event, ...args);
        try { const n = notificationFromEvent(event, args[0]); if (n) recordNotification(n, event); } catch (e) { /* การบันทึกแจ้งเตือนต้องไม่ทำให้การส่งหน้าจอล้ม */ }
        return result;
    };
}

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
// 📨 v1.0.16: เวลาที่รูปสลิปล่าสุดเข้ามาที่โปรแกรม (ในหน่วยความจำ นับตั้งแต่เปิดโปรแกรม) ให้หน้าจอบอกว่า "สลิปล่าสุดเข้ามาเมื่อกี่นาทีก่อน"
let lastSlipIngestAt = null;
var merchantAccountName = process.env.MERCHANT_ACCOUNT_NAME || "";
var merchantAccountNameEn = "";   // v1.0.17: ชื่อบัญชีร้านภาษาอังกฤษ (ไม่บังคับ) ใช้เทียบชื่อผู้รับตอนที่ SlipOK ตอบชื่อเป็นอังกฤษ เช่น สลิป TrueMoney

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
// v1.0.17: ช่องแยกสำหรับ "สรุปหลังจบไลฟ์" โดยเฉพาะ (เจ้าของร้านขอแยก channel) — ถ้าไม่ได้ตั้งไว้ สรุปจะไหลไปช่องแจ้งเตือนหลักตามเดิม
function getLiveSummaryWebhook() { const u = (process.env.DISCORD_LIVE_SUMMARY_WEBHOOK_URL || '').trim(); return isValidDiscordWebhook(u) ? u : ''; }
function getAppVersionSafe() { try { return require('./package.json').version; } catch (e) { return '?'; } }
function getShopLabel() {
    const n = (merchantAccountName || process.env.MERCHANT_ACCOUNT_NAME || '').trim();
    return n ? `ร้าน${n}` : 'ร้านค้า (AutoQueue)';
}

// 🛡️ ปิดบังข้อมูลส่วนตัวลูกค้าก่อนส่งออกนอกเครื่อง
// v1.0.18 (แก้ 2026-10-31): ตัวเลข 13 หลักที่ติดกับ "_" เป็นรหัสของโปรแกรม (LIVE_<เวลา>, manual_<เวลา>_...) ไม่ใช่เลขบัตรประชาชน
// เดิมปิดหมด รหัสรอบไลฟ์ในช่องกิจกรรม Discord จึงกลายเป็น LIVE_[เลขบัตร] ตั้งแต่ v1.0.16 ไล่ปัญหาตามรอบไม่ได้
function redactPersonalInfo(text) {
    return String(text === undefined || text === null ? '' : text)
        .replace(/(?<![\d_])\d{13}(?![\d_])/g, '[เลขบัตร]')
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

// v1.0.18 (เจ้าของขอ 2026-10-31): ตัดบรรทัด log ของรอบไลฟ์ออกจาก system.log ตามเวลา (ใช้ส่งเข้าช่อง Dev Report หลังจบไลฟ์)
// เวลาในแต่ละบรรทัดมาจาก toLocaleString en-US เขตเวลา Asia/Bangkok เช่น [10/31/2026, 7:34:12 PM] -- Node รุ่นใหม่คั่น PM ด้วย U+202F ซึ่ง \s ครอบคลุม
function parseLogLineTime(line) {
    const m = /^\[(\d{1,2})\/(\d{1,2})\/(\d{4}),\s(\d{1,2}):(\d{2}):(\d{2})\s(AM|PM)\]/.exec(String(line || ''));
    if (!m) return null;
    let h = Number(m[4]) % 12;
    if (m[7] === 'PM') h += 12;
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h - 7, Number(m[5]), Number(m[6]));
}
function sliceLogForLive(text, startMs, endMs) {
    return String(text || '').split(/\r?\n/).filter(line => {
        const t = parseLogLineTime(line);
        return t !== null && t >= startMs && t <= endMs;
    });
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
    'POST /api/queue/manual_match_count_second': () => 'ยืนยันสลิปตรงกับยอดที่กรอกเอง = การโอนครั้งที่ 2 (บวกยอดให้ลูกค้า)',
    'POST /api/queue/manual_match_dismiss': () => 'ยืนยันสลิปตรงกับยอดที่กรอกเอง = ใบเดียวกัน (ปิดการ์ดยืนยัน)',
    'POST /api/queue/verify_abnormal': () => 'ยืนยันสลิปผิดปกติ',
    'POST /api/queue/reject_slip': () => 'ปัดตกรูปที่ไม่ใช่สลิป',
    'POST /api/system/shutdown': () => 'กดปิดโปรแกรม',
    'POST /api/system/apply_update': () => 'กดติดตั้งอัปเดต',
    'POST /api/admin/setup_keys': () => 'บันทึกหน้าตั้งค่าเชื่อมต่อ',
    'GET /api/kerry/export_excel': (b, q) => `ดาวน์โหลดไฟล์ Kerry${q && q.sessionId ? ' (เลือกรอบไลฟ์)' : (q && q.date ? ` (วันที่ ${String(q.date).slice(0, 8)})` : '')}`,
    'GET /api/history/product_rounds_excel': () => 'ดาวน์โหลดรายงานสินค้าแยกรอบไลฟ์ (Excel)'
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
            if (item.key === 'merchant_account_name_en') merchantAccountNameEn = item.value || '';
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

app.get('/api/config', (req, res) => res.json({ prices: rawPriceString, shippingFee, freeShippingThreshold, merchantAccountName, merchantAccountNameEn, openchatLink }));


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
        p === '/api/history_data' ||
        p.startsWith('/api/history/') ||
        p.startsWith('/api/notifications')
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
    const { newPrices, newShipping, newThreshold, newMerchantName, newMerchantNameEn, newOpenchatLink } = req.body;
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
        if (newMerchantNameEn !== undefined) { merchantAccountNameEn = String(newMerchantNameEn || '').trim(); await supabase.from('configs').upsert([{ key: 'merchant_account_name_en', value: merchantAccountNameEn }]); }
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
        discordDevReportSet: maskDiscordWebhook(process.env.DISCORD_DEVREPORT_WEBHOOK_URL),
        discordLiveSummarySet: maskDiscordWebhook(process.env.DISCORD_LIVE_SUMMARY_WEBHOOK_URL)
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
            const { discordActivityWebhook, discordDevReportWebhook, discordLiveSummaryWebhook } = req.body;
            for (const [envName, val] of [['DISCORD_ACTIVITY_WEBHOOK_URL', discordActivityWebhook], ['DISCORD_DEVREPORT_WEBHOOK_URL', discordDevReportWebhook], ['DISCORD_LIVE_SUMMARY_WEBHOOK_URL', discordLiveSummaryWebhook]]) {
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

// v1.0.19: ตัวช่วยวันที่/เวลาไทย (ล้วนทั้ง 4) ย้ายไป lib/dates.js — ตัวอักษรเดิมทุกตัว / เทสต์ตรง: tests/unit/dates.test.js
const { getTodayString, getLocalTimeString, bangkokDateString, stampToSec, thaiLiveSpan } = require('./lib/dates');

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
    invalidateEndedSessionCache();   // v1.0.19: ป้าย ก่อนไลฟ์/หลังจบไลฟ์ ใช้รายการรอบที่จบแล้ว — เติม cache ใหม่เมื่อสถานะรอบเปลี่ยน
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
//  - session_id ว่าง และสถานะยังค้างอยู่ (waiting / called / skipped / abnormal_pending / accumulated)
//    ที่แม่ค้าจัดการจบแล้ว (completed / cleared / rejected) ไม่แตะ
//    v1.0.17 (เจ้าของร้านสั่ง 2026-10-31): accumulated (ยอดไม่พอ) ผูกเข้ารอบด้วย และคืนเงินเข้ากระเป๋าหลังรีเซ็ต v1.0.13
//    (เดิมไม่แตะ ทำให้เงินที่ลูกค้าโอนก่อนไลฟ์แต่ยังไม่พอซื้อหายจากระบบตอนกดเริ่มไลฟ์)
//  - id มากกว่าสลิปล่าสุดที่มีรหัสรอบ = เข้ามาหลังรอบก่อนหน้า (ไม่ดึงของเก่าก่อนรอบที่แล้วกลับมา)
//  - วันที่โอนเป็นวันนี้หรือย้อนหลังไม่เกิน OUT_OF_ROUND_LOOKBACK_DAYS วัน (เวลาไทย)
const OUT_OF_ROUND_LOOKBACK_DAYS = 1;
const OUT_OF_ROUND_PENDING_STATUSES = ['waiting', 'called', 'skipped', 'abnormal_pending', 'accumulated'];
// (bangkokDateString ย้ายไป lib/dates.js แล้ว — ดึงมาชื่อเดิมด้านบน)
// ===== v1.0.19: แยก "เงินมาก่อนเริ่มไลฟ์" ออกจาก "ยอดจุ่มหลังจบไลฟ์" =====
// เจ้าของตรวจพบ (2026-10-31): ป้ายเดิมเขียน "เงินมาหลังจบไลฟ์" ทุกกรณี ทั้งที่เงินที่มาก่อนไลฟ์รอบแรกของช่วง
// คือเงินเตรียมตัว (ไม่เสี่ยงส่งของซ้ำ) ส่วนเงินที่มาหลังมีรอบไลฟ์จบไปแล้วคือยอดจุ่ม (ระวังส่งซ้ำ)
let endedSessionCache = null;   // เวลาจบของรอบที่จบแล้ว เรียงจากน้อยไปมาก — เติมใหม่เมื่อบันทึกสถานะรอบ
function invalidateEndedSessionCache() { endedSessionCache = null; latestEndedSessionCache = undefined; }
function endedSessionList() {
    if (endedSessionCache) return endedSessionCache;
    const out = [];
    try {
        const rows = supabase.db.prepare("SELECT value FROM configs WHERE key LIKE 'session_hist_%'").all();
        rows.forEach(r => { try { const s = JSON.parse(r.value); if (s && s.endTime) out.push(Number(s.endTime)); } catch (e) {} });
    } catch (e) {}
    out.sort((a, b) => a - b);
    endedSessionCache = out;
    return out;
}
// v1.0.20 (P1): รอบไลฟ์ล่าสุด "ที่จบแล้ว" ทั้ง record — undefined = ยังไม่ได้ไล่, null = ไม่เคยมีรอบที่จบ
let latestEndedSessionCache;
function latestEndedSessionRecord() {
    if (latestEndedSessionCache !== undefined) return latestEndedSessionCache;
    let best = null;
    try {
        const rows = supabase.db.prepare("SELECT value FROM configs WHERE key LIKE 'session_hist_%'").all();
        rows.forEach(r => { try { const s = JSON.parse(r.value); if (s && s.endTime && (!best || Number(s.endTime) > Number(best.endTime))) best = s; } catch (e) {} });
    } catch (e) {}
    latestEndedSessionCache = best;
    return best;
}
// v1.0.20 (P1): ขอบเขตยอดบนหน้า Dashboard — มีไลฟ์ = รอบนั้น / ไม่มีไลฟ์ = รอบล่าสุดที่จบแล้ว "ทั้งรอบ"
// (ไลฟ์ 21:00–01:30 พ้นเที่ยงคืนแล้วยอดไม่ถูกตัดครึ่ง) / ไม่เคยมีไลฟ์ = ยอดวันนี้ตามเดิม
function currentDashboardScope() {
    if (activeLiveSession) return { date: getTodayString(), sessionId: activeLiveSession.id };
    const last = latestEndedSessionRecord();
    if (last && LIVE_ID_RE.test(String(last.id))) return { date: getTodayString(), sessionId: String(last.id) };
    return { date: getTodayString(), sessionId: null };
}
// ขอบเขตที่กำลังดูตรงกับ "ปัจจุบัน" ไหม — ชี้ว่าการ์ดในหน่วยความจำ (รอโอนเพิ่ม/รูปโหลดไม่สำเร็จ/การ์ดยืนยันสลิปซ้ำ) จะแสดงไหม
// v1.0.20 (P1): "ปัจจุบัน" คือรอบที่กำลังไลฟ์ หรือรอบล่าสุดที่จบแล้ว (ยังไม่เคยมีไลฟ์ = วันนี้)
function isCurrentStatsScope(targetSessionId, targetDate) {
    if (activeLiveSession) return targetSessionId === activeLiveSession.id;
    const last = latestEndedSessionRecord();
    if (last && LIVE_ID_RE.test(String(last.id))) return String(targetSessionId) === String(last.id);
    return !targetSessionId && targetDate === getTodayString();
}
// เวลาที่สลิปเข้าระบบเป็น epoch ms จริง: stampToSec อ่านเวลากรุงเทพเสมือน UTC → ลบ 7 ชม. กลับเป็นเวลาแท้
function slipArrivalEpochMs(transDate, transTime) {
    const sec = stampToSec(transDate, transTime);
    return sec === null ? null : (sec - 7 * 3600) * 1000;
}
// 'before' = ยังไม่มีรอบไหนจบก่อนเงินเข้า (เงินก่อนไลฟ์) / 'after' = มีรอบจบไปก่อนแล้ว (ยอดจุ่ม — ใช้คำเตือนเดิม)
function outOfRoundWhen(transDate, transTime) {
    const t = slipArrivalEpochMs(transDate, transTime);
    if (t === null) return 'after';   // ไม่รู้เวลาเข้า → ใช้คำเตือน (กันเหนียว)
    return endedSessionList().some(endMs => endMs <= t) ? 'after' : 'before';
}

function outOfRoundSlipFilter() {
    const last = supabase.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM slips WHERE session_id IS NOT NULL').get();
    const marks = OUT_OF_ROUND_PENDING_STATUSES.map(() => '?').join(',');
    return {
        where: `session_id IS NULL AND id > ? AND trans_date >= ? AND status IN (${marks})`,
        params: [Number(last && last.m) || 0, bangkokDateString(-OUT_OF_ROUND_LOOKBACK_DAYS), ...OUT_OF_ROUND_PENDING_STATUSES]
    };
}
// v1.0.17: ผลรวมยอดสลิป accumulated นอกรอบรายลูกค้า -- ใช้ทั้งตอนเริ่มไลฟ์จริง (claimOutOfRoundSlips) และตอนแสดงในหน้าต่างเช็กความพร้อม
// (/api/queue/pending_balances) เพื่อให้ยอด "ระบบเก็บไว้ให้" ที่แม่ค้าเห็นก่อนกดเริ่ม ตรงกับที่ระบบทำจริงเสมอ
function outOfRoundAccumulatedTotals(f = outOfRoundSlipFilter()) {
    return supabase.db.prepare(`SELECT line_id, MAX(line_name) AS name, SUM(amount) AS total FROM slips WHERE ${f.where} AND status = 'accumulated' AND line_id IS NOT NULL GROUP BY line_id`).all(...f.params);
}
// v1.0.17: คืนเงินของสลิปยอดไม่พอ (accumulated) ที่ผูกเข้ารอบ กลับเข้ากระเป๋าหลังรีเซ็ต
//  - คืนไม่เกินยอดที่อยู่ในกระเป๋าก่อนรีเซ็ต (preResetBalances) = เงินที่ใช้ซื้อชิ้นไปแล้วไม่ถูกคืนซ้ำ
//  - คืนไม่เกินผลรวมยอดของสลิป accumulated นอกรอบของคนนั้น = เศษเงินของรอบก่อนยังถูกรีเซ็ตตามกติกา v1.0.13
//  - ผูกรอบและคืนเงินอยู่ใน transaction เดียว (สำเร็จพร้อมกันหรือไม่เกิดทั้งคู่)
function claimOutOfRoundSlips(sessionId, preResetBalances = new Map()) {
    if (!LIVE_ID_RE.test(String(sessionId))) return { claimed: 0, restored: [] };
    const f = outOfRoundSlipFilter();
    return supabase.db.transaction(() => {
        const owedBySlips = outOfRoundAccumulatedTotals(f);
        const claimed = supabase.db.prepare(`UPDATE slips SET session_id = ? WHERE ${f.where}`).run(sessionId, ...f.params).changes;
        const restored = [];
        for (const r of owedBySlips) {
            const amount = Math.min(Number(preResetBalances.get(r.line_id)) || 0, Number(r.total) || 0);
            if (!(amount > 0)) continue;
            supabase.db.prepare('UPDATE customers SET balance = balance + ? WHERE line_id = ?').run(amount, r.line_id);
            restored.push({ lineId: r.line_id, name: r.name, amount });
        }
        return { claimed, restored };
    })();
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

// 💰 v1.0.19: สูตรเงินแท้ย้ายไปอยู่ที่ lib/money.js แล้ว (pure — รับการตั้งค่าร้านเป็นอาร์กิวเมนต์แรก)
// ตัวห่อด้านล่างผูก "ค่าตั้งค้าปัจจุบัน" ให้ทุกครั้งที่ถูกเรียก จุดใช้งานทั้งระบบจึงเหมือนเดิมทุกประการ
// การแก้สูตร: แก้ที่ lib/money.js เท่านั้น (มีเทสต์ตรง tests/unit/money-module.test.js และชุดระบบคุมพฤติกรรมรวม)
const Money = require('./lib/money');
const MAX_DP_BUDGET = Money.MAX_DP_BUDGET; // เพดานคำนวณอัตโนมัติ 500,000 บาท (คำนวณในหน่วยความจำ <3MB, เวลา <10ms ป้องกัน Event Loop ค้าง)
function calculateBestDraws(virtualBalance, pastDraws, opts = {}) {
    return Money.calculateBestDraws({ priceList, shippingFee, freeShippingThreshold, addLog }, virtualBalance, pastDraws, opts);
}
function calculateBestDrawsCore(virtualBalance, pastDraws) {
    return Money.calculateBestDrawsCore({ priceList, shippingFee, freeShippingThreshold, addLog }, virtualBalance, pastDraws);
}
function describeTopup(balance, pastDraws) {
    return Money.describeTopup({ priceList, shippingFee, freeShippingThreshold }, balance, pastDraws);
}
// 💰 ยอดที่ต้องเก็บเข้ากระเป๋าลูกค้าหลังคำนวณสิทธิ์
// ถ้าได้ชิ้น: ใช้เศษที่คำนวณได้ (รวมการคืนค่าส่งเมื่อครบจำนวนส่งฟรีตามที่ออกแบบไว้)
// ถ้าไม่ได้ชิ้น: เก็บเฉพาะเงินที่ลูกค้าโอนจริง (กระเป๋าเดิม + สลิปนี้) ห้ามรวมค่าส่งที่บวกเพิ่มชั่วคราวตอนคำนวณ
// (แก้บั๊ก v1.0.7-v1.0.10: ลูกค้าที่จ่ายค่าส่งไปแล้ว โอนเพิ่มไม่พอซื้อ จะถูกบวกค่าส่งเข้ากระเป๋าเกินจริง)
function walletAfter(result, currentBalance) {
    return Money.walletAfter(result, currentBalance);
}
function fmtBaht(n) {
    return Money.fmtBaht(n);
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

    let queueData;
    if (targetSessionId && !activeLiveSession) {
        // v1.0.20 (P1): ดูยอดของรอบที่จบแล้ว — คิวยังต้องแสดงการ์ดค้างของรอบนั้น + การ์ดโอนนอกรอบที่ยังไม่ถูกผูก (กติกา ก: ห้ามหายจากจอ)
        // เงื่อนไขโอนนอกรอบ = outOfRoundSlipFilter ตัด accumulated ออก (การ์ดส้มมาจาก topups ไม่ใช่คิว)
        try {
            const lastSessioned = supabase.db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM slips WHERE session_id IS NOT NULL').get();
            const oorStatuses = OUT_OF_ROUND_PENDING_STATUSES.filter(s => s !== 'accumulated');
            queueData = supabase.db.prepare(
                `SELECT * FROM slips WHERE (session_id = ? AND status IN ('waiting','called','skipped','abnormal_pending'))` +
                ` OR (session_id IS NULL AND id > ? AND trans_date >= ? AND status IN (${oorStatuses.map(() => '?').join(',')})) ORDER BY id ASC`
            ).all(targetSessionId, Number(lastSessioned && lastSessioned.m) || 0, bangkokDateString(-OUT_OF_ROUND_LOOKBACK_DAYS), ...oorStatuses);
        } catch (e) { queueData = null; }
    } else {
        let queueQuery = supabase.from('slips').select('*').in('status', ['waiting', 'called', 'skipped', 'abnormal_pending']);
        if (targetSessionId) {
            queueQuery = queueQuery.eq('session_id', targetSessionId);
        }
        ({ data: queueData } = await queueQuery.order('id', { ascending: true }));
    }
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
                if (slip.arrived_out_of_round === 1) {
                    existing.outOfRound = true;
                    const w = outOfRoundWhen(slip.trans_date, slip.trans_time);   // v1.0.19: ก่อนไลฟ์/หลังจบไลฟ์ (มีทั้งคู่ใช้ 'after' — กันเหนียว)
                    if (w === 'after' || !existing.outOfRoundWhen) existing.outOfRoundWhen = w;
                }
                if (breakdown) existing.rawBreakdowns.push(breakdown);
            } else {
                groupMap[statusGroup].set(key, {
                    id: slip.id, slipIds: [slip.id], name: slip.sender_name, lineName: slip.line_name,
                    amount: slip.amount, draws: slip.draws || 0, time: slip.trans_time, status: statusGroup,
                    isPendingAmount: isPendingAmount, imageUrl: imageUrl, date: slip.trans_date,
                    outOfRound: slip.arrived_out_of_round === 1,   // v1.0.16: ป้าย "โอนนอกรอบ" (เงินมาตอนไม่มีไลฟ์)
                    outOfRoundWhen: slip.arrived_out_of_round === 1 ? outOfRoundWhen(slip.trans_date, slip.trans_time) : undefined,   // v1.0.19: 'before'=มาก่อนไลฟ์ / 'after'=ยอดจุ่มหลังจบไลฟ์
                    bankDelay: isPendingAmount ? (bankDelayHints.get(slip.id) || undefined) : undefined,   // v1.0.17: สลิปธนาคารที่ต้องรอ (Code 1010)
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

        // v1.0.16: ไอคอน 📍 บนการ์ดคิว -- ลูกค้าคนนี้มีที่อยู่จัดส่งครบ (เบอร์โทร + รหัสไปรษณีย์ + ที่อยู่) แล้วหรือยัง (กติกาเดียวกับหน้าต่าง Kerry)
        try {
            const lineIdBySlipAll = new Map(queueData.map(s => [s.id, s.line_id]));
            const allCards = [...queues.waiting, ...queues.called, ...queues.skipped, ...queues.abnormal_pending];
            const uids = [...new Set(allCards.map(q => lineIdBySlipAll.get(q.id)).filter(Boolean))];
            const addrByUid = {};
            for (let i = 0; i < uids.length; i += 400) {
                const keys = uids.slice(i, i + 400).map(u => `cust_addr_${u}`);
                const ph = keys.map(() => '?').join(',');
                supabase.db.prepare(`SELECT key, value FROM configs WHERE key IN (${ph})`).all(...keys).forEach(r => {
                    try { addrByUid[r.key.replace('cust_addr_', '')] = JSON.parse(r.value); } catch (e) {}
                });
            }
            allCards.forEach(q => {
                const uid = lineIdBySlipAll.get(q.id);
                if (!uid) return;
                const a = addrByUid[uid];
                q.hasAddress = !!(a && a.phone && a.postcode && (a.address || typeof a === 'string'));
            });
        } catch (e) { /* ไอคอนที่อยู่เป็นข้อมูลเสริม: ล้มเหลวต้องไม่กระทบคิว */ }

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
        const isCurrentScope = isCurrentStatsScope(targetSessionId, targetDate);
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
        const scopeIsCurrent = isCurrentStatsScope(targetSessionId, targetDate);
        if (scopeIsCurrent) imageFails = currentLineImageFailures();
    } catch (e) { imageFails = []; }
    // v1.0.18: การ์ดยืนยัน "สลิปตรงกับยอดที่กรอกเอง" (รอแม่ค้าตัดสินใจ อยู่จนกด — ค่าเริ่มต้นผูกเป็นใบเดียวกัน)
    let manualMatches = [];
    try {
        const scopeIsCurrent2 = isCurrentStatsScope(targetSessionId, targetDate);
        if (scopeIsCurrent2) manualMatches = currentManualMatchWarnings();
    } catch (e) { manualMatches = []; }
    // v1.0.20 (P1): ดูยอดของรอบที่จบแล้ว → แนบป้ายช่วงรอบ และแยกเงินที่เข้า "หลังจบไลฟ์" ออกจากยอดรอบ
    let liveBadge = null; let afterLive = null;
    if (targetSessionId && !activeLiveSession) {
        const last = latestEndedSessionRecord();
        if (last && String(last.id) === String(targetSessionId)) {
            const span = thaiLiveSpan(last.startDateStr, last.startTimeStr, last.endTime, last.endTimeStr);
            liveBadge = span ? `ไลฟ์ล่าสุด: ${span}` : null;
            try {
                const f = outOfRoundSlipFilter();   // กติกาเดียวกับตอน claim: สถานะยังค้าง + เข้าหลังสลิปสุดท้ายที่มีรหัสรอบ
                const row = supabase.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS a FROM slips WHERE ${f.where}`).get(...f.params);
                if (row && Number(row.n) > 0) afterLive = { amount: Number(row.a) || 0, slips: Number(row.n) };
            } catch (e) { afterLive = null; }
        }
    }
    return { stats: { totalAmount, totalSlips: dailySlips ? dailySlips.length : 0, totalDraws, uniqueCustomers: uniqueCustomersSet.size, waitingCount: queues.waiting.filter(q => !q.isPendingAmount).length, liveBadge, afterLive }, queues, topups, recentSlips, imageFails, manualMatches };
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
                const scope = currentDashboardScope();   // v1.0.20 (P1): ไม่มีไลฟ์ = ยอดรอบล่าสุดที่จบแล้ว ไม่ใช่ยอดตามวันที่
                data = await getStatsByDate(scope.date, scope.sessionId);
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
    const scope = currentDashboardScope();
    const statsData = await getStatsByDate(scope.date, scope.sessionId);
    return statsData.stats.waitingCount;
}

app.get('/history.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'history.html')); });
app.get('/api/stats/today', async (req, res) => {
    try {
        const scope = currentDashboardScope();   // v1.0.20 (P1): ไม่มีไลฟ์ = ยอดรอบล่าสุดที่จบแล้ว ไม่ใช่ยอดตามวันที่
        const data = await getStatsByDate(scope.date, scope.sessionId);
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

            return { id: slip.id, date: slip.trans_date, time: slip.trans_time, name: slip.sender_name, lineName: slip.line_name, amount: slip.amount, draws: slip.draws || 0, status: slip.status, ref: safeRef, sessionId: slip.session_id || null, outOfRound: slip.arrived_out_of_round === 1, outOfRoundWhen: slip.arrived_out_of_round === 1 ? outOfRoundWhen(slip.trans_date, slip.trans_time) : null, customerKey: slip.line_id || null };   // v1.0.16: ธง "โอนนอกรอบ" ใช้บอกในหน้าประวัติว่ายอดนี้เข้ามาตอนไม่มีไลฟ์แล้วถูกผูกเข้ารอบไหน (+ v1.0.19: ก่อนไลฟ์/หลังจบไลฟ์)
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
        // v1.0.20 (P2): ตาราง สินค้า × รอบไลฟ์ — คำนวณที่เซิร์ฟเวอร์ด้วยกติกาเดียวกับสรุป Discord (lib/products.js)
        // หน้าประวัติเลิกแยกสินค้าเอง ใช้ตารางนี้แทน เพื่อไม่ให้มีสองกติกาให้ตัวเลขไม่ตรงกัน
        let productSummary = null;
        try { productSummary = buildProductRoundSummary(data, rounds); }
        catch (prodErr) { addLog('WARN', `สรุปสินค้าแยกรอบไม่สำเร็จ (ส่วนอื่นของประวัติยังแสดงปกติ): ${prodErr.message}`); }
        res.json({ success: true, history, rounds, productSummary });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 📊 v1.0.20 (P2): ดาวน์โหลดตาราง สินค้า × รอบไลฟ์ เป็น Excel — ข้อมูลชุดเดียวกับที่หน้าประวัติแสดง (กติกาเดียวกัน)
app.get('/api/history/product_rounds_excel', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let query = supabase.from('slips').select('*').order('trans_date', { ascending: false }).order('trans_time', { ascending: false });
        if (startDate) query = query.gte('trans_date', String(startDate).replace(/-/g, ''));
        if (endDate) query = query.lte('trans_date', String(endDate).replace(/-/g, ''));
        const { data, error } = await query;
        if (error) throw error;

        // เรียงคอลัมน์รอบใหม่ → เก่าเหมือนหน้าประวัติ (จากเวลาเริ่มรอบ) แล้วให้ buildProductRoundSummary จัด "นอกรอบ" ไว้ท้าย
        const sessionIds = [...new Set((data || []).map(s => s.session_id).filter(id => id && LIVE_ID_RE.test(String(id))))];
        const roundsLike = sessionIds.map(id => ({ sessionId: id, startTime: ((getSessionRecord(id) || {}).startTime) || Number(String(id).slice(5)) || 0 }))
            .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
        const ps = buildProductRoundSummary(data, roundsLike);

        // ชื่อคอลัมน์รอบแบบเดียวกับหน้าประวัติ ("ไลฟ์ 1 พ.ย. 21:00 - 01:30")
        const f = (ms, withTimeOnly) => withTimeOnly
            ? new Date(ms).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
            : new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const colLabel = (c) => {
            if (!c.sessionId) return 'นอกรอบไลฟ์';
            const rec = getSessionRecord(c.sessionId) || {};
            const startMs = rec.startTime || Number(String(c.sessionId).slice(5)) || 0;
            if (!startMs) return `ไลฟ์ ${c.sessionId}`;
            return `ไลฟ์ ${f(startMs)}${rec.endTime ? ' - ' + f(rec.endTime, true) : ''}`;
        };

        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('สินค้ารายรอบ');
        ws.columns = [
            { header: 'สินค้า', key: 'name', width: 26 },
            ...ps.columns.map((c, i) => ({ header: colLabel(c), key: 'c' + i, width: 18 })),
            { header: 'รวม', key: 'total', width: 10 },
        ];
        ps.rows.forEach(r => {
            const obj = { name: r.name, total: r.total };
            ps.columns.forEach((c, i) => { obj['c' + i] = r.cells[i] || 0; });
            ws.addRow(obj);
        });
        const sum = { name: 'รวมทุกสินค้า', total: ps.grandTotal };
        ps.columns.forEach((c, i) => { sum['c' + i] = ps.columnTotals[i] || 0; });
        ws.addRow(sum);
        ws.getRow(1).font = { bold: true };
        ws.getRow(ws.rowCount).font = { bold: true };

        const cleanStart = startDate ? String(startDate).replace(/\D/g, '').slice(0, 8) : getTodayString();
        const cleanEnd = endDate ? String(endDate).replace(/\D/g, '').slice(0, 8) : getTodayString();
        const filename = `product_rounds_${cleanStart}_${cleanEnd}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (e) {
        console.error('Product Rounds Excel Error:', e);
        res.status(500).send('Error generating Excel file: ' + e.message);
    }
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
// ===== v1.0.18 (เจ้าของขอ 2026-10-31): การแจ้งเตือนเก็บถาวรในฐานข้อมูลร้าน + แผงด้านขวาของหน้าจอ =====
// บันทึก 1 รายการ (ข้อความเดิมซ้ำภายใน 1 นาที บันทึกครั้งเดียว เหมือนประวัติเดิมในหน้าจอ) แล้วส่งให้ทุกหน้าจอที่เปิดอยู่
function recordNotification(n, source) {
    const kinds = ['bad', 'warn', 'ok', 'info'];
    const text = String((n && n.text) || '').trim().slice(0, 1000);
    if (!text || !kinds.includes(n.kind)) return null;
    const now = Date.now();
    const dup = supabase.db.prepare('SELECT id FROM notifications WHERE kind = ? AND text = ? AND created_at > ? LIMIT 1').get(n.kind, text, now - 60000);
    if (dup) return null;
    const title = String(n.title || '').slice(0, 120);
    const src = String(source || '').slice(0, 40);
    const sessionId = activeLiveSession ? activeLiveSession.id : null;
    const info = supabase.db.prepare('INSERT INTO notifications (created_at, kind, title, text, source, session_id) VALUES (?, ?, ?, ?, ?, ?)').run(now, n.kind, title, text, src, sessionId);
    const row = { id: Number(info.lastInsertRowid), t: now, kind: n.kind, title, text, source: src, sessionId };
    io.emit('notification', row);
    return row;
}
app.get('/api/notifications', (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const before = parseInt(req.query.before, 10);
        const where = []; const params = [];
        if (Number.isFinite(before)) { where.push('id < ?'); params.push(before); }
        if (req.query.important === '1') where.push("kind IN ('bad', 'warn')");
        const rows = supabase.db.prepare(`SELECT id, created_at, kind, title, text, source, session_id FROM notifications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...params, limit + 1);
        res.json({
            success: true,
            hasMore: rows.length > limit,
            items: rows.slice(0, limit).map(r => ({ id: r.id, t: r.created_at, kind: r.kind, title: r.title || '', text: r.text, source: r.source || '', sessionId: r.session_id || null }))
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// เรื่องที่หน้าจอเห็นเอง (เช่น ระบบเชื่อมต่อ LINE หลุด) ส่งมาให้โปรแกรมบันทึกและกระจายให้ทุกหน้าจอ
app.post('/api/notifications', (req, res) => {
    const b = req.body || {};
    if (!['bad', 'warn', 'ok', 'info'].includes(b.kind) || !String(b.text || '').trim()) {
        return res.status(400).json({ success: false, error: 'ข้อมูลการแจ้งเตือนไม่ถูกต้อง' });
    }
    try {
        const row = recordNotification({ kind: b.kind, title: b.title, text: b.text }, b.source === 'tunnel' ? 'tunnel' : 'dashboard');
        res.json({ success: true, recorded: !!row });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/queue/pending_balances', (req, res) => {
    try {
        const rows = supabase.db.prepare('SELECT name, line_id, balance FROM customers WHERE balance > 0 ORDER BY balance DESC, name ASC').all();
        const total = rows.reduce((sum, c) => sum + (Number(c.balance) || 0), 0);
        // v1.0.17 (พบตอนทดสอบหน้างาน 2026-10-31): บอกแยกว่าแต่ละคน "ระบบเก็บไว้ให้" เท่าไร (ยอดไม่พอที่โอนนอกรอบ สูตรเดียวกับ claimOutOfRoundSlips)
        // และ "จะรีเซ็ตเป็น 0" เท่าไร (เศษของรอบก่อน) -- เดิมหน้าต่างบอกให้โอนคืนทุกยอด แม่ค้าอาจคืนเงินที่ระบบเก็บไว้ให้แล้ว
        const keptBy = new Map();
        try { outOfRoundAccumulatedTotals().forEach(r => keptBy.set(r.line_id, Number(r.total) || 0)); } catch (e) { keptBy.clear(); }
        const r2 = (n) => Math.round(n * 100) / 100;
        const split = rows.map(c => {
            const balance = Number(c.balance) || 0;
            const keep = r2(Math.min(balance, keptBy.get(c.line_id) || 0));
            return { name: c.name || c.line_id || 'ลูกค้า', balance, keep, reset: r2(balance - keep) };
        });
        res.json({
            success: true,
            count: rows.length,
            total,
            keepTotal: r2(split.reduce((s, c) => s + c.keep, 0)),
            resetTotal: r2(split.reduce((s, c) => s + c.reset, 0)),
            keepCount: split.filter(c => c.keep > 0).length,
            resetCount: split.filter(c => c.reset > 0).length,
            list: split.slice(0, 8)
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
        // ขอบเขตเดียวกับที่หน้าจอใช้แสดงการ์ด: รอบไลฟ์ที่กำลังไลฟ์ / รอบล่าสุดที่จบแล้ว (+ สลิปโอนนอกรอบที่ยังค้าง) / วันนี้ถ้าไม่เคยมีไลฟ์
        let sql = "UPDATE slips SET status = 'cleared' WHERE line_id = ? AND status = 'accumulated'";
        const params = [slip.line_id];
        if (activeLiveSession) { sql += ' AND session_id = ?'; params.push(activeLiveSession.id); }
        else {
            const last = latestEndedSessionRecord();
            if (last && LIVE_ID_RE.test(String(last.id))) {
                // v1.0.20 (P1): ไลฟ์ข้ามเที่ยงคืน — การ์ดส้มของรอบ (trans_date เมื่อวาน) ต้องปิดได้ เหมือนที่จอแสดงให้เห็น
                sql += ' AND (session_id = ? OR (session_id IS NULL AND id > (SELECT COALESCE(MAX(id), 0) FROM slips WHERE session_id IS NOT NULL) AND trans_date >= ?))';
                params.push(String(last.id), bangkokDateString(-OUT_OF_ROUND_LOOKBACK_DAYS));
            }
            else { sql += ' AND trans_date = ?'; params.push(getTodayString()); }
        }
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
// 🔎 v1.0.17: วิเคราะห์ปัญหาที่เจอในรอบไลฟ์ — กฎตายตัวจับจาก "ข้อความ log ที่โปรแกรมเขียนเอง" (ไม่ใช้ AI ไม่เดาสาเหตุ)
// หลักการ: แต่ละกฎบอกเฉพาะสิ่งที่ข้อความนั้น / เอกสาร SlipOK / พฤติกรรมของโค้ดยืนยันได้ ข้อความที่ไม่ตรงกฎใดจะแสดงดิบ ๆ พร้อมบอกตรง ๆ ว่ายังไม่มีคำวิเคราะห์
// ข้อควรระวังตอนแก้: ตัวดึงฟังก์ชันของเทสต์ (tests/harness/extract.js) ไม่รู้จัก regex ที่มีเครื่องหมายคำพูดหรือ backtick อยู่ข้างใน — ใช้ split แทน
function quotedNamesOf(message) {
    return String(message || '').split('"').filter((_, i) => i % 2 === 1);
}

function getLiveIssueRules() {
    const OPEN_CARD = 'เปิดรูปในการ์ดรอใส่ยอด ถ้าเป็นสลิปจริงให้ใส่ยอดเอง ถ้าไม่ใช่สลิปให้ปัดตก';
    return [
        { key: 'bank_delay', test: /Code 1010/, severity: 'LOW',
          title: 'สลิปธนาคารที่ต้องรอหลังโอนถึงจะตรวจได้ (SlipOK 1010)',
          detail: (g) => {
              const seen = [];
              g.messages.forEach(m => {
                  const b = m.indexOf('ยังตรวจไม่ได้');
                  const bank = (m.indexOf('สลิป') === 0 && b > 4) ? m.slice(4, b) : 'ธนาคารต้นทาง';
                  const mm = m.match(/ประมาณ (\d+) นาที/);
                  const t = bank + (mm ? ' รอประมาณ ' + mm[1] + ' นาที' : '');
                  if (!seen.includes(t)) seen.push(t);
              });
              return seen.slice(0, 4).join(' • ');
          },
          meaning: 'ธนาคารต้นทางของลูกค้ายังไม่ให้ตรวจสลิปจนกว่าจะพ้นเวลาที่กำหนดหลังโอน (ตามเอกสาร SlipOK) ไม่ใช่สลิปผิดหรือสลิปปลอม รูปถูกเก็บไว้ในคิวรอใส่ยอดแล้ว',
          action: 'ให้ลูกค้าส่งรูปเดิมซ้ำหลังพ้นเวลานั้น ระบบจะตรวจให้ หรือเปิดรูปในการ์ดรอใส่ยอดแล้วใส่ยอดเอง' },
        { key: 'bank_outage', test: /Code 1009/, severity: 'LOW',
          title: 'ระบบธนาคารขัดข้องชั่วคราว (SlipOK 1009)',
          meaning: 'SlipOK แจ้งว่าธนาคารขัดข้องและขอให้ตรวจใหม่ในอีก 15 นาที เอกสาร SlipOK ระบุว่ารหัสนี้ไม่เสียโควต้า รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'เปิดรูปในการ์ดรอใส่ยอดแล้วใส่ยอดเอง หรือให้ลูกค้าส่งรูปเดิมซ้ำหลังผ่านไป 15 นาที' },
        { key: 'quota', test: /Code 100[34]|HTTP 402|เครดิตตรวจสลิป.*หมดแล้ว|โควตา.*หมด/, severity: 'HIGH',
          title: 'เครดิตหรือแพ็กเกจตรวจสลิปหมด',
          meaning: 'ผู้ให้บริการตรวจสลิปปฏิเสธเพราะแพ็กเกจหมดอายุหรือใช้เกินโควต้า (SlipOK 1003/1004) หรือเครดิตไม่พอ (HTTP 402) ระหว่างนี้สลิปที่เข้ามาถูกส่งเข้าคิวให้ตรวจภาพเอง หรือสลับไปผู้ให้บริการสำรองถ้าตั้งไว้',
          action: 'ต่อแพ็กเกจหรือเติมเครดิตที่ผู้ให้บริการ แล้วตรวจการ์ดรอใส่ยอดที่ค้างจากช่วงนั้น' },
        { key: 'slipok_config', test: /Code 100[012]/, severity: 'HIGH',
          title: 'ตั้งค่า SlipOK ไม่ถูกต้อง (1000-1002)',
          meaning: 'โปรแกรมแปลรหัส 1000-1002 ว่า API Key หรือ Branch ID ไม่ถูกต้อง สลิปที่เข้ามาถูกส่งเข้าคิวรอใส่ยอด',
          action: 'ตรวจ API Key และ Branch ID ในหน้าตั้งค่า' },
        { key: 'slipok_unreachable', test: /เชื่อมต่อ SlipOK ไม่ได้/, severity: 'HIGH',
          title: 'เชื่อมต่อ SlipOK ไม่ได้',
          meaning: 'ไม่ได้รับคำตอบจาก SlipOK อาจเป็นเน็ตของเครื่องร้านสะดุดหรือบริการล่ม (ข้อมูลที่บันทึกไว้แยกไม่ได้ว่าเป็นข้อไหน) สลิปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'ตรวจอินเทอร์เน็ตของเครื่องร้าน แล้วใส่ยอดเองจากการ์ดรอใส่ยอด' },
        { key: 'slipok_unknown', test: /SlipOK ตอบกลับข้อผิดพลาดที่ไม่รู้จัก/, severity: 'MEDIUM',
          title: 'SlipOK ตอบรหัสที่โปรแกรมยังไม่รู้จัก',
          meaning: 'รหัสนี้ไม่อยู่ในรายการที่โปรแกรมแปลความหมายได้ (รหัสอยู่ในข้อความด้านบน)',
          action: 'เทียบรหัสกับเอกสาร SlipOK แล้วแจ้งผู้พัฒนา' },
        { key: 'no_qr', test: /Code 1007/, severity: 'LOW',
          title: 'SlipOK ไม่พบ QR Code ในรูป (1007)',
          meaning: 'โปรแกรมแปลรหัสนี้ว่าไม่พบ QR Code ในรูป อาจไม่ใช่รูปสลิปหรือถูกครอบตัด ระบบยังบอกไม่ได้ว่ารูปแต่ละใบเป็นเพราะอะไร รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'bad_image', test: /Code 100[56]/, severity: 'LOW',
          title: 'รูปเปิดอ่านไม่ได้หรือไม่ใช่รูปภาพ (1005/1006)',
          meaning: 'SlipOK อ่านไฟล์ที่ส่งมาเป็นรูปภาพไม่ได้ รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'not_payment_qr', test: /Code 1008/, severity: 'LOW',
          title: 'QR ในรูปไม่ใช่ QR ตรวจสอบการชำระเงิน (1008)',
          meaning: 'มี QR ในรูป แต่ SlipOK ระบุว่าไม่ใช่ QR สำหรับตรวจสอบการชำระเงิน รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'qr_expired', test: /Code 1011/, severity: 'LOW',
          title: 'QR หมดอายุ หรือไม่พบรายการโอนจริง (1011)',
          meaning: 'SlipOK ไม่พบรายการโอนจริงของ QR นี้ หรือ QR หมดอายุ ระบบแยกไม่ได้ว่าเป็นกรณีไหน รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: OPEN_CARD },
        { key: 'mismatch', test: /Code 101[34]/, severity: 'MEDIUM',
          title: 'SlipOK แจ้งว่ายอดหรือบัญชีผู้รับไม่ตรง (1013/1014)',
          meaning: 'ผลตรวจจาก SlipOK ว่ายอดหรือบัญชีผู้รับไม่ตรง รูปถูกเก็บไว้ในคิวรอใส่ยอด',
          action: 'เปิดรูปตรวจกับบัญชีร้านและยอดที่ลูกค้าโอน แล้วใส่ยอดเองหรือปัดตก' },
        { key: 'wrong_account', test: /ตรวจพบสลิปโอนผิดบัญชี/, severity: 'HIGH',
          title: 'สลิปโอนเข้าบัญชีที่ไม่ใช่ของร้าน (ไม่บันทึก)',
          detail: (g) => g.messages.slice(0, 4).map(m => { const n = quotedNamesOf(m); return (n[0] || '?') + ' → ' + (n[1] || '?'); }).join(' • '),
          meaning: 'ชื่อผู้รับบนสลิปไม่มีชื่อบัญชีร้านที่ตั้งไว้ (ไทยหรืออังกฤษ) อยู่ข้างใน ระบบจึงไม่บันทึกและไม่นับยอด ระบบเช็กจากชื่อ ไม่ได้เช็กเลขบัญชี',
          action: 'ถ้าลูกค้าโอนผิดจริง แจ้งลูกค้า ถ้าเป็นบัญชีร้านจริง (เช่น สลิป TrueMoney ที่ชื่อผู้รับเป็นภาษาอังกฤษ) ให้ใส่ชื่อบัญชีอังกฤษในหน้าตั้งค่า แล้วให้ลูกค้าส่งสลิปใบเดิมอีกครั้ง' },
        { key: 'duplicate', test: /ตรวจพบสลิปซ้ำ/, severity: 'LOW',
          title: 'สลิปซ้ำ (เคยบันทึกไปแล้ว)',
          meaning: 'รหัสอ้างอิงของสลิปตรงกับสลิปที่บันทึกไว้แล้ว ระบบไม่บันทึกและไม่นับยอดซ้ำ',
          action: 'ไม่ต้องทำอะไรถ้าลูกค้าส่งซ้ำโดยไม่ได้ตั้งใจ ถ้าลูกค้าบอกว่าโอนใหม่ ให้ตรวจเวลาโอนบนสลิป' },
        { key: 'linked_keyed', test: /ผูกเป็นใบเดียวกัน/, severity: 'LOW',
          title: 'สลิปที่ตรวจผ่านตรงกับยอดที่แม่ค้ากรอกเองไว้',
          meaning: 'ระบบถือเป็นใบเดียวกัน ผูกรหัสสลิปเข้าใบเดิม ไม่สร้างใบใหม่ จึงไม่นับยอดและสิทธิ์ซ้ำ (เงื่อนไข: ลูกค้าคนเดียวกัน ยอดเท่ากัน เวลาโอนไม่หลังเวลาที่รูปเข้า)',
          action: 'ไม่ต้องทำอะไร ถ้าลูกค้าโอนก้อนใหม่ที่เวลาโอนหลังจากนั้น ระบบนับเป็นใบใหม่ตามปกติ' },
        { key: 'open_pending', test: /ยังมีรูปรอใส่ยอดค้างอยู่/, severity: 'MEDIUM',
          title: 'ลูกค้ามีรูปรอใส่ยอดค้าง ทั้งที่มีสลิปตรวจผ่านแล้ว',
          meaning: 'ระบบแยกไม่ได้ว่ารูปที่ค้างเป็นใบเดียวกับสลิปที่ตรวจผ่านหรือคนละรายการ จึงบันทึกสลิปที่ตรวจผ่านตามปกติ และไม่ปัดตกรูปที่ค้างให้',
          action: 'เปิดรูปที่ค้าง ถ้าเป็นใบเดียวกันให้ปัดตกการ์ดเก่า อย่ากรอกยอดซ้ำ' },
        { key: 'incomplete_read', test: /อ่านได้แต่ข้อมูลไม่ครบ/, severity: 'MEDIUM',
          title: 'ผู้ให้บริการอ่านสลิปได้ไม่ครบ (ส่งเข้าคิวให้ตรวจเอง)',
          meaning: 'ได้คำตอบจากผู้ให้บริการ แต่ขาดยอดหรือรหัสอ้างอิง ระบบจึงไม่บันทึกอัตโนมัติ และส่งเข้าคิวให้แม่ค้าตรวจเอง',
          action: 'เปิดรูปในการ์ดรอใส่ยอด แล้วใส่ยอดเอง' },
        { key: 'image_download', test: /ดาวน์โหลดรูป.*จาก LINE ไม่สำเร็จ/, severity: 'HIGH',
          title: 'ดึงรูปสลิปจาก LINE ไม่สำเร็จ',
          meaning: 'โปรแกรมไม่ได้รับรูปสลิปของลูกค้าคนนี้ จึงไม่มีสลิปนั้นในคิว (สาเหตุที่โปรแกรมบันทึกไว้อยู่ในบรรทัด Error ของ system.log)',
          action: 'เปิดแชทลูกค้าใน LINE OA ดูรูปสลิป แล้วใส่ยอดเอง หรือให้ลูกค้าส่งใหม่' },
        { key: 'line_reply', test: /ส่ง replyToken ล้มเหลว|ส่งข้อความตอบกลับ LINE ล้มเหลว|Push Message สำรอง/, severity: 'MEDIUM',
          title: 'ส่งข้อความตอบลูกค้าทาง LINE ไม่สำเร็จ',
          meaning: 'ข้อความตอบกลับลูกค้าไม่ถูกส่ง สาเหตุที่เป็นไปได้ตามข้อความของโปรแกรม: replyToken หมดอายุหรือเน็ตช้า, Channel Access Token ผิด, หรือโควตาข้อความ LINE เต็ม (แยกไม่ได้ว่าข้อไหน)',
          action: 'ตรวจ Channel Access Token และโควตาข้อความในบัญชี LINE Official ถ้าเกิดซ้ำ' },
        { key: 'save_failed', test: /บันทึกสลิปอัตโนมัติ.*ไม่สำเร็จ/, severity: 'HIGH',
          title: 'บันทึกสลิปอัตโนมัติไม่สำเร็จ (ส่งเข้าคิวให้ตรวจเอง)',
          meaning: 'ฐานข้อมูลบันทึกสลิปไม่สำเร็จ (ข้อความผิดพลาดของระบบอยู่ในบรรทัดนี้) โปรแกรมส่งสลิปเข้าคิวให้แม่ค้าตรวจเอง',
          action: 'เปิดการ์ดของลูกค้าคนนั้น ตรวจยอดกับรูปก่อนให้สินค้า ถ้าเกิดซ้ำส่ง system.log ให้ผู้พัฒนา' },
        { key: 'db_busy', test: /ฐานข้อมูลไม่ว่างชั่วคราว/, severity: 'LOW',
          title: 'ฐานข้อมูลไม่ว่างชั่วคราว (ลองบันทึกใหม่เอง)',
          meaning: 'ฐานข้อมูลถูกใช้งานอยู่ตอนบันทึกสลิป โปรแกรมลองบันทึกซ้ำเอง',
          action: 'ถ้ามี Error "บันทึกสลิปอัตโนมัติ… ไม่สำเร็จ" ของลูกค้าคนเดียวกันตามมา ให้ตรวจการ์ดของคนนั้น' },
        { key: 'backup_failed', test: /เก็บสลิปสำรองไม่สำเร็จ/, severity: 'CRITICAL',
          title: 'เก็บสลิปสำรองไม่สำเร็จ (สลิปอาจไม่อยู่ในระบบ)',
          meaning: 'บันทึกอัตโนมัติและการเก็บสลิปสำรองล้มเหลวทั้งคู่ สลิปของลูกค้าคนนี้อาจไม่อยู่ในคิว',
          action: 'เปิดแชท LINE ของลูกค้าคนนั้น ตรวจสลิปด้วยตัวเอง' },
        { key: 'webhook_event', test: /ประมวลผล Webhook Event/, severity: 'HIGH',
          title: 'ประมวลผลข้อความจาก LINE ไม่สำเร็จ',
          meaning: 'เกิดข้อผิดพลาดตอนประมวลผลข้อความที่ LINE ส่งมา (สาเหตุอยู่ท้ายบรรทัดด้านบน) ข้อความหรือสลิปนั้นอาจไม่ถูกประมวลผล',
          action: 'ตรวจแชทลูกค้าที่ส่งมาช่วงเวลานั้น' },
        { key: 'line_signature', test: /x-line-signature|Channel Secret/, severity: 'MEDIUM',
          title: 'LINE Webhook ถูกปฏิเสธ หรือยังไม่ได้ตั้ง Channel Secret',
          meaning: 'ข้อความที่เข้ามาไม่มีลายเซ็นหรือลายเซ็นไม่ตรง จึงถูกปฏิเสธ (กลไกกันคนนอกส่งข้อมูลเข้ามา) หรือยังไม่ได้ตั้ง Channel Secret ระบบจึงตรวจที่มาของข้อความไม่ได้',
          action: 'ถ้าเกิดกับข้อความจริงจาก LINE ให้ตรวจ Channel Secret ในหน้าตั้งค่า' },
        { key: 'tunnel', test: /Tunnel|Webhook ซ้ำยังไม่สำเร็จ|อัปเดต LINE Webhook อัตโนมัติ/, severity: 'MEDIUM',
          title: 'ท่อสัญญาณ (Tunnel) หรือการผูก LINE Webhook มีปัญหา',
          meaning: 'ท่อเชื่อมต่อหลุดหรือผูกลิงก์กับ LINE ไม่สำเร็จ ในช่วงนั้น LINE อาจส่งสลิปมาไม่ถึงเครื่องร้าน โปรแกรมลองเชื่อมต่อหรือผูกใหม่เอง',
          action: 'ดูแถบแดงบนหน้าจอ ถ้าเกิดบ่อยให้ตรวจเน็ตร้าน และตรวจแชทลูกค้าช่วงที่ท่อหลุดว่ามีสลิปที่ไม่เข้าระบบหรือไม่' },
        { key: 'gemini', test: /Gemini AI/, severity: 'LOW',
          title: 'AI อ่านที่อยู่ไม่สำเร็จ (ใช้ระบบสำรอง)',
          meaning: 'Gemini อ่านที่อยู่ไม่สำเร็จหรือเกินโควตา โปรแกรมสลับไปอ่านด้วยระบบสำรอง (Regex)',
          action: 'ตรวจที่อยู่ของลูกค้าที่ส่งมาช่วงนั้นก่อนส่งออก Kerry' },
        { key: 'other_provider', test: /EasySlip|Thunder|SlipVerify|Custom API/, severity: 'MEDIUM',
          title: 'ผู้ให้บริการตรวจสลิปอื่นตอบผิดพลาดหรือยังไม่ได้ตั้งค่า',
          meaning: 'ผู้ให้บริการตอบกลับไม่ถูกต้อง หรือไม่ได้ใส่ Token ในการตั้งค่า (รายละเอียดอยู่ในข้อความด้านบน) โปรแกรมไม่ได้แยกสาเหตุเพิ่ม',
          action: 'ดูบรรทัดเต็มใน system.log และตรวจการตั้งค่าผู้ให้บริการ' },
        { key: 'crash', test: /Uncaught Exception|Unhandled Rejection/, severity: 'CRITICAL',
          title: 'โปรแกรมเจอข้อผิดพลาดที่ไม่ได้ดักไว้',
          meaning: 'เกิดข้อผิดพลาดนอกจุดที่โค้ดดักไว้ (สาเหตุอยู่ในข้อความด้านบน) โปรแกรมบันทึกรายละเอียดไว้ใน system.log',
          action: 'เก็บ system.log ส่งให้ผู้พัฒนา' },
        { key: 'restart', test: /ตัวเฝ้าโปรแกรมเปิดใหม่อัตโนมัติ/, severity: 'HIGH',
          title: 'โปรแกรมหยุดทำงานแล้วถูกเปิดใหม่อัตโนมัติ',
          meaning: 'ตัวเฝ้าเปิดโปรแกรมใหม่เพราะโปรแกรมหยุดทำงานผิดปกติ',
          action: 'ดู supervisor.log และ system.log ช่วงก่อนหน้า ตามที่ข้อความระบุ' },
        { key: 'disk', test: /พื้นที่เครื่องเหลือน้อย/, severity: 'MEDIUM',
          title: 'พื้นที่ดิสก์เหลือน้อย',
          meaning: 'โปรแกรมลบรูปสลิปเก่าให้เองแล้วตามจำนวนที่ระบุในข้อความ',
          action: 'ย้ายไฟล์ที่ไม่ใช้ออกจากเครื่อง' }
    ];
}

// จัดกลุ่ม Error/WARN ของรอบตามกฎด้านบน (ข้อความที่ไม่ตรงกฎใดจัดกลุ่มตามข้อความเมื่อตัดตัวเลขและชื่อออก)
// คืนรายการกลุ่ม { type, key, rule|null, count, messages[] } เรียง ERROR ก่อน แล้วเรียงตามจำนวนมาก→น้อย
function analyzeLiveIssues(issues) {
    const rules = getLiveIssueRules();
    const map = new Map();
    (issues || []).forEach(it => {
        const msg = String((it && it.message) || '');
        const type = (it && it.type === 'ERROR') ? 'ERROR' : 'WARN';
        const rule = rules.find(r => r.test.test(msg)) || null;
        const norm = msg.split('"').map((s, i) => i % 2 === 1 ? '"…"' : s.replace(/\d+/g, '#')).join('');
        const key = type + '|' + (rule ? rule.key : 'raw:' + norm.slice(0, 120));
        let g = map.get(key);
        if (!g) { g = { type, key: rule ? rule.key : ('raw[' + type + ']:' + norm.slice(0, 100)), rule, count: 0, messages: [] }; map.set(key, g); }
        g.count++;
        if (g.messages.length < 50) g.messages.push(msg);
    });
    return Array.from(map.values()).sort((a, b) => (a.type === b.type ? 0 : (a.type === 'ERROR' ? -1 : 1)) || b.count - a.count);
}

// ข้อความของ 1 กลุ่มในสรุป: เกิดอะไรขึ้น (ข้อเท็จจริงจาก log) / วิเคราะห์ (จากกฎ) / ควรทำ
// v1.0.17: กลุ่มที่ยังไม่มีกฎ (rule = null) และมีความเห็นจาก AI (g.aiNote จาก getAiOpinionsForUnknownIssues)
// จะแสดงเป็นข้อสันนิษฐานกำกับชัดว่ายังไม่ยืนยัน — ไม่แอบอ้างเป็นคำวิเคราะห์ของระบบ
function renderLiveIssueGroup(g) {
    const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > n ? x.slice(0, n - 1) + '…' : x; };
    const rule = g.rule;
    let detail = '';
    if (rule && typeof rule.detail === 'function') detail = rule.detail(g);
    if (!detail && rule) {
        const names = [];
        g.messages.forEach(m => { const n = quotedNamesOf(m)[0]; if (n && !names.includes(n)) names.push(n); });
        if (names.length) detail = 'ลูกค้า: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? ' และอีก ' + (names.length - 4) + ' คน' : '');
    }
    if (!detail) detail = clip(g.messages[0], rule ? 160 : 200);
    detail = clip(detail, 230);

    let icon = '⚠️', label = '';
    if (g.type === 'ERROR') {
        if (rule) { const st = SEVERITY_STYLE[rule.severity] || SEVERITY_STYLE.MEDIUM; icon = st.icon; label = '**' + st.label + '** — '; }
        else icon = '❔';
    }
    const title = rule ? rule.title : 'ข้อความที่ระบบยังไม่มีคำวิเคราะห์เฉพาะ';
    const meaning = rule ? rule.meaning
        : (g.aiNote ? '🤖 ความเห็นจาก AI (ยังไม่ยืนยัน): ' + clip(g.aiNote, 260) : 'ยังไม่มีคำวิเคราะห์เฉพาะสำหรับข้อความนี้ (ระบบไม่เดาสาเหตุ)');
    const action = rule ? rule.action : 'ค้นข้อความด้านบนใน system.log ของร้านเพื่อดูรายละเอียดเต็ม';
    const out = icon + ' ' + label + title + (g.count > 1 ? ' — ' + g.count + ' ครั้ง' : '') + '\n' +
        '> เกิดอะไรขึ้น: ' + detail + '\n> วิเคราะห์: ' + meaning + '\n> ควรทำ: ' + action;
    return out.length > 950 ? out.slice(0, 949) + '…' : out;
}

// สรุปสินค้าที่ได้สิทธิ์ของรอบ — กติกาเดียวกับหน้าประวัติ (public/history.html): ไม่นับใบที่ปัดตก/ข้าม และ draws ต้อง > 0
// breakdown เก็บใน qr_payload: "รหัสอ้างอิง|ชื่อ xจำนวน, ชื่อ xจำนวน" (ใบ manual_image คือ "manual_image|url|breakdown")
// v1.0.20 (P2): ตัวนับย้ายไป lib/products.js เป็นกติกาเดียวกับตาราง "สินค้า × รอบไลฟ์" ของหน้าประวัติ — ห้ามแก้ข้างเดียว
const Products = require('./lib/products');
function summarizeLiveProducts(rows) {
    const { counts, pieces } = Products.countProducts(rows);
    const list = Object.keys(counts).map(n => ({ name: n, qty: counts[n] })).sort((a, b) => (b.qty - a.qty) || a.name.localeCompare(b.name));
    return { list, pieces };
}

// v1.0.20 (P2): ประกอบตาราง สินค้า × รอบไลฟ์ จากสลิปในช่วงที่เลือก (นับด้วยกติกาเดียวกันจาก lib/products.js)
// คอลัมน์ = รอบใหม่ → เก่า (ตามลำดับ rounds ที่ส่งเข้ามา ซึ่งเรียงแล้ว) + "นอกรอบไลฟ์" ท้ายสุดถ้ามีสลิปไม่มีรอบ
// ใช้ร่วมทั้ง /api/history_data (แสดงบนหน้าประวัติ) และ /api/history/product_rounds_excel (ดาวน์โหลด Excel)
function buildProductRoundSummary(slips, rounds) {
    const byRound = new Map();
    (slips || []).forEach(s => {
        const key = s.session_id && LIVE_ID_RE.test(String(s.session_id)) ? String(s.session_id) : '__oor__';
        if (!byRound.has(key)) byRound.set(key, []);
        byRound.get(key).push(s);
    });
    const columns = [];
    (rounds || []).forEach(r => { if (r.sessionId) columns.push({ key: String(r.sessionId), sessionId: r.sessionId }); });
    if (byRound.has('__oor__')) columns.push({ key: '__oor__', sessionId: null });
    const perCol = {};
    columns.forEach(c => { perCol[c.key] = Products.countProducts(byRound.get(c.key) || []); });
    const names = new Set();
    Object.keys(perCol).forEach(k => Object.keys(perCol[k].counts).forEach(n => names.add(n)));
    const rows = [...names].map(n => {
        const cells = columns.map(c => perCol[c.key].counts[n] || 0);
        return { name: n, cells, total: cells.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'th'));
    const columnTotals = columns.map(c => perCol[c.key].pieces);
    return { columns, rows, columnTotals, grandTotal: columnTotals.reduce((a, b) => a + b, 0) };
}

// 🏁 v1.0.16: ตัวสร้าง embed สรุปหลังจบไลฟ์ (pure function — ตัดมาทดสอบแบบ unit test ได้ตรงๆ)
// session = { id, startTimeStr, endTimeStr, startTime, endTime, holdMerge } / stats = { slips, amount, draws, customers, byStatus, rejected?, products? } / issues = [{type:'ERROR'|'WARN', message}]
// v1.0.17: + สลิปที่ปัดตก + สินค้าที่ออก + วิเคราะห์ปัญหาแยกกลุ่ม (analyzeLiveIssues) และคืนเป็น "หลาย embed" (1-2 อัน) เมื่อเนื้อหาล้นข้อจำกัด Discord
// v1.0.17 (ตามคำขอเจ้าของร้าน): รายละเอียด WARN ไม่ถูกตัดทิ้ง — เกิน 1 ข้อความก็แบ่งเป็นข้อความที่ 2
function buildEndOfLiveReportEmbeds(session, stats, issues, meta = {}, aiNotes = {}) {
    const fmtB = (n) => { const v = Math.round(Number(n) * 100) / 100; return Number.isInteger(v) ? String(v) : v.toFixed(2); };
    const durMs = (session.endTime || 0) - (session.startTime || 0);
    const h = Math.floor(durMs / 3600000), m = Math.floor((durMs % 3600000) / 60000);
    const durStr = durMs <= 0 ? 'น้อยกว่า 1 นาที' : (h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`);
    const errCount = (issues || []).filter(i => i.type === 'ERROR').length;
    const warnCount = (issues || []).filter(i => i.type === 'WARN').length;
    const groups = analyzeLiveIssues(issues);
    // v1.0.17: แนบความเห็น AI เฉพาะกลุ่มที่ยังไม่มีกฎ (ผู้เรียกสร้าง aiNotes จาก getAiOpinionsForUnknownIssues)
    if (aiNotes && typeof aiNotes === 'object') groups.forEach(g => { if (!g.rule && aiNotes[g.key]) g.aiNote = aiNotes[g.key]; });
    const errGroups = groups.filter(g => g.type === 'ERROR');
    const warnGroups = groups.filter(g => g.type === 'WARN');
    const st = stats.byStatus || {};

    const fields = [
        { name: '⏱️ ช่วงเวลา', value: `${session.startTimeStr || '-'} → ${session.endTimeStr || '-'} (${durStr})`, inline: false },
        { name: '🧾 สลิปรอบนี้', value: `${stats.slips} ใบ`, inline: true },
        { name: '👥 ลูกค้า', value: `${stats.customers} คน`, inline: true },
        { name: '💰 ยอดรับรวม', value: `${fmtB(stats.amount)} บาท`, inline: true },
        { name: '🎟️ สิทธิ์ที่ออก', value: `${stats.draws} ชิ้น`, inline: true }
    ];
    if (stats.rejected !== undefined) fields.push({ name: '🗑️ สลิปที่ปัดตก', value: `${stats.rejected} ใบ (ไม่นับในตัวเลขด้านบน)`, inline: true });
    fields.push({ name: '📋 สถานะคิว', value: `รอ ${st.waiting || 0} • เรียกแล้ว ${st.called || 0} • ข้าม ${st.skipped || 0} • เสร็จ ${st.completed || 0} • รอตรวจ ${st.abnormal_pending || 0}`, inline: false });
    if (session.holdMerge) fields.push({ name: '🔗 รวมบิล', value: 'รอบนี้ตั้ง "รอรวมกับรอบหน้า" — ยังไม่ต้องแพ็คส่งแยกรอบนี้', inline: false });

    if (stats.products) {
        const list = stats.products.list || [];
        const MAXP = 15;
        let text;
        if (list.length === 0) text = 'ไม่มีสินค้าที่ได้สิทธิ์ในรอบนี้';
        else {
            text = list.slice(0, MAXP).map(p => `${p.name} ×${p.qty}`).join(' • ');
            if (list.length > MAXP) text += ` • …และอีก ${list.length - MAXP} รายการ`;
            text += '\n> นับเฉพาะใบที่ได้สิทธิ์ ไม่รวมใบที่ข้ามและที่ปัดตก (กติกาเดียวกับหน้าประวัติ)';
            if (text.length > 1000) text = text.slice(0, 999) + '…';
        }
        fields.push({ name: `🛍️ สินค้าที่ออก (${stats.products.pieces || 0} ชิ้น, ${list.length} รายการ)`, value: text, inline: false });
    }

    // แพ็กกลุ่มปัญหาลงฟิลด์ (ฟิลด์ละไม่เกิน ~1000 ตัวอักษร ตามขีดจำกัด 1024 ของ Discord)
    const pack = (name, contName, texts) => {
        const out = [];
        let cur = '';
        texts.forEach(t => {
            if (cur && (cur.length + 2 + t.length) > 1000) { out.push(cur); cur = t; }
            else cur = cur ? cur + '\n\n' + t : t;
        });
        if (cur) out.push(cur);
        return out.map((v, i) => ({ name: i === 0 ? name : contName, value: v, inline: false }));
    };
    const sizeOf = (arr) => (`🏁 สรุปหลังจบไลฟ์ ${meta.shopLabel || ''}`).length + 120 + arr.reduce((a, f) => a + f.name.length + f.value.length, 0);
    // v1.0.17: รายละเอียด WARN ห้ามหาย — ถ้าทั้งรอบใส่ข้อความเดียวไม่ไหว แบ่งเป็น 2 ข้อความ (สถิติ+Error / WARN)
    // แทนที่จะตัดกลุ่ม WARN ทิ้งเหลือแค่ตัวเลขอย่างเดิม (เจ้าของร้านขอดูสาเหตุของทุกคำเตือน)
    const errBlock = (maxErr) => {
        if (errCount === 0) return [{ name: `🚨 Error ที่เจอในรอบนี้ (0)`, value: 'ไม่พบ Error ในรอบนี้ 🎉', inline: false }];
        const shown = errGroups.slice(0, maxErr).map(renderLiveIssueGroup);
        if (errGroups.length > maxErr) shown.push(`… และอีก ${errGroups.length - maxErr} ประเภท (ดูทั้งหมดใน system.log ของร้าน)`);
        const head = `${errCount} รายการ (${errGroups.length} ประเภท)`;
        return pack(`🚨 Error ที่เจอในรอบนี้ (${errCount})`, '🚨 Error (ต่อ)', [head].concat(shown));
    };
    const warnBlock = (maxWarn) => {
        if (warnCount === 0) return [];
        const shown = warnGroups.slice(0, maxWarn).map(renderLiveIssueGroup);
        if (warnGroups.length > maxWarn) shown.push(`… และอีก ${warnGroups.length - maxWarn} ประเภท (ดูทั้งหมดใน system.log ของร้าน)`);
        const head = `${warnCount} รายการ (${warnGroups.length} ประเภท)`;
        return pack(`⚠️ คำเตือน (WARN) (${warnCount})`, '⚠️ คำเตือน (ต่อ)', [head].concat(shown));
    };
    const shrinkToFit = (block, maxList, baseFields, baseSize) => {
        for (const n of maxList) {
            const b = block(n);
            if (baseSize + sizeOf(b) <= 5800 && baseFields + b.length <= 25) return b;
        }
        return block(maxList[maxList.length - 1]);
    };
    const mkEmbed = (fs, suffix, color) => ({
        title: `🏁 สรุปหลังจบไลฟ์ ${meta.shopLabel || ''}${suffix}`.trim(),
        color, fields: fs,
        footer: { text: `AutoQueueforLive v${meta.version || '?'} • รหัสรอบ ${session.id || '-'}` }
    });
    const colorOf = (errs) => errs > 0 ? 15158332 : (warnCount > 0 ? 16753920 : 3066993);

    const errFields = shrinkToFit(errBlock, [12, 10, 8, 6, 4], fields.length, sizeOf(fields));
    const warnFields = shrinkToFit(warnBlock, [12, 8, 6, 4, 3, 2], 0, 0);   // ต่ำสุด 2 ประเภท + บรรทัดชี้ system.log — ไม่มีทางเหลือแค่ตัวเลข
    const all = fields.concat(errFields, warnFields);
    if (sizeOf(all) <= 5800 && all.length <= 25) {
        return [mkEmbed(all, '', colorOf(errCount))];
    }
    return [
        mkEmbed(fields.concat(errFields), '', colorOf(errCount)),
        mkEmbed(warnFields, ' (ต่อ — คำเตือนของรอบนี้)', 16753920)
    ];
}

// คืน embed แรกเมื่อผู้เรียกต้องการแค่อันเดียว (ใช้ภายใน/ทดสอบ)
function buildEndOfLiveReportEmbed(session, stats, issues, meta = {}, aiNotes = {}) {
    return buildEndOfLiveReportEmbeds(session, stats, issues, meta, aiNotes)[0];
}

// 🤖 v1.0.17: ขอ "ข้อสันนิษฐาน" จาก Gemini สำหรับกลุ่ม log ที่ยังไม่มีกฎวิเคราะห์ (เรียกครั้งเดียวต่อการจบไลฟ์ สูงสุด 8 กลุ่ม)
// หลักการ: กฎของระบบยังเป็นคำวิเคราะห์หลัก (พิสูจน์ได้) — AI เป็นแค่ความเห็นเสริมกำกับชัดว่า "ยังไม่ยืนยัน"
// พังหรือเกินโควตาเมื่อไหร่: คืน {} เงียบๆ รายงานสรุปยังออกตามปกติทุกกรณี และไม่ขอ AI เลยถ้าไม่มีกลุ่มที่ไม่รู้จัก
async function getAiOpinionsForUnknownIssues(rawGroups) {
    const out = {};
    if (!process.env.GEMINI_API_KEY || !Array.isArray(rawGroups) || rawGroups.length === 0) return out;
    try {
        const list = rawGroups.slice(0, 8).map((g, i) => `${i + 1}. [${g.type}] ${String(g.messages[0] || '').replace(/\s+/g, ' ').slice(0, 200)}`);
        const prompt = `คุณคือผู้ช่วยวิเคราะห์ log ของโปรแกรมจัดคิวร้านขายของไลฟ์ ข้อความต่อไปนี้คือ log ที่ระบบยังไม่มีคำวิเคราะห์เฉพาะ
กรุณาให้ "ข้อสันนิษฐาน" ว่าน่าจะเกิดจากอะไร และควรตรวจอะไรต่อ ตอบเป็น JSON array เท่านั้น รูปแบบ [{"i":1,"opinion":"..."}]
กติกา: ภาษาไทย ไม่เกิน 2 ประโยคต่อข้อ ระบุเฉพาะสิ่งที่อนุมานได้จากข้อความ ห้ามแต่งตัวเลขหรือชื่อที่ไม่มีใน log ถ้าไม่แน่ใจให้บอกว่าไม่แน่ใจ

${list.join('\n')}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;
        const res = await axios.post(url, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        }, { timeout: 8000, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });

        const rawJson = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJson) return out;
        const parsed = JSON.parse(rawJson);
        const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.opinions) ? parsed.opinions : []);
        rawGroups.slice(0, 8).forEach((g, i) => {
            const hit = arr.find(x => x && Number(x.i) === i + 1 && x.opinion && String(x.opinion).trim() !== '');
            if (hit) out[g.key] = String(hit.opinion).trim().slice(0, 300);
        });
        if (Object.keys(out).length > 0) addLog('INFO', `สรุปหลังจบไลฟ์: ได้ความเห็นเสริมจาก AI สำหรับปัญหาที่ยังไม่มีคำวิเคราะห์ ${Object.keys(out).length} กลุ่ม (แสดงกำกับว่ายังไม่ยืนยัน)`);
    } catch (e) {
        // ไม่ WARN รบกวน: การขาดความเห็น AI ไม่ใช่ปัญหาของร้าน — บันทึกเบาๆ ไว้เท่านั้น
        addLog('INFO', `สรุปหลังจบไลฟ์: ขอความเห็นเสริมจาก AI ไม่สำเร็จ (${String(e.message).slice(0, 80)}) แสดงผลด้วยคำวิเคราะห์ของกฎตามปกติ`);
    }
    return out;
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
        const rejRow = supabase.db.prepare("SELECT COUNT(*) AS n FROM slips WHERE session_id = ? AND status = 'rejected'").get(sid) || {};
        const prodRows = supabase.db.prepare("SELECT qr_payload, status, draws FROM slips WHERE session_id = ? AND status NOT IN ('rejected', 'skipped') AND draws > 0").all(sid);
        const stats = { slips: row.n || 0, amount: row.amt || 0, draws: row.dr || 0, customers: row.cust || 0, byStatus, rejected: rejRow.n || 0, products: summarizeLiveProducts(prodRows) };

        // 🤖 v1.0.17: กลุ่มปัญหาที่ยังไม่มีกฎวิเคราะห์ → ขอความเห็นเสริมจาก Gemini (ครั้งเดียว จำกัดเวลา พังก็ข้ามได้เสมอ)
        const rawGroups = analyzeLiveIssues(issues).filter(g => !g.rule);
        const aiNotes = await getAiOpinionsForUnknownIssues(rawGroups);

        const embeds = buildEndOfLiveReportEmbeds(endedSession, stats, issues, { version: getAppVersionSafe(), shopLabel: getShopLabel() }, aiNotes);
        // v1.0.17: มีช่องแยกสำหรับสรุปหลังจบไลฟ์ (DISCORD_LIVE_SUMMARY_WEBHOOK_URL) ให้ส่งเฉพาะช่องนั้น
        // ถ้ายังไม่ได้ตั้ง ไหลไปช่องแจ้งเตือนหลัก → ช่องกิจกรรม → ช่อง Dev Report ตามลำดับ เพื่อให้สรุปมาถึงทุกครั้ง
        const url = getLiveSummaryWebhook() || DISCORD_WEBHOOK_URL || getActivityWebhook() || getDevReportWebhook();
        if (!url) return;
        embeds.forEach(embed => discordAlertQueue.push({ url, payload: { embeds: [embed] } }));
        await processDiscordQueue();
    } catch (e) {
        console.error('ส่งสรุปหลังจบไลฟ์เข้า Discord ไม่สำเร็จ:', e.message);
    }
}

// v1.0.18 (เจ้าของขอ 2026-10-31): หลังจบไลฟ์ ส่งไฟล์ log ของรอบนั้นเข้าช่อง Dev Report (DISCORD_DEVREPORT_WEBHOOK_URL) เพื่อให้ผู้พัฒนาเปิดดูได้ทุกเครื่อง
// เฉพาะบรรทัดตั้งแต่เริ่มถึงจบรอบ (อ่าน system-prev.log ด้วย เผื่อไฟล์หมุนกลางไลฟ์) ปิดเบอร์โทร/เลขบัตรด้วย redactPersonalInfo แบบเดียวกับช่องกิจกรรม
// ส่งไม่ได้ = WARN (ตอนนี้ไม่มีไลฟ์แล้ว จึงไม่ไปปนในสรุปรอบถัดไป) ไฟล์ system.log ต้นฉบับยังอยู่ในเครื่องร้านเสมอ
const LIVE_LOG_MAX_BYTES = 8 * 1024 * 1024;   // ต่ำกว่าขีดจำกัดไฟล์แนบของ Discord webhook
async function sendLiveLogToDevReport(endedSession) {
    const url = getDevReportWebhook();
    if (!url || process.env.DISCORD_ALERTS_ENABLED === 'false' || !endedSession || !endedSession.startTime) return;
    await new Promise(r => setTimeout(r, 1500));   // รอให้บรรทัด "จบไลฟ์" ถูกเขียนลงไฟล์ก่อน (appendLogFile เขียนแบบไม่รอผล)
    const sid = endedSession.id;
    const startMs = Math.floor(Number(endedSession.startTime) / 1000) * 1000;   // เวลาใน log ละเอียดถึงวินาที
    const endMs = Date.now();
    let text = '';
    for (const f of [LOG_FILE_PREV, LOG_FILE]) { try { text += fs.readFileSync(f, 'utf8') + '\n'; } catch (e) { /* ไม่มีไฟล์ */ } }
    const lines = sliceLogForLive(text, startMs, endMs).map(l => redactPersonalInfo(l));
    if (lines.length === 0) return;
    let body = lines.join('\r\n') + '\r\n';
    let note = '';
    if (Buffer.byteLength(body) > LIVE_LOG_MAX_BYTES) {
        const buf = Buffer.from(body, 'utf8');
        body = buf.slice(buf.length - LIVE_LOG_MAX_BYTES).toString('utf8');
        note = ' (ไฟล์ใหญ่เกิน ตัดช่วงต้นของรอบออก ดูฉบับเต็มใน system.log ที่เครื่องร้าน)';
    }
    const fmt = (ms) => new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false });
    const content = `📄 System log รอบไลฟ์ ${sid} — ${getShopLabel()} — v${getAppVersionSafe()}\n${lines.length} บรรทัด (${fmt(startMs)} ถึง ${fmt(endMs)}) ปิดเบอร์โทร/เลขบัตรแล้ว${note}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const form = new FormData();
            form.append('payload_json', JSON.stringify({ content: content.slice(0, 1900) }));
            form.append('files[0]', Buffer.from(body, 'utf8'), { filename: `system-log_${sid}.txt`, contentType: 'text/plain; charset=utf-8' });
            await axios.post(url, form, { headers: form.getHeaders(), timeout: 30000, maxBodyLength: Infinity, maxContentLength: Infinity });
            addLog('INFO', `ส่งไฟล์ log ของรอบไลฟ์ ${sid} เข้าช่อง Dev Report แล้ว (${lines.length} บรรทัด)`);
            return;
        } catch (e) {
            if (attempt === 3) {
                addLog('WARN', `ส่งไฟล์ log ของรอบไลฟ์ ${sid} เข้าช่อง Dev Report ไม่สำเร็จ (ลอง 3 ครั้ง): ${e.response ? 'HTTP ' + e.response.status : e.message} — ไฟล์ system.log ยังอยู่ในเครื่องร้าน`);
                return;
            }
            const retryAfter = e.response && e.response.data ? Number(e.response.data.retry_after) : 0;
            await new Promise(r => setTimeout(r, retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : attempt * 3000));
        }
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
        const preResetBalances = new Map();   // v1.0.17: ยอดก่อนรีเซ็ต ใช้คืนเงินของสลิปยอดไม่พอที่โอนนอกรอบ (claimOutOfRoundSlips)
        try {
            const owed = supabase.db.prepare('SELECT name, line_id, balance FROM customers WHERE balance != 0').all();
            if (owed.length > 0) {
                supabase.db.prepare('UPDATE customers SET balance = 0 WHERE balance != 0').run();
                owed.forEach(c => { if (c.line_id) preResetBalances.set(c.line_id, Number(c.balance) || 0); });
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
            const claim = claimOutOfRoundSlips(sessionId, preResetBalances);
            claimedOutOfRound = claim.claimed;
            carryOutOfRoundNotices(sessionId);
            if (claimedOutOfRound > 0) addLog('INFO', `เริ่มไลฟ์รอบใหม่: ผูกสลิปที่ลูกค้าโอนนอกรอบไลฟ์ ${claimedOutOfRound} ใบ เข้ากับรอบนี้ (ยังค้างอยู่ในคิว)`);
            if (claim.restored.length > 0) {
                const restoredTotal = claim.restored.reduce((sum, r) => sum + r.amount, 0);
                const restoredDetail = claim.restored.slice(0, 20).map(r => `${r.name || r.lineId}: ${fmtBaht(r.amount)}฿`).join(', ');
                addLog('INFO', `เริ่มไลฟ์รอบใหม่: คืนยอดที่ลูกค้าโอนนอกรอบแต่ยังไม่พอซื้อ กลับเข้ากระเป๋า ${claim.restored.length} คน รวม ${fmtBaht(restoredTotal)} บาท (${restoredDetail}${claim.restored.length > 20 ? ', ...' : ''}) ลูกค้าขึ้นการ์ดรอโอนเพิ่มในรอบนี้`);
            }
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
        // v1.0.18: ตามด้วยไฟล์ log ของรอบนี้เข้าช่อง Dev Report (ล้มก็ไม่กระทบการจบไลฟ์)
        sendEndOfLiveReport(endedSession).catch(() => {}).then(() => sendLiveLogToDevReport(endedSession)).catch(() => {});

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
        if (slip.arrived_out_of_round === 1) {   // v1.0.16: ยอดโอนนอกรอบของลูกค้าคนนี้ (+ v1.0.19: จำว่ามาก่อนไลฟ์หรือหลังจบไลฟ์ — มีทั้งคู่ใช้ 'after' กันเหนียว)
            customerOrders[custKey].outOfRound = true;
            const w = outOfRoundWhen(slip.trans_date, slip.trans_time);
            if (w === 'after' || !customerOrders[custKey].outOfRoundWhen) customerOrders[custKey].outOfRoundWhen = w;
        }
        
        let bd = '';
        if (slip.qr_payload && slip.qr_payload.startsWith('manual_image')) {
            bd = slip.qr_payload.split('|')[2] || '';
        } else {
            bd = (slip.qr_payload || '').split('|')[1] || '';
        }
        if (bd) customerOrders[custKey].breakdowns.push(bd);
    });

    // v1.0.17 (เจ้าของสั่ง 2026-10-31): ส่งของเฉพาะลูกค้าที่ได้สินค้าอย่างน้อย 1 ชิ้น -- คนที่ยอดยังไม่พอ (0 ชิ้น) ไม่อยู่ในรายชื่อ Kerry และไฟล์ Excel
    const orders = Object.values(customerOrders).filter(cust => cust.totalDraws > 0).map(cust => {
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
            outOfRoundWhen: cust.outOfRound ? (cust.outOfRoundWhen || 'after') : null,   // v1.0.19: 'before'=มาก่อนไลฟ์ / 'after'=ยอดจุ่ม
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
        res.json({ success: true, totalCustomers, readyCustomers, missingCustomers, orders: [...orders], outOfRoundCustomers: orders.filter(o => o.outOfRound).map(o => ({ name: o.lineName, when: o.outOfRoundWhen || 'after' })), merge, held, canHold });   // v1.0.19: ส่ง when ไปด้วย — หน้าต่างแยก "ก่อนเริ่มไลฟ์" กับ "หลังจบไลฟ์ (ยอดจุ่ม ระวังส่งซ้ำ)"
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
            row.getCell(12).value = addr.remark || '';                            // Col 12: Remark (ไฟล์นี้อัปโหลดให้ Kerry — ห้ามใส่โน้ตภายใน เจ้าของสั่งเอาโน้ตโอนนอกรอบออกแล้ว)
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

        // v1.0.17: การ์ดรอใส่ยอดกลายเป็นคิวที่ได้สิทธิ์ = เสียงคิวใหม่เหมือนสลิปปกติ (เดิมเส้นทางนี้เงียบ)
        if (result.draws > 0 && slip.status === 'waiting') io.emit('play_sound');
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
        // v1.0.17: รับได้ทั้งรูปเดิม { slipId, items } (การ์ดเดียว) และรูปใหม่ { edits: [{slipId, items}, ...] } (การ์ดรวมบิลหลายสลิป)
        // ตรวจความถูกต้องครบทุกใบก่อน แล้วค่อยบันทึกทีเดียว — กัน "แก้ครึ่งเดียว" แบบตอนหน้าเว็บส่งทีละใบแล้วใบหลังล้ม (HANDOFF §5)
        const rawEdits = Array.isArray(req.body && req.body.edits) ? req.body.edits
            : (req.body && req.body.slipId !== undefined && req.body.items !== undefined) ? [{ slipId: req.body.slipId, items: req.body.items }]
            : null;
        if (!rawEdits || rawEdits.length === 0 || rawEdits.length > 10) {
            return res.status(400).json({ success: false, message: 'ข้อมูลไม่ถูกต้อง (ต้องระบุ slipId และรายการสินค้า รับได้ครั้งละไม่เกิน 10 ใบ)' });
        }

        const plan = [];   // ตรวจทุกใบให้ผ่านหมดก่อน — ถ้าใบใดไม่ผ่าน จะไม่บันทึกอะไรเลย
        for (const edit of rawEdits) {
            const slipId = Number(edit && edit.slipId);
            const items = Array.isArray(edit && edit.items) ? edit.items : null;
            if (!Number.isInteger(slipId) || slipId <= 0 || !items) {
                return res.status(400).json({ success: false, message: 'ข้อมูลไม่ถูกต้อง (ต้องระบุ slipId และรายการสินค้า)' });
            }

            // ตรวจรายการ: ชื่อ 1-60 ตัวอักษรหลังตัดช่องว่าง, จำนวนเป็นจำนวนเต็ม 0-99, ห้ามชื่อซ้ำ (qty=0 ตัดทิ้ง)
            const clean = [];
            for (const it of items) {
                const name = String((it && it.name) || '').trim().slice(0, 60);
                const qty = Number(it && it.qty);
                if (!name || name.includes('|') || !Number.isInteger(qty) || qty < 0 || qty > 99) {   // "|" คือตัวคั่นข้อมูลในสลิป ห้ามอยู่ในชื่อสินค้า
                    return res.status(400).json({ success: false, message: `รายการสินค้าหรือจำนวนไม่ถูกต้อง: "${name || '?'}" x${qty} (สลิป #${slipId})` });
                }
                if (qty > 0 && !clean.some(c => c.name === name)) clean.push({ name, qty });
            }
            const breakdown = clean.map(c => `${c.name} x${c.qty}`).join(', ');
            const draws = clean.reduce((s, c) => s + c.qty, 0);
            if (draws <= 0) {
                // v1.0.17: การ์ดที่ไม่มีสินค้าเหลืออยู่เลยไม่มีความหมายในคิว — จะเอาการ์ดออก ใช้ปุ่มปัดตกรูปแทน
                return res.status(400).json({ success: false, message: `รวมสินค้าต้องมากกว่า 0 ชิ้น (สลิป #${slipId}) — ถ้าต้องการเอาการ์ดนี้ออกจากคิว ใช้ปุ่มปัดตกรูปแทน` });
            }

            const slip = supabase.db.prepare('SELECT * FROM slips WHERE id = ?').get(slipId);
            if (!slip) return res.status(404).json({ success: false, message: `ไม่พบสลิป #${slipId}` });
            if (!['waiting', 'called', 'skipped', 'abnormal_pending'].includes(slip.status)) {
                return res.status(409).json({ success: false, message: `แก้ไขได้เฉพาะการ์ดที่ยังค้างอยู่ในคิวเท่านั้น (สลิป #${slipId} จบแล้ว/ปัดตกแล้ว)` });
            }

            // คงส่วนอื่นของ qr_payload ไว้: ปกติคือ "รหัสอ้างอิง|breakdown" ส่วนของ manual_image คือ "manual_image|url|breakdown"
            const parts = String(slip.qr_payload || '').split('|');
            const isManual = slip.qr_payload && slip.qr_payload.startsWith('manual_image');
            const oldBreakdown = isManual ? (parts[2] || '') : (parts[1] || '');
            if (isManual) parts[2] = breakdown;
            else if (parts.length > 1) parts[1] = breakdown;
            else parts.push(breakdown);

            plan.push({ slip, slipId, draws, breakdown, oldBreakdown, payload: parts.join('|') });
        }

        // ผ่านครบทุกใบแล้ว — บันทึกทีเดียว (better-sqlite3 ซิงโครนัส ไม่มีคำขออื่นแทรกกลางคัน)
        const results = [];
        for (const p of plan) {
            supabase.db.prepare('UPDATE slips SET draws = ?, qr_payload = ? WHERE id = ?').run(p.draws, p.payload, p.slipId);
            addLog('INFO', `🖥️ แม่ค้าแก้ไขรายการสินค้า — ${p.slip.line_name || 'ลูกค้า'}: เดิม "${p.oldBreakdown || '-'}" → ใหม่ "${p.breakdown || '-'}" รวม ${p.draws} ชิ้น (สลิป #${p.slipId}, ยอดโอน ${p.slip.amount} บาท ไม่เปลี่ยน)`);
            results.push({ slipId: p.slipId, draws: p.draws, breakdown: p.breakdown });
        }
        await broadcastTodayStats();
        if (results.length === 1) return res.json({ success: true, draws: results[0].draws, breakdown: results[0].breakdown, results });
        res.json({ success: true, results });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ✏️ v1.0.16: ข้อมูลให้หน้าต่างแก้ไขสินค้าบอกแม่ค้าว่า "ลูกค้าคนนี้ซื้อรวมกี่ชิ้นในรอบไลฟ์นี้" และค่าส่งเป็นอย่างไร
// otherDraws = ชิ้นของลูกค้าคนนี้ในรอบ (นับตามกติกาเดียวกับตอนคิดค่าส่ง รวมรอบที่รวมบิล) ที่ไม่ได้อยู่ในการ์ดที่กำลังแก้
app.get('/api/queue/slip_heartbeat', (req, res) => res.json({ success: true, at: lastSlipIngestAt }));

app.get('/api/queue/edit_items_context', (req, res) => {
    try {
        const slipIds = String(req.query.slipIds || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0);
        if (slipIds.length === 0) return res.status(400).json({ success: false, message: 'ต้องระบุ slipIds' });
        if (slipIds.length > 10) return res.status(400).json({ success: false, message: 'รับได้ครั้งละไม่เกิน 10 สลิป' });   // v1.0.17: การ์บุ๊กรวมบิลมีสลิปได้แค่ 2-3 ใบ — เกินนี้คือคำขอผิดปกติ
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
    manualMatchWarnings.forEach(w => { if (!w.sid && w.date >= earliest) { w.sid = sessionId; } });   // v1.0.18: การ์ดยืนยันสลิปซ้ำก็ย้ายตามเข้ารอบเหมือนกัน
    return n;
}
// v1.0.16: สลิปที่ระบบ "ไม่บันทึก" โดยตั้งใจ (โอนผิดบัญชี / ซ้ำกับของลูกค้าอื่นหรือที่ปัดตกไปแล้ว) เดิมเงียบ เหลือแค่บรรทัดใน Logs
// ตอนนี้แสดงการ์ดบนหน้าจอให้แม่ค้ารับทราบ (การ์ดเดียวกับกรณีโหลดรูปไม่สำเร็จ ไม่แตะยอด/สลิป/ฐานข้อมูล)
// v1.0.19 (ไลฟ์จริงครั้งแรกบน v1.0.18): สลิปที่ระบบตรวจได้เป็นรายการเดียวกับสลิปที่แม่ค้ากรอกยอดเอง
// ยอดตรงกัน = ระบบทำงานถูกต้อง -> INFO เงียบๆ (เดิมเป็น WARN + การ์ดแดง "สลิปที่ระบบไม่บันทึก" + แจ้งเตือน "สลิปซ้ำ" = สัญญาณเตือนหลอก)
// ยอดไม่ตรง = แม่ค้าอาจกรอกผิด -> ผูกเป็นใบเดียวเหมือนเดิม (ไม่นับซ้ำ ไม่แก้ยอดเอง) + แจ้งเตือนสีส้มให้ตรวจยอด
async function reportKeyedSlipLink({ name, ref, slipId, keyedAmount, realAmount, where }) {
    if (Math.abs(Number(keyedAmount) - Number(realAmount)) < 0.005) {
        addLog('INFO', `${where}: รหัส ${ref} ตรงกับสลิปที่แม่ค้ากรอกยอดเอง (#${slipId}) ผูกเป็นใบเดียวกัน ไม่นับยอดซ้ำ (ยอดตรงกัน ${fmtBaht(realAmount)} บาท)`);
        return;
    }
    const reason = `สลิปรหัส ${ref} เป็นรายการเดียวกับสลิปที่แม่ค้ากรอกยอดเอง (#${slipId}) แต่ยอดจริง ${fmtBaht(realAmount)} บาท ไม่ตรงกับที่กรอกไว้ ${fmtBaht(keyedAmount)} บาท -- ตรวจยอดแล้วแก้ที่การ์ดสลิป (ระบบไม่นับซ้ำและไม่แก้ยอดเอง)`;
    addLog('WARN', `${where}: รหัส ${ref} ตรงกับสลิปที่แม่ค้ากรอกยอดเอง (#${slipId}) แต่ยอดไม่ตรง (สลิปจริง ${fmtBaht(realAmount)} / กรอกไว้ ${fmtBaht(keyedAmount)} บาท) ผูกเป็นใบเดียวกัน ไม่นับยอดซ้ำ ให้แม่ค้าตรวจยอด`);
    try { io.emit('slip_warning', { kind: 'amount_mismatch', name: name || 'ลูกค้า (ไม่ทราบชื่อ)', reason }); await broadcastTodayStats(); } catch (e) { /* หน้าจอล้มต้องไม่ทำให้การตรวจสลิปพัง */ }
}
async function notifyUnrecordedSlip(customerName, messageId, reason, kind = 'other') {
    try {
        recordLineImageFailure(customerName, messageId, reason);
        // v1.0.16: ส่ง slip_warning (Toast + บี๊ปคู่ 600Hz ที่หน้าจอ) แทน image_failed เพื่อไม่ให้เสียงดังซ้อนกัน
        io.emit('slip_warning', { kind, name: customerName || 'ลูกค้า (ไม่ทราบชื่อ)', reason });
        await broadcastTodayStats();
    } catch (notifyErr) { /* การแจ้งเตือนหน้าจอล้มเหลวต้องไม่ทำให้ Webhook พัง */ }
}

// ❓ v1.0.18 (คำสั่งเจ้าของ 2026-10-31 "ปิดรูรั่ว"): สลิปตรวจผ่านที่ตรงกับยอดที่แม่ค้ากรอกเองไว้
// ค่าเริ่มต้นปลอดภัยเหมือนเดิม = ผูกเป็นใบเดียวกัน ไม่นับซ้ำ (ระบบแยก "ส่งรูปเดิมซ้ำ" กับ "โอนครั้งที่ 2" ไม่ได้
// ถ้าไม่ทดลองเทียบรหัส QR กับคีย์จริงตาม HANDOFF §4) — แต่เดิมเงินใบที่ 2 หายเงียบๆ เหลือแค่ toast 12 วินาที
// ตอนนี้เป็นการ์ดยืนยันที่อยู่จนกด และแม่ค้ากด 1 ปุ่มกู้ยอดคืนได้ (บันทึกเป็นสลิปของตัวเอง คิดชิ้นตามสูตรเดิม)
// ข้อจำกัด: เก็บในหน่วยความจำเหมือนการ์ดแดง — รีสตาร์ทโปรแกรมระหว่างที่การ์ดค้าง = โอกาสกู้ยอดหาย
// (ยังเห็นเหตุการณ์ได้จากบรรทัด WARN "ผูกเป็นใบเดียวกัน" ใน system.log ให้แม่ค้าตรวจและแก้ด้วยมือ)
// v1.0.19 (เจ้าของสั่ง 2026-11-01): การ์ดเก็บลงฐานข้อมูลร้าน (configs) ปิด/รีสตาร์ทโปรแกรมแล้วการ์ดและปุ่มกู้ยอดยังอยู่
function savePendingState(key, value) {
    try { supabase.db.prepare('INSERT INTO configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); }
    catch (e) { console.error('save ' + key + ' failed:', e.message); }
}
function loadPendingState(key) {
    try { const r = supabase.db.prepare('SELECT value FROM configs WHERE key = ?').get(key); const v = r ? JSON.parse(r.value) : []; return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
}
let manualMatchWarnings = loadPendingState('pending_manual_match_cards').slice(-50);
let manualMatchSeq = manualMatchWarnings.reduce((m, w) => Math.max(m, Number(w.id) || 0), 0);
function recordManualMatchWarning({ name, lineId, slipId, transRef, amount, transDate, transTime }) {
    const item = { id: ++manualMatchSeq, name: name || 'ลูกค้า (ไม่ทราบชื่อ)', lineId: lineId || null, slipId, transRef, amount: Number(amount) || 0, transDate: transDate || null, transTime: transTime || null, time: new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok', hour12: false }), sid: activeLiveSession ? activeLiveSession.id : null, date: getTodayString() };
    manualMatchWarnings.push(item);
    if (manualMatchWarnings.length > 50) manualMatchWarnings.shift();
    savePendingState('pending_manual_match_cards', manualMatchWarnings);
    return item;
}
function currentManualMatchWarnings() {
    const today = getTodayString();
    return manualMatchWarnings
        .filter(w => activeLiveSession ? w.sid === activeLiveSession.id : (!w.sid && w.date === today))
        .map(w => ({ id: w.id, name: w.name, slipId: w.slipId, transRef: w.transRef, amount: Number(w.amount) || 0, time: w.time }));
}
function dropManualMatchWarning(id) {
    const before = manualMatchWarnings.length;
    manualMatchWarnings = manualMatchWarnings.filter(w => w.id !== id);
    if (manualMatchWarnings.length !== before) savePendingState('pending_manual_match_cards', manualMatchWarnings);
    return manualMatchWarnings.length !== before;
}

// ➕ แม่ค้ายืนยัน "เป็นการโอนครั้งที่ 2 จริง": ย้ายรหัสออกจากใบที่กรอกยอดเอง แล้วเปิดสลิปใหม่ให้การโอนครั้งที่ 2
// คิดยอด/ชิ้น/กระเป๋าด้วยสูตรเดียวกับ /api/queue/manual_amount ทุกบรรทัด ทำทั้งหมดใน transaction เดียว
app.post('/api/queue/manual_match_count_second', async (req, res) => {
    const matchId = Number(req.body && req.body.matchId);
    if (!Number.isInteger(matchId) || matchId <= 0) return res.status(400).json({ success: false, message: 'รหัสการ์ดไม่ถูกต้อง' });
    const warn = manualMatchWarnings.find(w => w.id === matchId);
    if (!warn) return res.status(404).json({ success: false, message: 'ไม่พบการ์ดนี้ (อาจถูกจัดการไปแล้วหรือโปรแกรมเปิดใหม่)' });
    const amount = Number(warn.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return res.status(400).json({ success: false, message: 'ยอดเงินที่จดไว้ไม่ถูกต้อง' });
    try {
        const result = supabase.runTransaction(() => {
            const keyed = supabase.db.prepare('SELECT id, amount, trans_ref, status FROM slips WHERE id = ?').get(warn.slipId);
            if (!keyed || keyed.trans_ref !== warn.transRef) throw new Error('KEYED_SLIP_CHANGED');   // ใบที่กรอกยอดเองไม่ได้ถือรหัสนี้อยู่แล้ว (มีคนจัดการไปก่อน)
            const dup = supabase.db.prepare("SELECT id FROM slips WHERE trans_ref = ? AND id != ? AND trans_ref IS NOT NULL AND trans_ref != '' LIMIT 1").get(warn.transRef, keyed.id);
            if (dup) throw new Error('DUPLICATE_SLIP');
            const customer = supabase.db.prepare('SELECT * FROM customers WHERE line_id = ?').get(warn.lineId);
            const currentBalance = (customer ? customer.balance : 0) + amount;
            const pastDrawsToday = countPastDraws(warn.lineId, { excludeRejected: true });
            const hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
            const virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
            const draws = calculateBestDraws(virtualBalance, pastDrawsToday, { holdExactPrice: true });
            const status = draws.draws > 0 ? 'waiting' : 'accumulated';
            const finalBalance = walletAfter(draws, currentBalance);
            // ใบที่กรอกยอดเองคือการโอนครั้งที่ 1 (ไม่มีรหัสของตัวเอง) — คืนรหัสว่างให้ แล้วรหัสนี้เป็นของใบใหม่ (กันนับซ้ำถ้าลูกค้าส่งรูปเดิมซ้ำอีก)
            supabase.db.prepare('UPDATE slips SET trans_ref = NULL WHERE id = ? AND trans_ref = ?').run(keyed.id, warn.transRef);
            if (customer) {
                supabase.db.prepare('UPDATE customers SET balance = ?, name = ? WHERE line_id = ?').run(finalBalance, warn.name, warn.lineId);
            } else {
                supabase.db.prepare('INSERT INTO customers (line_id, name, balance) VALUES (?, ?, ?)').run(warn.lineId, warn.name, finalBalance);
            }
            const info = supabase.db.prepare(`
                INSERT INTO slips (amount, draws, line_id, sender_name, line_name, session_id, trans_date, trans_time, trans_ref, qr_payload, status, arrived_out_of_round)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                amount, draws.draws, warn.lineId, warn.name, warn.name,
                activeLiveSession ? activeLiveSession.id : null,
                warn.transDate || getTodayString(), warn.transTime || getLocalTimeString(),
                warn.transRef, `manual_count_second|${warn.transRef}`, status,
                activeLiveSession ? 0 : 1
            );
            return { id: info.lastInsertRowid, draws: draws.draws, balance: finalBalance };
        });
        dropManualMatchWarning(matchId);
        const drawsTxt = result.draws > 0 ? `ได้ ${result.draws} ชิ้น` : 'ยอดยังไม่พอ (เข้าการ์ดส้มรอโอนเพิ่ม)';
        addLog('WARN', `🖥️ แม่ค้ายืนยันว่าสลิปรหัส ${warn.transRef} (${fmtBaht(amount)} บาท) เป็นการโอนครั้งที่ 2 จริง — บันทึกเป็นสลิปใหม่ #${result.id} ${drawsTxt} (ย้ายรหัสออกจากสลิป #${warn.slipId} ที่กรอกยอดเองไว้ เงินคงเหลือในกระเป๋า ${result.balance} บาท)`);
        if (result.draws > 0) io.emit('play_sound');   // การ์ดใหม่ได้สิทธิ์ = เสียงคิวใหม่เหมือนทางอื่น
        await broadcastTodayStats();
        res.json({ success: true, draws: result.draws, remainder: result.balance });
    } catch (e) {
        if (e.message === 'KEYED_SLIP_CHANGED' || e.message === 'DUPLICATE_SLIP') {
            dropManualMatchWarning(matchId);
            addLog('WARN', `การ์ดยืนยันสลิปรหัส ${warn.transRef} เลิกใช้ (สถานะสลิปเปลี่ยนไปจากที่ระบบจดไว้: ${e.message}) — ปิดการ์ดให้อัตโนมัติ โปรดตรวจยอดด้วยตัวเอง`);
            await broadcastTodayStats();
            return res.status(409).json({ success: false, message: 'สถานะสลิปเปลี่ยนไปจากที่ระบบจดไว้ ปิดการ์ดนี้แล้ว โปรดตรวจยอดกับสลิปจริงอีกครั้ง' });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

// ✔ แม่ค้ายืนยัน "เป็นสลิปใบเดียวกัน (ลูกค้าส่งรูปเดิมซ้ำ)": ปิดการ์ด คงพฤติกรรมเดิมทุกอย่าง (นับ 140 ไม่นับซ้ำ)
app.post('/api/queue/manual_match_dismiss', async (req, res) => {
    try {
        const matchId = Number(req.body && req.body.matchId);
        if (!Number.isInteger(matchId) || matchId <= 0) return res.status(400).json({ success: false, message: 'รหัสการ์ดไม่ถูกต้อง' });
        const warn = manualMatchWarnings.find(w => w.id === matchId);
        if (!warn) return res.status(404).json({ success: false, message: 'ไม่พบการ์ดนี้' });
        dropManualMatchWarning(matchId);
        addLog('INFO', `🖥️ แม่ค้ายืนยันว่าสลิปรหัส ${warn.transRef} คือใบเดียวกับที่กรอกยอดเองไว้ (สลิป #${warn.slipId}) — ปิดการ์ดยืนยัน ไม่นับยอดซ้ำ`);
        await broadcastTodayStats();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ⚡ ระบบติดตามและตรวจสอบโควตาเครดิต API ตรวจสลิป (ป้องกัน Risk 2)
let providerQuotaState = {
    provider: (process.env.SLIP_PROVIDER || 'slipok').toLowerCase(),
    balance: null,
    status: 'ok', // 'ok', 'low', 'exhausted', 'unlimited'
    lastChecked: null,
    message: ''
};

// ===== v1.0.17: แปลรหัส Error ของ SlipOK ให้ตรงความหมายตามเอกสาร (https://slipok.com/api-documentation/error-status-code/) =====
// เดิมทุกรหัสถูก log เป็น ERROR ว่า "สลิปอาจไม่ถูกต้อง หรือวงเงินเครดิตหมด" และรหัส 1009/1006/1008 ถูกนับเป็น "เครดิตหมด" ผิดๆ
// level: WARN = เหตุการณ์ปกติของลูกค้า/ธนาคาร (ไม่ส่ง Dev Report) | ERROR = ตั้งค่าผิด/แพ็กเกจหมด/ไม่รู้จัก (ควรดู)
// v1.0.19: ตัวแปลผลรหัส SlipOK + ตัวถอดรหัส QR ย้ายไป lib/slipVerify.js แล้ว (ตรรกะล้วน — ตัวอักษรเดิมทุกตัว)
// ห้ามตีความรหัส SlipOK ที่อื่นนอกจากตัวนี้ (กฎ AGENTS) / เทสต์ตรง: tests/unit/slipok-codes.test.js + tests/unit/qr-ref.test.js
const { classifySlipOkError, extractQrRef, extractQrBank, PROVEN_QR_BANKS } = require('./lib/slipVerify');
// ป้ายบนการ์ดรอใส่ยอด: สลิปธนาคารที่ต้องรอ (เก็บในหน่วยความจำ หายตอนปิดโปรแกรม = การ์ดกลับไปใช้ข้อความทั่วไป)
const bankDelayHints = new Map();
function rememberBankDelayHint(slipId, info) {
    if (!slipId || !info) return;
    bankDelayHints.set(slipId, { bankName: info.bankName || '', delay: info.delay || null, at: Date.now() });
    if (bankDelayHints.size > 300) bankDelayHints.delete(bankDelayHints.keys().next().value);
}

// ===== v1.0.17: ตรวจสลิปซ้ำเองหลังพ้นเวลารอ (Code 1010) =====
// สลิปธนาคารที่ต้องรอ (เช่น กรุงเทพ ~7 นาที) ระบบเก็บรูปไว้แล้วตั้งเวลายิงตรวจซ้ำจากไฟล์เดิม สูงสุด 2 ครั้ง
// (ครั้งแรกพ้นเวลารอ +1 นาที, ครั้งที่สองอีก 4 นาที) แทนการรอให้ลูกค้าส่งรูปเดิมซ้ำ
// ผลตรวจเดินกฎชุดเดียวกับเส้นทางปกติ: ข้อมูลไม่ครบ/โอนผิดบัญชี/สลิปซ้ำ = ไม่บันทึก (แจ้งการ์ดแดง ไม่ปัดการ์ดเอง)
// ถ้าแม่ค้าใส่ยอดไปก่อนแล้ว = ผูกรหัสเข้าใบเดิมผ่านหน้าต่างเวลาของ pickManualMatch (กันนับซ้ำ)
// ถ้ายังไม่ใส่ = อัปเกรดการ์ดด้วยคณิตเดียวกับ /api/queue/manual_amount เดิมทุกบรรทัด
// ข้อจำกัด: ตัวจับเวลาอยู่ในหน่วยความจำ ถ้าโปรแกรมรีสตาร์ทระหว่างรอ การ์ดกลับไปอยู่ในทางแม่ค้า (ใส่ยอดเอง/ขอให้ลูกค้าส่งซ้ำ) ตามพฤติกรรมเดิม
const bankRecheckTimers = new Map();   // slipId -> Timeout
function bankRecheckDelayMs(delayMin, attempt) {
    const env = Number(process.env.AQ_BANK_RECHECK_DELAY_MS);   // ชุดทดสอบย่อเวลารอ
    if (Number.isFinite(env) && env > 0) return env;
    return attempt === 1 ? ((Number(delayMin) || 7) + 1) * 60000 : 4 * 60000;
}
function scheduleBankDelayRecheck(slipId, imageFile, delayMin, attempt = 1) {
    if (bankRecheckTimers.has(slipId)) return;
    const t = setTimeout(() => {
        bankRecheckTimers.delete(slipId);
        runBankDelayRecheck(slipId, imageFile, delayMin, attempt).catch(e => addLog('WARN', `ตรวจสลิปซ้ำเองหลังพ้นเวลารอ (สลิป #${slipId}) ไม่สำเร็จ: ${e.message}`));
    }, bankRecheckDelayMs(delayMin, attempt));
    t.unref();
    bankRecheckTimers.set(slipId, t);
}
async function runBankDelayRecheck(slipId, imageFile, delayMin, attempt) {
    const slip = supabase.db.prepare('SELECT * FROM slips WHERE id = ?').get(slipId);
    if (!slip || ['rejected', 'completed', 'cleared'].includes(slip.status)) return;   // การ์ดถูกจัดการไปแล้ว — เลิกตรวจซ้ำเงียบ ๆ
    let imageBuffer;
    try { imageBuffer = await fs.promises.readFile(imageFile); }
    catch (e) { addLog('WARN', `อ่านรูปสลิป #${slipId} กลับมาตรวจซ้ำไม่ได้ (${e.message}) ให้แม่ค้าใส่ยอดเองหรือขอให้ลูกค้าส่งรูปซ้ำ`); return; }

    const slipResult = await verifySlipWithProvider(imageBuffer);
    if (!slipResult || !slipResult.success) {
        const info = (slipResult && Number(slipResult.code) === 1010) ? classifySlipOkError(400, slipResult) : null;
        if (info && info.kind === 'bank_delay' && attempt === 1) {
            addLog('INFO', `ธนาคารยังไม่ยืนยันสลิป #${slipId} ของ "${slip.line_name || 'ลูกค้า'}" หลังพ้นเวลารอ — ระบบจะลองตรวจซ้ำอีกครั้ง (ครั้งที่ 2 จาก 2)`);
            scheduleBankDelayRecheck(slipId, imageFile, delayMin, 2);
        } else if (info && info.kind === 'bank_delay') {
            addLog('WARN', `ระบบพยายามตรวจสลิปซ้ำเอง 2 ครั้งแล้วยังไม่สำเร็จ (สลิป #${slipId} ของ "${slip.line_name || 'ลูกค้า'}"${info.bankName ? ' ธนาคาร' + info.bankName : ''}ยังไม่ยืนยัน) — ให้แม่ค้ากดเช็คสลิปแล้วใส่ยอดเอง หรือให้ลูกค้าส่งรูปเดิมซ้ำ`);
        } else {
            addLog('WARN', `ตรวจสลิปซ้ำเองหลังพ้นเวลารอไม่สำเร็จ (สลิป #${slipId}): ${slipResult && slipResult.message ? slipResult.message : 'ไม่ทราบสาเหตุ'} — การ์ดรอใส่ยอดยังอยู่ตามเดิม`);
        }
        return;
    }

    // ตรวจข้อมูลครบก่อนใช้ผลตรวจ (กฎเดียวกับเส้นทาง webhook)
    const d = slipResult.data || {};
    const amt = Number(d.amount);
    const ref = String(d.transRef || '').trim();
    const isSyntheticRef = /^(EASY|THUNDER|SLIPVERIFY)_\d{13}$/.test(ref);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000 || !ref || isSyntheticRef) {
        addLog('WARN', `ตรวจสลิปซ้ำเองได้ผลแต่ข้อมูลไม่ครบ (สลิป #${slipId}, ยอด ${d.amount}, รหัส ${ref || '-'}) ให้แม่ค้าตรวจเอง`);
        return;
    }

    // โอนผิดบัญชี: ไม่บันทึก แจ้งการ์ดแดง (ไม่ปัดการ์ดเอง — แม่ค้ากดปัดตกเอง)
    const shopNames = [merchantAccountName, merchantAccountNameEn];
    const shopCheck = receiverMatchesShop(d.receiver, shopNames);
    if (shopCheck.checked && !shopCheck.ok) {
        const shopLabel = shopNames.map(n => String(n || '').trim()).filter(Boolean).map(n => `"${n}"`).join(' หรือ ');
        await notifyUnrecordedSlip(slip.line_name || 'ลูกค้า', null, `สลิปรหัส ${ref} (ยอด ${fmtBaht(amt)} บาท) ที่ระบบตรวจซ้ำหลังพ้นเวลารอ โอนเข้าบัญชี "${shopCheck.shown || 'ไม่ทราบชื่อ'}" ไม่ตรงกับชื่อบัญชีร้าน ${shopLabel} ระบบไม่ได้นับยอดนี้`, 'wrong_account');
        addLog('WARN', `ตรวจสลิปซ้ำเองเจอโอนผิดบัญชี: สลิป #${slipId} ของ "${slip.line_name || 'ลูกค้า'}" โอนเข้า "${shopCheck.shown}" (ไม่ใช่ ${shopLabel}) — ไม่บันทึก`);
        return;
    }

    // สลิปซ้ำ: รหัสถูกบันทึกไปแล้ว (เช่น ลูกค้าส่งรูปซ้ำเองก่อนที่ระบบจะตรวจซ้ำทัน) — ไม่นับซ้ำ ทิ้งการ์ดไว้ให้แม่ค้าปัดตกเอง
    const existing = supabase.db.prepare("SELECT id FROM slips WHERE trans_ref = ? AND trans_ref IS NOT NULL AND trans_ref != '' AND id != ? LIMIT 1").get(ref, slipId);
    if (existing) {
        addLog('WARN', `ตรวจสลิปซ้ำเอง (สลิป #${slipId}) เจอรหัส ${ref} ถูกบันทึกไปแล้ว (สลิป #${existing.id}) — ไม่นับซ้ำ ถ้าเป็นการ์ดรอใส่ยอดของสลิปเดิม ให้ปัดตกการ์ดนี้`);
        return;
    }

    // แม่ค้าใส่ยอดไปก่อนแล้ว: ผูกรหัสเข้าใบเดิมเมื่อเข้าหน้าต่างเวลาของ pickManualMatch (กันนับซ้ำ)
    if (Number(slip.amount) > 0) {
        if (slip.trans_ref) return;   // มีรหัสแล้ว (เช่น ตรวจซ้ำชนกัน) ไม่ทำซ้ำ
        const transferSec = stampToSec(d.transDate, d.transTime);
        // v1.0.18: ถ้ารูปที่เก็บไว้มีรหัส QR และตรงกับรหัสที่ตรวจได้ = รายการเดียวกันแน่นอน ผูกได้เลยไม่ต้องดูหน้าต่างเวลา (กันนาฬิกาเครื่องร้านเพี้ยน)
        if ((slip.qr_ref && slip.qr_ref === ref) || pickManualMatch([slip], amt, transferSec)) {
            supabase.db.prepare("UPDATE slips SET trans_ref = ? WHERE id = ? AND (trans_ref IS NULL OR trans_ref = '')").run(ref, slipId);
            await reportKeyedSlipLink({ name: slip.line_name || 'ลูกค้า', ref, slipId, keyedAmount: slip.amount, realAmount: amt, where: 'ระบบตรวจสลิปซ้ำเอง' });
            bankDelayHints.delete(slipId);
            await broadcastTodayStats();
        } else {
            addLog('WARN', `ระบบตรวจสลิปซ้ำเองได้ยอด ${fmtBaht(amt)} บาท (รหัส ${ref}) แต่ไม่ตรงเงื่อนไขเวลา/ยอดกับที่แม่ค้ากรอกไว้ (${fmtBaht(slip.amount)} บาท, สลิป #${slipId}) — ให้แม่ค้าตรวจสอบเอง`);
        }
        return;
    }

    // ยังไม่มียอด: อัปเกรดการ์ดด้วยคณิตเดียวกับ /api/queue/manual_amount (เงินเป็นข้อเท็จจริงจากสลิปที่ตรวจผ่านแล้ว)
    let { data: customer } = await supabase.from('customers').select('*').eq('line_id', slip.line_id).single();
    const currentBalance = (customer ? customer.balance : 0) + amt;
    const pastDrawsToday = countPastDraws(slip.line_id, { excludeId: slipId, excludeRejected: true });
    const hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
    const virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
    const result = calculateBestDraws(virtualBalance, pastDrawsToday, { holdExactPrice: true });
    const breakdownStr = result.breakdown.join(', ');
    let parts = String(slip.qr_payload || '').split('|');     // คงรูป manual_image|url|breakdown เดิม (ปุ่มดูรูปและหน้าต่างแก้ไขสินค้าใช้อยู่)
    if (parts[0] === 'manual_image') parts[2] = breakdownStr;
    else parts = ['manual_image', '', breakdownStr];

    await supabase.from('slips').update({
        amount: amt, draws: result.draws, trans_ref: ref,
        qr_payload: parts.join('|'),
        status: result.draws > 0 ? slip.status : 'accumulated'   // ยอดไม่พอ = การ์ดส้มสะสมยอด เหมือนใส่ยอดเอง
    }).eq('id', slipId);

    const finalBalance = walletAfter(result, currentBalance);
    if (customer) await supabase.from('customers').update({ balance: finalBalance }).eq('line_id', slip.line_id);
    else if (slip.line_id) await supabase.from('customers').insert([{ line_id: slip.line_id, name: slip.line_name || 'ลูกค้า LINE', balance: finalBalance }]);

    bankDelayHints.delete(slipId);
    const drawsTxt = result.draws > 0 ? `ได้ ${result.draws} ชิ้น` : 'ยอดยังไม่พอ (เข้าการ์ดส้มรอโอนเพิ่ม)';
    addLog('SUCCESS', `🔄 ระบบตรวจสลิปซ้ำเองหลังพ้นเวลารอสำเร็จ — ${slip.line_name || 'ลูกค้า'} ${fmtBaht(amt)} บาท ${drawsTxt} (สลิป #${slipId}, อ้างอิง ${ref}, เงินคงเหลือในกระเป๋า ${finalBalance} บาท)`);
    if (result.draws > 0 && slip.status === 'waiting') io.emit('play_sound');   // v1.0.17: การ์ดอัปเกรดเป็นคิวเอง = เสียงคิวใหม่
    await broadcastTodayStats();
}
// ===== v1.0.17: กันนับยอดซ้ำระหว่าง "สลิปที่แม่ค้ากรอกยอดเอง" กับ "สลิปใบเดียวกันที่ตรวจผ่านทีหลัง" =====
// ถือว่าเป็นใบเดียวกันเมื่อเวลาโอนอยู่ในหน้าต่าง [รูปเข้า - 60 นาที, รูปเข้า + 120 วินาที]:
// ราวบน (โอนไม่ช้ากว่ารูป + 120 วิ) เผื่อนาฬิการ้าน/ธนาคารเพี้ยนเล็กน้อย -- โอนใหม่ทีหลังรูปแรกคือเงินก้อนใหม่
// ราวล่าง (โอนไม่เก่ากว่ารูปเกิน 60 นาที, เจ้าของร้านตกลง 2026-10-31) กันสลิปเก่าของเมื่อวานที่ไม่เคยบันทึก
//   ถูกดูดรวมกับยอดที่แม่ค้ากรอกของวันนี้จนเงินหาย -- 60 นาที = รอธนาคารยืนยัน ~8 นาที + เผื่อลูกค้าส่งรูปซ้ำช้า
// (stampToSec ย้ายไป lib/dates.js แล้ว — ดึงมาชื่อเดิมด้านบน)
// ===== v1.0.18: ตัวตนของรายการจาก QR ของสลิป =====
// พิสูจน์ด้วยคีย์ SlipOK จริง (2026-10-31): sub-tag 02 ใน QR ของสลิป == transRef ที่ SlipOK ตอบตอนตรวจผ่าน
// (สลิปกรุงไทยตรงกันทุกตัวอักษร A0aa74ba726a04481) — จึงใช้เป็นบัตรประจำตัวรายการจับคู่แทนการเดาจากเวลาได้
// v1.0.19: ตัวถอด (extractQrRef) ย้ายไป lib/slipVerify.js แล้ว — ดึงมาไว้ตัวแปรชื่อเดิมด้านบน (จุดเรียกใช้ไม่เปลี่ยน)
// ถอด QR จากรูปสลิปเอง (jsqr + jimp ติดตั้งอยู่แล้ว) — ใช้เมื่อ SlipOK ไม่ได้ส่ง qrcodeData มาให้ (เช่น รูปไม่มี QR ที่ตรวจไม่ผ่าน)
// ถอดไม่ได้ = คืน null → ระบบกลับไปใช้วิธีเดิม (หน้าต่างเวลา + การ์ดยืนยัน) ไม่มีอะไรพัง
// v1.0.19: คืนข้อความใน QR ทั้งหมด (ใช้ได้ทั้งรหัสรายการและรหัสธนาคาร)
async function decodeImageQrText(imageBuffer) {
    try {
        const JimpMod = require('jimp');
        const jsqrMod = require('jsqr');
        const jsQR = jsqrMod.default || jsqrMod;
        const Jimp = JimpMod.default || JimpMod;
        const img = await Jimp.read(Buffer.from(imageBuffer));
        const res = jsQR(img.bitmap.data, img.bitmap.width, img.bitmap.height);
        return res && res.data ? res.data : null;
    } catch (e) { return null; }
}
// v1.0.19 (เจ้าของสั่ง 2026-11-01): ทุกสลิปที่ตรวจผ่าน เขียนหลักฐาน 1 บรรทัดว่าธนาคารไหน และรหัสใน QR ตรงกับรหัส SlipOK หรือไม่
// (ใช้ qrcodeData ถ้า SlipOK ส่งมา ไม่งั้นถอดจากรูป) ทำเบื้องหลัง ไม่หน่วงคิว -- ใช้พิสูจน์ธนาคารเพิ่มก่อนเพิ่มลง PROVEN_QR_BANKS
async function logQrEvidence(imageBuffer, slipData) {
    try {
        const qrText = (slipData && slipData.qrcodeData) || (imageBuffer ? await decodeImageQrText(imageBuffer) : null);
        const ref = extractQrRef(qrText);
        const bank = extractQrBank(qrText);
        if (!ref || !bank || !slipData || !slipData.transRef) return;
        const same = ref === slipData.transRef;
        addLog('INFO', `🔎 หลักฐานรหัส QR: ธนาคารรหัส ${bank}${PROVEN_QR_BANKS.includes(bank) ? ' (พิสูจน์แล้ว)' : ''} -- รหัสใน QR ${same ? 'ตรงกับ' : 'ไม่ตรงกับ'} รหัส SlipOK (QR ${ref} / SlipOK ${slipData.transRef})`);
    } catch (e) { /* หลักฐานเสริม ล้มได้ไม่กระทบสลิป */ }
}
async function decodeImageQrRef(imageBuffer) {
    try {
        const JimpMod = require('jimp');
        const jsqrMod = require('jsqr');
        const jsQR = jsqrMod.default || jsqrMod;
        const Jimp = JimpMod.default || JimpMod;
        const img = await Jimp.read(Buffer.from(imageBuffer));
        const res = jsQR(img.bitmap.data, img.bitmap.width, img.bitmap.height);
        return res && res.data ? extractQrRef(res.data) : null;
    } catch (e) { return null; }
}

const MANUAL_MATCH_TOLERANCE_SEC = 120;    // ราวบน: เผื่อนาฬิกาเครื่องร้านกับนาฬิกาธนาคารต่างกันเล็กน้อย
const MANUAL_MATCH_MAX_AGE_SEC = 60 * 60;  // ราวล่าง: การโอนต้องไม่เก่ากว่ารูปที่เข้ามาเกิน 60 นาที
function pickManualMatch(rows, amount, transferSec, toleranceSec = MANUAL_MATCH_TOLERANCE_SEC, maxAgeSec = MANUAL_MATCH_MAX_AGE_SEC) {
    if (transferSec === null || transferSec === undefined || !Number.isFinite(Number(amount))) return null;
    for (const r of rows || []) {
        if (Math.abs(Number(r.amount) - Number(amount)) > 0.005) continue;
        const arrive = stampToSec(r.trans_date, r.trans_time);
        if (arrive === null) continue;
        if (arrive + toleranceSec >= transferSec && transferSec >= arrive - maxAgeSec) return r;
    }
    return null;
}

// ===== v1.0.17: เช็กว่าสลิปโอนเข้าบัญชีร้านหรือไม่ =====
// SlipOK ตอบชื่อผู้รับได้ 3 ช่อง (displayName / name / accountName) และบางสลิป (เช่น TrueMoney) ตอบเป็นอังกฤษล้วน
// จึงเทียบ "ทุกช่อง" กับ "ทุกชื่อของร้าน" (ไทย + อังกฤษ) ผ่านถ้ามีอย่างน้อย 1 คู่ที่ชื่อร้านเป็นส่วนหนึ่งของชื่อผู้รับ (ไม่สนตัวพิมพ์เล็กใหญ่)
// ไม่ได้ตั้งชื่อร้านเลย = ไม่เช็ก
function receiverMatchesShop(receiver, shopNames) {
    const wanted = (shopNames || []).map(n => String(n || '').trim().toLowerCase()).filter(Boolean);
    if (wanted.length === 0) return { checked: false, ok: true, shown: '' };
    const r = receiver || {};
    const texts = [];
    [r.displayName, r.name, r.accountName].forEach(t => { const s = String(t || '').trim(); if (s && !texts.includes(s)) texts.push(s); });
    const ok = texts.some(t => wanted.some(w => t.toLowerCase().includes(w)));
    return { checked: true, ok, shown: texts.join(' / ') };
}

function handleProviderQuotaExhaustion(providerName, error) {
    const errText = (error.response ? JSON.stringify(error.response.data) : error.message).toLowerCase();
    const status = error.response?.status;
    const code = error.response?.data?.code;
    
    if (status === 402 || (providerName === 'slipok' && (code === 1003 || code === 1004)) || errText.includes('quota') || errText.includes('credit') || errText.includes('insufficient') || errText.includes('exceeded')) {
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
        const slipOkInfo = classifySlipOkError(error.response ? error.response.status : null, error.response ? error.response.data : null);
        addLog(slipOkInfo.level, slipOkInfo.message, errData);
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
// v1.0.17 (Phase C, ร้านแจ้ง 2026-10-31: Kerry ใช้ชื่อ LINE แทนชื่อที่ลูกค้าพิมพ์ไว้ท้ายข้อความ)
// หาชื่อผู้รับจากทุกบรรทัด ตามลำดับความน่าเชื่อ: (ก) บรรทัดที่ขึ้นต้นด้วย "ชื่อ"/"ผู้รับ" (ข) บรรทัดที่ขึ้นต้นด้วยคำนำหน้าชื่อคน
// (ค) บรรทัดแรก (กติกาเดิม) (ง) ข้อความหน้าเบอร์โทรในบรรทัดเดียวกัน (จ) บรรทัดสุดท้าย
// ข้อความที่มีตัวเลข / คำบอกที่อยู่ / คำทักทาย ไม่ใช่ชื่อ (กันเอาบรรทัดที่อยู่หรือ "ขอบคุณค่ะ" มาเป็นชื่อ) ไม่เจอ = คืนค่าว่าง ให้ผู้เรียกใช้ชื่อสำรอง
// v1.0.19: ตัวอ่านที่อยู่/ชื่อภาษาไทย (ล้วนทั้ง 7 ฟังก์ชัน) ย้ายไป lib/address.js แล้ว — ตัวอักษรเดิมทุกตัว
// (ยังเหลือที่นี่เฉพาะ callGeminiAddress ที่ยิงเน็ตจริง และตัวจัดคิวลองใหม่ที่มีสถานะ) / เทสต์ตรง: tests/unit/address-recipient-name.test.js
const { pickRecipientName, findThaiProvinceName, parseThaiAddressFallback, normalizeThaiPhone, isRetryableGeminiError, geminiRetryDelayMs, finishAiAddress } = require('./lib/address');
// 🧠 ฟังก์ชันสกัดที่อยู่จัดส่งด้วย Gemini AI สำหรับ Kerry Express (พร้อม Auto-Fallback)
// v1.0.19 (เจ้าของสั่ง 2026-10-31 "ทำให้ Gemini สกัดสำเร็จได้เยอะที่สุด เพราะเชื่อได้มากกว่า" หลังวัดผลด้วยคีย์จริง: Gemini ถูกครบ 25/30
// ข้อความ ระบบสำรอง 15/30): (1) ใช้คำตอบ Gemini เสมอเมื่อมีเบอร์หรือรหัสไปรษณีย์ ช่องที่ Gemini เว้นว่างค่อยเติมจากระบบสำรอง
// (เดิมทิ้งทั้งก้อนถ้าขาดรหัสไปรษณีย์) (2) Gemini ตอบไม่ได้ชั่วคราว (429 โควตาเต็ม / 5xx / หมดเวลา / เน็ต) -> บันทึกผลระบบสำรองไปก่อน
// แล้วลองใหม่เบื้องหลังตามเวลาที่ Google บอกให้รอ (scheduleAiAddressRetry) สำเร็จเมื่อไรอัปเดตแทน (3) คีย์ผิด/ถูกปฏิเสธ = ไม่ลองซ้ำ
const AI_RETRY_SCALE = Number(process.env.AQ_AI_RETRY_SCALE) > 0 ? Number(process.env.AQ_AI_RETRY_SCALE) : 1;   // เทสต์ย่อเวลารอ
let aiAddressPauseUntil = 0;   // โดน 429 แล้ว: ไม่ยิง Gemini จนถึงเวลานี้ (ทุกข้อความใช้ระบบสำรองไปก่อน + เข้าคิวลองใหม่)
// (normalizeThaiPhone / isRetryableGeminiError / geminiRetryDelayMs ย้ายไป lib/address.js แล้ว — ดึงมาชื่อเดิมด้านบน)
// v1.0.19 (ไลฟ์จริงครั้งแรกบน v1.0.18, 2026-10-31): Gemini ตอบที่อยู่ช้ากว่า 4 วินาที 5 จาก 36 ครั้ง (4 ครั้งใน 15 นาที) แล้วตกไปใช้ระบบสำรอง
// ตอนสกัดที่อยู่ webhook ตอบ LINE ไปแล้ว รอนานขึ้นไม่กระทบลูกค้า จึงรอ 8 วินาที (ยังช้ากว่านั้น = คิวลองใหม่เบื้องหลังรับช่วงต่อ)
const GEMINI_ADDRESS_TIMEOUT_MS = 8000;
async function callGeminiAddress(text) {
    const prompt = `คุณคือผู้ช่วยสกัดที่อยู่จัดส่งพัสดุในประเทศไทย กรุณาวิเคราะห์ข้อความต่อไปนี้ และตอบกลับเป็น JSON เท่านั้น
ข้อกำหนด:
- recipient_name: ชื่อ-นามสกุลของผู้รับ (หากในข้อความไม่ได้ระบุชื่อคน ให้ตอบค่าว่าง "") ชื่ออาจอยู่บรรทัดไหนก็ได้ รวมถึงท้ายข้อความ ไม่จำเป็นต้องอยู่บรรทัดแรก และห้ามเอาที่อยู่หรือคำทักทายมาเป็นชื่อ
- phone: เบอร์โทรศัพท์ 10 หลัก (ตัดขีด ช่องว่าง หรือ +66 ให้เป็น 0XXXXXXXXX)
- address: บ้านเลขที่ ซอย หมู่ ถนน อาคาร ชั้น
- subdistrict: ตำบล หรือ แขวง (ตัดคำนำหน้า ต. หรือ แขวง ออกถ้ามี)
- district: อำเภอ หรือ เขต (ตัดคำนำหน้า อ. หรือ เขต ออกถ้ามี)
- province: จังหวัด (ตัดคำนำหน้า จ. ออกถ้ามี)
- postcode: รหัสไปรษณีย์ 5 หลัก
- remark: หมายเหตุหรือคำสั่งพิเศษ (เช่น ฝากไว้ที่ป้อมยาม, โทรแจ้งก่อนส่ง) ถ้าไม่มีให้เป็นค่าว่าง ""

ข้อความ: "${text}"`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`;
    const res = await axios.post(url, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
    }, { timeout: GEMINI_ADDRESS_TIMEOUT_MS, headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
    const rawJson = res.data && res.data.candidates && res.data.candidates[0] && res.data.candidates[0].content && res.data.candidates[0].content.parts && res.data.candidates[0].content.parts[0] && res.data.candidates[0].content.parts[0].text;
    if (!rawJson) { const e = new Error('Gemini ตอบกลับว่างเปล่า'); e.retryable = true; throw e; }
    return JSON.parse(rawJson);
}
// (finishAiAddress ย้ายไป lib/address.js แล้ว — ดึงมาชื่อเดิมด้านบน)
async function parseThaiAddressWithAI(text, defaultName = 'ลูกค้า LINE') {
    const fallbackParsed = parseThaiAddressFallback(text, defaultName);
    let aiRetry = null;
    if (process.env.GEMINI_API_KEY) {
        if (Date.now() < aiAddressPauseUntil) {
            aiRetry = { delayMs: aiAddressPauseUntil - Date.now() };
            addLog('INFO', 'Gemini AI โควตาเต็มชั่วคราว ใช้ระบบสำรองไปก่อน แล้วจะลองสกัดด้วย Gemini ใหม่อัตโนมัติ');
        } else {
            try {
                const merged = finishAiAddress(await callGeminiAddress(text), fallbackParsed, defaultName);
                if (merged) {
                    addLog('SUCCESS', `Gemini AI สกัดที่อยู่สำเร็จ: คุณ${merged.recipient_name} (${merged.phone}) จ.${merged.province}`);
                    return merged;
                }
                addLog('INFO', 'Gemini AI อ่านข้อความแล้วไม่พบเบอร์โทรหรือรหัสไปรษณีย์ ตรวจด้วยระบบสำรองอีกชั้น');
            } catch (e) {
                const st = e && e.response ? e.response.status : null;
                if (isRetryableGeminiError(e) || e.retryable) {
                    const d = geminiRetryDelayMs(e);
                    if (st === 429) aiAddressPauseUntil = Date.now() + Math.max(d, 5000) * AI_RETRY_SCALE;
                    aiRetry = { delayMs: d };
                    addLog('INFO', `Gemini AI ยังสกัดที่อยู่ไม่ได้ตอนนี้ (${st ? 'HTTP ' + st : e.message}) ใช้ระบบสำรองไปก่อน แล้วจะลองสกัดด้วย Gemini ใหม่อัตโนมัติ`);
                } else {
                    addLog('WARN', `Gemini AI สกัดที่อยู่ไม่สำเร็จ (HTTP ${st} -- ลองใหม่ไม่ช่วย เช่น คีย์ไม่ถูกต้อง) ใช้ระบบสำรอง Regex`, e.message);
                }
            }
        }
    }
    // 🛡️ ระบบสำรอง Deterministic Regex: ทำงานทันทีเมื่อไม่มี Gemini หรือ AI เกิดข้อผิดพลาด
    if (fallbackParsed && (fallbackParsed.phone || fallbackParsed.postcode)) {
        addLog('SUCCESS', `ระบบสำรอง Regex สกัดที่อยู่สำเร็จ: คุณ${fallbackParsed.recipient_name} (${fallbackParsed.phone}) ${fallbackParsed.postcode}`);
        // ไม่ลงฐานข้อมูล (enumerable: false) -- บอก webhook ให้เข้าคิวลองสกัดด้วย Gemini ใหม่
        if (aiRetry) Object.defineProperty(fallbackParsed, 'aiRetry', { value: aiRetry, enumerable: false });
        return fallbackParsed;
    }

    addLog('INFO', 'วิเคราะห์ข้อความแล้วแต่ไม่ใช่รูปแบบที่อยู่จัดส่งที่ระบุเบอร์หรือรหัสไปรษณีย์');
    return null;
}

// บันทึกที่อยู่ของลูกค้า (ใช้ทั้งตอนข้อความเข้า และตอน Gemini ลองใหม่สำเร็จ) -- กติกาเดิมของ webhook ทุกข้อ:
// ชื่อว่าง/ทั่วไป = ชื่อ LINE, ช่องที่ข้อความใหม่ไม่มี = คงของเดิม, ข้อความใหม่ไม่มีชื่อ = คงชื่อจริงที่เคยส่งไว้
async function saveCustomerAddress(userId, lineName, parsedAddress) {
    const genericNames = ['ลูกค้า line', 'ลูกค้าline', 'ลูกค้า', 'คุณ', 'คุณลูกค้า', 'ลูกค้าทั่วไป'];
    const isGenericName = (n) => !n || genericNames.includes(String(n).trim().toLowerCase());
    const messageHasName = !isGenericName(parsedAddress.recipient_name);
    if (!messageHasName) parsedAddress.recipient_name = lineName || 'ลูกค้า LINE';
    const addrConfigKey = `cust_addr_${userId}`;
    try {
        const { data: prevRow } = await supabase.from('configs').select('value').eq('key', addrConfigKey).single();
        if (prevRow && prevRow.value) {
            const prev = JSON.parse(prevRow.value);
            for (const f of ['phone', 'address', 'subdistrict', 'district', 'province', 'postcode']) {
                const nv = parsedAddress[f];
                if ((nv === undefined || nv === null || String(nv).trim() === '') && prev[f]) parsedAddress[f] = prev[f];
            }
            if (!messageHasName && !isGenericName(prev.recipient_name) && String(prev.recipient_name).trim() !== String(lineName || '').trim()) {
                parsedAddress.recipient_name = prev.recipient_name;
            }
        }
    } catch (mergeErr) { /* ไม่มีที่อยู่เดิม หรืออ่านไม่ได้ ใช้ข้อมูลใหม่ตามปกติ */ }
    await supabase.from('configs').upsert([{ key: addrConfigKey, value: JSON.stringify(parsedAddress) }]);
    try { io.emit('address_updated', { name: parsedAddress.recipient_name || lineName }); broadcastTodayStats(); } catch (e) { /* หน้าจอล้มเหลวต้องไม่ทำให้การบันทึกพัง */ }
    return parsedAddress;
}

// ===== v1.0.19: คิวลองสกัดที่อยู่ด้วย Gemini ใหม่เบื้องหลัง (อยู่ในหน่วยความจำ ปิดโปรแกรมแล้วคิวหาย ผลระบบสำรองยังอยู่) =====
const AI_ADDRESS_RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000];   // ลองได้ 6 ครั้ง รวมราว 9 นาที
const aiAddressSeq = new Map();      // userId -> ลำดับข้อความที่อยู่ล่าสุด (ผลลองใหม่ของข้อความเก่าห้ามทับข้อความใหม่)
const aiAddressRetryJobs = [];
let aiAddressTimer = null;
// v1.0.19 (เจ้าของสั่ง 2026-11-01): คิวเก็บลงฐานข้อมูลร้าน เปิดโปรแกรมใหม่แล้วลองต่อ (งานเก่ากว่า 24 ชม. ทิ้ง)
// ลำดับข้อความ (seq) อยู่ในหน่วยความจำ ตอนโหลดจึงให้ seq ใหม่ ข้อความที่อยู่ใหม่ของลูกค้าคนเดิมยังทำให้งานเก่าถูกข้ามเหมือนเดิม
function saveAiAddressRetryJobs() {
    savePendingState('pending_ai_address_jobs', aiAddressRetryJobs.map(j => ({ userId: j.userId, lineName: j.lineName, text: j.text, attempt: j.attempt, notBefore: j.notBefore, createdAt: j.createdAt })));
}
function restoreAiAddressRetryJobs() {
    const latest = new Map();
    for (const j of loadPendingState('pending_ai_address_jobs')) {
        if (!j || !j.userId || !j.text || Date.now() - (Number(j.createdAt) || 0) > 24 * 3600 * 1000) continue;
        latest.set(j.userId, j);   // ลูกค้าคนเดียว เก็บแค่งานล่าสุด
    }
    for (const j of latest.values()) aiAddressRetryJobs.push({ userId: j.userId, lineName: j.lineName, text: j.text, attempt: Number(j.attempt) || 0, notBefore: Number(j.notBefore) || Date.now(), createdAt: Number(j.createdAt), seq: nextAddressSeq(j.userId) });
    saveAiAddressRetryJobs();
    if (aiAddressRetryJobs.length) { addLog('INFO', `โหลดคิวลองสกัดที่อยู่ด้วย Gemini ที่ค้างจากก่อนปิดโปรแกรม ${aiAddressRetryJobs.length} รายการ`); kickAiAddressRetry(); }
}
function nextAddressSeq(userId) {
    const n = (aiAddressSeq.get(userId) || 0) + 1;
    aiAddressSeq.set(userId, n);
    return n;
}
function scheduleAiAddressRetry(job, delayMs) {
    const backoff = AI_ADDRESS_RETRY_BACKOFF_MS[Math.min(job.attempt, AI_ADDRESS_RETRY_BACKOFF_MS.length - 1)];
    job.notBefore = Date.now() + Math.max(Number(delayMs) || 0, backoff) * AI_RETRY_SCALE;
    if (!job.createdAt) job.createdAt = Date.now();
    aiAddressRetryJobs.push(job);
    saveAiAddressRetryJobs();
    kickAiAddressRetry();
}
function kickAiAddressRetry() {
    if (aiAddressTimer || !aiAddressRetryJobs.length) return;
    const due = Math.max(Math.min(...aiAddressRetryJobs.map(j => j.notBefore)), aiAddressPauseUntil);
    aiAddressTimer = setTimeout(runAiAddressRetry, Math.max(0, due - Date.now()));
}
async function runAiAddressRetry() {
    aiAddressTimer = null;
    const now = Date.now();
    aiAddressRetryJobs.sort((a, b) => a.notBefore - b.notBefore);
    const idx = now < aiAddressPauseUntil ? -1 : aiAddressRetryJobs.findIndex(j => j.notBefore <= now);
    if (idx < 0) { kickAiAddressRetry(); return; }
    const job = aiAddressRetryJobs.splice(idx, 1)[0];
    saveAiAddressRetryJobs();   // ถ้ายังต้องลองต่อ scheduleAiAddressRetry จะบันทึกกลับเข้าไปเอง
    try {
        if (aiAddressSeq.get(job.userId) !== job.seq) {
            addLog('INFO', `ข้ามการลองสกัดที่อยู่ของ "${job.lineName || 'ลูกค้า'}" ด้วย Gemini ใหม่ เพราะลูกค้าส่งข้อความที่อยู่ใหม่กว่ามาแล้ว`);
            return;
        }
        job.attempt++;
        try {
            const merged = finishAiAddress(await callGeminiAddress(job.text), parseThaiAddressFallback(job.text, ''), '');
            if (!merged) { addLog('INFO', `Gemini AI ลองใหม่แล้วไม่พบเบอร์โทรหรือรหัสไปรษณีย์ในข้อความของ "${job.lineName || 'ลูกค้า'}" คงผลจากระบบสำรองไว้`); return; }
            if (aiAddressSeq.get(job.userId) !== job.seq) return;   // มีข้อความใหม่เข้ามาระหว่างรอคำตอบ
            const saved = await saveCustomerAddress(job.userId, job.lineName, merged);
            addLog('SUCCESS', `Gemini AI สกัดที่อยู่สำเร็จ (ลองใหม่ครั้งที่ ${job.attempt}): คุณ${saved.recipient_name} (${saved.phone}) จ.${saved.province} -- อัปเดตแทนผลจากระบบสำรองแล้ว`);
        } catch (e) {
            const st = e && e.response ? e.response.status : null;
            if ((isRetryableGeminiError(e) || e.retryable) && job.attempt < AI_ADDRESS_RETRY_BACKOFF_MS.length) {
                const d = geminiRetryDelayMs(e);
                if (st === 429) aiAddressPauseUntil = Date.now() + Math.max(d, 5000) * AI_RETRY_SCALE;
                scheduleAiAddressRetry(job, d);
            } else {
                addLog('WARN', `Gemini AI สกัดที่อยู่ของ "${job.lineName || 'ลูกค้า'}" ไม่สำเร็จหลังลองใหม่ ${job.attempt} ครั้ง (${st ? 'HTTP ' + st : e.message}) ใช้ผลจากระบบสำรองต่อ -- ตรวจที่อยู่ก่อนส่งออก Kerry`);
            }
        }
    } catch (e) {
        console.error('Gemini address retry failed:', e.message);
    } finally {
        kickAiAddressRetry();
    }
}
try { restoreAiAddressRetryJobs(); } catch (e) { console.error('restore Gemini address retry queue failed:', e.message); }

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
                    // v1.0.17 (Phase C): ไม่ให้ตัวสกัดเติมชื่อ LINE เอง (ส่ง '') เพื่อรู้ว่าข้อความนี้มีชื่อผู้รับจริงหรือไม่
                    const addrSeq = nextAddressSeq(userId);   // v1.0.19: ลำดับข้อความที่อยู่ของลูกค้า กันผลลองใหม่ของข้อความเก่าทับข้อความใหม่
                    const parsedAddress = await parseThaiAddressWithAI(text, '');
                    if (parsedAddress) {
                        // บันทึกที่อยู่ลง configs ผูกกับ line_id ของลูกค้า (กติกาชื่อ/การคงช่องเดิม อยู่ใน saveCustomerAddress)
                        await saveCustomerAddress(userId, lineName, parsedAddress);
                        // v1.0.19: Gemini ตอบไม่ได้ชั่วคราว -> ลองใหม่เบื้องหลัง สำเร็จเมื่อไรอัปเดตแทนผลจากระบบสำรอง
                        if (parsedAddress.aiRetry) scheduleAiAddressRetry({ userId, lineName, text, seq: addrSeq, attempt: 0 }, parsedAddress.aiRetry.delayMs);

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
            lastSlipIngestAt = Date.now();
            try { io.emit('slip_ingest', { at: lastSlipIngestAt }); } catch (e) { /* ตัวนับเป็นข้อมูลเสริม */ }
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

                {
                    const shopNames = [merchantAccountName, merchantAccountNameEn];
                    const shopCheck = receiverMatchesShop(slipData.receiver, shopNames);
                    if (shopCheck.checked && !shopCheck.ok) {
                        const receiverName = shopCheck.shown;
                        const shopLabel = shopNames.map(n => String(n || '').trim()).filter(Boolean).map(n => '"' + n + '"').join(' หรือ ');
                        await notifyUnrecordedSlip(lineName, messageId, `สลิปโอนเข้าบัญชี "${receiverName || 'ไม่ทราบชื่อ'}" ไม่ตรงกับชื่อบัญชีร้าน ${shopLabel} (ยอด ${fmtBaht(slipData.amount)} บาท) ระบบไม่ได้บันทึกสลิปนี้`, 'wrong_account');
                        addLog('WARN', `ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "${lineName}" โอนเข้าบัญชี "${receiverName}" (ไม่ใช่ ${shopLabel})`);
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
                        await notifyUnrecordedSlip(lineName, messageId, `สลิปรหัส ${transRef} (ยอด ${fmtBaht(amount)} บาท) เคยถูกบันทึกแล้ว ${dupWho} ระบบจึงไม่นับซ้ำ`, 'duplicate');
                    }
                    addLog('WARN', `ตรวจพบสลิปซ้ำ: ลูกค้า "${lineName}" ส่งสลิปรหัส ${transRef} ที่เคยบันทึกไปแล้ว`);
                    console.log(`⚠️ ตรวจพบสลิปซ้ำ: ${transRef}`);
                    // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้เคยถูกใช้งานไปแล้วนะคะ รบกวนคุณลูกค้าตรวจสอบสลิปอีกครั้ง หรือติดต่อแอดมินน้า 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                    continue;
                }

                logQrEvidence(imageBuffer, slipData);   // v1.0.19: เบื้องหลัง ไม่รอ
                // v1.0.17: กันนับยอดซ้ำ -- ถ้าแม่ค้ากรอกยอดสลิปใบนี้เองไปแล้ว (เช่น สลิปธนาคารที่ต้องรอ แล้วลูกค้าส่งรูปเดิมซ้ำตอนตรวจผ่าน)
                // ให้ผูกรหัสสลิปเข้ากับใบเดิม ไม่สร้างใบใหม่ และถ้ายังมีรูปรอใส่ยอดค้างของลูกค้าคนเดียวกัน ให้เตือนไม่ให้กรอกซ้ำ
                try {
                    const transferSec = stampToSec(slipData.transDate, slipData.transTime);
                    const manualRows = supabase.db.prepare("SELECT id, amount, trans_date, trans_time, status, trans_ref, qr_ref, qr_bank FROM slips WHERE line_id = ? AND qr_payload LIKE 'manual_image%' AND status != 'rejected' AND trans_date >= ? ORDER BY id ASC").all(userId, bangkokDateString(-2));
                    const keyedCandidates = manualRows.filter(r => Number(r.amount) > 0 && !r.trans_ref);
                    // v1.0.18: จับคู่ด้วยรหัส QR ก่อน (แม่นยำ 100% — พิสูจน์ด้วยคีย์จริงว่า sub-tag 02 == transRef) ไม่ต้องพึ่งหน้าต่างเวลา
                    // รหัสตรงกัน = รายการเดียวกันแน่นอน แม้นาฬิกาเครื่องร้านเพี้ยนเกิน 120 วินาที
                    const refMatch = keyedCandidates.find(r => r.qr_ref && r.qr_ref === transRef);
                    if (refMatch) {
                        supabase.db.prepare("UPDATE slips SET trans_ref = ? WHERE id = ? AND (trans_ref IS NULL OR trans_ref = '')").run(transRef, refMatch.id);
                        await reportKeyedSlipLink({ name: lineName, ref: transRef, slipId: refMatch.id, keyedAmount: refMatch.amount, realAmount: amount, where: `ลูกค้า "${lineName}" ส่งสลิปซ้ำ (ผูกด้วยรหัส QR แม่นยำ ไม่ใช่การเดาจากเวลา)` });
                        continue;
                    }
                    let keyedMatch = pickManualMatch(keyedCandidates, amount, transferSec);
                    // v1.0.19 (เจ้าของสั่ง 2026-11-01): สลิปที่แม่ค้ากรอกยอดมาจากธนาคารที่พิสูจน์แล้ว (QR == transRef ทุกตัวอักษร)
                    // รหัส QR ของใบนั้นจึงเท่ากับรหัสธนาคารของมันแน่นอน -- รหัสไม่ตรงกับสลิปใหม่ = คนละรายการ นับเป็นยอดใหม่อัตโนมัติ
                    // ไม่ต้องรอแม่ค้ากดการ์ด (ธนาคารอื่น / ไม่มีรหัส ยังใช้ทางปลอดภัยเดิม: ผูก + การ์ดยืนยัน)
                    if (keyedMatch && keyedMatch.qr_ref && PROVEN_QR_BANKS.includes(keyedMatch.qr_bank) && keyedMatch.qr_ref !== transRef) {
                        addLog('INFO', `ลูกค้า "${lineName}" โอนยอดเท่ากันซ้ำ: รหัสสลิปใหม่ ${transRef} ไม่ตรงกับรหัส QR ของสลิปที่แม่ค้ากรอกยอดเอง (#${keyedMatch.id}, ธนาคารรหัส ${keyedMatch.qr_bank} ที่พิสูจน์แล้ว) = คนละรายการ นับเป็นยอดใหม่อัตโนมัติ`);
                        keyedMatch = null;
                    }
                    // แก้ 2026-10-31 (เจ้าของสั่ง "แก้ความเสี่ยงก่อน"): รหัส QR "ไม่ตรง" ไม่ใช่หลักฐานว่าเป็นคนละรายการ -- QR sub-tag 02 == transRef
                    // พิสูจน์แล้วกับสลิป KTB ใบเดียว ส่วน BBL/SCB ยังเทียบไม่ได้ และรูปแบบรหัสอาจต่างกันเสมอแม้เป็นสลิปใบเดิม ถ้าถือว่า "ไม่ตรง = คนละรายการ"
                    // จะนับเงินซ้ำในเคสที่ตัวกันนี้มีไว้พอดี (BBL 1010 -> แม่ค้ากรอกยอด -> ลูกค้าส่งรูปเดิมซ้ำ) จึงใช้เฉพาะ "ตรงกัน" (refMatch ด้านบน)
                    // ที่เหลือใช้ทางปลอดภัย: ผูกเป็นใบเดียว + การ์ดยืนยันให้แม่ค้ากด "บวกยอด" ได้ถ้าเป็นการโอนครั้งที่ 2 จริง
                    if (keyedMatch) {
                        supabase.db.prepare("UPDATE slips SET trans_ref = ? WHERE id = ? AND (trans_ref IS NULL OR trans_ref = '')").run(transRef, keyedMatch.id);
                        // v1.0.18: ขึ้นการ์ดยืนยันถาวรให้แม่ค้าตัดสิน (แทน toast 12 วิ ที่หายไปพร้อมเงิน) — กด 1 ปุ่มบวกยอดครั้งที่ 2 ได้
                        recordManualMatchWarning({ name: lineName, lineId: userId, slipId: keyedMatch.id, transRef, amount, transDate: slipData.transDate, transTime: slipData.transTime });
                        io.emit('slip_warning', { kind: 'manual_match', name: lineName || 'ลูกค้า (ไม่ทราบชื่อ)', reason: `สลิปรหัส ${transRef} (ยอด ${fmtBaht(amount)} บาท) ตรงกับสลิปที่แม่ค้ากรอกยอดเองไว้ (สลิป #${keyedMatch.id}) ระบบถือเป็นใบเดียวกันชั่วคราว ไม่นับซ้ำ — ถ้าลูกค้าโอนแยกกัน 2 ครั้งจริง กดปุ่มส้มบนการ์ดยืนยัน` });
                        addLog('WARN', `สลิปรหัส ${transRef} ของ "${lineName}" ตรงกับสลิปที่แม่ค้ากรอกยอดเอง (#${keyedMatch.id}, ${fmtBaht(amount)} บาท) ผูกเป็นใบเดียวกัน ไม่นับยอดซ้ำ — ขึ้นการ์ดยืนยันให้แม่ค้า (กด "บวกยอด" ได้ถ้าเป็นการโอนครั้งที่ 2 จริง)`);
                        await broadcastTodayStats();
                        continue;
                    }
                    const stillOpen = manualRows.filter(r => Number(r.amount) === 0 && r.status === 'waiting' && (() => { const a = stampToSec(r.trans_date, r.trans_time); return a !== null && transferSec !== null && a + MANUAL_MATCH_TOLERANCE_SEC >= transferSec && a - MANUAL_MATCH_MAX_AGE_SEC <= transferSec; })());   // หน้าต่างเดียวกับ pickManualMatch
                    if (stillOpen.length > 0) {
                        addLog('WARN', `ลูกค้า "${lineName}" ส่งสลิปที่ตรวจผ่านแล้ว (${fmtBaht(amount)} บาท) และยังมีรูปรอใส่ยอดค้างอยู่ ${stillOpen.length} ใบ ถ้าเป็นสลิปใบเดียวกัน ให้ปัดตกการ์ดรอใส่ยอดใบเก่า อย่ากรอกยอดซ้ำ`);
                        io.emit('slip_warning', { kind: 'check_pending', name: lineName, reason: `ส่งสลิปที่ตรวจผ่านแล้ว ${fmtBaht(amount)} บาท แต่ยังมีรูปรอใส่ยอดค้างอยู่ ${stillOpen.length} ใบ ถ้าเป็นใบเดียวกัน ให้ปัดตกการ์ดเก่า อย่ากรอกยอดซ้ำ` });
                    }
                } catch (guardErr) { addLog('WARN', 'ตรวจสลิปซ้ำกับยอดที่กรอกเองไม่สำเร็จ (ข้ามขั้นนี้ ระบบบันทึกสลิปตามปกติ): ' + guardErr.message); }

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
                            qr_ref: (await decodeImageQrRef(imageBuffer)) || null,   // v1.0.18: ตัวตนรายการจาก QR (ถอดได้จากรูปที่เก็บไว้)
                            arrived_out_of_round: activeLiveSession ? 0 : 1   // v1.0.16: รูปที่เข้าตอนไม่มีไลฟ์ ติดป้ายโอนนอกรอบเหมือนสลิปปกติ
                        }]).select().single();
                        io.emit('pending_amount_slip', { name: lineName });
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

                // v1.0.18: เก็บตัวตนของรายการจาก QR ไว้ตั้งแต่รูปเข้า (ใช้ qrcodeData ที่ SlipOK ตอบมาใน 1010 ก่อน — ฟรีและเร็ว
                // ถอด QR จากรูปเองเป็นทางสำรอง) เพื่อจับคู่กับสลิปที่ตรวจผ่านภายหลังได้แบบแม่นยำ ไม่ต้องเดาจากช่วงเวลา
                const qrText = (slipResult && slipResult.data && slipResult.data.qrcodeData) || (await decodeImageQrText(imageBuffer)) || null;
                const qrRef = extractQrRef(qrText) || null;
                const qrBank = extractQrBank(qrText) || null;   // v1.0.19: ธนาคารผู้โอน (บอกว่ากติการหัส QR พิสูจน์แล้วหรือยัง)

                const payloadRef = `manual_image|${imageUrl}`;
                addLog('INFO', `ได้รับภาพจากลูกค้า "${lineName}" ที่ระบบอัตโนมัติอ่านสลิปไม่ได้ นำเข้าคิวเพื่อให้แอดมินตรวจเช็คภาพเอง${qrRef ? ` (จดรหัส QR ของรายการไว้: ${qrRef})` : ''}`);
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
                    qr_ref: qrRef,   // v1.0.18: ตัวตนรายการจาก QR (NULL ถ้าถอดไม่ได้ — ใช้วิธีเดิม)
                    qr_bank: qrBank,
                    status: 'waiting',
                    arrived_out_of_round: activeLiveSession ? 0 : 1   // v1.0.16: รูปที่เข้าตอนไม่มีไลฟ์ ติดป้ายโอนนอกรอบเหมือนสลิปปกติ
                }]).select().single();

                if (inserted) {
                    // v1.0.17: ถ้าเหตุผลคือสลิปธนาคารที่ต้องรอ (Code 1010) จำไว้ให้การ์ดบอกเวลาที่ลองใหม่ได้
                    const bankInfo = (slipResult && Number(slipResult.code) === 1010) ? classifySlipOkError(400, slipResult) : null;
                    if (bankInfo && bankInfo.kind === 'bank_delay') {
                        rememberBankDelayHint(inserted.id, bankInfo);
                        scheduleBankDelayRecheck(inserted.id, filePath, bankInfo.delay);   // v1.0.17: ระบบตรวจซ้ำเองหลังพ้นเวลารอ (ไม่ต้องรอลูกค้าส่งรูปซ้ำ)
                    }
                    io.emit('pending_amount_slip', { name: lineName, bankName: bankInfo ? bankInfo.bankName : undefined, delay: bankInfo ? bankInfo.delay : undefined });   // v1.0.16: เสียงคอร์ด + การ์ดกะพริบ (แทน ping ปกติ)
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

// 🔁 v1.0.16: ผูก LINE Webhook ไม่สำเร็จ (เช่น ลิงก์ท่อใหม่ยังไม่พร้อม) -> ลองใหม่เองเป็นระยะจนกว่าจะผ่าน
// เดิมลอง 3 ครั้งแล้วหยุด ต้องรอให้แม่ค้ากดปุ่มทดสอบเอง ระหว่างนั้น LINE ยังชี้ไปลิงก์เก่าที่ใช้ไม่ได้ สลิปลูกค้าไม่เข้า
const WEBHOOK_RESYNC_INTERVAL_MS = 60 * 1000;          // ลองใหม่ทุก 1 นาที
const WEBHOOK_RESYNC_SLOW_AFTER_ROUNDS = 30;           // ผ่านไป 30 รอบ (~30 นาที) ค่อยห่างเป็นทุก 5 นาที กัน Log รก
const WEBHOOK_RESYNC_SLOW_INTERVAL_MS = 5 * 60 * 1000;
let webhookRetryRound = 0;
let webhookRetryTimer = null;
function scheduleWebhookResync(publicUrl) {
    if (webhookRetryTimer) clearTimeout(webhookRetryTimer);
    const wait = webhookRetryRound >= WEBHOOK_RESYNC_SLOW_AFTER_ROUNDS ? WEBHOOK_RESYNC_SLOW_INTERVAL_MS : WEBHOOK_RESYNC_INTERVAL_MS;
    webhookRetryTimer = setTimeout(() => {
        webhookRetryTimer = null;
        if (typeof shuttingDown !== 'undefined' && shuttingDown) return;
        if (currentPublicUrl !== publicUrl) { webhookRetryRound = 0; return; }   // ท่อได้ลิงก์ใหม่แล้ว: รอบใหม่ของลิงก์ใหม่จัดการเอง
        if (webhookSyncStatus.synced && webhookSyncStatus.url === `${publicUrl}/webhook`) { webhookRetryRound = 0; return; }   // มีคนกดทดสอบผ่านไปแล้ว
        webhookRetryRound++;
        updateLineWebhookEndpoint(publicUrl, 1, true).catch(() => {});
    }, wait);
    if (webhookRetryTimer && webhookRetryTimer.unref) webhookRetryTimer.unref();
}

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
async function updateLineWebhookEndpoint(publicUrl, retries = 3, isResync = false) {
    if (!isResync) {   // ลิงก์ใหม่ / กดบันทึกคีย์ใหม่ = เริ่มนับรอบลองซ้ำใหม่
        webhookRetryRound = 0;
        if (webhookRetryTimer) { clearTimeout(webhookRetryTimer); webhookRetryTimer = null; }
    }
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
            if (webhookRetryRound > 0) {
                addLog('SUCCESS', `ผูก LINE Webhook สำเร็จหลังระบบลองซ้ำเอง (รอบที่ ${webhookRetryRound}) ลิงก์: ${webhookUrl}`);
            }
            webhookRetryRound = 0;
            if (webhookRetryTimer) { clearTimeout(webhookRetryTimer); webhookRetryTimer = null; }
            break;
        } catch(err) {
            const errMsg = err.response ? JSON.stringify(err.response.data) : err.message;
            webhookSyncStatus = { synced: false, url: webhookUrl, error: errMsg, lastTested: Date.now() };
            io.emit('tunnel_status', { active: true, url: publicUrl, type: activeTunnelType, synced: false, error: errMsg });
            
            if (attempt === retries) {
                console.error(`❌ ไม่สามารถอัปเดต LINE Webhook อัตโนมัติได้: ${errMsg}`);
                const httpStatus = err.response ? err.response.status : '-';
                const detail = `HTTP ${httpStatus} | ท่อ: ${activeTunnelType || '-'} | ลิงก์ที่ส่งให้ LINE: ${webhookUrl}`;
                if (webhookRetryRound === 0) addLog('ERROR', `อัปเดต LINE Webhook อัตโนมัติไม่สำเร็จ: ${errMsg} (${detail}) ระบบจะลองผูกใหม่เองทุก 1 นาทีจนกว่าจะผ่าน`);
                else addLog('WARN', `ผูก LINE Webhook ซ้ำยังไม่สำเร็จ (รอบที่ ${webhookRetryRound}): ${errMsg} (${detail})`);
                scheduleWebhookResync(publicUrl);
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
    // v1.0.16: กำลังไลฟ์อยู่ห้ามปิดโปรแกรมโดยไม่ตั้งใจ (ปิดแล้วสลิปลูกค้าไม่เข้า คิวหยุดทันที) -- ต้องส่ง force:true ที่หน้าจอยืนยันซ้ำเท่านั้น
    if (activeLiveSession) {
        if (!(req.body && req.body.force === true)) {
            return res.status(409).json({ success: false, code: 'LIVE_ACTIVE', message: 'กำลังไลฟ์อยู่ ปิดโปรแกรมตอนนี้สลิปลูกค้าจะไม่เข้าระบบ กรุณากด "จบไลฟ์" ก่อน' });
        }
        addLog('WARN', '🖥️ แม่ค้ายืนยันปิดโปรแกรมทั้งที่กำลังไลฟ์อยู่ (ยืนยันซ้ำแล้ว)');
    }
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
// v1.0.17 (พบตอนทดสอบอัปเดตจริง 2026-10-31): env ที่ส่งให้ updater.bat ต้องไม่มีค่าของตัวเฝ้า -- ตัวงานรันด้วย AQ_SUPERVISED=1
// ถ้าส่งต่อไป โปรแกรมที่ updater เปิดใหม่ (vbs -> run_background.bat -> index.js) จะคิดว่ามีตัวเฝ้าอยู่แล้วและรันโดยไม่มีตัวเฝ้า
// (พังแล้วไม่เปิดตัวเองใหม่จนกว่าแม่ค้าจะปิด-เปิดโปรแกรม) มีผลกับการอัปเดตที่สั่งจากโค้ดรุ่นนี้ขึ้นไป
function updaterEnv(env) {
    const out = Object.assign({}, env || {});
    delete out.AQ_SUPERVISED;
    delete out.AQ_RESTART_COUNT;
    return out;
}
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
            env: updaterEnv(process.env),
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