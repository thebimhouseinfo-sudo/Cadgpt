@echo off
setlocal
cd /d "%~dp0"
title CadGPT Setup

echo.
echo ========================================
echo   CadGPT - One-time setup
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js 20+ and run setup.bat again.
  pause
  exit /b 1
)
for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js 20+ is required. Current major version: %NODE_MAJOR%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  echo Python 3.11 is required for the current CadGPT beta runtime.
  pause
  exit /b 1
)
python -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3,11) else 1)"
if errorlevel 1 (
  echo [ERROR] Python 3.11.x is required for this beta build.
  python --version
  pause
  exit /b 1
)

if not exist "package-lock.json" (
  echo [ERROR] package-lock.json is missing.
  pause
  exit /b 1
)
if not exist "runtimes\cad-mcp\requirements.lock.txt" (
  echo [ERROR] runtimes\cad-mcp\requirements.lock.txt is missing.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [OK] Created .env
)

echo.
echo [1/10] Initializing CadGPT AppData...
for %%D in (
  "appdata\libraries\lisp"
  "appdata\libraries\jobs"
  "appdata\registry\user"
  "appdata\workspace\lisp-draft"
  "appdata\workspace\job-draft"
  "appdata\data\runs"
  "appdata\runtime\dynamic-lisp"
  "appdata\drawings"
  "appdata\state"
  "appdata\logs"
) do (
  if not exist "%%~D" mkdir "%%~D"
  if not exist "%%~D" (
    echo [ERROR] Could not create AppData directory: %%~D
    goto :failed
  )
)

echo.
echo [2/10] Installing locked Node dependencies...
call npm ci
if errorlevel 1 goto :failed

echo.
echo [3/10] Generating CAD MCP tool manifest...
python "%~dp0scripts\generate-cad-tool-manifest.py"
if errorlevel 1 goto :failed
if not exist "runtimes\cad-mcp\tool-manifest.json" (
  echo [ERROR] CAD tool manifest was not generated.
  goto :failed
)

echo.
echo [4/10] Building CadGPT...
call npm run build
if errorlevel 1 goto :failed

echo.
echo [5/10] Running static regression tests...
call npm test
if errorlevel 1 goto :failed

echo.
echo [6/10] Rebuilding isolated CAD MCP Python environment...
call "%~dp0run.bat" stop >nul 2>nul
if exist ".venv-cad" (
  rmdir /s /q ".venv-cad"
  if exist ".venv-cad" (
    echo [ERROR] Could not remove existing .venv-cad.
    goto :failed
  )
)
python -m venv .venv-cad
if errorlevel 1 goto :failed
".venv-cad\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :failed
".venv-cad\Scripts\python.exe" -m pip install -r "runtimes\cad-mcp\requirements.lock.txt"
if errorlevel 1 goto :failed
".venv-cad\Scripts\python.exe" -m pip check
if errorlevel 1 goto :failed

echo.
echo [7/10] Configuring OpenAI Secure MCP Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Init
if errorlevel 1 goto :failed

echo.
echo [8/10] Removing legacy Scheduled Task startup if present...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=Get-ScheduledTask -TaskName 'CadGPT Background Agent' -ErrorAction SilentlyContinue; if($t){ Stop-ScheduledTask -TaskName 'CadGPT Background Agent' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'CadGPT Background Agent' -Confirm:$false; Write-Host '[OK] Removed legacy CadGPT Scheduled Task.' }"
if errorlevel 1 goto :failed

echo.
echo [9/10] Installing and starting CadGPT tray runtime...
call "%~dp0run.bat" install
if errorlevel 1 goto :failed

echo Waiting for slim MCP + Secure Tunnel...
powershell -NoProfile -Command "$ok=$false; foreach($i in 1..150){ try{$h=Invoke-RestMethod 'http://127.0.0.1:3000/health' -TimeoutSec 1; $t=Invoke-WebRequest 'http://127.0.0.1:8080/readyz' -UseBasicParsing -TimeoutSec 1; if($h.status -eq 'ok' -and $h.name -eq 'cadgpt' -and $t.StatusCode -eq 200){$ok=$true;break}}catch{}; Start-Sleep -Milliseconds 500}; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo [ERROR] Tray started but slim MCP or Secure Tunnel did not become ready.
  goto :failed
)

echo.
echo [10/10] Running installation doctor...
call "%~dp0doctor.bat"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup complete
echo ========================================
echo CadGPT now starts as a Windows tray app for this user.
echo Idle runtime: tray + slim admission MCP + Secure Tunnel.
echo Heavy FILE/CAD capabilities load only after valid @cadgpt admission and work registration.
echo CAD MCP starts only on actual CAD demand; AutoCAD is never launched by CadGPT.
echo cad-mcp-dev is development-only and is excluded from production packaging.
echo.
echo Manual control: run.bat status ^| start ^| stop ^| restart ^| uninstall
echo Diagnostics: doctor.bat
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] CadGPT setup failed. Review the error above or run doctor.bat.
pause
exit /b 1
