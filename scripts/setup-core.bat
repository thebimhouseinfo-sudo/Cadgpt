@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
cd /d "%ROOT%"
title CadGPT Setup Core

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js 20+ and run setup.bat again.
  exit /b 1
)
for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js 20+ is required. Current major version: %NODE_MAJOR%
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available.
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  echo CadGPT currently supports Python 3.11 through 3.14.
  exit /b 1
)
python -c "import sys; raise SystemExit(0 if (3,11) <= sys.version_info[:2] <= (3,14) else 1)"
if errorlevel 1 (
  echo [ERROR] CadGPT currently supports Python 3.11 through 3.14.
  python --version
  exit /b 1
)
for /f "delims=" %%V in ('python -c "import sys; print('.'.join(map(str, sys.version_info[:3])))"') do set "PYTHON_VERSION=%%V"
echo [OK] Python %PYTHON_VERSION%

if not exist "package-lock.json" (
  echo [ERROR] package-lock.json is missing.
  exit /b 1
)
if not exist "runtimes\cad-mcp\requirements.lock.txt" (
  echo [ERROR] runtimes\cad-mcp\requirements.lock.txt is missing.
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [OK] Created .env
)
findstr /B /C:"CADGPT_BUILD_PROFILE=" ".env" >nul 2>nul
if errorlevel 1 (
  >>".env" echo CADGPT_BUILD_PROFILE=development
  echo [OK] Enabled development profile for this source checkout.
)

echo.
echo Stopping any previously owned CadGPT tray/runtime before dependency/build changes...
call "%ROOT%\run.bat" stop >nul 2>nul

echo.
echo Checking for pending CAD MCP development recovery...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$repo=[System.IO.Path]::GetFullPath('%ROOT%\'); $line=Get-Content '.env' -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*CADGPT_APPDATA_ROOT\s*=' -and -not $_.TrimStart().StartsWith('#') } | Select-Object -First 1; $configured=if($line){(($line -split '=',2)[1].Trim()).Trim([char]39).Trim([char]34)}else{'appdata'}; $root=if([System.IO.Path]::IsPathRooted($configured)){[System.IO.Path]::GetFullPath($configured)}else{[System.IO.Path]::GetFullPath((Join-Path $repo $configured))}; $recovery=Join-Path $root 'state\cad-mcp-dev-recovery'; $pending=@(); if(Test-Path $recovery){$pending=@(Get-ChildItem $recovery -Directory -ErrorAction SilentlyContinue | Where-Object { -not ($_.Name.StartsWith('.') -and $_.Name.EndsWith('.tmp')) })}; if($pending.Count -gt 0){ Write-Host '[ERROR] Pending CAD MCP development recovery baseline found.' -ForegroundColor Red; Write-Host 'Run CadGPT development recovery before setup so setup cannot overwrite an unaccepted runtime.' -ForegroundColor Yellow; exit 42 }"
if errorlevel 1 (
  echo [ERROR] Setup stopped to preserve CAD MCP crash-recovery state.
  exit /b 1
)

echo.
echo [1/9] Initializing configured CadGPT AppData...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$repo=[System.IO.Path]::GetFullPath('%ROOT%\'); $line=Get-Content '.env' -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\s*CADGPT_APPDATA_ROOT\s*=' -and -not $_.TrimStart().StartsWith('#') } | Select-Object -First 1; $configured=if($line){(($line -split '=',2)[1].Trim()).Trim([char]39).Trim([char]34)}else{'appdata'}; $root=if([System.IO.Path]::IsPathRooted($configured)){[System.IO.Path]::GetFullPath($configured)}else{[System.IO.Path]::GetFullPath((Join-Path $repo $configured))}; $dirs=@('libraries\lisp','libraries\jobs','registry\user','workspace\lisp-draft','workspace\job-draft','data\runs','runtime\dynamic-lisp','drawings','state','logs'); New-Item -ItemType Directory -Force -Path $root | Out-Null; foreach($rel in $dirs){$target=Join-Path $root $rel; New-Item -ItemType Directory -Force -Path $target | Out-Null; if(-not (Test-Path $target)){Write-Error ('Could not create AppData directory: '+$target); exit 1}}; Write-Host ('[OK] CadGPT AppData root: '+$root)"
if errorlevel 1 goto :failed

