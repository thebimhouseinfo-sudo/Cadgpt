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

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm is not available.
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python is not installed or not in PATH.
  echo Python is required for CAD MCP.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo [OK] Created .env
)

echo.
echo [1/5] Installing CadGPT connector dependencies...
call npm install
if errorlevel 1 goto :failed

echo.
echo [2/5] Building CadGPT connector...
call npm run build
if errorlevel 1 goto :failed

echo.
echo [3/5] Preparing isolated CAD MCP Python environment...
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
  echo [WARN] CAD MCP requirements.txt not present yet; skipping Python dependencies.
)

echo.
echo [4/5] Configuring OpenAI Secure MCP Tunnel...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0openai-tunnel.ps1" -Init
if errorlevel 1 goto :failed

echo.
echo [5/5] Starting CadGPT...
call "%~dp0run.bat"
if errorlevel 1 goto :failed

echo.
echo ========================================
echo   Setup complete

echo ========================================
echo Enable ChatGPT Developer Mode and add/select the CadGPT tunnel connection once.
echo After that, normal use is only: run.bat
echo.
pause
exit /b 0

:failed
echo.
echo [ERROR] CadGPT setup failed. Review the error above.
pause
exit /b 1
