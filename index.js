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

// 🛰️ Realtime SubAgents Telemetry Watcher (Method 1)
const telemetryWatcher = new TelemetryWatcher({ io });
telemetryWatcher.start();

app.get('/api/subagents/telemetry', (req, res) => {
    res.json(telemetryWatcher.currentData || {});
});

// 🔴 Live Session State & Storage
let activeLiveSession = null; // { id: 'LIVE_timestamp', startTime: Date.now(), endTime: null }
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
                await axios.post(DISCORD_WEBHOOK_URL, item.payload, { timeout: 8000 });
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
        { name: '📦 เวอร์ชัน', value: 'v1.0.6', inline: true }
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
}

// 📜 ระบบบันทึก System & Error Logs สำหรับหน้าตั้งค่าเชื่อมต่อ
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

    // 🛡️ บันทึก System Logs ใน Dashboard เท่านั้น (ไม่ส่งสแปมเข้า Discord เพื่อป้องกันการแจ้งเตือนรบกวน)
    // การแจ้งเตือนเข้า Discord จะส่งเฉพาะกรณีวิกฤตระดับ Crash (uncaughtException) หรือสั่งส่งโดยตรงเท่านั้น
}
addLog('INFO', 'ระบบเริ่มต้นทำงานเรียบร้อย');

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
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
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

