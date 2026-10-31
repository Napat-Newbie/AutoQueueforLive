@echo off
setlocal enabledelayedexpansion
title AutoQueueforLive Auto-Updater
cd /d "%~dp0"
rem ---------------------------------------------------------------------------
rem AutoQueueforLive updater. Keep this file ASCII-only and LF-only.
rem cmd.exe reads a running .bat by byte offset, and the update package
rem overwrites this file. So the updater first copies itself to %TEMP% and
rem runs from there, where nothing can overwrite it mid-run.
rem Updaters v1.0.10 - v1.0.18 (shipped in every shop) cannot do that: after
rem their xcopy they keep reading THIS file at byte 1920. The LEGACY
rem LANDING below must start exactly there (tests/unit/updater-bat.test.js).
rem Never add or remove bytes above the landing without re-running that test.
rem ---------------------------------------------------------------------------
if /i not "%~2"=="--from-temp" (
    copy /y "%~f0" "%TEMP%\aq_updater_run.bat" >nul 2>&1
    if exist "%TEMP%\aq_updater_run.bat" "%TEMP%\aq_updater_run.bat" "%~1" --from-temp "%~dp0."
)
if /i "%~2"=="--from-temp" cd /d "%~3"
goto :main
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem----------------------------------------------------------------------------
rem------------------------------------------------
rem ===== LEGACY LANDING (byte 1920) - only an OLD updater that has just overwritten this file runs these lines =====
if exist "updates\extracted" rmdir /s /q "updates\extracted"
if exist "updates\update_incoming.zip" del /f /q "updates\update_incoming.zip"
echo [5/5] Restarting AutoQueueforLive...
ping -n 2 127.0.0.1 >nul
start "" wscript.exe "AutoQueueforLive.vbs"
echo Update complete.
exit
:main
set TARGET_PID=%~1
set UPDATE_ZIP=updates\update_incoming.zip
set EXTRACT_DIR=updates\extracted
rem Backup folder name from PowerShell: same format on every Windows language and Windows version.
set STAMP=
for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"`) do set STAMP=%%I
if not defined STAMP set STAMP=%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set BACKUP_DIR=backups\auto_backup_%STAMP%
set BACKUP_DIR=%BACKUP_DIR: =0%

echo ========================================================
echo       AutoQueueforLive System Updater
echo ========================================================
echo [1/5] Terminating previous process (PID: %TARGET_PID%)...
rem ping instead of timeout: timeout fails at once when there is no console (the app starts us hidden)
ping -n 3 127.0.0.1 >nul
if not "%TARGET_PID%"=="" (
    taskkill /F /PID %TARGET_PID% >nul 2>&1
)
taskkill /F /IM bin_node.exe >nul 2>&1

echo [2/5] Backing up current version to %BACKUP_DIR%...
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if exist index.js copy /y index.js "%BACKUP_DIR%\" >nul
if exist db.js copy /y db.js "%BACKUP_DIR%\" >nul
if exist package.json copy /y package.json "%BACKUP_DIR%\" >nul
if exist lib xcopy /y /e /i /q lib "%BACKUP_DIR%\lib" >nul
if exist public xcopy /y /e /i /q public "%BACKUP_DIR%\public" >nul
if exist templates xcopy /y /e /i /q templates "%BACKUP_DIR%\templates" >nul

echo [3/5] Extracting update files...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
mkdir "%EXTRACT_DIR%"

powershell -NoProfile -Command "Expand-Archive -Path '%UPDATE_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force"

echo [4/5] Enforcing 100%% merchant data protection...
rem Strictly delete any sensitive files from update package
if exist "%EXTRACT_DIR%\data.sqlite" del /f /q "%EXTRACT_DIR%\data.sqlite"
if exist "%EXTRACT_DIR%\data.sqlite-shm" del /f /q "%EXTRACT_DIR%\data.sqlite-shm"
if exist "%EXTRACT_DIR%\data.sqlite-wal" del /f /q "%EXTRACT_DIR%\data.sqlite-wal"
if exist "%EXTRACT_DIR%\.env" del /f /q "%EXTRACT_DIR%\.env"
if exist "%EXTRACT_DIR%\public\uploads" rmdir /s /q "%EXTRACT_DIR%\public\uploads"

echo Applying update files...
xcopy /y /e /s /i /q "%EXTRACT_DIR%\*" "." >nul

rem Cleanup temporary files
rmdir /s /q "%EXTRACT_DIR%"
if exist "%UPDATE_ZIP%" del /f /q "%UPDATE_ZIP%"

echo [5/5] Restarting AutoQueueforLive...
ping -n 2 127.0.0.1 >nul
start "" wscript.exe "AutoQueueforLive.vbs"

echo Update complete.
exit
