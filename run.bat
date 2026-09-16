@echo off
setlocal
cd /d "%~dp0"
title CadGPT Launcher

echo.
echo ========================================
echo   Starting CadGPT

echo ========================================
echo.

if not exist ".env" (
  echo [ERROR] CadGPT is not set up yet. Run setup.bat first.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [ERROR] Dependencies are missing. Run setup.bat first.
  pause
  exit /b 1
)

set "CADGPT_PORT=3000"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"PORT=" ".env"') do set "CADGPT_PORT=%%A"

start "CadGPT Local MCP" /min powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0start.ps1" -Port %CADGPT_PORT% -Force

echo Waiting for CadGPT local MCP on port %CADGPT_PORT%...
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..30) { try { $r=Invoke-WebRequest 'http://127.0.0.1:%CADGPT_PORT%/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERROR] CadGPT local MCP did not become ready.
  echo Check the 'CadGPT Local MCP' window for build/runtime errors.
  pause
  exit /b 1
)

start "CadGPT Secure Tunnel" /min powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0openai-tunnel.ps1" -Port %CADGPT_PORT%

echo.
echo [OK] CadGPT local MCP is ready.
echo [OK] Secure MCP Tunnel is starting with the configured stable tunnel identity.
echo.
echo AutoCAD may be opened before or after CadGPT. CAD connection status will be reported separately.
echo Open ChatGPT and use the configured CadGPT MCP app.
echo.
exit /b 0
