const { execFileSync } = require('child_process');
const gh = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const git = 'C:\\Users\\napat\\AppData\\Local\\Programs\\MinGit\\cmd\\git.exe';
const token = execFileSync(gh, ['auth', 'token']).toString().trim();

execFileSync(git, ['add', '-A'], { stdio: 'inherit' });
execFileSync(git, ['commit', '-m', 'feat: Kiro Conductor hardening - 2-tier RBAC, midnight freeze fix, sqlite optimization'], { stdio: 'inherit' });
execFileSync(git, ['push', `https://x-access-token:${token}@github.com/Napat-Newbie/AutoQueueforLive.git`, 'main'], { stdio: 'inherit' });
console.log('✅ COMMIT & PUSH COMPLETED SUCCESSFULLY!');
