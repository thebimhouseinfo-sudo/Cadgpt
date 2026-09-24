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
exit /b 0

:stop
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StopInstalled
exit /b %ERRORLEVEL%

:restart
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StopInstalled
wscript "%~dp0cadgpt-tray.vbs" -RestartRuntimeOnStart
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wait-tray-ready.ps1" -TimeoutSeconds 15
exit /b %ERRORLEVEL%

:status
call :preflight
if errorlevel 1 exit /b 1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0cadgpt-tray.ps1" -StatusOnly
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
echo   run.bat              Start CadGPT tray
echo   run.bat install      Register per-user Windows startup and start tray
echo   run.bat start        Start tray + slim MCP + Secure Tunnel
echo   run.bat stop         Stop tray + verified CadGPT runtime
echo   run.bat restart      Restart tray/runtime
echo   run.bat status       Show tray/slim MCP/tunnel/CAD status
echo   run.bat uninstall    Remove startup registration and stop runtime
echo.
echo Normal daily use requires no command after setup.
exit /b 2
