@echo off
cd /d "%~dp0"
echo ===================================================
echo   Pushing Jagnya Downloader to GitHub...
echo ===================================================
echo.
echo If a browser window opens, click "Authorize Git".
echo.
.\bin\git\cmd\git.exe push -u origin main
echo.
echo ===================================================
echo   Done! Press any key to close this window.
echo ===================================================
pause
