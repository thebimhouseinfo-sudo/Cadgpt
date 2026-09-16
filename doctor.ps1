$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$failures = 0
$warnings = 0

function Ok([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Warn([string]$Message) { $script:warnings++; Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Fail([string]$Message) { $script:failures++; Write-Host "[FAIL] $Message" -ForegroundColor Red }

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

function Test-Command([string]$Name) {
    return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "=== CadGPT Doctor ===" -ForegroundColor Cyan
Write-Host ""

if (Test-Command "node") {
    $nodeVersion = (& node --version 2>$null).TrimStart('v')
    $nodeMajor = 0
    if ($nodeVersion -match '^(\d+)\.') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -ge 20) { Ok "Node.js $nodeVersion" } else { Fail "Node.js $nodeVersion found; CadGPT requires Node.js 20+." }
} else { Fail "Node.js not found in PATH." }

if (Test-Command "npm") { Ok "npm available" } else { Fail "npm not found in PATH." }

if (Test-Command "python") {
    $pyVersion = (& python -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null).Trim()
    $parts = $pyVersion.Split('.')
    if ($parts.Count -ge 2 -and ([int]$parts[0] -gt 3 -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 11))) {
        Ok "Python $pyVersion"
    } else { Fail "Python $pyVersion found; CadGPT requires Python 3.11+." }
} else { Fail "Python not found in PATH." }

if (Test-Path ".env") { Ok ".env exists" } else { Fail ".env missing; run setup.bat." }
foreach ($root in @("lisp", "jobs")) {
    if (Test-Path $root) { Ok "Editable root exists: $root/" } else { Fail "Editable root missing: $root/" }
}

$portValue = Get-DotEnvValue "PORT"
$port = if ($portValue) { [int]$portValue } else { 3000 }
$healthPortValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
$healthPort = if ($healthPortValue) { [int]$healthPortValue } else { 8080 }

$mcpToken = Get-DotEnvValue "MCP_TOKEN"
if ($mcpToken) { Ok "Private MCP path token configured" } else { Warn "MCP_TOKEN is empty; re-run setup/openai-tunnel init to generate one." }

$tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
$tunnelKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
if ($tunnelId -and $tunnelKey) { Ok "Secure MCP Tunnel credentials configured" } else { Fail "Secure MCP Tunnel is not configured." }

$cadPython = ".venv-cad\Scripts\python.exe"
if (Test-Path $cadPython) {
    Ok "CAD MCP virtual environment exists"
    & $cadPython -c "import sys; sys.path.insert(0, r'runtimes\cad-mcp'); import main; print('cad-mcp import ok')" *> $null
    if ($LASTEXITCODE -eq 0) { Ok "CAD MCP entrypoint imports cleanly" } else { Fail "CAD MCP entrypoint import failed." }
} else { Fail "CAD MCP virtual environment missing; run setup.bat." }

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Method Get -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.name -eq "cadgpt") {
        Ok "CadGPT local MCP healthy on port $port"
        if ($health.cad_mcp.connected) { Ok "CAD MCP upstream connected ($($health.cad_mcp.tool_count) tools)" }
        elseif ($health.cad_mcp.last_error) { Warn "CAD MCP upstream not connected: $($health.cad_mcp.last_error)" }
        else { Warn "CAD MCP upstream is idle/not connected yet; this is valid before first CAD tool use." }
    } else { Fail "Unexpected service responded on CadGPT port $port." }
} catch { Warn "CadGPT local MCP is not currently running on port $port." }

try {
    $ready = Invoke-WebRequest -Uri "http://127.0.0.1:$healthPort/readyz" -UseBasicParsing -TimeoutSec 2
    if ($ready.StatusCode -eq 200 -and $ready.Content -match "ready") { Ok "OpenAI Secure MCP Tunnel ready on health port $healthPort" }
    else { Warn "Tunnel health endpoint responded but is not ready." }
} catch { Warn "OpenAI Secure MCP Tunnel is not currently ready on health port $healthPort." }

if ($tunnelId -and $tunnelKey -and (Test-Path "openai-tunnel.ps1")) {
    Write-Host ""
    Write-Host "Running tunnel-client doctor..." -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\openai-tunnel.ps1" -Doctor -Port $port -HealthPort $healthPort
    if ($LASTEXITCODE -eq 0) { Ok "tunnel-client doctor passed" } else { Fail "tunnel-client doctor failed" }
}

Write-Host ""
Write-Host "=== Doctor result ===" -ForegroundColor Cyan
Write-Host "Failures: $failures"
Write-Host "Warnings: $warnings"
if ($failures -gt 0) {
    Write-Host "CadGPT needs attention before reliable use." -ForegroundColor Red
    exit 1
}
Write-Host "CadGPT core environment is healthy. Warnings may only mean a service/AutoCAD is not currently running." -ForegroundColor Green
exit 0