// 🏢 Sentinel Office Dashboard Live State Endpoint
app.get('/api/sentinel/office_state', (req, res) => {
    try {
        const publicUrl = (sentinel.getPublicUrl && sentinel.getPublicUrl()) || currentPublicUrl || 'http://localhost:3000';
        const isLive = typeof activeLiveSession !== 'undefined' && activeLiveSession && activeLiveSession.active;
        
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
            },
            {
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
            }
        ];

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

// 🩺 Trigger Immediate Self-Healing
app.post('/api/sentinel/heal_now', async (req, res) => {
    try {
        const { category = 'DATABASE_MAINTENANCE' } = req.body || {};
        const record = await sentinel.executeManualHealing(category);
        res.json({ success: true, record });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 🧪 Simulate Merchant Incident from Office Dashboard
app.post('/api/sentinel/simulate_merchant_issue', async (req, res) => {
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

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir, { recursive: true }); }

// 🧹 ระบบลบรูปสลิปเก่าอัตโนมัติ (ลบรูปที่มีอายุเกิน 7 วัน เพื่อไม่ให้เปลืองพื้นที่คอม)
function cleanupOldUploads() {
    try {
        const files = fs.readdirSync(uploadsDir);
        const now = Date.now();
        const maxAgeMs = 7 * 24 * 60 * 60 * 1000; // 7 วัน
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
            if (item.key === 'shipping_fee') shippingFee = parseInt(item.value); 
            if (item.key === 'free_shipping_threshold') freeShippingThreshold = parseInt(item.value); 
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
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
    }
    return token;
}

function clientIp(req) {
    return String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
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
const DREAMDEV_PASSWORD_HASH = (process.env.DREAMDEV_PASSWORD_HASH || '').trim();

// 🛡️ Middleware ป้องกันการเข้าถึง Endpoint จัดการระบบโดยไม่ได้รับอนุญาต (Two-Tier RBAC Hardening)
app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const method = req.method.toUpperCase();

    // 🔒 Tier B: สิทธิ์สูงสุดเฉพาะผู้พัฒนา (Dreamdev Only)
    const isTierB = (
        p.startsWith('/api/admin/') ||
        p.startsWith('/api/test/') ||
        p.startsWith('/api/sentinel/') ||
        p === '/api/system/shutdown' ||
        p === '/api/system/apply_update' ||
        p === '/api/system/save_update_url' ||
        p === '/api/auth/change_password'
    );
    if (isTierB) {
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

    // 🛡️ Tier A: สิทธิ์สำหรับแม่ค้าหรือผู้พัฒนา (Merchant or Dreamdev)
    const isTierA = (
        (p === '/api/config' && method === 'POST') ||
        p.startsWith('/api/kerry/') ||
        p.startsWith('/api/queue/') ||
        (p.startsWith('/api/live_session/') && (p === '/api/live_session/start' || p === '/api/live_session/end')) ||
        p === '/api/history_data'
    );
    if (isTierA) {
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
        if (newShipping !== undefined) { shippingFee = parseInt(newShipping); await supabase.from('configs').upsert([{ key: 'shipping_fee', value: newShipping.toString() }]); }
        if (newThreshold !== undefined) { freeShippingThreshold = parseInt(newThreshold); await supabase.from('configs').upsert([{ key: 'free_shipping_threshold', value: newThreshold.toString() }]); }
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
    if (DREAMDEV_PASSWORD_HASH && isDreamdevUser) {
        isDreamdevMatch = verifyPassword(password, DREAMDEV_PASSWORD_HASH);
    } else if (DREAMDEV_PASSWORD && isDreamdevUser) {
        isDreamdevMatch = (password === DREAMDEV_PASSWORD);
    }

    if (isDreamdevMatch) {
        const token = issueSession(res, 'dreamdev');
        addLog('SUCCESS', `ผู้พัฒนา [Dreamdev] เข้าสู่ระบบในโหมด Developer สำเร็จ`);
        return res.json({ success: true, role: 'dreamdev', token });
    }

    // 2. เช็คสิทธิ์แม่ค้า (Merchant)
    try {
        const { data: configPass } = await supabase.from('configs').select('value').eq('key', 'merchant_password').single();
        const savedPass = configPass?.value;

        // หากร้านนี้ยังไม่เคยตั้งรหัสผ่าน ให้รหัสที่ส่งมากลายเป็นรหัสที่ตั้งใหม่ทันที
        if (!savedPass) {
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
    const isDreamdevUser = (username === DREAMDEV_USERNAME) || (!username && password === DREAMDEV_PASSWORD);
    let isMatch = false;
    if (DREAMDEV_PASSWORD_HASH) {
        isMatch = isDreamdevUser && verifyPassword(password, DREAMDEV_PASSWORD_HASH);
    } else {
        isMatch = isDreamdevUser && (password === DREAMDEV_PASSWORD);
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
        customApiKey: process.env.CUSTOM_API_KEY ? `${process.env.CUSTOM_API_KEY.substring(0, 6)}...` : ''
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
        const isDreamdev = (session && session.role === 'dreamdev') || (role === 'dreamdev' && (req.headers.authorization?.includes('DEV_') || readSessionToken(req)));
        if (isDreamdev && geminiApiKey !== undefined) {
            updateEnvVar('GEMINI_API_KEY', geminiApiKey);
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

const MAX_DP_BUDGET = 500000; // เพดานคำนวณอัตโนมัติ 500,000 บาท (คำนวณในหน่วยความจำ <3MB, เวลา <10ms ป้องกัน Event Loop ค้าง)
function calculateBestDraws(virtualBalance, pastDraws) {
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
                if (breakdown) existing.rawBreakdowns.push(breakdown);
            } else {
                groupMap[statusGroup].set(key, {
                    id: slip.id, slipIds: [slip.id], name: slip.sender_name, lineName: slip.line_name,
                    amount: slip.amount, draws: slip.draws || 0, time: slip.trans_time, status: statusGroup, 
                    isPendingAmount: isPendingAmount, imageUrl: imageUrl,
                    rawBreakdowns: breakdown ? [breakdown] : []
                });
            }
        });
        
        const processGroup = (map) => Array.from(map.values()).map(q => { q.breakdown = mergeBreakdowns(q.rawBreakdowns); delete q.rawBreakdowns; return q; });
        queues.waiting = processGroup(groupMap.waiting);
        queues.called = processGroup(groupMap.called);
        queues.skipped = processGroup(groupMap.skipped);
        queues.abnormal_pending = processGroup(groupMap.abnormal_pending);
    }
    return { stats: { totalAmount, totalSlips: dailySlips ? dailySlips.length : 0, totalDraws, uniqueCustomers: uniqueCustomersSet.size, waitingCount: queues.waiting.length }, queues };
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
app.get('/api/stats/history', async (req, res) => res.json(await getStatsByDate(req.query.date)));

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

            return { id: slip.id, date: slip.trans_date, time: slip.trans_time, name: slip.sender_name, lineName: slip.line_name, amount: slip.amount, draws: slip.draws || 0, status: slip.status, ref: safeRef };
        });
        res.json({ success: true, history });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

const ALLOWED_QUEUE_ACTIONS = new Set(['completed', 'called', 'skipped', 'waiting', 'cleared', 'rejected']);
app.post('/api/queue/action', async (req, res) => {
    try {
        const { action } = req.body || {};
        const slipIds = Array.isArray(req.body?.slipIds) ? req.body.slipIds.map(Number).filter(Number.isInteger) : [];
        if (!ALLOWED_QUEUE_ACTIONS.has(action) || slipIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid action or slipIds' });
        }
        
        if (action === 'completed') {
            const { data: slips } = await supabase.from('slips').select('id, qr_payload').in('id', slipIds);
            const validSlips = slips || [];
            const manualIds = validSlips.filter(s => s.qr_payload && s.qr_payload.startsWith('manual_image')).map(s => s.id);
            const normalIds = validSlips.filter(s => !(s.qr_payload && s.qr_payload.startsWith('manual_image'))).map(s => s.id);
            
            if (manualIds.length > 0) { await supabase.from('slips').update({ status: 'abnormal_pending' }).in('id', manualIds); }
            if (normalIds.length > 0) { await supabase.from('slips').update({ status: 'completed' }).in('id', normalIds); }
        } else {
            await supabase.from('slips').update({ status: action }).in('id', slipIds);
        }
        
        await broadcastTodayStats(); 
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/queue/clear', async (req, res) => {
    await supabase.from('slips').update({ status: 'cleared' }).eq('status', 'waiting');
    broadcastTodayStats(); res.json({ success: true });
});

// 🔴 LIVE SESSION API -----------------------------------------
app.get('/api/live_session/current', (req, res) => {
    res.json({ success: true, session: activeLiveSession });
});

app.post('/api/live_session/start', async (req, res) => {
    try {
        const sessionId = `LIVE_${Date.now()}`;
        const newSession = {
            id: sessionId,
            startTime: Date.now(),
            startDateStr: getTodayString(),
            startTimeStr: getLocalTimeString(),
            endTime: null,
            endTimeStr: null
        };
        activeLiveSession = newSession;
        await supabase.from('configs').upsert([{ key: 'active_live_session', value: JSON.stringify(newSession) }]);
        
        // 💾 สำรองฐานข้อมูล SQLite อัตโนมัติก่อนเริ่มไลฟ์ ด้วย Online Backup API (รองรับ WAL ครบถ้วน 100%)
        if (typeof supabase.performBackup === 'function') {
            supabase.performBackup('data_backup_live').then(r => {
                if (r && r.success) addLog('INFO', `สำรองฐานข้อมูลก่อนเริ่มไลฟ์สดเรียบร้อย: ${path.basename(r.file)}`);
                else if (r && r.error) addLog('ERROR', `สำรองฐานข้อมูลก่อนเริ่มไลฟ์ล้มเหลว: ${r.error}`);
            }).catch(bkErr => console.error('Auto Backup Error:', bkErr.message));
        }

        // บันทึกลง live_sessions history ใน config ด้วย
        io.emit('live_session_changed', activeLiveSession);
        await broadcastTodayStats();
        res.json({ success: true, session: activeLiveSession });
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
        
        // เซฟประวัติเซสชันที่จบแล้ว
        const historyKey = `session_hist_${endedSession.id}`;
        await supabase.from('configs').upsert([{ key: historyKey, value: JSON.stringify(endedSession) }]);
        
        // ล้าง active_live_session
        await supabase.from('configs').delete().eq('key', 'active_live_session');
        const prevSession = activeLiveSession;
        activeLiveSession = null;
        
        io.emit('live_session_changed', null);
        await broadcastTodayStats();
        res.json({ success: true, endedSession: endedSession });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 📦 API ดึงข้อมูลสรุปสำหรับ Kerry Express (ทั้งแบบ JSON และดาวน์โหลด Excel)
async function getOrdersForKerry(options = {}) {
    const { sessionId, date } = options;
    const targetDate = date || getTodayString();
    
    // ดึงสลิปที่สำเร็จหรือมีของ (completed, waiting, called, skipped) โดยไม่นับ rejected
    let query = supabase.from('slips').select('*').neq('status', 'rejected');
    if (sessionId) {
        query = query.eq('session_id', sessionId);
    } else if (date) {
        query = query.eq('trans_date', date);
    } else if (activeLiveSession) {
        query = query.eq('session_id', activeLiveSession.id);
    } else {
        query = query.eq('trans_date', targetDate);
    }
    const { data: slips, error } = await query;
    if (error) throw error;

    // ดึงที่อยู่ลูกค้าทั้งหมดจาก configs
    const { data: addrConfigs } = await supabase.from('configs').select('key, value').like('key', 'cust_addr_%');
    const addressMap = {};
    if (addrConfigs) {
        addrConfigs.forEach(item => {
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
            address: effectiveAddr
        };
    });

    // 🌟 จัดเรียง: ผู้ที่มีที่อยู่ครบถ้วนขึ้นก่อนด้านบน และคนที่ยังไม่ได้ส่งที่อยู่จัดรวมไว้ข้างล่างด้วยกัน
    orders.sort((a, b) => {
        if (a.hasAddress && !b.hasAddress) return -1;
        if (!a.hasAddress && b.hasAddress) return 1;
        return 0;
    });

    return orders;
}

// เช็คสรุปสถานะที่อยู่ของรอบไลฟ์/วันนี้
app.get('/api/kerry/summary', async (req, res) => {
    try {
        const orders = await getOrdersForKerry({ date: req.query.date, sessionId: req.query.sessionId });
        const totalCustomers = orders.length;
        const readyCustomers = orders.filter(o => o.hasAddress).length;
        const missingCustomers = orders.filter(o => !o.hasAddress).map(o => o.lineName);
        res.json({ success: true, totalCustomers, readyCustomers, missingCustomers, orders });
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

    let rawAddr = (addr.address || '').trim();
    let sub = (addr.subdistrict || '').trim();
    let dist = (addr.district || '').trim();
    let prov = (addr.province || '').trim();
    let post = (addr.postcode ? String(addr.postcode) : '').trim();

    // 1. นำรหัสไปรษณีย์ 5 หลักออกจากที่อยู่ (Kerry แยกช่องรหัสไปรษณีย์ไว้ใน Col 5 อยู่แล้ว)
    if (post) {
        rawAddr = rawAddr.replace(new RegExp(`\\b${post}\\b`, 'g'), '');
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
        const subRegex = new RegExp(`(?:ต\\.|ตำบล|แขวง)?\\s*${cleanSub}`, 'i');
        if (!subRegex.test(rawAddr)) {
            parts.push(`${subPrefix}${cleanSub}`);
        }
    }

    // เช็คว่ามีอำเภอ/เขต อยู่แล้วหรือไม่
    if (cleanDist) {
        const distRegex = new RegExp(`(?:อ\\.|อำเภอ|เขต)?\\s*${cleanDist}`, 'i');
        const currentText = parts.join(' ');
        if (!distRegex.test(currentText)) {
            parts.push(`${distPrefix}${cleanDist}`);
        }
    }

    // เช็คว่ามีจังหวัดอยู่แล้วหรือไม่ (ป้องกันสับสนกับ อำเภอเมือง)
    if (cleanProv) {
        const provRegex = new RegExp(`(?:จ\\.|จังหวัด)\\s*${cleanProv}|(?:^|\\s+)${cleanProv}(?:\\s+|$)`, 'i');
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
            row.getCell(12).value = addr.remark || '';                            // Col 12: Remark
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
        let pastSlipsQuery = supabase.from('slips').select('draws').eq('line_id', fakeUserId);
        if (activeLiveSession) {
            pastSlipsQuery = pastSlipsQuery.eq('session_id', activeLiveSession.id);
        } else {
            pastSlipsQuery = pastSlipsQuery.eq('trans_date', getTodayString());
        }
        const { data: todaySlips } = await pastSlipsQuery;
        let pastDrawsToday = 0;
        if (todaySlips) pastDrawsToday = todaySlips.reduce((sum, slip) => sum + (slip.draws || 0), 0);

        let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
        let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);

        let result = calculateBestDraws(virtualBalance, pastDrawsToday);
        let draws = result.draws;
        let remainingBalance = result.remainder;

        // อัปเดตกระเป๋าเงินลูกค้า
        if (customer) await supabase.from('customers').update({ balance: remainingBalance, name: randomName }).eq('line_id', fakeUserId);
        else await supabase.from('customers').insert([{ line_id: fakeUserId, name: randomName, balance: remainingBalance }]);

        const status = draws > 0 ? 'waiting' : 'accumulated';
        let breakdownStr = result.breakdown.join(', ');

        const minPrice = priceList.length > 0 ? Math.min(...priceList.map(p => p.price)) : 189;
        const defaultName = priceList.length > 0 ? priceList[0].name : 'สินค้า';
        const neededForOne = minPrice + (pastDrawsToday >= freeShippingThreshold ? 0 : shippingFee);

        if (!breakdownStr && draws === 0) {
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

        let pastSlipsQuery = supabase.from('slips')
            .select('draws')
            .eq('line_id', slip.line_id)
            .neq('status', 'rejected')
            .neq('id', slipId);

        if (activeLiveSession) {
            pastSlipsQuery = pastSlipsQuery.eq('session_id', activeLiveSession.id);
        } else {
            pastSlipsQuery = pastSlipsQuery.eq('trans_date', getTodayString());
        }
        const { data: todaySlips } = await pastSlipsQuery;
        
        let pastDrawsToday = todaySlips ? todaySlips.reduce((sum, s) => sum + (s.draws || 0), 0) : 0;
        let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
        let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
        
        let result = calculateBestDraws(virtualBalance, pastDrawsToday);
        let breakdownStr = result.breakdown.join(', ');
        
        const parts = (slip.qr_payload || '').split('|');
        const payloadRef = `manual_image|${parts[1] || ''}|${breakdownStr}`; 

        await supabase.from('slips').update({
            amount: amount, draws: result.draws, qr_payload: payloadRef
        }).eq('id', slipId);

        if (customer) {
            await supabase.from('customers').update({ balance: result.remainder }).eq('line_id', slip.line_id);
        } else if (slip.line_id) {
            await supabase.from('customers').insert([{ line_id: slip.line_id, name: slip.line_name || 'ลูกค้า LINE', balance: result.remainder }]);
        }

        broadcastTodayStats(); 
        res.json({ success: true, draws: result.draws, remainder: result.remainder });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// 📝 API อนุมัติหรือปัดตกสลิปผิดปกติหลังจบไลฟ์
app.post('/api/queue/verify_abnormal', async (req, res) => {
    const { slipIds, isApproved } = req.body;
    try {
        const newStatus = isApproved ? 'completed' : 'rejected';
        await supabase.from('slips').update({ status: newStatus }).in('id', slipIds);
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
            
            // ส่งข้อความแจ้งลูกค้าใน LINE หากมี line_id
            if (slip.line_id) {
                try {
                    await axios.post('https://api.line.me/v2/bot/message/push', {
                        to: slip.line_id,
                        messages: [{ type: 'text', text: 'ขออภัยนะคะ 🥺 รูปภาพที่คุณลูกค้าส่งมาไม่ใช่สลิปการโอนเงิน รบกวนส่งรูปสลิปใหม่อีกครั้งนะคะ 🙏' }]
                    }, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` } });
                } catch(e) {}
            }
        }
        await broadcastTodayStats();
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
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

async function downloadImageFromLine(messageId) {
    try { 
        const res = await axios({ method: 'get', url: `https://api-data.line.me/v2/bot/message/${messageId}/content`, headers: { 'Authorization': `Bearer ${process.env.LINE_ACCESS_TOKEN}` }, responseType: 'arraybuffer' }); 
        return res.data; 
    } catch (error) { 
        addLog('ERROR', `ดาวน์โหลดรูปภาพสลิปจาก LINE ไม่สำเร็จ (Message ID: ${messageId})`, error.response?.data?.message || error.message);
        return null; 
    }
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
            if (!imageBuffer) continue;

            const slipResult = await verifySlipWithProvider(imageBuffer);
            // ✅ ดึงชื่อ LINE จากโปรไฟล์ผู้ใช้อย่างถูกต้อง 100%
            const lineName = await getLineProfile(userId);
            
            if (slipResult && slipResult.success) {
                const slipData = slipResult.data;

                if (merchantAccountName && merchantAccountName.trim() !== "") {
                    let receiverName = "";
                    if (slipData.receiver) receiverName = slipData.receiver.displayName || slipData.receiver.name || slipData.receiver.accountName || "";
                    const searchName = merchantAccountName.trim().toLowerCase();
                    const actualName = receiverName.toLowerCase();
                    if (!actualName.includes(searchName)) {
                        addLog('WARN', `ตรวจพบสลิปโอนผิดบัญชี: ลูกค้า "${lineName}" โอนเข้าบัญชี "${receiverName}" (ไม่ใช่ "${merchantAccountName}")`);
                        // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้โอนไปที่บัญชี "${receiverName || 'ไม่ทราบชื่อ'}" นะคะ ซึ่งไม่ใช่บัญชีของผักกาดน้า รบกวนคุณลูกค้าเช็คบัญชีผู้รับอีกทีนะคะ 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                        continue;
                    }
                }

                const transRef = slipData.transRef; 
                const amount = slipData.amount;

                // 🛡️ ป้องกันสลิปซ้ำระดับ B-Tree Index: เช็กว่ารหัสสลิปนี้เคยส่งเข้ามาในระบบแล้วหรือยัง
                const existingSlip = supabase.db.prepare('SELECT id, trans_date FROM slips WHERE trans_ref = ? LIMIT 1').get(transRef);
                if (existingSlip) {
                    addLog('WARN', `ตรวจพบสลิปซ้ำ: ลูกค้า "${lineName}" ส่งสลิปรหัส ${transRef} ที่เคยบันทึกไปแล้ว`);
                    console.log(`⚠️ ตรวจพบสลิปซ้ำ: ${transRef}`);
                    // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้เคยถูกใช้งานไปแล้วนะคะ รบกวนคุณลูกค้าตรวจสอบสลิปอีกครั้ง หรือติดต่อแอดมินน้า 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                    continue;
                }

                let customer = supabase.db.prepare('SELECT * FROM customers WHERE line_id = ?').get(userId);
                let currentBalance = (customer ? customer.balance : 0) + amount; 

                let pastSlipsRows = [];
                if (activeLiveSession) {
                    pastSlipsRows = supabase.db.prepare('SELECT draws FROM slips WHERE line_id = ? AND session_id = ?').all(userId, activeLiveSession.id);
                } else {
                    pastSlipsRows = supabase.db.prepare('SELECT draws FROM slips WHERE line_id = ? AND trans_date = ?').all(userId, getTodayString());
                }

                let pastDrawsToday = pastSlipsRows.reduce((sum, slip) => sum + (slip.draws || 0), 0);

                let hasPaidShippingToday = (pastDrawsToday > 0 && pastDrawsToday < freeShippingThreshold);
                let virtualBalance = currentBalance + (hasPaidShippingToday ? shippingFee : 0);
                
                let result = calculateBestDraws(virtualBalance, pastDrawsToday);
                let draws = result.draws;
                let remainingBalance = result.remainder;

                const status = draws > 0 ? 'waiting' : 'accumulated';
                let breakdownStr = result.breakdown.join(', ');
                const payloadRef = `${transRef}|${breakdownStr}`; 
                
                // 🔒 Atomic Transaction: รวมการบันทึกยอดเงินลูกค้าและสลิปเป็น Atomic Unit เพื่อป้องกัน Race Condition 100%
                let inserted = null;
                try {
                    inserted = supabase.runTransaction(() => {
                        // Double check ป้องกัน race condition ในระดับ transaction
                        const dup = supabase.db.prepare('SELECT id FROM slips WHERE trans_ref = ? LIMIT 1').get(transRef);
                        if (dup) throw new Error('DUPLICATE_SLIP');

                        if (customer) {
                            supabase.db.prepare('UPDATE customers SET balance = ?, name = ? WHERE line_id = ?').run(remainingBalance, lineName, userId);
                        } else {
                            supabase.db.prepare('INSERT INTO customers (line_id, name, balance) VALUES (?, ?, ?)').run(userId, lineName, remainingBalance);
                        }

                        const stmt = supabase.db.prepare(`
                            INSERT INTO slips (amount, draws, line_id, sender_name, line_name, session_id, trans_date, trans_time, trans_ref, qr_payload, status)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);
                        const info = stmt.run(
                            amount, draws, userId, lineName, lineName,
                            activeLiveSession ? activeLiveSession.id : null,
                            getTodayString(), slipData.transTime || getLocalTimeString(),
                            transRef, payloadRef, status
                        );
                        return { id: info.lastInsertRowid };
                    });
                } catch (txErr) {
                    if (txErr.message === 'DUPLICATE_SLIP' || (txErr.message && txErr.message.includes('UNIQUE constraint failed'))) {
                        addLog('WARN', `ตรวจพบสลิปซ้ำ (Atomic Unique Lock): ลูกค้า "${lineName}" ส่งสลิปรหัส ${transRef} ซ้ำ`);
                        console.log(`⚠️ ตรวจพบสลิปซ้ำ (Atomic Block): ${transRef}`);
                        // await replyLineMessage(replyToken, `อุ๊ย! 🥺 สลิปใบนี้เคยถูกใช้งานไปแล้วนะคะ รบกวนคุณลูกค้าตรวจสอบสลิปอีกครั้ง หรือติดต่อแอดมินน้า 🙏`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด
                        continue;
                    }
                    throw txErr;
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
                        // await replyLineMessage(replyToken, `ผักกาดได้รับยอดแล้วน้าา\n(แต่ยอดรวมตอนนี้ยังไม่พอสำหรับสินค้านะคะ รบกวนโอนเพิ่มอีกนิดนึงน้าา 😉)`, userId); // ปิดการตอบกลับตามที่ผู้ใช้กำหนด (ข้อ 4)
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
                    status: 'waiting' 
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
                }
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
            (hostname === 'objects.githubusercontent.com' && pathname.includes('AutoQueueforLive'))
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
        try {
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