@echo off
setlocal
cd /d "%~dp0"

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

if /I "%ACTION%"=="help" goto :usage
if /I "%ACTION%"=="install" goto :install
if /I "%ACTION%"=="start" goto :start
if /I "%ACTION%"=="stop" goto :stop
if /I "%ACTION%"=="restart" goto :restart
if /I "%ACTION%"=="status" goto :status
if /I "%ACTION%"=="doctor" goto :doctor
if /I "%ACTION%"=="uninstall" goto :uninstall

echo [ERROR] Unknown action: %ACTION%
goto :usage

:preflight
if not exist ".env" (
  echo [ERROR] CadGPT is not set up yet. Run setup.bat first.
  exit /b 1
)
if not exist "cadgpt-tray.ps1" (
  echo [ERROR] cadgpt-tray.ps1 is missing.
  exit /b 1
)
if not exist "cadgpt-tray.vbs" (
  echo [ERROR] cadgpt-tray.vbs is missing.
  exit /b 1
)
if not exist "dist\index.js" (
  echo [ERROR] dist\index.js is missing. Run setup.bat or npm run build first.
  exit /b 1
)
exit /b 0

:install
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -InstallStartup
if errorlevel 1 exit /b 1
goto :start

:start
call :preflight
if errorlevel 1 exit /b 1
wscript "%~dp0cadgpt-tray.vbs"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-tray-ready.ps1" -TimeoutSeconds 15
if errorlevel 1 exit /b 1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StatusOnly
exit /b %ERRORLEVEL%

:stop
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StopInstalled
exit /b %ERRORLEVEL%

:restart
call :preflight
if errorlevel 1 exit /b 1
echo.
echo Rebuilding CadGPT source before restart...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed. Existing runtime was not restarted.
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StopInstalled
wscript "%~dp0cadgpt-tray.vbs" -RestartRuntimeOnStart
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-tray-ready.ps1" -TimeoutSeconds 15
if errorlevel 1 exit /b 1
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StatusOnly
exit /b %ERRORLEVEL%

:status
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StatusOnly
exit /b %ERRORLEVEL%

:doctor
call :preflight
if errorlevel 1 exit /b 1
call "%~dp0doctor.bat"
exit /b %ERRORLEVEL%

:uninstall
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StopInstalled
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -RemoveStartup
exit /b %ERRORLEVEL%

:usage
echo.
echo CadGPT tray/runtime control
echo.
echo   run.bat              Start CadGPT and show current status
echo   run.bat start        Start tray + slim MCP + Secure Tunnel, then show status
echo   run.bat stop         Stop verified CadGPT-owned runtime only
echo   run.bat restart      Rebuild source, restart runtime, and show status
echo   run.bat status       Show tray / slim MCP / tunnel / CAD MCP status
echo   run.bat doctor       Run CadGPT diagnostics
echo   run.bat install      Register per-user Windows startup and start CadGPT
echo   run.bat uninstall    Remove startup registration and stop CadGPT
echo.
echo Normal daily use requires no command after setup.
exit /b 2
