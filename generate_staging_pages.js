const fs = require('fs');
const path = require('path');

const baseDir = path.join(__dirname, 'public', 'manual_images');
if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
}

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// 1. Dashboard View (พร้อมคิวตัวอย่าง)
let dashInjection = `
<script>
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('totalAmount').innerText = '14,350.00';
  document.getElementById('uniqueCustomers').innerText = '24';
  document.getElementById('totalSlips').innerText = '28';
  document.getElementById('totalDraws').innerText = '41';
  document.getElementById('waitingQueuesCount').innerText = '2';
  document.getElementById('liveTimerDisplay').innerText = '⏱️ 01:25:40';
  document.getElementById('btnStartLive').style.display = 'none';
  document.getElementById('btnEndLive').style.display = 'flex';
  
  // mock active
  document.getElementById('active-queue-list').innerHTML = \`
    <div class="queue-card active-card" style="display:flex; justify-content:space-between; align-items:center; background:#eff6ff; border:1px solid #bfdbfe; border-left:6px solid #1a73e8; padding:15px; border-radius:10px; margin-bottom:10px;">
      <div>
        <div style="font-size:1.15em; font-weight:600; color:#1e293b;">[คิวที่ 4] 👤 คุณแอนนี่ (LINE: Annie_Baby)</div>
        <div style="font-size:0.95em; color:#475569; margin-top:4px;">💰 ยอดเงิน: <strong style="color:#16a34a;">฿ 700.00</strong> | 🎁 สิทธิ์จุ่ม: <strong>2 ชิ้น</strong> [ กล่องสุ่ม Crybaby x2 ]</div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn-danger" style="padding:8px 16px;">⏭️ ข้ามคิว</button>
        <button class="btn-success" style="padding:8px 20px;">✅ เสร็จสิ้น</button>
      </div>
    </div>
  \`;
  
  // mock waiting
  document.getElementById('queue-list').innerHTML = \`
    <div class="queue-card" style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid #cbd5e1; border-left:6px solid #10b981; padding:14px; border-radius:10px; margin-bottom:10px; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
      <div>
        <div style="font-size:1.05em; font-weight:600; color:#1e293b;">[คิวที่ 5] 👤 คุณบอส สั่งด่วน</div>
        <div style="font-size:0.9em; color:#64748b; margin-top:3px;">💰 ยอดเงิน: ฿ 350.00 | 🎁 สิทธิ์จุ่ม: 1 ชิ้น [ กล่องสุ่ม Crybaby x1 ]</div>
      </div>
      <button class="btn-primary" style="padding:8px 18px;">🎮 เรียกเล่น</button>
    </div>
    <div class="queue-card" style="display:flex; justify-content:space-between; align-items:center; background:#ffffff; border:1px solid #cbd5e1; border-left:6px solid #10b981; padding:14px; border-radius:10px; margin-bottom:10px; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
      <div>
        <div style="font-size:1.05em; font-weight:600; color:#1e293b;">[คิวที่ 6] 👤 คุณมินนี่ น่ารัก</div>
        <div style="font-size:0.9em; color:#64748b; margin-top:3px;">💰 ยอดเงิน: ฿ 1,100.00 | 🎁 สิทธิ์จุ่ม: 2 ชิ้น [ พวงกุญแจ Labubu x2 ]</div>
      </div>
      <button class="btn-primary" style="padding:8px 18px;">🎮 เรียกเล่น</button>
    </div>
  \`;
  
  // mock abnormal
  document.getElementById('abnormal-queue-list').innerHTML = \`
    <div class="queue-card" style="display:flex; justify-content:space-between; align-items:center; background:#fffbeb; border:1px solid #fde68a; border-left:6px solid #f59e0b; padding:12px; border-radius:10px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div style="width:48px; height:48px; background:#fef3c7; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:1.5em;">🧾</div>
        <div>
          <div style="font-weight:600; color:#92400e;">👤 ลูกค้าท่านหนึ่ง (สลิปไม่มี QR Code หรือรอตรวจเอง)</div>
          <div style="font-size:0.85em; color:#b45309;">เวลาโอน: 20:25 น. (กรุณาคลิกเพื่อตรวจดูรูปภาพสลิป)</div>
        </div>
      </div>
      <button class="btn-warning" style="padding:8px 16px; background:#f59e0b; color:#fff; border:none; border-radius:6px; cursor:pointer; font-family:'Kanit';">🔍 ตรวจสอบภาพสลิป</button>
    </div>
  \`;
  
  // mock products
  const pList = document.getElementById('productList');
  pList.innerHTML = \`
    <div style="display:flex; gap:10px; align-items:center;">
      <input type="text" value="กล่องสุ่ม Crybaby Monster" style="flex:2; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
      <input type="number" value="350" style="width:100px; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
      <button class="btn-danger" style="padding:8px 12px;">🗑️</button>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <input type="text" value="พวงกุญแจ Labubu Macaron" style="flex:2; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
      <input type="number" value="550" style="width:100px; padding:8px; border:1px solid #cbd5e1; border-radius:6px;">
      <button class="btn-danger" style="padding:8px 12px;">🗑️</button>
    </div>
  \`;
  document.getElementById('shippingInput').value = '40';
  document.getElementById('thresholdInput').value = '3';
  document.getElementById('merchantInput').value = 'นภัสสร ใจดี';
  document.getElementById('openchatInput').value = 'https://line.me/ti/g2/DEMO_OPENCHAT';
});
</script>
`;
fs.writeFileSync(path.join(baseDir, 'page_dashboard.html'), html.replace('</body>', dashInjection + '</body>'), 'utf8');

