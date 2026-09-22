param([int]$TimeoutSeconds = 15)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

$configured = Get-DotEnvValue "CADGPT_APPDATA_ROOT"
if (-not $configured) { $configured = "appdata" }

$root = if ([System.IO.Path]::IsPathRooted($configured)) {
    [System.IO.Path]::GetFullPath($configured)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $configured))
}

$marker = Join-Path $root "state\tray-ready.json"
$expectedScript = [System.IO.Path]::GetFullPath(
    (Join-Path $ScriptDir "cadgpt-tray.ps1")
)
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)

do {
    if (Test-Path $marker) {
        try {
            $state = Get-Content $marker -Raw | ConvertFrom-Json
            $trayPid = [int]$state.pid
            $proc = if ($trayPid -gt 0) {
                Get-Process -Id $trayPid -ErrorAction SilentlyContinue
            } else {
                $null
            }
            $info = if ($proc) {
                Get-CimInstance Win32_Process -Filter "ProcessId = $trayPid" -ErrorAction SilentlyContinue
            } else {
                $null
            }

            $owned =
                $proc -and
                $proc.ProcessName -match '^(powershell|pwsh)(?:\.exe)?$' -and
                $info -and
                $info.CommandLine -and
                $info.CommandLine.IndexOf(
                    $expectedScript,
                    [System.StringComparison]::OrdinalIgnoreCase
                ) -ge 0

            if ($state.ready -eq $true -and $owned) {
                Write-Host "[OK] CadGPT tray ready (PID $trayPid)." -ForegroundColor Green
                exit 0
            }
        } catch {
            # Marker may be in the middle of an atomic-ish rewrite; retry until timeout.
        }
    }

    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

Write-Host "[ERROR] CadGPT tray did not become ready." -ForegroundColor Red
exit 1
