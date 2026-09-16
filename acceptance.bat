@echo off
setlocal
cd /d "%~dp0"
title CadGPT Local Acceptance

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0acceptance.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo [FAIL] CadGPT local acceptance did not pass.
  pause
  exit /b %RC%
)

echo.
echo [OK] CadGPT local acceptance passed.
pause
exit /b 0
