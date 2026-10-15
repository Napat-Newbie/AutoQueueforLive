@echo off
cd /d "%~dp0"

REM Launch AutoQueueforLive background server
if exist "bin_node.exe" (
    bin_node.exe index.js
) else (
    node index.js
)
