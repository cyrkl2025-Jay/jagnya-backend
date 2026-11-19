@echo off
title Universal Video Downloader
echo ========================================================
echo   Starting Universal Video Downloader...
echo   YouTube, Instagram & Facebook (up to 4K + Audio)
echo ========================================================
echo.

cd /d "%~dp0"
start http://127.0.0.1:5000
node server.js
pause
