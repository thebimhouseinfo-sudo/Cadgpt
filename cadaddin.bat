@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title CadGPT AutoCAD Add-in Installer

set "CONFIG=Release"
if /I "%~1"=="Debug" set "CONFIG=Debug"
if /I "%~1"=="Release" set "CONFIG=Release"

echo.
echo ========================================
echo   CadGPT - AutoCAD Add-in Installer
echo ========================================
echo.
echo Configuration : %CONFIG%
echo Command       : CADGPT
echo.

if not exist "%~dp0scripts\install-autocad-addin.ps1" (
  echo [ERROR] Missing scripts\install-autocad-addin.ps1
  echo Run git pull origin main and try again.
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "if (Get-Process acad -ErrorAction SilentlyContinue) { exit 2 } else { exit 0 }"

if errorlevel 2 (
  echo [ERROR] AutoCAD is running.
  echo Save your drawings and close AutoCAD completely, then run cadaddin.bat again.
  echo.
  pause
  exit /b 2
)

echo Building and installing CadGPT AutoCAD add-in...
echo.

powershell -NoProfile -ExecutionPolicy Bypass ^
  -File "%~dp0scripts\install-autocad-addin.ps1" ^
  -Configuration %CONFIG%

set "EC=%ERRORLEVEL%"

if not "%EC%"=="0" (
  echo.
  echo ========================================
  echo   CadGPT add-in installation FAILED
  echo   Exit code: %EC%
  echo ========================================
  echo.
  pause
  exit /b %EC%
)

echo.
echo ========================================
echo   CadGPT add-in installation COMPLETE
echo ========================================
echo.
echo AutoCAD startup load : ENABLED
echo Panel command         : CADGPT
echo.
echo Open AutoCAD and type:
echo.
echo   cadgpt
echo.
pause
exit /b 0
