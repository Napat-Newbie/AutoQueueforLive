# 🧠 AutoQueue for Live — Project Persistent Memory

> Last refreshed: 2026-10-29 (evening session). Code on main = **v1.0.16 EXPANDED, re-packed, tagged, sitting in a DRAFT release — NOT published yet** (merchant machines still run v1.0.15).
> Before touching code, read `AGENTS.md` — file map, business invariants, traps, rule ก (out-of-round slips), and the test-suite guide.

## 0. 🔖 CURRENT STATUS & WHAT THE NEXT SESSION MUST DO (handoff)

**Scope change this session: the owner folded ALL new work into v1.0.16 (no v1.0.17).** The draft release was re-cut:

**Done and verified this session (all pushed):**
- v1.0.16 now ALSO includes (on top of the morning build): (1) every merchant action logged in detail (queue buttons with customer names, manual amount, dismisses, reject, verify, clear, live start/end) into system.log + Discord activity channel; (2) "📮 ขออัปเดตเวอร์ชันใหม่" dev-report embed when Self-Healing cannot fix an error (CRITICAL severity / same error ≥5× in 30 min / crash-loop ≥3 restarts via AQ_RESTART_COUNT / supervisor gives up after 5 crashes in 10 min — the supervisor itself posts to Discord reading .env manually); (3) permanent "🕒 โอนนอกรอบ" badge for money arriving while no live runs: purple tag on the queue card (survives the claim into the new round), history page names the round it belongs to (or "รอผูกเข้ารอบถัดไป"), Kerry summary lists the customers, Excel Remark stays EMPTY of the note (owner decision 2026-10-29: the file is uploaded to Kerry); new DB column `slips.arrived_out_of_round` (auto-migration in db.js)
- Re-packed from a fresh clone; **tag `v1.0.16` re-pointed to commit B `8745815`** (was 739d226); draft release assets replaced: `update_v1.0.16.zip` (248.3 KB, sha256 `499edb86…`, byte-verified via the raw URL at commit A `3c2d214`) + `version.json` + updated release notes; safe because NOTHING ever shipped 1.0.16 (draft only)
- **67 automated tests**, all green locally (Windows) and on CI (Linux). Trap learned: `appendLogFile` writes async — tests must POLL system.log (`sb.waitFor`), a single read races on Linux CI (that was the one CI failure, fixed in `efe7b34`)
- CI: `.github/workflows/ci.yml` runs `npm test` on every push/PR (ubuntu-latest, Node 24)
- `.gitattributes` locks `*.bat`/`*.vbs` to LF — REQUIRED because `updater.bat` overwrites itself while running; a CRLF-packed copy breaks cmd.exe mid-update. Every shipped zip v1.0.10–v1.0.16 contains LF `updater.bat` 2,168 bytes — verified again this pack. Packing MUST be done from a fresh clone

