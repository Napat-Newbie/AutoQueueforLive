const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const baseDir = path.join(__dirname, 'public', 'manual_images');
const brainDir = 'C:\\Users\\napat\\.gemini\\antigravity\\brain\\82c1fccc-253f-4df2-a685-20e6068f9a40\\manual_images';

if (!fs.existsSync(brainDir)) {
    fs.mkdirSync(brainDir, { recursive: true });
}

const screenshots = [
    { html: 'page_dashboard.html', out: '01_live_dashboard.png', size: '1280,950' },
    { html: 'page_first_time_login.html', out: '02_first_time_login.png', size: '1280,780' },
    { html: 'page_setup_wizard.html', out: '03_setup_wizard_providers.png', size: '1280,920' },
    { html: 'page_kerry_export.html', out: '04_kerry_export_modal.png', size: '1280,850' },
    { html: 'page_manual_slip.html', out: '05_manual_slip_modal.png', size: '1280,850' }
];

screenshots.forEach(s => {
    const htmlFile = path.join(baseDir, s.html);
    const outFile = path.join(baseDir, s.out);
    const fileUrl = 'file:///' + htmlFile.replace(/\\/g, '/');

    const cmd = `"${edgePath}" --headless --disable-gpu --hide-scrollbars --window-size=${s.size} --screenshot="${outFile}" "${fileUrl}"`;
    console.log(`Capturing: ${s.out}...`);
    try {
        execSync(cmd, { stdio: 'ignore' });
        // copy to brain directory as well
        fs.copyFileSync(outFile, path.join(brainDir, s.out));
        console.log(`Success: ${s.out}`);
    } catch (e) {
        console.error(`Failed ${s.out}:`, e.message);
    }
});

console.log('All screenshots captured and saved to both public/manual_images and brain artifact directory!');
