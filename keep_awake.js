const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let preventSleepProc = null;

function enableSleepBlocker() {
  if (process.platform !== 'win32') return;

  // We write a tiny keepalive script that calls SetThreadExecutionState continuously
  const scriptContent = `
$code = @"
using System;
using System.Runtime.InteropServices;
public class WinSleep {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
Add-Type -TypeDefinition $code
# ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001) | ES_DISPLAY_REQUIRED (0x00000002)
while ($true) {
    [WinSleep]::SetThreadExecutionState(0x80000003)
    Start-Sleep -Seconds 60
}
`;

  const scriptPath = path.join(__dirname, 'keep_awake.ps1');
  try {
    fs.writeFileSync(scriptPath, scriptContent.trim(), 'utf8');
    preventSleepProc = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath
    ], {
      windowsHide: true,
      stdio: 'ignore'
    });

    preventSleepProc.unref();
    console.log('🛡️ Sleep Blocker Active: ป้องกันคอมพิวเตอร์เข้า Sleep Mode ระหว่างใช้งาน');
  } catch (err) {
    console.error('Cannot initialize Sleep Blocker:', err.message);
  }
}

function disableSleepBlocker() {
  if (preventSleepProc) {
    try {
      preventSleepProc.kill();
    } catch (e) {}
    preventSleepProc = null;
  }
  const scriptPath = path.join(__dirname, 'keep_awake.ps1');
  if (fs.existsSync(scriptPath)) {
    try { fs.unlinkSync(scriptPath); } catch (e) {}
  }
}

process.on('exit', disableSleepBlocker);
process.on('SIGINT', () => { disableSleepBlocker(); process.exit(); });
process.on('SIGTERM', () => { disableSleepBlocker(); process.exit(); });

module.exports = {
  enableSleepBlocker,
  disableSleepBlocker
};