**Next session, in order:**
1. **Manual test before publishing v1.0.16** (automation cannot cover these): follow `tests/MANUAL_TEST_CHECKLIST.md` on a NON-shop Windows machine that has a v1.0.15 install + a test LINE OA account: real LINE webhook, real SlipOK credit, tunnel, and one real update via `UPDATE_MANIFEST_URL = https://raw.githubusercontent.com/Napat-Newbie/AutoQueueforLive/8745815/releases/version.json` (set through the setup page or `POST /api/system/save_update_url`, then press update on the dashboard; clear it afterwards). Checklist now also covers the out-of-round badge (หมวด ข) and the Discord live monitor; smoke test: set real DISCORD_ACTIVITY/DEVREPORT webhooks, run a live, press queue buttons, end the live — actions must appear in the activity channel and the summary embed must arrive.
2. **Publish when tests pass:** `gh release edit v1.0.16 --repo Napat-Newbie/AutoQueueforLive --draft=false --latest`, then verify `curl -sL https://github.com/Napat-Newbie/AutoQueueforLive/releases/latest/download/version.json` answers 1.0.16. Rollback if needed: `gh release edit v1.0.15 --latest` (machines already updated cannot be downgraded this way — `hasUpdate` only fires on newer versions).
3. **Post-release backlog (agreed):**
   - `pack_update.js`: make `--publish` exit non-zero on failure; add an option to generate the raw-URL manifest automatically (today the URL is rewritten by hand between commit A and commit B)
   - Split `index.js` (~5,000 lines) into modules — now UNBLOCKED because the test suite exists; order agreed long ago: extract pure money logic first (`calculateBestDraws` etc. reference module-level `priceList/shippingFee/...`, so convert them to parameters when extracting), then split by domain. Tests must stay green after every move
   - Long-term hardening: `updater.bat` self-overwrite is fragile by design (works only because shipped bytes are identical); consider a tiny stub that re-execs the new file
   - Idea parked (owner's call): quick button on out-of-round cards "จ่ายของแล้ว (จุ่มรอบก่อน)" that completes the card and records the reason — current badge + เสร็จสิ้น covers ~90% of cases

**Release procedure that works (v1.0.11–v1.0.16 pattern):** fresh clone → `node pack_update.js <ver> "item1; item2"` (no `--publish`) → verify zip contents (no `tests/`, `.github/`, `*.md`; `updater.bat` = 2,168 B) → bump `installer.iss` → commit A (zip + package.json + installer.iss + changelog.html) → push → rewrite `releases/version.json` downloadUrl to `https://raw.githubusercontent.com/Napat-Newbie/AutoQueueforLive/<commit-A-sha>/releases/update_vX.zip` → verify sha256 of the downloaded file → commit B → tag vX at B → `gh release create vX <zip> <version.json> --draft --verify-tag` → test → `--draft=false --latest`. Merchant machines read the manifest from the **Release asset** (`releases/latest/download/version.json`, index.js DEFAULT_MANIFEST_URL), not from the repo file.

**Machine-setup notes for a new dev PC:** `gh auth login` as Napat-Newbie (repo scope). Node 24 works, but `better-sqlite3@13` ships no prebuilt binary — if `npm install` fails at node-gyp, retry `npm install --no-save better-sqlite3@latest` (same version, succeeds). Tests need `node:sqlite` (built into Node 24, no flag). `.gitattributes` handles line endings; no special git config needed.

## 1. Project Overview & Architecture
* **Name:** AutoQueue for Live (v1.0.16 draft; merchant machines run v1.0.15)
* **GitHub Repository:** `https://github.com/Napat-Newbie/AutoQueueforLive`
* **Core Technology Stack:**
  * **Backend:** Node.js (CommonJS), Express 5, Socket.IO, `better-sqlite3` (local SQLite, WAL mode — the `supabase` variable in index.js is this local DB, not cloud Supabase)
  * **Frontend:** Vanilla JS / HTML5 Real-Time SPA (`public/index.html`) + `history.html`
  * **LINE Integration:** LINE Messaging API webhook (HMAC signature verify + message dedup) receiving slip images & address text
  * **Slip Verification (4 selectable providers):** SlipOK (default) / EasySlip / Thunder / SlipVerify — switchable in setup wizard, with quota monitoring
  * **Address Extraction:** Gemini AI with regex-based Thai address fallback
  * **Logistics Export:** Kerry Express (KEX) EasyShip Excel via `exceljs`, per live-round or per date, merged rounds export as one file (v1.0.15)
  * **Tunneling & Inbound Webhook:** Cloudflare Quick Tunnel primary + LocalTunnel fallback, watchdog restart, auto-sync webhook URL to LINE Developers Console
  * **Monitoring & Alerts:** Discord — every `addLog` flows to the activity channel (batched 1/min) and ERRORs go to the dev-report channel immediately with fix guidance; end-of-live summary embed on every "จบไลฟ์" (v1.0.16); rate-limit queue
  * **Self-healing:** SQLite busy retry, disk-space cleanup tiers, auto-backup every 6h + before each live, backup pruning, `system.log` file with rotation (v1.0.16)
  * **Auto-updater:** downloads self-hosted zips committed to `releases/` via raw.githubusercontent.com; allowlist also permits github.com + release-assets for this repo (index.js `isUpdateUrlAllowed`)

## 2. Key Operational Details
* **Installed Location on Merchant PC:** `D:\Users\napat\AppData\Local\Programs\AutoQueueforLive`
* **Local Development Workspace:** `c:\Users\napat\OneDrive\Desktop\Project-SlipAPI`
* **Cloudflare Tunnel URL:** changes per session; the app auto-syncs the current URL to LINE Developers Console — do not hardcode
* **Discord Alert Webhook:** `(เก็บไว้ใน .env -> DISCORD_WEBHOOK_URL เท่านั้น ห้ามใส่ลิงก์จริงในไฟล์นี้)`

## 3. Audit Findings from v1.0.5 — ALL RESOLVED (verified in v1.0.16 code, each has a test)
1. ~~BUG-01~~ webhook iterates all events in a batch
2. ~~SEC-01 & SEC-02~~ update URLs allowlisted; 3-tier RBAC; `/uploads` requires login
3. ~~BUG-02 & BUG-03~~ everything round-scoped by `session_id`; midnight-crossing covered; page reload during a live loads live-round stats; Kerry summary matches the file; out-of-round slips claimed into the next round (rule ก)
4. ~~DB-01~~ indexes + partial UNIQUE on `trans_ref`; `busy_timeout = 10000`

## 4. Release History Milestones (post-v1.0.11)
* **v1.0.12** — dev login via shared login window; fixed: dev login impossible since v1.0.8
* **v1.0.13** — dismiss button on orange top-up cards; starting a new live resets customer wallets (with pre-start warning)
* **v1.0.14** — retry LINE slip image download (3 tries); red warning card when it still fails
* **v1.0.15** — merge bills across 2 live rounds; per-round totals + round column on history page
* **v1.0.16 (DRAFT, not published)** — out-of-round slips claimed into the next round; **permanent "🕒 โอนนอกรอบ" badge** (queue card + history round naming, new column `arrived_out_of_round`); **every merchant action in the Discord live monitor + system.log**; **"ขออัปเดตเวอร์ชันใหม่" dev-report when Self-Healing cannot fix an error** (CRITICAL / ≥5 repeats / crash-loop / supervisor gives up); red cards for unrecorded slips (wrong account / other customer's duplicate / re-sent rejected slip); `system.log` file; live-round stats on page reload + Kerry summary fix; provider logos as files; end-of-live Discord summary with per-error fix guidance; 67-test suite + CI; `.gitattributes` LF lock for installed scripts

## 5. How to Continue Development on Any Machine
1. **Clone the repository:**
   ```bash
   git clone https://github.com/Napat-Newbie/AutoQueueforLive.git
   cd AutoQueueforLive
   npm install        # Node 24: if better-sqlite3 build fails, retry: npm install --no-save better-sqlite3@latest
   ```
2. **Run tests before anything else:** `npm test` (56 tests, ~20 s; needs no .env, no network — everything runs in a sandbox)
3. **Environment Variables (.env):** copy secrets (LINE Access Token + Channel Secret, slip provider keys, Gemini API Key, Discord Webhook URLs). `.env` is gitignored — never commit it.
4. **Run Application:** `node index.js` (port 3000)

## 6. Multi-Model Team Workflow (Kiro + Gemini + Claude + ZCode)
* **Kiro Conductor (Claude Opus tier):** system auditing, architectural oversight, edge-case analysis, acceptance criteria, post-implementation review
* **Gemini (3.8 Flash):** rapid code generation, bug fixing, migrations, scripts, unit tests
* **Claude Sonnet:** read-only deep reviews (release-path review 2026-10-29 was verified accurate; its updater.bat CRLF warning was proven real by experiment)
* **ZCode (GLM):** interactive sessions — analysis, features, tests, CI, docs, git/release engineering
* Rules: verify every AI claim against the code before acting on it; point agents at specific files/lines (map in `AGENTS.md`); batch work into fewer sessions to save tokens
