/**
 * 🛰️ AutoQueue for Live — Live Telemetry Watcher (Method 1)
 * Monitors SubAgents & Parent Agent Transcripts in Real-time.
 * Emits live events via Socket.IO and updates public/agent_telemetry.json.
 */

const fs = require('fs');
const path = require('path');
const StorageMonitor = require('./storage_monitor.js');

class TelemetryWatcher {
    constructor(options = {}) {
        this.brainBase = options.brainBase || path.join(process.env.USERPROFILE || 'C:/Users/Napat.R', '.gemini/antigravity/brain');
        this.parentConvId = options.parentConvId || process.env.CONVERSATION_ID || '82c1fccc-253f-4df2-a685-20e6068f9a40';
        this.telemetryPath = options.telemetryPath || path.join(__dirname, '..', 'public', 'agent_telemetry.json');
        this.io = options.io || null;
        this.intervalMs = options.intervalMs || 1000;
        this.timer = null;
        this.lastMtimes = {};
        this.currentData = null;
        this.storageMonitor = new StorageMonitor({ projectRoot: path.join(__dirname, '..') });
        this.lastStorageCheck = 0;
        this.storageHealthCache = null;

        this.agentsConfig = [
            {
                id: 'sentinel-scanner',
                convId: this.parentConvId,
                name: 'น้องสแกน (Scanner Agent)',
                type: 'sentinel_scanner',
                role: 'Telemetry & Fleet Watchdog',
                icon: '🕵️',
                badge: 'Fleet Sentry'
            },
            {
                id: 'sentinel-medic',
                convId: this.parentConvId,
                name: 'หมอเมดิค (Medic Agent)',
                type: 'sentinel_medic',
                role: 'Priority 1 Autonomous Self-Healing',
                icon: '🩺',
                badge: 'Self-Healer'
            },
            {
                id: 'kiro-conductor',
                convId: 'f831f216-6a32-4073-b115-9caeb0977f57',
                name: 'หัวหน้าคิโร่ (Kiro Conductor)',
                type: 'kiro_conductor',
                role: 'Chief Auditor & Safety Officer (Opus Tier)',
                icon: '🛡️',
                badge: 'Chief Auditor'
            },
            {
                id: 'sentinel-dispatcher',
                convId: this.parentConvId,
                name: 'น้องดิสแพตช์ (Dispatcher Agent)',
                type: 'sentinel_dispatcher',
                role: 'Release Officer & Discord Bridge',
                icon: '📦',
                badge: 'Discord Officer'
            }
        ];
    }

    setDatabase(dbInstance) {
        if (this.storageMonitor) {
            this.storageMonitor.setDatabase(dbInstance);
        }
    }

    setSocketIO(io) {
        this.io = io;
    }

