# AGENTS.md — คู่มือสำหรับ AI Agent ที่มาทำงานกับ Repo นี้

อ่านไฟล์นี้ก่อนลงมือแก้โค้ดทุกครั้ง ประหยัดเวลา/Token และกันทำลายกฎธุรกิจที่สร้างไว้แล้ว

## 1. โปรเจคคืออะไร

AutoQueue for Live — ระบบจัดคิวสินค้าสำหรับแม่ค้าไลฟ์ขายของ: ลูกค้าส่งสลิปเงินเข้า LINE OA → ระบบตรวจสลิปอัตโนมัติผ่านผู้ให้บริการ → คำนวณสิทธิ์รับสินค้าตามยอดโอน → แม่ค้าเรียกคิวทีละคนบน Dashboard → จบไลฟ์ Export รายชื่อส่ง Kerry Express รันทั้งหมดบนเครื่องแม่ค้า (Windows) ภาษา UI/Log ทั้งหมดเป็นภาษาไทย — รักษาไว้แบบนั้น

## 2. วิธีรัน

```bash
npm install
node index.js   # รันบนพอร์ต 3000
```

ต้องมี `.env` (ไม่อยู่ใน repo): `LINE_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `SLIP_PROVIDER` (slipok|easyslip|thunder|slipverify) พร้อม key ของผู้ให้บริการนั้น, `MERCHANT_ACCOUNT_NAME`, `DISCORD_WEBHOOK_URL` — ดูรายชื่อตัวแปรทั้งหมดได้จาก handler `/api/admin/setup_keys` ใน index.js

## 3. แผนที่ไฟล์ (อ่านเฉพาะที่เกี่ยวข้องกับงาน)

| ไฟล์ | บทบาท |
|---|---|
| `index.js` (~4,700 บรรทัด) | ทั้งเซิร์ฟเวอร์ในไฟล์เดียว: API routes, LINE webhook, ตรวจสลิป, คำนวณสิทธิ์, คิว, รอบไลฟ์, Kerry export, tunnel, auto-updater |
| `db.js` | SQLite (better-sqlite3, WAL) + query builder เลียน interface ของ Supabase — **ตัวแปรชื่อ `supabase` ใน index.js คือ SQLite ในเครื่อง ไม่ใช่คลาวด์** |
| `public/index.html` (~3,500 บรรทัด) | Dashboard แม่ค้า (vanilla JS + Socket.IO, ไม่มี framework) |
| `public/history.html` | หน้าประวัติรายวัน/รายรอบไลฟ์ |
| `sentinel/` | AI agent เฝ้าระบบ (dev-only, ไม่เกี่ยวกับธุรกิจหลัก) |
| `releases/` | zip อัปเดต self-host + `version.json` manifest — **อย่าลบ/ย้าย URL เด็ดขาด** (ด้อ 5.3) |
| `MEMORY.md` | บันทึกสถานะโปรเจค + รายละเอียดการใช้งานจริงของร้าน |

ตารางหลักใน DB: `slips` (สลิป+สิทธิ์), `customers` (ยอดเงินค้างในกระเป๋าลูกค้า), `configs` (key-value เก็บทุกอย่าง: ตั้งค่าร้าน, ประวัติรอบไลฟ์ `session_hist_*`, ที่อยู่ลูกค้า `cust_addr_*`), `admins`

## 4. กฎธุรกิจที่ห้ามทำลาย (invariants)

### 4.1 การเงิน (แก้ต้องรอบคอบที่สุด — เคยบั๊กมาแล้วหลายเวอร์ชัน)
- `calculateBestDraws` = Dynamic Programming 2 state: จ่ายค่าส่ง / ส่งฟรีเมื่อสะสมครบ `freeShippingThreshold` ชิ้น เพดานงบ `MAX_DP_BUDGET` = 500,000 บาท
- `holdExactPrice`: โอนมาเท่าราคาสินค้าพอดีชิ้นแรก = พักยอดรอค่าส่ง ไม่ให้สินค้าชิ้นที่ถูกกว่าแทน
- `walletAfter`: ได้ชิ้นเก็บเศษลงกระเป๋า / ไม่ได้ชิ้นเก็บเฉพาะเงินที่โอนจริง (ห้ามรวมค่าส่งเสมือนเข้าไป — บั๊ก v1.0.7–1.0.10)
- เริ่มไลฟ์รอบใหม่ = รีเซ็ต `customers.balance` ทุกคนเป็น 0 (v1.0.13) มีเตือนก่อนกดเริ่ม
- สถานะสลิป: `waiting, called, skipped, completed, cleared, abnormal_pending, rejected`

### 4.2 กันสลิปซ้ำ 3 ชั้น (ห้ามถอดชั้นใดชั้นหนึ่ง)
pre-check `trans_ref` → double-check ใน atomic transaction → partial UNIQUE index `idx_slips_trans_ref` ใน db.js

### 4.3 รวมบิล 2 รอบ (v1.0.15)
รอบที่จบแล้วตั้ง `holdMerge` → รอบถัดไปมี `mergeFrom` → ลูกค้าซื้อทั้งสองรอบไม่เก็บค่าส่งซ้ำ นับชิ้นรวมเพื่อส่งฟรี export เป็นไฟล์เดียว — รวมได้สูงสุด 2 รอบ (`canHoldSession`)

### 4.4 ความปลอดภัย
- RBAC 3 ชั้น: Tier A (หน้าคิว/Kerry — เครื่องร้านผ่าน `isDirectLocalRequest` ไม่ต้อง login, ผ่าน tunnel ต้อง login), Tier B (`/api/admin/*`, `/api/system/*` = merchant+dreamdev), Tier C (`/api/test/*`, sentinel, reset = dreamdev เท่านั้น)
- LINE webhook ตรวจ HMAC signature + dedup `processedMessageIds`

## 5. กับดักสำคัญ

1. **`index.js` ไม่มี `module.exports` และ require เมื่อไหร่ server รันทันที** (tunnel, sentinel, DB ทั้งชุด) — จะเขียน unit test ต้องแยก pure logic ออกเป็นโมดูลก่อน
2. **ปุ่มตอบกลับ LINE จำนวนมากถูก comment ไว้** (`// await replyLineMessage(...)`) — ปิดโดยเจตนาตามคำสั่งเจ้าของร้าน เปิดใหม่ได้เฉพาะเมื่อเจ้าของสั่ง เหลือไว้เฉพาะข้อความขอบคุณตอนได้สิทธิ์ และข้อความบอกยอดที่ต้องโอนเพิ่ม
3. **Auto-updater ดาวน์โหลดจาก raw.githubusercontent.com เท่านั้น** — updater รุ่นที่ติดตั้งก่อน v1.0.10 บล็อก redirect ไป GitHub release-assets การเปลี่ยนกลยุทธ์ hosting ต้องคุยกับเจ้าของก่อน
4. **Gemini API Key ในหน้าตั้งค่าเป็นค่ามาตรฐานของระบบ แม่ค้าแก้ไม่ได้** (readonly สำหรับ merchant) — โดยเจตนา
5. **`.env` / `data.sqlite` / `backups/` ไม่เคยขึ้น repo** (ตรวจ .gitignore แล้วครบ) — อย่า commit เด็ดขาด
6. ตัวเลขเงินทุกจุดเป็นบาท (float ได้ทศนิยม) แสดงผลผ่าน `fmtBaht`

## 6. สถานะปัจจุบันและแผนที่ตกลงไว้

- ยังไม่มี test และ CI (`npm test` เป็น placeholder)
- แผนที่ตกลงกับเจ้าของไว้: (1) แยก pure logic การเงินออกจาก index.js เป็นโมดูลแรก → (2) เขียน unit test ให้ logic เงิน → (3) ค่อยแยก index.js ที่เหลือตามโดเมน → (4) เพิ่ม CI — **ห้ามข้ามขั้น test ไปแยกไฟล์ทั้งไฟล์**
- โครงสร้าง commit: ข้อความอธิบายเป็นอังกฤษ สไตล์ `feat(v1.0.x): ...` / `fix: ...` / `release: ...` / `docs: ...`

## 7. ไฟล์ที่ไม่ควรเปิดทั้งไฟล์ (ประหยัด token)

ขนาดวัดจาก commit นี้ (v1.0.15):
- `index.js` 4,699 บรรทัด และ `public/index.html` 3,506 บรรทัด: อ่านเป็นช่วง (offset/limit) หลังหาตำแหน่งด้วย `grep -n "function ชื่อ"` หรือ `code get_document_symbols` (`public/index.html` ไม่มีบรรทัดยาวเกิน 474 ตัวอักษรแล้ว โลโก้ผู้ให้บริการอ้างผ่าน `/images/providers/*` แทน base64)
- `public/images/providers/logos_base64.json` (329 KB, 6 บรรทัด มี 1 บรรทัดยาว 279,178 ตัวอักษร): ไม่มีโค้ดใน repo อ้างถึง (ตรวจด้วย `git grep`) อย่าเปิด
- `public/manual_images/page_*.html` (ไฟล์ละ ~440 KB): สร้างจาก `node generate_staging_pages.js` ไม่อยู่ใน git (อยู่ใน `.gitignore`) ส่วนภาพ PNG ในโฟลเดอร์เดียวกันอยู่ใน git
- `package-lock.json` (209 KB), `releases/*.zip` (12 ไฟล์ รวม ~4.2 MB), `*.docx` (3 ไฟล์): ไบนารี/ไฟล์สร้างอัตโนมัติ ไม่ต้องอ่านเว้นแต่ถูกสั่ง
- ถ้าเพิ่มรูปใหม่ลง `public/index.html` ให้ใส่เป็นไฟล์ใน `public/images/` แล้วอ้างด้วย path ไม่ฝัง base64 (หน้าคู่มือ `generate_staging_pages.js` จะฝังกลับเองเฉพาะ `/images/providers/*`)
