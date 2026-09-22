param(
    [ValidateSet("install", "start", "stop", "restart", "status", "uninstall")]
    [string]$Action = "status",
    [switch]$WaitReady
)

# Legacy compatibility shim.
# CadGPT no longer uses a Scheduled Task or a polling wake-agent. Keep this file
# only so an old shortcut/manual command cannot resurrect the retired lifecycle.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Warning "agent-task.ps1 is deprecated. CadGPT now uses the Windows tray + HKCU Run lifecycle."

switch ($Action) {
    "install" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "cadgpt-tray.ps1") -InstallStartup
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & cmd.exe /d /c ("call `"" + (Join-Path $ScriptDir "run.bat") + "`" start")
    }
    "start" {
        & cmd.exe /d /c ("call `"" + (Join-Path $ScriptDir "run.bat") + "`" start")
    }
    "stop" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "cadgpt-tray.ps1") -StopInstalled
    }
    "restart" {
        & cmd.exe /d /c ("call `"" + (Join-Path $ScriptDir "run.bat") + "`" restart")
    }
    "status" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "cadgpt-tray.ps1") -StatusOnly
    }
    "uninstall" {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "cadgpt-tray.ps1") -StopInstalled
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "cadgpt-tray.ps1") -RemoveStartup
    }
}

if ($WaitReady -and $Action -in @("install", "start", "restart")) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $ScriptDir "wait-tray-ready.ps1") -TimeoutSeconds 15
}

exit $LASTEXITCODE
