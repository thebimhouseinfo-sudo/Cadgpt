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
  echo [ERROR] package-lock.json is missing. Reproducible Node install cannot continue.
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
echo [1/9] Initializing CadGPT Beta AppData...
for %%D in (
  "appdata\data\runs"
  "appdata\lisp-draft"
  "appdata\runtime\dynamic-lisp"
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
echo [2/9] Installing locked CadGPT connector dependencies...
call npm ci
if errorlevel 1 goto :failed

echo.
echo [3/9] Generating stable CAD tool manifest...
python "%~dp0scripts\generate-cad-tool-manifest.py"
if errorlevel 1 goto :failed
if not exist "runtimes\cad-mcp\tool-manifest.json" (
  echo [ERROR] CAD tool manifest was not generated.
  goto :failed
)

echo.
echo [4/9] Building CadGPT connector and wake-agent...
call npm run build
if errorlevel 1 goto :failed

echo.
echo [5/9] Rebuilding isolated CAD MCP Python environment from lock...
call "%~dp0run.bat" stop >nul 2>nul
if exist ".venv-cad" (
  rmdir /s /q ".venv-cad"
  if exist ".venv-cad" (
    echo [ERROR] Could not remove existing .venv-cad. Stop running CadGPT/CAD MCP processes and retry setup.
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
echo [6/9] Configuring OpenAI Secure MCP Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Init
if errorlevel 1 goto :failed

echo.
echo [7/9] Installing CadGPT background autostart agent...
call "%~dp0run.bat" install
if errorlevel 1 goto :failed

echo.
echo [8/9] Verifying background listener status...
call "%~dp0run.bat" status
if errorlevel 1 goto :failed

echo.
echo [9/9] Running installation doctor...
call "%~dp0doctor.bat"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup complete
echo ========================================
echo CadGPT is installed as a hidden per-user wake-agent.
echo It starts automatically when you sign in to Windows.
echo Full CadGPT wakes only after ChatGPT calls it.
echo CAD MCP runs only while CadGPT is active and AutoCAD is running.
echo Beta AppData is stored under repo\appdata and can move to per-user LocalAppData when packaged.
echo No daily launcher is required.
echo.
echo Enable ChatGPT Developer Mode and add/select the CadGPT tunnel connection once.
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
