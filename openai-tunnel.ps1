param(
    [int]$Port = 0,
    [int]$HealthPort = 0,
    [switch]$Init,
    [switch]$Doctor,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$TunnelVersion = "v0.0.14"
$BinDir = Join-Path $ScriptDir "bin"
$TunnelExe = [System.IO.Path]::GetFullPath((Join-Path $BinDir "tunnel-client.exe"))
$ProfileDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "profiles"))
$ProfileFile = [System.IO.Path]::GetFullPath((Join-Path $ProfileDir "cadgpt.yaml"))
$ZipName = "tunnel-client-$TunnelVersion-windows-amd64.zip"
$DownloadUrl = "https://github.com/openai/tunnel-client/releases/download/$TunnelVersion/$ZipName"

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

function Set-DotEnvValue([string]$Name, [string]$Value) {
    if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
    $lines = Get-Content ".env"
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^\s*$Name\s*=" -and -not $line.TrimStart().StartsWith("#")) {
            $found = $true
            "$Name=$Value"
        } else {
            $line
        }
    }
    if (-not $found) { $out += "$Name=$Value" }
    Set-Content ".env" -Value $out -Encoding UTF8
}

function Ensure-McpToken {
    $token = Get-DotEnvValue "MCP_TOKEN"
    if ($token) { return $token }

    $token = ([guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"))
    Set-DotEnvValue "MCP_TOKEN" $token
    Write-Host "[OK] Generated private local MCP path token." -ForegroundColor Green
    return $token
}

function Get-McpPath {
    $token = Get-DotEnvValue "MCP_TOKEN"
    if (-not $token) {
        throw "MCP_TOKEN is required. Run openai-tunnel.ps1 -Init."
    }
    return "/mcp/$token"
}

function Resolve-Ports {
    $script:ResolvedPort = if ($Port -gt 0) {
        $Port
    } else {
        $p = Get-DotEnvValue "PORT"
        if ($p) { [int]$p } else { 3000 }
    }

    $script:ResolvedHealthPort = if ($HealthPort -gt 0) {
        $HealthPort
    } else {
        $p = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
        if ($p) { [int]$p } else { 8080 }
    }
}

function Get-PortOwnerPid([int]$TargetPort) {
    try {
        $lines = netstat -ano | Select-String ":$TargetPort\s" | Select-String "LISTENING"
        foreach ($line in $lines) {
            $parts = ($line -replace '\s+', ' ').ToString().Trim().Split(' ')
            $processId = [int]$parts[-1]
            if ($processId -gt 0) { return $processId }
        }
    } catch {}
    return $null
}

function Get-ProcessInfo([int]$ProcessId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-TunnelHealthy([int]$TargetHealthPort) {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetHealthPort/readyz" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200 -and $r.Content -match "ready")
    } catch {
        return $false
    }
}

function Test-OwnedTunnelProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^tunnel-client(?:\.exe)?$') {
        return $false
    }

    $info = Get-ProcessInfo -ProcessId $ProcessId
    if (-not $info -or -not $info.CommandLine) { return $false }

    return $info.CommandLine.IndexOf(
        $ProfileFile,
        [System.StringComparison]::OrdinalIgnoreCase
    ) -ge 0
}

function Install-TunnelClient {
    if (Test-Path $TunnelExe) { return $TunnelExe }

    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $zipPath = Join-Path $env:TEMP $ZipName

    Write-Host "Downloading OpenAI tunnel-client $TunnelVersion..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing
    try {
        Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force
        $candidate = Get-ChildItem $BinDir -Recurse -Filter "tunnel-client.exe" | Select-Object -First 1
        if (-not $candidate) {
            throw "tunnel-client.exe not found after extracting $ZipName"
        }
        if ([System.IO.Path]::GetFullPath($candidate.FullName) -ne $TunnelExe) {
            Move-Item $candidate.FullName $TunnelExe -Force
        }
    } finally {
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
    }

    return $TunnelExe
}

function Ensure-Profile([string]$TunnelId) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
    $mcpUrl = "http://127.0.0.1:$ResolvedPort$(Get-McpPath)"
    $yaml = @"
config_version: 1
control_plane:
  tunnel_id: $TunnelId
  api_key: env:OPENAI_TUNNEL_API_KEY
log:
  level: info
  format: struct-text
health:
  listen_addr: 127.0.0.1:$ResolvedHealthPort
mcp:
  server_urls:
    - channel: main
      url: $mcpUrl
"@
    Set-Content $ProfileFile -Value $yaml -Encoding UTF8
    return $mcpUrl
}

function Test-CadGptReady {
    try {
        $r = Invoke-RestMethod "http://127.0.0.1:$ResolvedPort/health" -TimeoutSec 2
        return ($r.status -eq "ok" -and $r.name -eq "cadgpt")
    } catch {
        return $false
    }
}

function Configure-Environment([string]$TunnelId, [string]$ApiKey) {
    $env:OPENAI_TUNNEL_API_KEY = $ApiKey
    $env:CONTROL_PLANE_API_KEY = $ApiKey
    $env:CONTROL_PLANE_TUNNEL_ID = $TunnelId
}

