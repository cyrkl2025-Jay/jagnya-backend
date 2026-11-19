@echo off
title Push to GitHub - Universal Downloader
echo ========================================================
echo   Pushing code to GitHub to trigger APK Cloud Build...
echo ========================================================
echo.

cd /d "%~dp0"
.\bin\git\cmd\git.exe push -f origin main

echo.
echo ========================================================
echo   Done! Check the "Actions" tab on GitHub to see your
echo   APK building in the cloud!
echo ========================================================
pause
