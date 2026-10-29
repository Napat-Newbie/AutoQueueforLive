# 🧠 AutoQueue for Live — Project Persistent Memory

> Last refreshed: 2026-10-29, at release **v1.0.15** (main branch synced).
> Before touching code, read `AGENTS.md` — it has the file map, business invariants, and traps.

## 1. Project Overview & Architecture
* **Name:** AutoQueue for Live (v1.0.15)
* **GitHub Repository:** `https://github.com/Napat-Newbie/AutoQueueforLive`
* **Core Technology Stack:**
  * **Backend:** Node.js (CommonJS), Express 5, Socket.IO, `better-sqlite3` (local SQLite, WAL mode — the `supabase` variable in index.js is this local DB, not cloud Supabase)
  * **Frontend:** Vanilla JS / HTML5 Real-Time SPA (`public/index.html`) + `history.html`
  * **LINE Integration:** LINE Messaging API webhook (HMAC signature verify + message dedup) receiving slip images & address text
  * **Slip Verification (4 selectable providers):** SlipOK (default) / EasySlip / Thunder / SlipVerify — switchable in setup wizard, with quota monitoring
  * **Address Extraction:** Gemini AI with regex-based Thai address fallback
  * **Logistics Export:** Kerry Express (KEX) EasyShip Excel via `exceljs`, per live-round or per date, merged rounds export as one file (v1.0.15)
  * **Tunneling & Inbound Webhook:** Cloudflare Quick Tunnel primary + LocalTunnel fallback, watchdog restart, auto-sync webhook URL to LINE Developers Console
  * **Monitoring & Alerts:** Discord Webhook auto-diagnostics (activity + dev-report channels, rate-limit queue)
  * **Self-healing:** SQLite busy retry, disk-space cleanup tiers, auto-backup every 6h + before each live, backup pruning
  * **Auto-updater:** downloads self-hosted zips from `releases/` via raw.githubusercontent.com (NOT GitHub release-assets — old updaters block that redirect)

## 2. Key Operational Details
* **Installed Location on Merchant PC:** `D:\Users\napat\AppData\Local\Programs\AutoQueueforLive`
* **Local Development Workspace:** `c:\Users\napat\OneDrive\Desktop\Project-SlipAPI`
* **Cloudflare Tunnel URL:** changes per session; the app auto-syncs the current URL to LINE Developers Console — do not hardcode
* **Discord Alert Webhook:** `(เก็บไว้ใน .env -> DISCORD_WEBHOOK_URL เท่านั้น ห้ามใส่ลิงก์จริงในไฟล์นี้)`

## 3. Audit Findings from v1.0.5 — resolved, except one midnight edge case (item 3)
1. ~~BUG-01~~ **Fixed:** webhook now iterates `for (const event of events)` — no dropped slips in a batch
2. ~~SEC-01 & SEC-02~~ **Fixed:** update URLs restricted to allowlisted hosts; full 3-tier RBAC middleware (Tier A local/tunnel-login, Tier B merchant+dreamdev, Tier C dreamdev-only) + `/uploads` requires login
3. **BUG-02 & BUG-03 — fixed except one edge case:** broadcasts, `/api/stats/today`, slip inserts and Kerry export use `session_id`; `last_ended_live_session` covers livestreams crossing midnight. Also fixed after v1.0.15: reloading the page during a live now loads the live-round stats (it used to load per-date stats until the next broadcast), and `/api/kerry/summary` uses the same live-round rule as the Excel download. **Still open:** `countPastDraws()` counts slips paid before the live started (`session_id IS NULL`) only when `trans_date` is today, so in a live that crosses midnight they stop counting after 00:00 and the customer could be charged shipping again (found by reading the code, not reproduced; fix it together with unit tests)
4. ~~DB-01~~ **Fixed:** indexes on `trans_date`, `status`, `line_id`, `session_id` + partial UNIQUE index on `trans_ref`; `busy_timeout = 10000`

## 4. Release History Milestones (post-v1.0.11)
* **v1.0.12** — dev login via shared login window (no username field); fixed: dev login impossible since v1.0.8
* **v1.0.13** — dismiss button on orange top-up cards; starting a new live resets customer wallets (with pre-start warning)
* **v1.0.14** — retry LINE slip image download (3 tries); red warning card when it still fails
* **v1.0.15** — merge bills across 2 live rounds (hold at end of live, no double shipping, combined free-shipping count, single Kerry file); per-round totals + round column on history page

## 5. How to Continue Development on Any Machine
1. **Clone the repository:**
   ```bash
   git clone https://github.com/Napat-Newbie/AutoQueueforLive.git
   cd AutoQueueforLive
   npm install
   ```
2. **Environment Variables (.env):** copy secrets (LINE Access Token + Channel Secret, slip provider keys, Gemini API Key, Discord Webhook URLs). `.env` is gitignored — never commit it.
3. **Run Application:**
   ```bash
   node index.js   # port 3000
   ```
4. **Known gaps / agreed roadmap:** no tests & no CI yet. Agreed order: extract pure money logic to a module → unit-test it (`calculateBestDraws`, `walletAfter`, `describeTopup`, `countPastDraws`) → split index.js by domain → add CI. Do not refactor the monolith before tests exist.

## 6. Multi-Model Team Workflow (Kiro + Gemini + ZCode)
* **Kiro Conductor (`kiro_conductor` - Model: `pro` / Claude Opus Tier):**
  - Responsibilities: System auditing, architectural oversight, edge-case analysis, acceptance criteria definition, and post-implementation review.
* **Gemini (`gemini` - Model: Gemini 3.8 Flash):**
  - Responsibilities: Rapid code generation, bug fixing, database migrations, script executions, and unit testing following Kiro's criteria.
* **ZCode (GLM):** interactive development sessions — analysis, refactors, git operations, and docs (created `AGENTS.md`, synced main to v1.0.15).
* Token-saving rule: point agents at specific files/lines (see map in `AGENTS.md`) instead of letting them explore; batch work into fewer sessions.