function Stop-VerifiedTunnel([int]$TargetHealthPort) {
    $ownerPid = Get-PortOwnerPid -TargetPort $TargetHealthPort
    if (-not $ownerPid) { return }

    if (-not (Test-OwnedTunnelProcess -ProcessId $ownerPid)) {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        throw "Tunnel health port $TargetHealthPort is occupied by unowned PID $ownerPid ($name). CadGPT will not kill it."
    }

    Write-Host "Stopping verified CadGPT tunnel-client on health port $TargetHealthPort (PID $ownerPid)..." -ForegroundColor Yellow
    Stop-Process -Id $ownerPid -Force -ErrorAction Stop

    $deadline = (Get-Date).AddSeconds(5)
    do {
        if (-not (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) { return }
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)

    throw "Verified tunnel-client PID $ownerPid did not stop within timeout."
}

Resolve-Ports
$bin = Install-TunnelClient

if ($Init) {
    Write-Host ""
    Write-Host "=== CadGPT Secure MCP Tunnel setup ===" -ForegroundColor Cyan
    Write-Host "Create/inspect a tunnel at OpenAI Platform, then enter its tunnel ID and Runtime API key." -ForegroundColor Yellow

    $null = Ensure-McpToken

    $tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
    if (-not $tunnelId) {
        $tunnelId = Read-Host "OPENAI_TUNNEL_ID (tunnel_...)"
    }

    $apiKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
    if (-not $apiKey) {
        $apiKey = Read-Host "OPENAI_TUNNEL_API_KEY (Runtime API key)"
    }

    if (-not $tunnelId -or $tunnelId -notmatch '^tunnel_[0-9a-fA-F]{32}$') {
        throw "OPENAI_TUNNEL_ID is invalid. Expected tunnel_ followed by 32 hexadecimal characters."
    }
    if (-not $apiKey) {
        throw "OPENAI_TUNNEL_API_KEY is required."
    }

    Set-DotEnvValue "OPENAI_TUNNEL_ID" $tunnelId
    Set-DotEnvValue "OPENAI_TUNNEL_API_KEY" $apiKey

    $mcpUrl = Ensure-Profile $tunnelId
    Configure-Environment $tunnelId $apiKey

    Write-Host "Running tunnel doctor..." -ForegroundColor Yellow
    & $bin doctor --profile-file $ProfileFile --explain
    if ($LASTEXITCODE -ne 0) {
        throw "OpenAI tunnel doctor failed."
    }

    Write-Host "[OK] Stable tunnel configured for CadGPT." -ForegroundColor Green
    Write-Host "Local MCP target: $mcpUrl"
    exit 0
}

$existingToken = Get-DotEnvValue "MCP_TOKEN"
if (-not $existingToken) {
    throw "MCP_TOKEN is missing. Run: powershell -File openai-tunnel.ps1 -Init"
}
$tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
$apiKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"

if (-not $tunnelId -or -not $apiKey) {
    throw "Secure MCP Tunnel is not configured. Run: powershell -File openai-tunnel.ps1 -Init"
}
if ($tunnelId -notmatch '^tunnel_[0-9a-fA-F]{32}$') {
    throw "OPENAI_TUNNEL_ID is invalid. Re-run openai-tunnel.ps1 -Init."
}

$mcpUrl = Ensure-Profile $tunnelId
Configure-Environment $tunnelId $apiKey

if ($Doctor) {
    & $bin doctor --profile-file $ProfileFile --explain
    exit $LASTEXITCODE
}

$existingPid = Get-PortOwnerPid -TargetPort $ResolvedHealthPort
if ($existingPid) {
    $owned = Test-OwnedTunnelProcess -ProcessId $existingPid
    $healthy = Test-TunnelHealthy -TargetHealthPort $ResolvedHealthPort

    if ($owned -and $healthy -and -not $Force) {
        Write-Host "[OK] Verified CadGPT Secure MCP Tunnel is already healthy on port $ResolvedHealthPort (PID $existingPid)." -ForegroundColor Green
        exit 0
    }

    if ($owned -and $Force) {
        Stop-VerifiedTunnel -TargetHealthPort $ResolvedHealthPort
    } elseif ($owned -and -not $healthy) {
        throw "CadGPT tunnel-client PID $existingPid is owned by this profile but unhealthy. Run doctor.bat or use -Force to restart it."
    } else {
        $proc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        throw "Tunnel health port $ResolvedHealthPort is occupied by unowned PID $existingPid ($name). CadGPT will not adopt or kill it."
    }
}

if (-not (Test-CadGptReady)) {
    throw "CadGPT local MCP is not ready at http://127.0.0.1:$ResolvedPort/health"
}

Write-Host ""
Write-Host "=== OpenAI Secure MCP Tunnel / CadGPT ===" -ForegroundColor Cyan
Write-Host "Tunnel ID: $tunnelId"
Write-Host "Local MCP: $mcpUrl"
Write-Host "Health UI: http://127.0.0.1:$ResolvedHealthPort/ui"
Write-Host "Ready:     http://127.0.0.1:$ResolvedHealthPort/readyz"
Write-Host "Tunnel client: $TunnelVersion"
Write-Host ""

& $bin run --profile-file $ProfileFile
exit $LASTEXITCODE
