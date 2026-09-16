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
  echo Python 3.11+ is required for CAD MCP.
  pause
  exit /b 1
)
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,11) else 1)"
if errorlevel 1 (
  echo [ERROR] Python 3.11+ is required.
  python --version
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [OK] Created .env
)

echo.
echo [1/6] Installing CadGPT connector dependencies...
call npm install
if errorlevel 1 goto :failed

echo.
echo [2/6] Building CadGPT connector...
call npm run build
if errorlevel 1 goto :failed

echo.
echo [3/6] Preparing isolated CAD MCP Python environment...
if not exist ".venv-cad\Scripts\python.exe" (
  python -m venv .venv-cad
  if errorlevel 1 goto :failed
)
if exist "runtimes\cad-mcp\requirements.txt" (
  ".venv-cad\Scripts\python.exe" -m pip install --upgrade pip
  if errorlevel 1 goto :failed
  ".venv-cad\Scripts\python.exe" -m pip install -r "runtimes\cad-mcp\requirements.txt"
  if errorlevel 1 goto :failed
) else (
  echo [ERROR] runtimes\cad-mcp\requirements.txt is missing.
  goto :failed
)

echo.
echo [4/6] Configuring OpenAI Secure MCP Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Init
if errorlevel 1 goto :failed

echo.
echo [5/6] Starting CadGPT...
call "%~dp0run.bat"
if errorlevel 1 goto :failed

echo.
echo [6/6] Running installation doctor...
call "%~dp0doctor.bat"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup complete
echo ========================================
echo Enable ChatGPT Developer Mode and add/select the CadGPT tunnel connection once.
echo After that, normal use is only: run.bat
echo Diagnostics: doctor.bat
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] CadGPT setup failed. Review the error above or run doctor.bat.
pause
exit /b 1