    readLastJsonLine(filePath) {
        try {
            if (!fs.existsSync(filePath)) return null;
            const stat = fs.statSync(filePath);
            if (stat.size === 0) return null;

            const bufferSize = Math.min(8192, stat.size);
            const buffer = Buffer.alloc(bufferSize);
            const fd = fs.openSync(filePath, 'r');
            try {
                fs.readSync(fd, buffer, 0, bufferSize, stat.size - bufferSize);
            } finally {
                try { fs.closeSync(fd); } catch (e) {}
            }

            const text = buffer.toString('utf8');
            const lines = text.trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                const l = lines[i].trim();
                if (l) {
                    try {
                        return { data: JSON.parse(l), mtime: stat.mtimeMs, size: stat.size };
                    } catch (e) {}
                }
            }
        } catch (err) {
            // Non-blocking file error
        }
        return null;
    }

    parseAgentActivity(agent, lastStep) {
        if (!lastStep || !lastStep.data) {
            return {
                state: 'idle',
                currentAction: '🟢 สแตนด์บาย (Standby) พร้อมรับคำสั่งถัดไป',
                badge: 'Standby',
                targetFile: '-',
                progress: 100,
                codingDetail: { operation: 'Awaiting dispatch', step: 0 }
            };
        }

        const step = lastStep.data;
        const now = Date.now();
        const diffSeconds = Math.round((now - lastStep.mtime) / 1000);
        const isRecent = diffSeconds <= 15;

        let state = 'idle';
        let currentAction = '🟢 สแตนด์บาย (Standby) พร้อมรับคำสั่งถัดไป';
        let targetFile = '-';
        let operation = 'Idle';
        let badge = agent.badge || 'Standby';

        // Check if there are active tool calls in the step
        const toolCalls = step.tool_calls || [];
        const hasTools = toolCalls.length > 0;

        if (isRecent) {
            state = 'running';
            badge = '⚡ RUNNING';

            if (hasTools) {
                const primaryTool = toolCalls[0];
                const toolName = primaryTool.name || '';
                const args = primaryTool.args || {};
                const summary = (args.toolSummary || args.toolAction || '').replace(/^"|"$/g, '');
                const filePath = args.AbsolutePath || args.TargetFile || '';
                if (filePath) targetFile = path.basename(filePath.replace(/^"|"$/g, ''));

                if (toolName === 'run_command') {
                    currentAction = `⚡ รันคำสั่ง Terminal: ${summary || 'Executing shell command'}`;
                    operation = args.CommandLine ? args.CommandLine.slice(0, 100) : 'run_command';
                } else if (toolName === 'view_file') {
                    currentAction = `📖 อ่านโค้ด: ${targetFile} (${summary || 'Inspecting source'})`;
                    operation = `view_file ${targetFile}`;
                } else if (toolName === 'replace_file_content' || toolName === 'write_to_file') {
                    currentAction = `✏️ แก้ไขไฟล์: ${targetFile} (${summary || 'Writing code patch'})`;
                    operation = `patch ${targetFile}`;
                } else if (toolName === 'send_message') {
                    currentAction = `📨 ส่งข้อความส่งมอบงาน/รายงานผลให้คู่หู Agent`;
                    operation = `send_message to ${args.Recipient || 'peer'}`;
                } else {
                    currentAction = `🛠️ ใช้งานเครื่องมือ ${toolName}: ${summary}`;
                    operation = toolName;
                }
            } else if (step.type === 'PLANNER_RESPONSE' && step.thinking) {
                currentAction = `🧠 กำลังคิดวิเคราะห์เชิงสถาปัตยกรรม (Architectural Reasoning)...`;
                operation = 'Thinking';
            } else if (step.type === 'SYSTEM_MESSAGE') {
                currentAction = `📥 ได้รับมอบหมายภารกิจใหม่ กำลังเริ่มตรวจสอบ...`;
                operation = 'Dispatch Received';
            }
        } else {
            // Idle / Finished
            state = 'idle';
            if (agent.id === 'sentinel-scanner') {
                currentAction = '🕵️ สแกนสถานะเครื่องแม่ค้า, ท่อ Cloudflare, Webhook และ Quota ต่อเนื่อง';
                badge = 'Fleet Sentry (Active)';
                targetFile = 'Fleet Telemetry Stream';
                operation = 'Continuous Watch';
            } else if (agent.id === 'sentinel-medic') {
                currentAction = '🩺 สแตนด์บายหน่วยกู้ภัย Self-Healing พร้อมสั่ง PRAGMA checkpoint ทันที';
                badge = 'Self-Healer (Ready)';
                targetFile = 'data.sqlite & runtime';
                operation = 'Hot Mitigation Ready';
            } else if (agent.id === 'kiro-conductor') {
                currentAction = '🛡️ หัวหน้าฝ่ายสถาปัตยกรรม (Opus Tier) ควบคุมการวิเคราะห์และตรวจสอบความปลอดภัย';
                badge = 'Chief Auditor (Opus)';
                targetFile = 'Architectural Guard';
                operation = 'Auditor Standby';
            } else if (agent.id === 'sentinel-dispatcher') {
                currentAction = '📦 แสตนด์บายส่งรายงานขออนุมัติอัปเดตเวอร์ชันใหม่เข้า Discord พร้อม Mobile Action';
                badge = 'Discord Officer (Ready)';
                targetFile = 'Discord Webhook & Releases';
                operation = 'Dispatcher Standby';
            }
        }

        return {
            state,
            currentAction,
            badge,
            targetFile,
            progress: state === 'running' ? 65 : 100,
            codingDetail: {
                functionName: hasTools ? toolCalls[0].name : (state === 'running' ? 'Thinking' : 'Completed'),
                lines: targetFile,
                operation: operation,
                step: step.step_index || 0,
                lastSeenSecondsAgo: diffSeconds
            }
        };
    }

    async tick() {
        try {
            const now = Date.now();
            if (!this.storageHealthCache || (now - this.lastStorageCheck > 10000)) {
                this.lastStorageCheck = now;
                try {
                    this.storageHealthCache = await this.storageMonitor.checkHealthAndSelfHeal();
                } catch (e) {}
            }

            let hasChanges = false;
            const updatedAgents = [];

            for (const agent of this.agentsConfig) {
                const transcriptPath = path.join(this.brainBase, agent.convId, '.system_generated', 'logs', 'transcript.jsonl');
                const lastStep = this.readLastJsonLine(transcriptPath);

                const currentMtime = lastStep ? lastStep.mtime : 0;
                if (this.lastMtimes[agent.id] !== currentMtime) {
                    hasChanges = true;
                    this.lastMtimes[agent.id] = currentMtime;
                }

                const activity = this.parseAgentActivity(agent, lastStep);
                updatedAgents.push({
                    id: agent.id,
                    name: agent.name,
                    type: agent.type,
                    role: agent.role,
                    icon: agent.icon,
                    ...activity
                });
            }

            // Always update timestamp if any agent is running
            const anyRunning = updatedAgents.some(a => a.state === 'running');
            if (anyRunning) hasChanges = true;

            if (hasChanges || !this.currentData) {
                // Read existing logs if available
                let existingLogs = [];
                if (fs.existsSync(this.telemetryPath)) {
                    try {
                        const prev = JSON.parse(fs.readFileSync(this.telemetryPath, 'utf8'));
                        existingLogs = prev.logs || [];
                    } catch (e) {}
                }

                const telemetryPayload = {
                    lastUpdated: new Date().toISOString(),
                    activeSubagentsCount: updatedAgents.length,
                    systemStatus: anyRunning ? 'AGENTS_ACTIVELY_WORKING' : 'ALL_AGENTS_STANDBY',
                    workflow: 'Gemini 3.8 (Vibe Coder) + Claude Opus 4.6 (Inspector & Mentor)',
                    learnedSkillsCount: 3,
                    server: {
                        status: 'RUNNING',
                        port: 3000,
                        mode: 'Live Dual-Engine Synergy'
                    },
                    storageHealth: this.storageHealthCache,
                    agents: updatedAgents,
                    logs: existingLogs.slice(-20) // Keep latest 20 logs
                };

                this.currentData = telemetryPayload;

                // Write atomic to disk
                fs.writeFileSync(this.telemetryPath, JSON.stringify(telemetryPayload, null, 2), 'utf8');

                // Emit via Socket.IO if available
                if (this.io) {
                    this.io.emit('agent_telemetry_update', telemetryPayload);
                }
            }
        } catch (err) {
            console.error('TelemetryWatcher tick error:', err.message);
        }
    }

    start() {
        if (this.timer) return;
        this.tick(); // Run initial tick immediately
        this.timer = setInterval(() => this.tick(), this.intervalMs);
        console.log(`🛰️ Live Telemetry Watcher Started (Interval: ${this.intervalMs}ms)`);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = TelemetryWatcher;
