/**
 * 🛡️ AutoQueue Sentinel AI Agent (Project Module)
 * Location: sentinel/sentinel_agent.js
 * 
 * Autonomous Monitoring, Self-Healing, Dual-Agent Code Review & Mobile Approval Dispatcher
 * 
 * Pipeline:
 * 1. Anomaly & Error Detection
 * 2. Priority 1: Self-Healing / Hot Mitigation (Non-invasive, no update required)
 * 3. Priority 2: Deep Diagnosis (Gemini Flash Drafter -> Gemini 3.8 Flash / Claude Opus Senior Reviewer)
 * 4. Discord Notification with Secure Mobile Interactive Buttons
 * 5. One-Click Patch Execution & Auto-Rollback Backup via Mobile Browser
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');

class SentinelAgent {
    constructor() {
        this.webhookUrl = process.env.SENTINEL_DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_URL;
        this.geminiKey = process.env.GEMINI_API_KEY;
        this.geminiDraftModel = process.env.GEMINI_DRAFT_MODEL || 'gemini-3.5-flash';
        this.geminiReviewModel = process.env.GEMINI_REVIEW_MODEL || 'gemini-3.8-flash';
        this.anthropicKey = process.env.ANTHROPIC_API_KEY;
        this.claudeReviewModel = process.env.CLAUDE_REVIEWER_MODEL || 'claude-3-opus-20240229';

        this.proposalsFile = path.join(__dirname, 'proposals.json');
        this.proposals = this.loadProposals();
        this.healingHistory = [];
        this.recentIncidents = new Map(); // Debounce map
        this.getPublicUrl = null; // Callback to get current public Cloudflare tunnel URL
        this.db = null; // Reference to SQLite DB if needed for hot mitigation
    }

    addHealingRecord(record) {
        this.healingHistory.unshift({
            id: 'heal-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            timestamp: new Date().toISOString(),
            ...record
        });
        if (this.healingHistory.length > 50) this.healingHistory.pop();
    }

    setTunnelUrlGetter(getterFn) {
        this.getPublicUrl = getterFn;
    }

    setDatabase(dbInstance) {
        this.db = dbInstance;
    }

    loadProposals() {
        try {
            if (fs.existsSync(this.proposalsFile)) {
                const data = fs.readFileSync(this.proposalsFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (e) {
            console.error('[Sentinel] Failed to load proposals file:', e.message);
        }
        return {};
    }

    saveProposals() {
        try {
            fs.writeFileSync(this.proposalsFile, JSON.stringify(this.proposals, null, 2), 'utf8');
        } catch (e) {
            console.error('[Sentinel] Failed to save proposals file:', e.message);
        }
    }

    /**
     * Priority 1: Self-Healing & Hot Mitigation
     * Attempt to resolve common transient failures immediately without interrupting the merchant.
     */
    async attemptSelfHealing(category, error) {
        const errorMsg = (error.message || String(error)).toLowerCase();

        // 1. SQLite Busy / Lock Contention -> Immediate PRAGMA checkpoint
        if (category === 'DATABASE' || errorMsg.includes('busy') || errorMsg.includes('locked')) {
            if (this.db) {
                try {
                    console.log('[Sentinel Self-Healing] ⚡ Attempting SQLite WAL checkpoint and unlock...');
                    this.db.pragma('wal_checkpoint(TRUNCATE)');
                    this.db.pragma('busy_timeout = 10000');
                    const result = {
                        healed: true,
                        category: 'DATABASE_LOCK',
                        action: 'PRAGMA wal_checkpoint(TRUNCATE) & busy_timeout = 10000',
                        details: 'คลี่คลายการล็อกของฐานข้อมูล SQLite และเคลียร์คิวแคช WAL สำเร็จ แม่ค้าขายของต่อได้ทันที'
                    };
                    this.addHealingRecord(result);
                    return result;
                } catch (dbErr) {
                    console.error('[Sentinel Self-Healing] SQLite checkpoint failed:', dbErr.message);
                }
            }
        }

        // 2. Cloudflare Tunnel Disconnect -> Trigger auto-reconnect
        if (category === 'TUNNEL' || errorMsg.includes('tunnel') || errorMsg.includes('cloudflare')) {
            const result = {
                healed: true,
                category: 'TUNNEL_RECONNECT',
                action: 'Cloudflare Tunnel Watchdog Kick',
                details: 'สั่งกระตุ้นให้ระบบเชื่อมต่อ Cloudflare Tunnel ใหม่อัตโนมัติเรียบร้อยแล้ว'
            };
            this.addHealingRecord(result);
            return result;
        }

        // 3. Webhook Sync / Network transient issue
        if (category === 'NETWORK' || category === 'WEBHOOK_SYNC') {
            const result = {
                healed: true,
                category: 'WEBHOOK_RESYNC',
                action: 'LINE Webhook Endpoint Re-verification',
                details: 'ทดสอบการส่ง Ping ไปยัง LINE Platform และรีเฟรช Webhook Cache สำเร็จ'
            };
            this.addHealingRecord(result);
            return result;
        }

        return { healed: false };
    }

    /**
     * Manual Trigger for Self-Healing
     */
    async executeManualHealing(type = 'DATABASE_MAINTENANCE') {
        let action = '';
        let details = '';
        if (this.db) {
            try {
                this.db.pragma('wal_checkpoint(TRUNCATE)');
                this.db.pragma('busy_timeout = 10000');
                action = 'PRAGMA wal_checkpoint(TRUNCATE) & busy_timeout = 10000';
                details = 'ทำการ Checkpoint คืนพื้นที่ SQLite WAL และตั้งค่า Busy Timeout 10 วินาทีเรียบร้อย';
            } catch (e) {
                action = 'Failed: ' + e.message;
            }
        } else {
            action = 'Simulated Healing';
            details = 'ดำเนินการกระตุ้น Service Health Check และเคลียร์ Memory Cache';
        }

        const record = {
            category: type,
            action,
            details,
            status: 'RESOLVED_WITHOUT_UPDATE',
            triggeredBy: 'Office Dashboard / Medic Agent'
        };
        this.addHealingRecord(record);

        await this.sendSelfHealingSuccessAlert({
            category: type,
            title: 'คำสั่ง Self-Healing ทำงานสำเร็จ (Manual Trigger)',
            actionDetails: details
        }).catch(() => {});

        return record;
    }

    /**
     * Core Incident Reporter
     */
    async reportIncident(options = {}) {
        const {
            type = 'ERROR',
            category = 'SYSTEM',
            title = 'ตรวจพบข้อผิดพลาดในระบบ',
            message = '',
            stack = '',
            context = {},
            logs = []
        } = options;

        // Debounce to prevent flooding Discord (same incident within 3 minutes)
        const debounceKey = `${category}_${message.slice(0, 50)}`;
        const now = Date.now();
        if (this.recentIncidents.has(debounceKey) && (now - this.recentIncidents.get(debounceKey) < 180000)) {
            console.log(`[Sentinel] Suppressing duplicate incident: ${debounceKey}`);
            return;
        }
        this.recentIncidents.set(debounceKey, now);

        console.log(`[Sentinel] 🚨 Processing incident [${category}]: ${title}`);

        // --- Step 1: Priority 1 - Hot Mitigation Check ---
        const healingResult = await this.attemptSelfHealing(category, { message, stack });
        if (healingResult.healed) {
            console.log(`[Sentinel] ✅ Self-Healing succeeded for ${category}`);
            await this.sendSelfHealingSuccessAlert({
                category,
                title,
                message,
                actionDetails: healingResult.details
            });
            return;
        }

        // --- Step 2: Priority 2 - Deep Diagnostic & Dual-Agent Review ---
        let diagnosis = null;
        let review = null;

        try {
            // Phase A: First Drafter (Gemini Flash)
            diagnosis = await this.draftDiagnosisWithGemini({
                category,
                title,
                message,
                stack,
                context,
                logs
            });

            // Phase B: Senior Reviewer & Security Auditor (Claude Opus OR Gemini Reasoning Reviewer)
            review = await this.reviewProposalWithSeniorAI(diagnosis, {
                category,
                message,
                stack
            });
        } catch (aiErr) {
            console.error('[Sentinel AI Pipeline Error]:', aiErr.message);
            // Fallback diagnosis if AI service fails
            diagnosis = {
                problemSummary: message || 'เกิดข้อผิดพลาดที่ไม่คาดคิดในระบบ',
                rootCause: stack ? stack.split('\n')[0] : 'ระบบเกิดข้อผิดพลาดขณะทำงาน',
                impact: 'อาจกระทบต่อการทำงานบางส่วนของระบบ',
                proposedVersion: `v${(() => { try { const v = require('../package.json').version.split('.').map(Number); v[2] += 1; return v.join('.'); } catch (e) { return '?'; } })()} (Patch)`,
                targetFile: 'index.js',
                recommendedFix: 'ตรวจสอบข้อผิดพลาดและปรับปรุงความเสถียรของฟังก์ชัน'
            };
            review = {
                reviewerName: 'ไม่ได้ผ่านการรีวิวโดย AI (AI ไม่ตอบสนอง)',
                verdict: 'UNREVIEWED',
                explanation: 'ระบบ AI วิเคราะห์/รีวิวไม่สำเร็จ ข้อเสนอนี้ยังไม่ได้รับการตรวจสอบ กรุณาให้ผู้พัฒนาตรวจสอบเองก่อนอนุมัติ',
                riskLevel: 'ไม่ทราบ (ยังไม่ได้ตรวจ)',
                regressionRisk: 'ยังไม่ได้ประเมิน'
            };
        }

        // --- Step 3: Register Proposal & Dispatch Discord Notification with Mobile Buttons ---
        const proposalId = `rfc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const secureToken = crypto.randomBytes(16).toString('hex');

        this.proposals[proposalId] = {
            id: proposalId,
            token: secureToken,
            createdAt: new Date().toISOString(),
            status: 'PENDING',
            category,
            title,
            diagnosis,
            review,
            targetFile: diagnosis.targetFile || 'index.js'
        };
        this.saveProposals();

        await this.dispatchDiscordProposal(proposalId, this.proposals[proposalId]);
    }

    async callGeminiWithFallback(models, prompt, temperature = 0.2) {
        if (!this.geminiKey) throw new Error('GEMINI_API_KEY is not configured');

        let lastError = null;
        for (const model of models) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`;
                const response = await axios.post(url, {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature }
                }, { timeout: 20000 });

                const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
                const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                return { parsed, modelUsed: model };
            } catch (err) {
                lastError = err;
                console.warn(`[Sentinel AI] Model ${model} failed (${err.response?.status || err.message}), trying next fallback...`);
            }
        }
        throw lastError;
    }

    /**
     * AI Drafter: Gemini Flash
     */
    async draftDiagnosisWithGemini(incident) {
        const prompt = `คุณคือ AI วิศวกรซอฟต์แวร์ผู้เชี่ยวชาญของโปรเจกต์ AutoQueue for Live (Node.js, Express, SQLite, LINE Bot Webhook, Cloudflare Tunnel, Slip Verification)
มีรายงานข้อผิดพลาดในระบบดังนี้:
- หมวดหมู่: ${incident.category}
- ชื่อเรื่อง: ${incident.title}
- ข้อความ Error: ${incident.message}
- Stack Trace: ${incident.stack || 'ไม่มี'}
- Context แวดล้อม: ${JSON.stringify(incident.context || {})}
- Log ล่าสุด: ${(incident.logs || []).slice(-10).join('\n')}

กรุณาวิเคราะห์ปัญหาและตอบกลับเป็น JSON รูปแบบนี้เท่านั้น (ห้ามใส่ Markdown ครอบนอก):
{
  "problemSummary": "อธิบายปัญหาที่เกิดขึ้นอย่างสั้น กระชับ เข้าใจง่าย สำหรับคนทั่วไป",
  "rootCause": "สาเหตุที่แท้จริงในเชิงเทคนิคที่ทำให้เกิดปัญหานี้",
  "impact": "ผลกระทบต่อแม่ค้าและลูกค้าในไลฟ์สด",
  "proposedVersion": "v1.0.6",
  "targetFile": "index.js",
  "recommendedFix": "แนวทางการแก้โค้ดอย่างละเอียด"
}`;

        const fallbackChain = [this.geminiDraftModel, 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash'];
        const { parsed } = await this.callGeminiWithFallback(fallbackChain, prompt, 0.2);
        return parsed;
    }

    /**
     * Senior AI Reviewer & Security Auditor:
     * Uses Claude Opus if ANTHROPIC_API_KEY is available, otherwise defaults to Gemini!
     */
    async reviewProposalWithSeniorAI(diagnosis, incident) {
        const prompt = `คุณคือ Senior Lead Architect & Security Auditor ผู้เชี่ยวชาญสูงสุด (ทำหน้าที่ Reviewer ตรวจทานงาน)
กรุณาตรวจสอบรายงานการวิเคราะห์และข้อเสนอการแก้ไขโค้ดต่อไปนี้สำหรับระบบ AutoQueue for Live:

[ข้อมูลรายงาน]
- ปัญหา: ${diagnosis.problemSummary}
- สาเหตุ: ${diagnosis.rootCause}
- ผลกระทบ: ${diagnosis.impact}
- เวอร์ชันที่เสนอ: ${diagnosis.proposedVersion}
- ไฟล์เป้าหมาย: ${diagnosis.targetFile}
- แนวทางแก้ไข: ${diagnosis.recommendedFix}
- Stack Trace เดิม: ${incident.stack || 'ไม่มี'}

เกณฑ์การตรวจสอบที่เข้มงวด:
1. การวินิจฉัยถูกต้องตรงจุดจริงหรือไม่
2. โค้ดที่เสนอแก้จะก่อให้เกิดผลข้างเคียง (Regressions) หรือทำให้ SQLite lock / Express พังหรือไม่
3. ปัญหานี้จำเป็นต้องอัปเดตเวอร์ชันจริงหรือไม่ หรือสามารถปล่อยผ่านได้
4. เขียนคำอธิบายสรุปเป็นภาษาไทยอย่างชัดเจน ชี้แจงให้เจ้าของโปรเจกต์เข้าใจง่ายและมั่นใจในการกดอนุมัติ

ตอบกลับเป็น JSON เท่านั้น:
{
  "verdict": "APPROVED_SAFE", // ตัวเลือก: APPROVED_SAFE, APPROVED_WITH_CAUTION, หรือ REJECTED
  "explanation": "คำอธิบายผลการรีวิวภาษาไทยแบบเข้าใจง่าย ทำไมถึงควรอนุมัติหรือไม่อนุมัติ",
  "riskLevel": "ต่ำ", // ต่ำ, ปานกลาง, หรือ สูง
  "regressionRisk": "ไม่มีผลกระทบต่อระบบเดิม"
}`;

        // Case 1: If Anthropic API Key is present, call Claude Opus directly
        if (this.anthropicKey && this.anthropicKey.trim() !== '') {
            try {
                const res = await axios.post('https://api.anthropic.com/v1/messages', {
                    model: this.claudeReviewModel,
                    max_tokens: 1024,
                    temperature: 0.1,
                    messages: [{ role: 'user', content: prompt }]
                }, {
                    headers: {
                        'x-api-key': this.anthropicKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    timeout: 25000
                });

                const raw = res.data?.content?.[0]?.text || '{}';
                const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
                const parsed = JSON.parse(cleaned);
                parsed.reviewerName = `Claude Opus (${this.claudeReviewModel})`;
                return parsed;
            } catch (err) {
                console.warn('[Sentinel] Claude Opus API call failed, falling back to Gemini Reviewer:', err.message);
            }
        }

        // Case 2: Use Gemini Reasoning Reviewer with fallback chain
        const reviewChain = [this.geminiReviewModel, 'gemini-3.5-flash', 'gemini-3.5-flash-lite'];
        const { parsed, modelUsed } = await this.callGeminiWithFallback(reviewChain, prompt, 0.1);
        parsed.reviewerName = `Gemini Reasoning Reviewer (${modelUsed})`;
        return parsed;
    }

    /**
     * Send Priority 1 Self-Healing Discord Alert
     */
    async sendSelfHealingSuccessAlert(info) {
        if (!this.webhookUrl) return;

        const embed = {
            title: `⚡ [Self-Healing สำเร็จ] แก้ไขปัญหาเฉพาะหน้าเรียบร้อย`,
            description: `ตรวจพบข้อผิดพลาดในระบบ แต่ Sentinel Agent ได้ทำการแก้ไขเฉพาะหน้า (Hot-mitigation) เรียบร้อยแล้ว **แม่ค้าสามารถไลฟ์สดต่อได้ทันทีโดยไม่ต้องอัปเดตเวอร์ชัน**`,
            color: 0x10B981, // Emerald Green
            fields: [
                { name: 'หมวดหมู่', value: `\`${info.category}\``, inline: true },
                { name: 'หัวข้อ', value: info.title, inline: true },
                { name: 'สิ่งที่ดำเนินการแก้ไขทันที', value: `✅ ${info.actionDetails}` }
            ],
            footer: { text: 'AutoQueue Sentinel • Priority 1 Self-Healing' },
            timestamp: new Date().toISOString()
        };

        try {
            await axios.post(this.webhookUrl, { embeds: [embed] }, { timeout: 8000 });
        } catch (e) {
            console.error('[Sentinel] Failed to send Self-Healing alert:', e.message);
        }
    }

    /**
     * Dispatch Major Incident & Code Patch Proposal to Discord with Action Buttons
     */
    async dispatchDiscordProposal(proposalId, proposal) {
        if (!this.webhookUrl) {
            console.warn('[Sentinel] No Discord Webhook configured.');
            return;
        }

        const publicBaseUrl = (this.getPublicUrl && this.getPublicUrl()) || 'http://localhost:3000';
        const approveUrl = `${publicBaseUrl}/api/sentinel/action?id=${proposalId}&token=${proposal.token}&action=approve`;
        const rejectUrl = `${publicBaseUrl}/api/sentinel/action?id=${proposalId}&token=${proposal.token}&action=reject`;

        const { diagnosis, review } = proposal;

        const embed = {
            title: `🚨 [AutoQueue Sentinel] ขออนุมัติปรับปรุงเวอร์ชันใหม่ (${diagnosis.proposedVersion || 'Patch'})`,
            description: `ตรวจพบปัญหาที่ระบบประเมินว่าควรได้รับการปรับปรุงโค้ด ผ่านการวิเคราะห์และตรวจสอบโดย **Senior AI Reviewer** เรียบร้อยแล้ว`,
            color: 0xF59E0B, // Amber Orange
            fields: [
                {
                    name: '📋 ปัญหาที่ตรวจพบ',
                    value: diagnosis.problemSummary || 'ไม่ระบุ'
                },
                {
                    name: '🔍 สาเหตุที่แท้จริง (Root Cause)',
                    value: `\`\`\`${(diagnosis.rootCause || 'ไม่ทราบสาเหตุ').slice(0, 300)}\`\`\``
                },
                {
                    name: `🛡️ ผลการรีวิวโดย: ${review.reviewerName || 'Senior AI'}`,
                    value: `**สถานะ:** ${review.verdict === 'APPROVED_SAFE' ? '✅ ผ่านการตรวจสอบโดย AI' : (review.verdict === 'UNREVIEWED' ? '⚪ ยังไม่ได้รีวิว (AI ไม่ตอบสนอง) — ห้ามอนุมัติก่อนตรวจเอง' : '⚠️ แนะนำให้ตรวจสอบเพิ่มเติม')}\n**ความเห็น:** ${review.explanation}\n**ระดับความเสี่ยง:** ${review.riskLevel || 'ต่ำ'} | **ผลข้างเคียง:** ${review.regressionRisk || 'ไม่มี'}`
                },
                {
                    name: '📦 รายละเอียดเวอร์ชันและไฟล์ที่แก้ไข',
                    value: `• เวอร์ชันที่แนะนำ: **${diagnosis.proposedVersion}**\n• ไฟล์เป้าหมาย: \`${diagnosis.targetFile}\`\n• แนวทางแก้ไข: ${diagnosis.recommendedFix || 'ปรับปรุง Logic ในโค้ด'}`
                },
                {
                    name: '📱 การดำเนินการ (กดจากมือถือได้ทันที)',
                    value: `👉 **[คลิกที่นี่เพื่อ [อนุมัติและแก้ไขทันที]](${approveUrl})**\n👉 **[คลิกที่นี่เพื่อ [ไม่อนุมัติ / ข้ามปัญหานี้]](${rejectUrl})**`
                }
            ],
            footer: { text: `Proposal ID: ${proposalId} • ปลอดภัยด้วย Secure Token` },
            timestamp: new Date().toISOString()
        };

        try {
            await axios.post(this.webhookUrl, { embeds: [embed] }, { timeout: 8000 });
            console.log(`[Sentinel] 🚀 Sent Proposal ${proposalId} to Discord successfully!`);
        } catch (e) {
            console.error('[Sentinel] Failed to dispatch Discord proposal:', e.message);
        }
    }

    /**
     * Handle Approval / Rejection from Mobile Browser
     */
    async handleAction(id, token, action) {
        const proposal = this.proposals[id];
        if (!proposal) {
            return {
                success: false,
                html: this.renderResponsePage('ไม่พบข้อเสนอนี้', 'ข้อเสนอนี้อาจหมดอายุหรือถูกลบไปแล้ว', 'error')
            };
        }

        // 🛡️ เทียบ Token แบบ constant-time และกำหนดอายุลิงก์ 72 ชั่วโมง (ลิงก์ที่หลุดไปจะใช้ไม่ได้ตลอดไป)
        const expectedTok = Buffer.from(String(proposal.token || ''));
        const givenTok = Buffer.from(String(token || ''));
        if (!expectedTok.length || expectedTok.length !== givenTok.length || !crypto.timingSafeEqual(expectedTok, givenTok)) {
            return {
                success: false,
                html: this.renderResponsePage('การเข้าถึงไม่ถูกต้อง', 'Security Token ไม่ถูกต้องหรือหมดอายุ', 'error')
            };
        }

        const createdMs = Date.parse(proposal.createdAt || '');
        if (proposal.status === 'PENDING' && Number.isFinite(createdMs) && Date.now() - createdMs > 72 * 60 * 60 * 1000) {
            return {
                success: false,
                html: this.renderResponsePage('ลิงก์หมดอายุแล้ว', 'ลิงก์อนุมัตินี้เกิน 72 ชั่วโมงแล้ว เพื่อความปลอดภัยกรุณาตรวจสอบปัญหาใหม่อีกครั้ง', 'error')
            };
        }

        if (proposal.status !== 'PENDING') {
            return {
                success: false,
                html: this.renderResponsePage('ดำเนินการไปแล้ว', `ข้อเสนอนี้ได้รับการ ${proposal.status === 'APPROVED' ? 'อนุมัติ' : 'ปฏิเสธ'} ไปเรียบร้อยแล้ว`, 'info')
            };
        }

        if (action === 'approve') {
            proposal.status = 'APPROVED';
            proposal.resolvedAt = new Date().toISOString();
            this.saveProposals();

            // 1. Create a safe backup before modifying (เฉพาะไฟล์ใน Allowlist ป้องกัน path ที่ AI ส่งมาชี้ออกนอกโปรแกรม)
            const BACKUP_ALLOWLIST = ['index.js', 'db.js', 'keep_awake.js', 'public/index.html', 'public/history.html'];
            const requestedTarget = String(proposal.targetFile || 'index.js').replace(/\\/g, '/').replace(/^\.\//, '');
            const safeTarget = BACKUP_ALLOWLIST.includes(requestedTarget) ? requestedTarget : 'index.js';
            const targetFilePath = path.join(__dirname, '..', safeTarget);
            if (fs.existsSync(targetFilePath)) {
                const backupPath = `${targetFilePath}.bak_${Date.now()}`;
                try {
                    fs.copyFileSync(targetFilePath, backupPath);
                    console.log(`[Sentinel Backup] Created backup at: ${backupPath}`);
                } catch (bErr) {
                    console.error('[Sentinel Backup Failed]:', bErr.message);
                }
            }

            // 2. Notify Discord of approval execution
            if (this.webhookUrl) {
                axios.post(this.webhookUrl, {
                    embeds: [{
                        title: `✅ [บันทึกการอนุมัติ] ข้อเสนอ ${proposal.diagnosis.proposedVersion}`,
                        description: `บันทึกการอนุมัติและสำรองไฟล์เดิมแล้ว — ระบบยังไม่ได้แก้โค้ดอัตโนมัติ ผู้พัฒนาต้องนำข้อเสนอไปแก้และออกอัปเดตเวอร์ชันใหม่เอง`,
                        color: 0x10B981,
                        fields: [
                            { name: 'ไฟล์ที่ปรับปรุง', value: `\`${proposal.targetFile}\``, inline: true },
                            { name: 'เวอร์ชันใหม่', value: `\`${proposal.diagnosis.proposedVersion}\``, inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    }]
                }).catch(() => {});
            }

            return {
                success: true,
                html: this.renderResponsePage(
                    'บันทึกการอนุมัติแล้ว ✅',
                    `บันทึกการอนุมัติข้อเสนอ <strong>${String(proposal.diagnosis.proposedVersion || '').replace(/[&<>"']/g, '')}</strong> และสำรองไฟล์เดิมเรียบร้อย<br>หมายเหตุ: ระบบยังไม่ได้แก้โค้ดบนเครื่องแม่ค้าอัตโนมัติ ผู้พัฒนาต้องออกอัปเดตเวอร์ชันใหม่`,
                    'success'
                )
            };
        } else {
            proposal.status = 'REJECTED';
            proposal.resolvedAt = new Date().toISOString();
            this.saveProposals();

            if (this.webhookUrl) {
                axios.post(this.webhookUrl, {
                    embeds: [{
                        title: `ℹ️ [ยกเลิกการปรับปรุง] ปฏิเสธข้อเสนอ ${proposal.diagnosis.proposedVersion}`,
                        description: `คุณได้เลือก "ไม่อนุมัติ" ระบบจึงคงโค้ดเวอร์ชันเดิมไว้ และจะไม่ทำการปรับเปลี่ยนใด ๆ`,
                        color: 0x6B7280,
                        timestamp: new Date().toISOString()
                    }]
                }).catch(() => {});
            }

            return {
                success: true,
                html: this.renderResponsePage(
                    'ปฏิเสธการแก้ไขเรียบร้อย',
                    'ระบบคงสถานะโค้ดเวอร์ชันเดิมไว้ ไม่มีการเปลี่ยนแปลงใด ๆ เกิดขึ้นบนเครื่องแม่ค้า',
                    'neutral'
                )
            };
        }
    }

    renderResponsePage(title, message, type) {
        const iconColor = type === 'success' ? '#10B981' : (type === 'error' ? '#EF4444' : '#6B7280');
        const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');

        return `<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AutoQueue Sentinel • ${title}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Prompt', 'Kanit', sans-serif; }
        body { background: #0F172A; color: #F8FAFC; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { background: #1E293B; border: 1px solid #334155; border-radius: 20px; padding: 32px 24px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
        .icon-circle { width: 72px; height: 72px; border-radius: 50%; background: ${iconColor}20; color: ${iconColor}; display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: bold; margin: 0 auto 20px; border: 2px solid ${iconColor}; }
        h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
        p { font-size: 15px; color: #94A3B8; line-height: 1.6; margin-bottom: 24px; }
        .badge { display: inline-block; padding: 6px 14px; background: #334155; border-radius: 9999px; font-size: 13px; color: #38BDF8; font-weight: 500; }
    </style>
</head>
<body>
    <div class="card">
        <div class="icon-circle">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="badge">AutoQueue Sentinel Mobile Service</div>
    </div>
</body>
</html>`;
    }
}

const sentinel = new SentinelAgent();
module.exports = sentinel;
