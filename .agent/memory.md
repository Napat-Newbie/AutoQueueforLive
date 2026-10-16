# 🧠 AutoQueue for Live — Project Persistent Memory

## 1. Project Overview & Architecture
* **Name:** AutoQueue for Live (v1.0.5)
* **GitHub Repository:** `https://github.com/Napat-Newbie/AutoQueueforLive`
* **Core Technology Stack:**
  * **Backend:** Node.js, Express, Socket.IO, `better-sqlite3` (SQLite with WAL mode)
  * **Frontend:** Vanilla JS / HTML5 Real-Time SPA (`public/index.html`) with embedded Tailwind-like styles
  * **LINE Integration:** LINE Messaging API webhook receiving slips & address text
  * **Slip Verification:** SlipOK API (Primary) + EasySlip API (Secondary failover)
  * **Address Extraction:** Gemini AI with regex-based Thai address fallback
  * **Logistics Export:** Kerry Express (KEX) EasyShip Excel 2007-2010 (.xlsx) via `exceljs`
  * **Tunneling & Inbound Webhook:** Cloudflare Quick Tunnel (`cloudflared.exe`) with auto-sync to LINE Developers Console
  * **Monitoring & Alerts:** Discord Webhook auto-diagnostics with Thai explanations and action recommendations

## 2. Key Operational Details
* **Installed Location on Merchant PC:** `D:\Users\napat\AppData\Local\Programs\AutoQueueforLive`
* **Local Development Workspace:** `c:\Users\napat\OneDrive\Desktop\Project-SlipAPI`
* **Active Cloudflare Tunnel URL:** `https://released-wrote-infrared-radical.trycloudflare.com`
* **Discord Alert Webhook:** `https://discordapp.com/api/webhooks/1560336154786668545/6JofEN84L1gXPZfyWAR3ol3Bo1MB9dqaIyJJwf9ms6MT-RIgTwrwMbKZDiEEpsAYQy2v`

## 3. Important System Audit Findings (v1.0.5)
1. **BUG-01 (Critical):** In `index.js`, LINE Webhook handler only takes `events[0]`. When multiple customers send slips at the same second, subsequent slips in the batch array are dropped. Needs `for (const event of events)`.
2. **SEC-01 & SEC-02 (Critical):** `/api/system/apply_update` allows arbitrary URL download. Needs URL whitelist restriction. Admin routes like `/api/admin/backup` lack auth middleware.
3. **BUG-02 & BUG-03 (High):** Midnight Boundary Bug. The dashboard and Kerry export query by calendar date `trans_date = getTodayString()`. When a live stream crosses midnight (00:00), stats reset and the frontend stops refreshing because `selectedDate !== today`. Needs to query by `session_id` (`activeLiveSession`) instead.
4. **DB-01 (Critical):** Table `slips` lacks database indexes on `trans_date`, `status`, and `line_id`. Needs index creation and `busy_timeout = 5000`.

## 4. How to Continue Development on Any Machine with Antigravity
1. **Clone the repository:**
   ```bash
   git clone https://github.com/Napat-Newbie/AutoQueueforLive.git
   cd AutoQueueforLive
   npm install
   ```
2. **Environment Variables (.env):**
   - Copy `.env` secrets (LINE Channel Access Token, SlipOK API Key/Branch, Gemini API Key, Discord Webhook URL).
3. **Run Application:**
   ```bash
   node index.js
   ```

## 5. Multi-Model Team Workflow (Kiro + Gemini)
* **Kiro Conductor (`kiro_conductor` - Model: `pro` / Claude Opus Tier):**
  - Responsibilities: System auditing, architectural oversight, edge-case analysis, acceptance criteria definition, and post-implementation review.
* **Gemini (`gemini` - Model: Gemini 3.8 Flash):**
  - Responsibilities: Rapid code generation, bug fixing, database migrations, script executions, and unit testing following Kiro's criteria.
