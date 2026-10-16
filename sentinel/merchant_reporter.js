/**
 * 🛰️ AutoQueue Merchant Telemetry Probe (Lightweight Client)
 * Location: sentinel/merchant_reporter.js
 * 
 * Runs on Merchant machines with ZERO UI / ZERO Canvas overhead.
 * Sends minimal telemetry and error incident reports back to the Central Sentinel Office on the developer PC.
 */

const axios = require('axios');
const os = require('os');

class MerchantReporter {
    constructor(options = {}) {
        this.centralEndpoint = options.centralEndpoint || process.env.SENTINEL_CENTRAL_ENDPOINT || 'http://localhost:3000/api/sentinel/telemetry_ingest';
        this.merchantId = options.merchantId || process.env.MERCHANT_ID || 'merchant_' + os.hostname().toLowerCase().replace(/[^a-z0-9]/g, '_');
        this.shopName = options.shopName || process.env.SHOP_NAME || 'ร้านค้าหลัก (' + os.hostname() + ')';
        this.appVersion = options.appVersion || 'v1.0.7';
        this.heartbeatTimer = null;
    }

    /**
     * Send incident to Central Sentinel Office on Developer PC
     */
    async reportIncident(category, error = {}, metrics = {}) {
        const payload = {
            merchantId: this.merchantId,
            shopName: this.shopName,
            appVersion: this.appVersion,
            timestamp: new Date().toISOString(),
            category: category || 'GENERAL_ERROR',
            error: {
                message: error.message || String(error),
                stack: (error.stack || '').slice(0, 500)
            },
            metrics: {
                hostname: os.hostname(),
                platform: os.platform(),
                freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
                ...metrics
            }
        };

        try {
            const res = await axios.post(this.centralEndpoint, payload, { timeout: 4000 });
            return res.data;
        } catch (err) {
            // Fail silently on merchant PC - Never interrupt live stream!
            return { sent: false, error: err.message };
        }
    }

    /**
     * Periodic heartbeat (every 60 seconds, lightweight < 1KB)
     */
    startHeartbeat(getMetricsFn) {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = setInterval(async () => {
            const metrics = typeof getMetricsFn === 'function' ? getMetricsFn() : {};
            await this.reportIncident('HEARTBEAT', { message: 'Normal Heartbeat' }, metrics).catch(() => {});
        }, 60000);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}

module.exports = MerchantReporter;
