# PR R1 Implementation Plan: Persistent Event Deduplication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate LINE webhook processing permanently across program restarts using SQLite table `processed_events`.

**Architecture:** Replace the transient 5-minute in-memory `processedMessageIds` with persistent SQLite table `processed_events` in `db.js`. Use `webhookEventId` as primary key (fallback to `message.id`). Prune records older than 8 days on startup and maintenance. Skip entire duplicate event payloads immediately with INFO log.

**Tech Stack:** Node.js 24 (`node:test`, `better-sqlite3`, Express).

**Spec:** Section 4.4 & 4.5 of AGENTS.md + PR R1 spec from prompt.

## Global Constraints
- Base: `3118ef1` on branch `feat/relay-r1-dedup-events`.
- Strict TDD: Write tests first, verify red, implement, verify green.
- Do not touch `updater.bat`, `pack_update.js`, `package-lock.json`.
- `index.js` CRLF line endings preserved; new files strictly LF (0 `\r`).
- Test paths: `process.env.AQ_TEST_APP_ROOT || path.join(__dirname, '..', '..')`.
- All tests in `npm test` must pass.

---

### Task 1: Write Failing Unit and System Tests (TDD - Red Phase)

**Files:**
- Create: `tests/unit/processed-events.test.js`
- Create: `tests/system/processed-events.test.js`

- [ ] **Step 1: Write Unit Test for `processed_events` and cleanup**
  - Verify table schema `(event_id TEXT PRIMARY KEY, seen_at INTEGER)`
  - Verify `cleanupProcessedEvents(8)` purges items older than 8 days and retains <= 8 days
  - Verify duplicate inserts are ignored or throw constraint error (PRIMARY KEY)

- [ ] **Step 2: Write System Test for Webhook Event Deduplication**
  - Send slip event with `webhookEventId: 'ev_dup_1'` and `message.id: 'm_dup_1'`
  - Wait for slip to be processed (amount = 100, 1 slip created)
  - Restart server using `await sb.restart()`
  - Send exact same slip event again
  - Assert slip amount counted once, slip row count is 1
  - Assert second event was dropped at deduplication check (INFO log logged, 0 extra image downloads)
  - Also test with an unreadable or text address message to verify it skips whole event without re-processing

- [ ] **Step 3: Run the new tests to verify FAIL**
  - Run: `node --test tests/unit/processed-events.test.js` and `node --test tests/system/processed-events.test.js`
  - Record the exact failure output.

---

### Task 2: Implement Table Migration & Cleanup in `db.js`

**Files:**
- Modify: `db.js`

- [ ] **Step 1: Add table initialization and migration in `db.js`**
  - `CREATE TABLE IF NOT EXISTS processed_events (event_id TEXT PRIMARY KEY, seen_at INTEGER);`
  - `CREATE INDEX IF NOT EXISTS idx_processed_events_seen_at ON processed_events(seen_at);`
  - Migration check in try-catch to create table on existing databases if missing
  - Implement `cleanupProcessedEvents(maxAgeDays = 8)`: deletes rows older than 8 days
  - Run `cleanupProcessedEvents(8)` on startup and in `optimizeDb()`
  - Export `cleanupProcessedEvents` in `module.exports`

- [ ] **Step 2: Run unit test to verify it PASSES**
  - Run: `node --test tests/unit/processed-events.test.js`

---

### Task 3: Implement Persistent Deduplication in `index.js`

**Files:**
- Modify: `index.js`

- [ ] **Step 1: Update webhook event loop deduplication**
  - Read `eventId = event.webhookEventId || event.message?.id;`
  - If `eventId`: check if already exists in `processed_events` table (or if `event.message?.id` also exists).
  - If already exists: log `addLog('INFO', 'บล็อกข้อความซ้ำ (Deduplication): Event ID ' + eventId)` and `continue` to drop the whole event immediately.
  - If not seen: insert into `processed_events (event_id, seen_at) VALUES (?, ?)`.
  - Preserve CRLF in `index.js`.

- [ ] **Step 2: Run system test to verify it PASSES**
  - Run: `node --test tests/system/processed-events.test.js`

---

### Task 4: Full Suite & Line Ending Verification

- [ ] **Step 1: Run full `npm test` suite**
  - All 353+ tests must pass.

- [ ] **Step 2: Verify line endings and CR byte count**
  - `index.js` has CRLF on all lines.
  - New test files are strictly LF (0 `\r`).
