param(
    [int]$Port = 0,
    [switch]$Force
)

# Legacy compatibility entrypoint. CadGPT is now owned by the Windows tray
# lifecycle. Keeping start.ps1 as a thin wrapper prevents old shortcuts from
# starting a second unmanaged slim MCP process.

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

if ($Port -gt 0) {
    Write-Warning "start.ps1 -Port is deprecated. Set PORT in .env so tray/tunnel/doctor use one consistent port."
}

$action = if ($Force) { "restart" } else { "start" }
Write-Warning "start.ps1 is deprecated. Delegating to run.bat $action."
& cmd.exe /d /c ("call `"" + (Join-Path $ScriptDir "run.bat") + "`" " + $action)
exit $LASTEXITCODE
