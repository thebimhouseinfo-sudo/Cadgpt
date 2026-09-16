@echo off
setlocal
cd /d "%~dp0"

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

if /I "%ACTION%"=="help" goto :usage
if /I "%ACTION%"=="install" goto :control
if /I "%ACTION%"=="start" goto :control
if /I "%ACTION%"=="stop" goto :control
if /I "%ACTION%"=="restart" goto :control
if /I "%ACTION%"=="status" goto :control
if /I "%ACTION%"=="uninstall" goto :control

echo [ERROR] Unknown action: %ACTION%
goto :usage

:control
if not exist ".env" (
  echo [ERROR] CadGPT is not set up yet. Run setup.bat first.
  exit /b 1
)
if not exist "agent-task.ps1" (
  echo [ERROR] agent-task.ps1 is missing.
  exit /b 1
)

set "WAIT_ARG="
if /I "%ACTION%"=="install" set "WAIT_ARG=-WaitReady"
if /I "%ACTION%"=="start" set "WAIT_ARG=-WaitReady"
if /I "%ACTION%"=="restart" set "WAIT_ARG=-WaitReady"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agent-task.ps1" -Action %ACTION% %WAIT_ARG%
exit /b %ERRORLEVEL%

:usage
echo.
echo CadGPT background agent control
echo.
echo   run.bat              Start/wake the installed background agent
echo   run.bat install      Install autostart task and start now
echo   run.bat start        Start/wake the background agent
echo   run.bat stop         Stop until manually started or next logon
echo   run.bat restart      Restart background agent
echo   run.bat status       Show task/listener/tunnel status
echo   run.bat uninstall    Remove autostart task, keep CadGPT files/config
echo.
echo Normal daily use requires no command: CadGPT starts hidden at Windows logon.
exit /b 2