// 2. Setup Wizard Modal View
let setupInjection = dashInjection + `
<script>
window.addEventListener('load', () => {
  document.getElementById('setupWizardModal').style.display = 'flex';
  selectSlipProvider('slipok');
  document.getElementById('wizLineToken').value = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...LINE_CHANNEL_ACCESS_TOKEN';
  document.getElementById('wizSlipOkKey').value = 'SLIPOK_SECRET_API_KEY_xxxx';
  document.getElementById('wizSlipOkBranch').value = '78194';
});
</script>
`;
fs.writeFileSync(path.join(baseDir, 'page_setup_wizard.html'), html.replace('</body>', setupInjection + '</body>'), 'utf8');

// 3. First Time Password Setup Modal View
let firstTimeInjection = `
<script>
window.addEventListener('load', () => {
  document.getElementById('devAuthModal').style.display = 'flex';
  document.getElementById('authModalTitle').innerText = '✨ กำหนดรหัสผ่านร้านค้า (ครั้งแรก)';
  document.getElementById('authNotice').innerText = 'ยินดีต้อนรับสู่ระบบ AutoQueue! กรุณากำหนดรหัสผ่านประจำร้านค้าของคุณ (อย่างน้อย 4 ตัวอักษร) เพื่อใช้เข้าจัดการเชื่อมต่อ LINE และผู้ให้บริการตรวจสลิปในอนาคต';
  document.getElementById('authPassLabel').innerText = 'กำหนดรหัสผ่านร้านค้าใหม่:';
  document.getElementById('btnAuthSubmit').innerText = 'บันทึกรหัสผ่าน & เริ่มตั้งค่า';
});
</script>
`;
fs.writeFileSync(path.join(baseDir, 'page_first_time_login.html'), html.replace('</body>', firstTimeInjection + '</body>'), 'utf8');

// 4. Kerry Express Modal View
let kerryInjection = dashInjection + `
<script>
window.addEventListener('load', () => {
  document.getElementById('kerryExportModal').style.display = 'flex';
  document.getElementById('kerryStatusDetails').innerHTML = '✅ พบที่อยู่จัดส่งครบถ้วน <strong>23 / 24 ออเดอร์</strong> (พร้อมส่งออก Kerry Excel)';
  document.getElementById('kerryMissingList').style.display = 'block';
  document.getElementById('kerryMissingUl').innerHTML = '<li>คุณวรรณา (LINE: Wanna_Doll) - ยังไม่พิมพ์ส่งที่อยู่เข้ามาใน LINE</li>';
});
</script>
`;
fs.writeFileSync(path.join(baseDir, 'page_kerry_export.html'), html.replace('</body>', kerryInjection + '</body>'), 'utf8');

// 5. Manual Slip Modal View
let slipModalInjection = dashInjection + `
<script>
window.addEventListener('load', () => {
  document.getElementById('checkSlipModal').style.display = 'flex';
  document.getElementById('checkSlipCustomerName').innerText = 'คุณมด (LINE: Mod_Kk)';
  document.getElementById('checkSlipAmount').value = '350';
  document.getElementById('checkSlipImage').src = 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=500&auto=format&fit=crop&q=60';
});
</script>
`;
fs.writeFileSync(path.join(baseDir, 'page_manual_slip.html'), html.replace('</body>', slipModalInjection + '</body>'), 'utf8');

console.log('Successfully generated all staging html files!');
