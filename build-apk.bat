@echo off
set "JAVA_HOME=%~dp0bin\jdk\jdk-17.0.12+7"
set "PATH=%JAVA_HOME%\bin;%PATH%"
cd /d "%~dp0android"
"C:\Users\PLANTSITE PS\.gradle\wrapper\dists\gradle-8.13-bin\5xuhj0ry160q40clulazy9h7d\gradle-8.13\bin\gradle.bat" assembleDebug --stacktrace
