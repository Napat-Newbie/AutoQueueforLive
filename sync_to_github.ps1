$git = "$env:LOCALAPPDATA\Programs\MinGit\cmd\git.exe"
$gh = "C:\Program Files\GitHub CLI\gh.exe"

Write-Host "1. Setting up git user info..."
& $git config --global user.name "Napat-Newbie"
& $git config --global user.email "napat.work@gmail.com"
& $git config --global init.defaultBranch main

Write-Host "2. Setting up GitHub CLI credentials helper for Git..."
& $gh auth setup-git

Write-Host "3. Initializing Git repository..."
if (-not (Test-Path .git)) {
    & $git init
}

Write-Host "4. Checking remote..."
$remotes = & $git remote
if ($remotes -notcontains "origin") {
    & $git remote add origin https://github.com/Napat-Newbie/AutoQueueforLive.git
} else {
    & $git remote set-url origin https://github.com/Napat-Newbie/AutoQueueforLive.git
}

Write-Host "5. Adding files to git..."
& $git add .

Write-Host "6. Status:"
& $git status --short

Write-Host "7. Committing..."
& $git commit -m "AutoQueueforLive complete codebase v1.0.5 - Realtime Slip Verification, Kerry EasyShip Export, Remote Diagnostics"

Write-Host "8. Setting branch to main..."
& $git branch -M main

Write-Host "9. Pushing to GitHub main..."
& $git push -u origin main --force

Write-Host "✅ Cloud Sync to GitHub complete!"
