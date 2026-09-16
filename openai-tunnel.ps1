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
$TunnelExe = Join-Path $BinDir "tunnel-client.exe"
$ProfileDir = Join-Path $ScriptDir "profiles"
$ProfileFile = Join-Path $ProfileDir "cadgpt.yaml"
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
        } else { $line }
    }
    if (-not $found) { $out += "$Name=$Value" }
    Set-Content ".env" -Value $out -Encoding UTF8
}

function Get-McpPath {
    $token = Get-DotEnvValue "MCP_TOKEN"
    if ($token) { return "/mcp/$token" }
    return "/mcp"
}

function Resolve-Ports {
    $script:ResolvedPort = if ($Port -gt 0) { $Port } else {
        $p = Get-DotEnvValue "PORT"; if ($p) { [int]$p } else { 3000 }
    }
    $script:ResolvedHealthPort = if ($HealthPort -gt 0) { $HealthPort } else {
        $p = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"; if ($p) { [int]$p } else { 8080 }
    }
}

function Install-TunnelClient {
    if (Test-Path $TunnelExe) { return $TunnelExe }
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $zipPath = Join-Path $env:TEMP $ZipName
    Write-Host "Downloading OpenAI tunnel-client $TunnelVersion..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force
    $candidate = Get-ChildItem $BinDir -Recurse -Filter "tunnel-client.exe" | Select-Object -First 1
    if (-not $candidate) { throw "tunnel-client.exe not found after extracting $ZipName" }
    if ($candidate.FullName -ne $TunnelExe) { Move-Item $candidate.FullName $TunnelExe -Force }
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
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
        $r = Invoke-WebRequest "http://127.0.0.1:$ResolvedPort/health" -UseBasicParsing -TimeoutSec 2
        return $r.StatusCode -eq 200
    } catch { return $false }
}

function Configure-Environment([string]$TunnelId, [string]$ApiKey) {
    $env:OPENAI_TUNNEL_API_KEY = $ApiKey
    $env:CONTROL_PLANE_API_KEY = $ApiKey
    $env:CONTROL_PLANE_TUNNEL_ID = $TunnelId
}

Resolve-Ports
$bin = Install-TunnelClient

if ($Init) {
    Write-Host ""
    Write-Host "=== CadGPT Secure MCP Tunnel setup ===" -ForegroundColor Cyan
    Write-Host "Create/inspect a tunnel at OpenAI Platform, then enter its tunnel ID and Runtime API key." -ForegroundColor Yellow
    $tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
    if (-not $tunnelId) { $tunnelId = Read-Host "OPENAI_TUNNEL_ID (tunnel_...)" }
    $apiKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
    if (-not $apiKey) { $apiKey = Read-Host "OPENAI_TUNNEL_API_KEY (Runtime API key)" }
    if (-not $tunnelId -or -not $apiKey) { throw "Tunnel ID and API key are required." }
    Set-DotEnvValue "OPENAI_TUNNEL_ID" $tunnelId
    Set-DotEnvValue "OPENAI_TUNNEL_API_KEY" $apiKey
    $mcpUrl = Ensure-Profile $tunnelId
    Configure-Environment $tunnelId $apiKey
    Write-Host "Running tunnel doctor..." -ForegroundColor Yellow
    & $bin doctor --profile-file $ProfileFile --explain
    if ($LASTEXITCODE -ne 0) { throw "OpenAI tunnel doctor failed." }
    Write-Host "[OK] Stable tunnel configured for CadGPT." -ForegroundColor Green
    Write-Host "Local MCP target: $mcpUrl"
    exit 0
}

$tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
$apiKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
if (-not $tunnelId -or -not $apiKey) {
    throw "Secure MCP Tunnel is not configured. Run: powershell -File openai-tunnel.ps1 -Init"
}

$mcpUrl = Ensure-Profile $tunnelId
Configure-Environment $tunnelId $apiKey

if ($Doctor) {
    & $bin doctor --profile-file $ProfileFile --explain
    exit $LASTEXITCODE
}

if (-not (Test-CadGptReady)) {
    throw "CadGPT local MCP is not ready at http://127.0.0.1:$ResolvedPort/health"
}

Write-Host ""
Write-Host "=== OpenAI Secure MCP Tunnel / CadGPT ===" -ForegroundColor Cyan
Write-Host "Tunnel ID: $tunnelId"
Write-Host "Local MCP: $mcpUrl"
Write-Host "Health UI: http://127.0.0.1:$ResolvedHealthPort/ui"
Write-Host "Tunnel client: $TunnelVersion"
Write-Host ""

& $bin run --profile-file $ProfileFile
exit $LASTEXITCODE
