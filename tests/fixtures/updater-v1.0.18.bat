@echo off
setlocal enabledelayedexpansion
title AutoQueueforLive Auto-Updater
cd /d "%~dp0"

set TARGET_PID=%1
set UPDATE_ZIP=updates\update_incoming.zip
set EXTRACT_DIR=updates\extracted
set BACKUP_DIR=backups\auto_backup_%DATE:~-4%%DATE:~3,2%%DATE:~0,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%
set BACKUP_DIR=%BACKUP_DIR: =0%

echo ========================================================
echo       AutoQueueforLive System Updater
echo ========================================================
echo [1/5] Terminating previous process (PID: %TARGET_PID%)...
timeout /t 2 /nobreak >nul

if not "%TARGET_PID%"=="" (
    taskkill /F /PID %TARGET_PID% >nul 2>&1
)
taskkill /F /IM bin_node.exe >nul 2>&1

echo [2/5] Backing up current version to %BACKUP_DIR%...
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if exist index.js copy /y index.js "%BACKUP_DIR%\" >nul
if exist db.js copy /y db.js "%BACKUP_DIR%\" >nul
if exist package.json copy /y package.json "%BACKUP_DIR%\" >nul
if exist public xcopy /y /e /i /q public "%BACKUP_DIR%\public" >nul
if exist templates xcopy /y /e /i /q templates "%BACKUP_DIR%\templates" >nul

echo [3/5] Extracting update files...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
mkdir "%EXTRACT_DIR%"

powershell -NoProfile -Command "Expand-Archive -Path '%UPDATE_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force"

echo [4/5] Enforcing 100%% merchant data protection...
REM Strictly delete any sensitive files from update package
if exist "%EXTRACT_DIR%\data.sqlite" del /f /q "%EXTRACT_DIR%\data.sqlite"
if exist "%EXTRACT_DIR%\data.sqlite-shm" del /f /q "%EXTRACT_DIR%\data.sqlite-shm"
if exist "%EXTRACT_DIR%\data.sqlite-wal" del /f /q "%EXTRACT_DIR%\data.sqlite-wal"
if exist "%EXTRACT_DIR%\.env" del /f /q "%EXTRACT_DIR%\.env"
if exist "%EXTRACT_DIR%\public\uploads" rmdir /s /q "%EXTRACT_DIR%\public\uploads"

echo Applying update files...
xcopy /y /e /s /i /q "%EXTRACT_DIR%\*" "." >nul

REM Cleanup temporary files
rmdir /s /q "%EXTRACT_DIR%"
if exist "%UPDATE_ZIP%" del /f /q "%UPDATE_ZIP%"

echo [5/5] Restarting AutoQueueforLive...
timeout /t 1 /nobreak >nul
start "" wscript.exe "AutoQueueforLive.vbs"

echo Update complete.
exit
