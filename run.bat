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
set "TUNNEL_HEALTH_PORT=8080"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"PORT=" ".env"') do set "CADGPT_PORT=%%A"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"OPENAI_TUNNEL_HEALTH_PORT=" ".env"') do set "TUNNEL_HEALTH_PORT=%%A"

start "CadGPT Local MCP" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Port %CADGPT_PORT% -Force

echo Waiting for CadGPT local MCP on port %CADGPT_PORT%...
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..40) { try { $r=Invoke-RestMethod 'http://127.0.0.1:%CADGPT_PORT%/health' -TimeoutSec 1; if ($r.status -eq 'ok' -and $r.name -eq 'cadgpt') { $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERROR] CadGPT local MCP did not become ready.
  echo Run doctor.bat for diagnostics.
  pause
  exit /b 1
)

start "CadGPT Secure Tunnel" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Port %CADGPT_PORT% -HealthPort %TUNNEL_HEALTH_PORT%

echo Waiting for OpenAI Secure MCP Tunnel on health port %TUNNEL_HEALTH_PORT%...
powershell -NoProfile -Command "$ok=$false; foreach ($i in 1..40) { try { $r=Invoke-WebRequest 'http://127.0.0.1:%TUNNEL_HEALTH_PORT%/readyz' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200 -and $r.Content -match 'ready') { $ok=$true; break } } catch {}; Start-Sleep -Milliseconds 500 }; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo [ERROR] Secure MCP Tunnel did not become ready.
  echo CadGPT local MCP is running, but ChatGPT connection is not ready.
  echo Run doctor.bat for diagnostics.
  pause
  exit /b 1
)

echo.
echo [OK] CadGPT local MCP is ready.
echo [OK] OpenAI Secure MCP Tunnel is ready.
echo.
echo AutoCAD may be opened before or after CadGPT. CAD status is reported separately.
echo Open ChatGPT and use the configured CadGPT MCP app.
echo.
exit /b 0
