/**
 * 💾 Storage & DB Health Monitor Engine
 * AutoQueue for Live (v1.0.6)
 *
 * Dedicated background watcher for:
 * 1. public/uploads/ slip storage & retention (with 60s TTL cache)
 * 2. SQLite database (data.sqlite) & WAL file (data.sqlite-wal)
 * 3. backups/ retention & size
 * 4. Host disk capacity & safety margins (fs.statfs)
 * 5. Autonomous self-healing (PASSIVE WAL checkpoint, proactive health tracking)
 */

const fs = require('fs');
const path = require('path');

class StorageMonitor {
    constructor(options = {}) {
        this.projectRoot = options.projectRoot || path.join(__dirname, '..');
        this.uploadsDir = options.uploadsDir || path.join(this.projectRoot, 'public', 'uploads');
        this.dbDir = options.dbDir || this.projectRoot;
        this.backupsDir = options.backupsDir || path.join(this.projectRoot, 'backups');
        this.db = options.db || null;
        this.walBloatThresholdBytes = options.walBloatThresholdBytes || (20 * 1024 * 1024); // 20 MB
        this.lowDiskThresholdPercent = options.lowDiskThresholdPercent || 15; // < 15% free
        this.lastCheck = null;

        // 🚀 Caching & In-Flight Coalescing
        this.uploadsCache = null;
        this.uploadsCacheAt = 0;
        this.uploadsCacheTtlMs = options.uploadsCacheTtlMs || 60000; // 60 seconds TTL
        this.inFlight = null;
        this.knownTables = null;
    }

    setDatabase(dbInstance) {
        this.db = dbInstance;
        this.knownTables = null;
    }

    _tableExists(name) {
        if (!this.db) return false;
        if (!this.knownTables) {
            try {
                const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
                this.knownTables = new Set(rows.map(r => r.name));
            } catch (e) {
                return false;
            }
        }
        return this.knownTables.has(name);
    }

    async scanUploads() {
        const now = Date.now();
        if (this.uploadsCache && (now - this.uploadsCacheAt < this.uploadsCacheTtlMs)) {
            return this.uploadsCache;
        }

        let result;
        try {
            if (!fs.existsSync(this.uploadsDir)) {
                result = { count: 0, totalBytes: 0, totalMB: '0.00', oldestAgeDays: 0, newestAgeDays: 0 };
            } else {
                const entries = await fs.promises.readdir(this.uploadsDir, { withFileTypes: true }).catch(e => {
                    if (e.code === 'ENOENT') return [];
                    throw e;
                });

                let totalBytes = 0;
                let count = 0;
                let oldestMs = now;
                let newestMs = 0;

                for (const ent of entries) {
                    if (!ent.isFile()) continue;
                    try {
                        const st = await fs.promises.stat(path.join(this.uploadsDir, ent.name));
                        count++;
                        totalBytes += st.size;
                        if (st.mtimeMs < oldestMs) oldestMs = st.mtimeMs;
                        if (st.mtimeMs > newestMs) newestMs = st.mtimeMs;
                    } catch (e) {}
                }

                const day = 86400000;
                result = {
                    count,
                    totalBytes,
                    totalMB: (totalBytes / 1048576).toFixed(2),
                    oldestAgeDays: count ? Number(((now - oldestMs) / day).toFixed(1)) : 0,
                    newestAgeDays: count ? Number(((now - newestMs) / day).toFixed(1)) : 0
                };
            }
        } catch (err) {
            result = { count: 0, totalBytes: 0, totalMB: '0.00', error: err.message };
        }

        this.uploadsCache = result;
        this.uploadsCacheAt = now;
        return result;
    }

    scanDatabase() {
        try {
            const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
            const dbPath = path.join(this.dbDir, 'data.sqlite');
            const walPath = path.join(this.dbDir, 'data.sqlite-wal');
            const shmPath = path.join(this.dbDir, 'data.sqlite-shm');

            const dbSizeBytes = sizeOf(dbPath);
            const walSizeBytes = sizeOf(walPath);
            const shmSizeBytes = sizeOf(shmPath);

            const rowCounts = { slips: 0, sessions: 0, orders: 0 };
            if (this.db) {
                const targets = [
                    ['slips', 'slips'],
                    ['sessions', 'live_sessions'],
                    ['orders', 'orders']
                ];
                for (const [key, table] of targets) {
                    if (this._tableExists(table)) {
                        try {
                            const row = this.db.prepare(`SELECT count(*) as count FROM ${table}`).get();
                            if (row) rowCounts[key] = row.count;
                        } catch (e) {}
                    }
                }
            }

            const isWalBloated = walSizeBytes > this.walBloatThresholdBytes;

            return {
                dbSizeBytes,
                dbSizeMB: (dbSizeBytes / 1048576).toFixed(2),
                walSizeBytes,
                walSizeMB: (walSizeBytes / 1048576).toFixed(2),
                shmSizeBytes,
                isWalBloated,
                rowCounts
            };
        } catch (err) {
            return {
                dbSizeBytes: 0,
                dbSizeMB: '0.00',
                walSizeBytes: 0,
                walSizeMB: '0.00',
                error: err.message
            };
        }
    }

