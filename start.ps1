param(
    [int]$Port = 0,
    [switch]$Force
)

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

function Get-PortOwnerPid([int]$TargetPort) {
    $lines = netstat -ano | Select-String ":$TargetPort\s" | Select-String "LISTENING"
    foreach ($line in $lines) {
        $parts = ($line -replace '\s+', ' ').ToString().Trim().Split(' ')
        $processId = [int]$parts[-1]
        if ($processId -gt 0) { return $processId }
    }
    return $null
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example" -ForegroundColor Yellow
}

$envPort = Get-DotEnvValue "PORT"
if ($Port -le 0) { $Port = if ($envPort) { [int]$envPort } else { 3000 } }
$env:PORT = "$Port"

$existingPid = Get-PortOwnerPid -TargetPort $Port
if ($existingPid) {
    if ($Force) {
        Write-Host "Stopping old CadGPT process on port $Port (PID $existingPid)..." -ForegroundColor Yellow
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    } else {
        Write-Host "CadGPT already appears to be listening on port $Port (PID $existingPid)." -ForegroundColor Green
        exit 0
    }
}

if (-not (Test-Path "node_modules")) {
    throw "node_modules not found. Run setup.bat first."
}

Write-Host "Building CadGPT..." -ForegroundColor Yellow
& npm run build
if ($LASTEXITCODE -ne 0) { throw "CadGPT build failed." }

Write-Host "Starting CadGPT local MCP on 127.0.0.1:$Port..." -ForegroundColor Green
& node dist/index.js
exit $LASTEXITCODE
