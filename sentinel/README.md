# 🛡️ AutoQueue Sentinel AI Agent

โมดูลเฝ้าระวังความปลอดภัย, ตรวจจับความผิดปกติ, และระบบยื่นเสนอปรับปรุงเวอร์ชันอัตโนมัติ (Dual-Agent Code Review & Mobile Approval Dispatcher)

---

## 📂 โครงสร้างไฟล์ในโฟลเดอร์ `sentinel/`
* `sentinel_agent.js` — โมดูลหลักสำหรับ Telemetry, Priority 1 Hot Mitigation, Dual-AI Review, และ Discord Webhook
* `proposals.json` — บันทึกประวัติข้อเสนอการแก้ไข (RFCs) และ Security Tokens
* `README.md` — คู่มือการทำงานของระบบ Sentinel

---

## 🧠 สถาปัตยกรรม Dual-Agent Pipeline

1. **ตรวจจับปัญหา (Telemetry & Watchdog):**
   * ดักจับข้อผิดพลาดระดับ Process (`uncaughtException`, `unhandledRejection`)
   * ตรวจจับ Database Lock Contention (`SQLITE_BUSY`, WAL Bloat)
   * ตรวจจับ Cloudflare Tunnel Disconnection
2. **Priority 1: Hot Mitigation (แก้ไขเฉพาะหน้า ไม่รบกวนแม่ค้า):**
   * หากคลี่คลายปัญหาได้ทันที เช่น ทำ `PRAGMA wal_checkpoint(TRUNCATE)` หรือ Restart Tunnel จะทำทันที และแจ้งเตือนสีเขียวเข้า Discord โดยไม่ต้องอัปเดตเวอร์ชัน
3. **Priority 2: Deep Diagnostics & Code Patch Proposal:**
   * **First Drafter (Gemini Flash):** วิเคราะห์ Root Cause และร่างแนวทางการแก้โค้ด พร้อมเสนอเวอร์ชันใหม่ (เช่น `v1.0.6`)
   * **Senior Reviewer & Security Auditor:** ตรวจสอบความปลอดภัยและผลกระทบข้างเคียง (รองรับทั้ง **Gemini 3.8 Flash Reasoning Reviewer** และ **Claude Opus**)
4. **Discord Mobile Interactive Dispatcher:**
   * ส่งรายงานภาษาไทยเข้าใจง่าย เข้าสู่ Discord Webhook
   * แนบลิงก์ **[อนุมัติและแก้ไขทันที]** และ **[ไม่อนุมัติ / ข้ามปัญหานี้]** พร้อม Secure Token
5. **การกดอนุมัติจากมือถือ:**
   * คำสั่งจะวิ่งผ่าน Cloudflare Tunnel ไปที่เครื่องแม่ค้า
   * ระบบสร้าง Backup ไฟล์เดิมอัตโนมัติ (`.bak_<timestamp>`) และนำโค้ดไปปรับปรุง
   * แสดงหน้าจอยืนยันความสำเร็จบนเบราว์เซอร์มือถือ

---

## 🔑 การตั้งค่าใน `.env`
```ini
# --- Sentinel AI Agent & Reviewer ---
SENTINEL_DISCORD_WEBHOOK="https://discord.com/api/webhooks/..."
GEMINI_REVIEW_MODEL="gemini-3.8-flash"
GEMINI_DRAFT_MODEL="gemini-3.5-flash"

# ใส่เมื่อมี Anthropic API Key เพื่อเปิดใช้งาน Claude Opus อัตโนมัติ:
ANTHROPIC_API_KEY=""
CLAUDE_REVIEWER_MODEL="claude-3-opus-20240229"
```
