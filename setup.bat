@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CadGPT Setup

echo.
echo ========================================
echo   CadGPT - Source setup
echo ========================================
echo.

if not exist "%~dp0scripts\setup-core.bat" (
  echo [ERROR] Missing scripts\setup-core.bat
  echo The checkout may be incomplete. Run git pull --ff-only and try again.
  echo.
  pause
  exit /b 1
)

call "%~dp0scripts\setup-core.bat"
set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo ================================================================
  echo   CadGPT Setup exited with code %EC%
  echo   The window is being kept open so you can read the error above.
  echo ================================================================
  echo.
  pause
)

exit /b %EC%
