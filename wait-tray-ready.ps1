param([int]$TimeoutSeconds = 15)
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object { $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#") } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}
$configured = Get-DotEnvValue "CADGPT_APPDATA_ROOT"
if (-not $configured) { $configured = "appdata" }
$root = if ([System.IO.Path]::IsPathRooted($configured)) { [System.IO.Path]::GetFullPath($configured) } else { [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $configured)) }
$marker = Join-Path $root "state\tray-ready.json"
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
do {
    if (Test-Path $marker) {
        try {
            $state = Get-Content $marker -Raw | ConvertFrom-Json
            if ($state.ready -eq $true -and [int]$state.pid -gt 0 -and (Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue)) {
                Write-Host "[OK] CadGPT tray ready (PID $($state.pid))." -ForegroundColor Green
                exit 0
            }
        } catch {}
    }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)
Write-Host "[ERROR] CadGPT tray did not become ready." -ForegroundColor Red
exit 1