echo.
echo [2/9] Installing locked Node dependencies...
call npm ci
if errorlevel 1 goto :failed

echo.
echo [3/9] Generating CAD MCP tool manifest...
python "%ROOT%\scripts\generate-cad-tool-manifest.py"
if errorlevel 1 goto :failed
if not exist "runtimes\cad-mcp\tool-manifest.json" (
  echo [ERROR] CAD tool manifest was not generated.
  goto :failed
)

echo.
echo [4/9] Building CadGPT...
call npm run build
if errorlevel 1 goto :failed

echo.
echo [5/9] Running static regression tests...
call npm run test:unit
if errorlevel 1 goto :failed

echo.
echo [6/9] Rebuilding isolated CAD MCP Python environment...
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
echo [7/9] Configuring OpenAI Secure MCP Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\openai-tunnel.ps1" -Init
if errorlevel 1 goto :failed

echo.
echo [8/9] Installing and starting CadGPT tray runtime...
call "%ROOT%\run.bat" install
if errorlevel 1 goto :failed

set "CADGPT_PORT=3100"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"PORT=" ".env"') do set "CADGPT_PORT=%%A"
set "CADGPT_TUNNEL_HEALTH_PORT=8180"
for /f "tokens=2 delims==" %%A in ('findstr /B /C:"OPENAI_TUNNEL_HEALTH_PORT=" ".env"') do set "CADGPT_TUNNEL_HEALTH_PORT=%%A"

echo Waiting for slim MCP + Secure Tunnel on ports %CADGPT_PORT% / %CADGPT_TUNNEL_HEALTH_PORT%...
powershell -NoProfile -Command "$ok=$false; foreach($i in 1..150){ try{$h=Invoke-RestMethod 'http://127.0.0.1:%CADGPT_PORT%/health' -TimeoutSec 1; $t=Invoke-WebRequest 'http://127.0.0.1:%CADGPT_TUNNEL_HEALTH_PORT%/readyz' -UseBasicParsing -TimeoutSec 1; if($h.status -eq 'ok' -and $h.name -eq 'cadgpt' -and $t.StatusCode -eq 200){$ok=$true;break}}catch{}; Start-Sleep -Milliseconds 500}; if(-not $ok){exit 1}"
if errorlevel 1 (
  echo [ERROR] Tray started but slim MCP or Secure Tunnel did not become ready.
  echo.
  echo ---- CadGPT runtime diagnostics ----
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$log='appdata\logs'; foreach($n in @('tray.log','cadgpt.err.log','cadgpt.out.log','tunnel.err.log','tunnel.out.log')){ $p=Join-Path $log $n; if(Test-Path $p){ Write-Host ('--- '+$n+' ---'); Get-Content $p -Tail 30 } }"
  goto :failed
)

echo.
echo [9/9] Running installation doctor...
call "%ROOT%\doctor.bat"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup complete
echo ========================================
echo CadGPT now starts as a Windows tray app for this user.
echo Idle runtime: tray + slim admission MCP + Secure Tunnel.
echo Heavy FILE/CAD capabilities load only after explicit current-turn CadGPT invocation (@cadgpt or CadGPT plugin/icon) and work registration.
echo CAD MCP starts only on actual CAD demand; AutoCAD is never launched by CadGPT.
echo cad-mcp-dev is development-only and is excluded from production packaging.
echo.
echo Manual control: run.bat status ^| start ^| stop ^| restart ^| uninstall
echo Diagnostics: doctor.bat
echo.
exit /b 0

:failed
echo.
echo [ERROR] CadGPT setup core failed.
exit /b 1