    async scanBackups() {
        try {
            if (!fs.existsSync(this.backupsDir)) {
                return { count: 0, totalBytes: 0, totalMB: '0.00', backups: [] };
            }

            const files = await fs.promises.readdir(this.backupsDir);
            let totalBytes = 0;
            const list = [];

            for (const file of files) {
                try {
                    const filePath = path.join(this.backupsDir, file);
                    const stat = await fs.promises.stat(filePath);
                    if (stat.isFile() && (file.endsWith('.sqlite') || file.endsWith('.db') || file.endsWith('.bak'))) {
                        totalBytes += stat.size;
                        list.push({
                            name: file,
                            sizeMB: (stat.size / 1048576).toFixed(2),
                            mtime: stat.mtime
                        });
                    }
                } catch (e) {}
            }

            list.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

            return {
                count: list.length,
                totalBytes,
                totalMB: (totalBytes / 1048576).toFixed(2),
                latestBackup: list[0] ? list[0].name : null,
                latestBackupTime: list[0] ? list[0].mtime : null
            };
        } catch (err) {
            return { count: 0, totalBytes: 0, totalMB: '0.00', error: err.message };
        }
    }

    scanDiskSpace() {
        try {
            if (typeof fs.statfsSync === 'function') {
                const stat = fs.statfsSync(this.projectRoot);
                const bsize = stat.bsize || 4096;
                const totalBytes = Number(stat.blocks) * bsize;
                const freeBytes = Number(stat.bavail) * bsize;
                const usedBytes = totalBytes - freeBytes;

                const totalGB = (totalBytes / (1024 ** 3)).toFixed(1);
                const freeGB = (freeBytes / (1024 ** 3)).toFixed(1);
                const usedGB = (usedBytes / (1024 ** 3)).toFixed(1);

                const freePercent = totalBytes > 0 ? Number(((freeBytes / totalBytes) * 100).toFixed(1)) : 100;
                const usedPercent = totalBytes > 0 ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0;

                return {
                    totalGB: Number(totalGB),
                    freeGB: Number(freeGB),
                    usedGB: Number(usedGB),
                    freePercent,
                    usedPercent,
                    isLowSpace: freePercent < this.lowDiskThresholdPercent
                };
            }
        } catch (err) {}

        return {
            totalGB: 0,
            freeGB: 0,
            usedGB: 0,
            freePercent: 100,
            usedPercent: 0,
            isLowSpace: false,
            simulated: true
        };
    }

    checkHealthAndSelfHeal() {
        if (this.inFlight) return this.inFlight;
        this.inFlight = this._runHealthCheck().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    async _runHealthCheck() {
        const uploads = await this.scanUploads();
        const dbInfo = this.scanDatabase();
        const backups = await this.scanBackups();
        const disk = this.scanDiskSpace();

        const selfHealActions = [];
        const warnings = [];

        // 1. Check WAL Bloat -> Non-blocking PASSIVE Checkpoint (zero lock on live session)
        if (dbInfo.isWalBloated && this.db) {
            try {
                const [r] = this.db.pragma('wal_checkpoint(PASSIVE)');
                const ok = r && r.busy === 0 && r.log === r.checkpointed;
                const fresh = this.scanDatabase();
                Object.assign(dbInfo, {
                    walSizeBytes: fresh.walSizeBytes,
                    walSizeMB: fresh.walSizeMB,
                    isWalBloated: fresh.isWalBloated
                });

                if (ok) {
                    selfHealActions.push({
                        type: 'WAL_CHECKPOINT',
                        reason: `WAL file reached ${dbInfo.walSizeMB} MB`,
                        result: `PASSIVE checkpoint completed (${r.checkpointed}/${r.log} frames flushed)`
                    });
                } else {
                    warnings.push(`WAL checkpoint busy (busy=${r?.busy}, ${r?.checkpointed}/${r?.log} frames)`);
                }
            } catch (err) {
                warnings.push(`WAL Checkpoint failed: ${err.message}`);
            }
        }

        // 2. Check Disk Space
        let healthStatus = 'HEALTHY';
        if (warnings.length > 0) healthStatus = 'WARNING';
        if (disk.isLowSpace) {
            healthStatus = disk.freePercent < 5 ? 'CRITICAL' : 'WARNING';
            warnings.unshift(`พื้นที่ฮาร์ดดิสก์เหลือเพียง ${disk.freePercent}% (${disk.freeGB} GB) กรุณาตรวจสอบ`);
        }

        const report = {
            timestamp: new Date().toISOString(),
            status: healthStatus,
            message: warnings.length ? warnings.join(' | ') : 'พื้นที่ฮาร์ดดิสก์และฐานข้อมูลปกติสมบูรณ์',
            disk,
            uploads,
            database: dbInfo,
            backups,
            selfHealActions
        };

        this.lastCheck = report;
        return report;
    }
}

module.exports = StorageMonitor;
