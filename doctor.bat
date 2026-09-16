@echo off
setlocal
cd /d "%~dp0"
title CadGPT Doctor
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0doctor.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" pause
exit /b %RC%
