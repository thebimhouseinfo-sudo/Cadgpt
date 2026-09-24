$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$failures = 0
$warnings = 0

function Ok([string]$Message) {
    Write-Host "[OK]   $Message" -ForegroundColor Green
}
function Warn([string]$Message) {
    $script:warnings++
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}
function Fail([string]$Message) {
    $script:failures++
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

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

function Get-ProcessInfo([int]$ProcessId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    } catch {
        return $null
    }
}

Write-Host ""
Write-Host "=== CadGPT Doctor ===" -ForegroundColor Cyan
Write-Host ""

if (Test-Command "node") {
    $nodeVersion = (& node --version 2>$null).TrimStart('v')
    $nodeMajor = 0
    if ($nodeVersion -match '^(\d+)\.') { $nodeMajor = [int]$Matches[1] }
    if ($nodeMajor -ge 20) { Ok "Node.js $nodeVersion" }
    else { Fail "Node.js $nodeVersion found; CadGPT requires Node.js 20+." }
} else {
    Fail "Node.js not found in PATH."
}

if (Test-Command "npm") { Ok "npm available" }
else { Fail "npm not found in PATH." }

if (Test-Command "python") {
    $pyVersion = (& python -c "import sys; print('.'.join(map(str, sys.version_info[:3])))" 2>$null).Trim()
    $parts = $pyVersion.Split('.')
    $major = if ($parts.Count -ge 1) { [int]$parts[0] } else { 0 }
    $minor = if ($parts.Count -ge 2) { [int]$parts[1] } else { 0 }
    if ($major -eq 3 -and $minor -ge 11 -and $minor -le 14) {
        Ok "Python $pyVersion"
    } else {
        Fail "Python $pyVersion found; CadGPT currently supports Python 3.11 through 3.14."
    }
} else {
    Fail "Python not found in PATH."
}

foreach ($required in @(
    "package-lock.json",
    "runtimes\cad-mcp\requirements.lock.txt",
    "runtimes\cad-mcp\tool-manifest.json",
    "knowledge\jobs\JOB_RULES.md",
    "resources\cad\CADGPT_LOAD_SMOKE.lsp",
    "cadgpt-tray.vbs"
)) {
    if (Test-Path $required) { Ok "Required file exists: $required" }
    else { Fail "Required file missing: $required" }
}

if (Test-Path ".env") { Ok ".env exists" }
else { Fail ".env missing; run setup.bat." }

$buildProfile = Get-DotEnvValue "CADGPT_BUILD_PROFILE"
if (-not $buildProfile) { $buildProfile = "production" }
Ok "Build profile: $buildProfile"
if ($buildProfile.Trim().ToLowerInvariant() -eq "development") {
    if (Test-Path "skills\cad-mcp-dev\SKILL.md") {
        Ok "Development-only cad-mcp-dev Skill source exists"
    } else {
        Fail "Development profile requires skills\cad-mcp-dev\SKILL.md."
    }
} else {
    Ok "cad-mcp-dev is disabled by non-development build profile"
}

$appDataConfigured = Get-DotEnvValue "CADGPT_APPDATA_ROOT"
if (-not $appDataConfigured) { $appDataConfigured = "appdata" }
$appDataRoot = if ([System.IO.Path]::IsPathRooted($appDataConfigured)) {
    [System.IO.Path]::GetFullPath($appDataConfigured)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $appDataConfigured))
}

foreach ($relative in @(
    "libraries\lisp",
    "libraries\jobs",
    "registry\user",
    "workspace\lisp-draft",
    "workspace\job-draft",
    "data\runs",
    "runtime\dynamic-lisp",
    "drawings",
    "state",
    "logs"
)) {
    $target = Join-Path $appDataRoot $relative
    if (Test-Path $target) { Ok "AppData area exists: $relative" }
    else { Fail "AppData area missing: $target (rerun setup.bat)" }
}
Ok "CadGPT AppData root: $appDataRoot"

$recoveryRoot = Join-Path $appDataRoot "state\cad-mcp-dev-recovery"
if (Test-Path $recoveryRoot) {
    $pendingRecovery = @(
        Get-ChildItem -Path $recoveryRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { -not ($_.Name.StartsWith(".") -and $_.Name.EndsWith(".tmp")) }
    )
    if ($pendingRecovery.Count -gt 0) {
        Warn "CAD MCP development has $($pendingRecovery.Count) pending crash-recovery baseline(s). Use cad_mcp_dev_recovery_status/recover before new CAD MCP mutation."
    } else {
        Ok "No pending CAD MCP development recovery baseline"
    }

    $sourceLock = Join-Path $recoveryRoot "source-owner.lock"
    if (Test-Path $sourceLock) {
        try {
            $lock = Get-Content $sourceLock -Raw | ConvertFrom-Json
            if ($lock.execution_id) {
                Warn "CAD MCP development source lock is present for execution $($lock.execution_id)."
            } else {
                Fail "CAD MCP development source lock is corrupt."
            }
        } catch {
            Fail "CAD MCP development source lock is unreadable/corrupt."
        }
    } else {
        Ok "No persistent CAD MCP development source lock"
    }
} else {
    Ok "No pending CAD MCP development recovery baseline"
}

$startup = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "CadGPT" -ErrorAction SilentlyContinue
if ($startup -and $startup.CadGPT -match "wscript(?:\.exe)?\s+.*cadgpt-tray\.vbs") {
    Ok "HKCU Run startup points to the silent CadGPT tray launcher"
} else {
    Warn "CadGPT silent tray launcher is not registered in HKCU Run. Run run.bat install."
}

$legacy = Get-ScheduledTask -TaskName "CadGPT Background Agent" -ErrorAction SilentlyContinue
if ($legacy) {
    Warn "Legacy CadGPT Scheduled Task still exists; rerun setup.bat to remove it."
} else {
    Ok "Legacy Scheduled Task startup is absent"
}

$trayMarker = Join-Path $appDataRoot "state\tray-ready.json"
if (Test-Path $trayMarker) {
    try {
        $trayState = Get-Content $trayMarker -Raw | ConvertFrom-Json
        $trayPid = [int]$trayState.pid
        $trayProc = if ($trayPid -gt 0) { Get-Process -Id $trayPid -ErrorAction SilentlyContinue } else { $null }
        $trayInfo = if ($trayProc) { Get-ProcessInfo -ProcessId $trayPid } else { $null }
        $expectedTrayScript = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "cadgpt-tray.ps1"))
        $ownedTray =
            $trayProc -and
            $trayProc.ProcessName -match '^(powershell|pwsh)(?:\.exe)?$' -and
            $trayInfo -and
            $trayInfo.CommandLine -and
            $trayInfo.CommandLine.IndexOf($expectedTrayScript, [System.StringComparison]::OrdinalIgnoreCase) -ge 0

        if ($ownedTray) {
            Ok "CadGPT tray host is running (PID $trayPid)"
        } else {
            Warn "CadGPT tray marker exists but does not identify the owned tray process."
        }
    } catch {
        Warn "CadGPT tray marker is unreadable."
    }
} else {
    Warn "CadGPT tray is not currently running."
}

$portValue = Get-DotEnvValue "PORT"
$port = if ($portValue) { [int]$portValue } else { 3000 }
$healthPortValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
$healthPort = if ($healthPortValue) { [int]$healthPortValue } else { 8080 }

$mcpToken = Get-DotEnvValue "MCP_TOKEN"
if ($mcpToken) {
    Ok "Private MCP path token configured"
} else {
    Fail "MCP_TOKEN is empty; CadGPT refuses to start an unprotected MCP route. Re-run openai-tunnel.ps1 -Init."
}

$tunnelId = Get-DotEnvValue "OPENAI_TUNNEL_ID"
$tunnelKey = Get-DotEnvValue "OPENAI_TUNNEL_API_KEY"
if ($tunnelId -and $tunnelKey) {
    Ok "Secure MCP Tunnel credentials configured"
} else {
    Fail "Secure MCP Tunnel is not configured."
}

$cadPython = ".venv-cad\Scripts\python.exe"
if (Test-Path $cadPython) {
    Ok "CAD MCP virtual environment exists"

    & $cadPython -m pip check *> $null
    if ($LASTEXITCODE -eq 0) {
        Ok "CAD MCP Python dependency graph passes pip check"
    } else {
        Fail "CAD MCP Python dependency graph failed pip check; rerun setup.bat."
    }

    $compileCode = @'
import pathlib
root = pathlib.Path("runtimes/cad-mcp")
files = sorted(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)
for p in files:
    compile(p.read_text(encoding="utf-8"), str(p), "exec")
print(f"compiled {len(files)} python files in-memory")
'@
    $env:PYTHONDONTWRITEBYTECODE = "1"
    & $cadPython -c $compileCode *> $null
    if ($LASTEXITCODE -eq 0) {
        Ok "CAD MCP Python source compiles in-memory"
    } else {
        Fail "CAD MCP source compile failed."
    }

    & $cadPython -c "import sys; sys.path.insert(0, r'runtimes\cad-mcp'); import main; print('cad-mcp import ok')" *> $null
    if ($LASTEXITCODE -eq 0) {
        Ok "CAD MCP entrypoint imports cleanly"
    } else {
        Fail "CAD MCP entrypoint import failed."
    }
} else {
    Fail "CAD MCP virtual environment missing; run setup.bat."
}

try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Method Get -TimeoutSec 2
    if ($health.status -eq "ok" -and $health.name -eq "cadgpt") {
        Ok "CadGPT slim MCP healthy on port $port"
        if ($health.mode -eq "slim-control-plane") { Ok "Slim control plane mode confirmed" }
        else { Warn "Unexpected CadGPT mode: $($health.mode)" }

        $families = @($health.loaded_families)
        if ($families.Count -eq 0) { Ok "Heavy capability families remain unloaded at idle" }
        else { Ok "Loaded capability families: $($families -join ', ')" }

        if ($health.mcp_path_protected -eq $true) { Ok "Slim MCP confirms protected private route" }
        else { Fail "Slim MCP reports an unprotected route" }

        if ($health.cad_mcp.connected) {
            Ok "CAD MCP currently connected ($($health.cad_mcp.tool_count) tools)"
        } else {
            Ok "CAD MCP is sleeping/not connected (expected at idle)"
        }
    } else {
        Fail "Unexpected service responded on CadGPT port $port."
    }
} catch {
    Warn "CadGPT slim MCP is not currently running on port $port."
}

try {
    $ready = Invoke-WebRequest -Uri "http://127.0.0.1:$healthPort/readyz" -UseBasicParsing -TimeoutSec 2
    if ($ready.StatusCode -eq 200 -and $ready.Content -match "ready") {
        Ok "OpenAI Secure MCP Tunnel ready on health port $healthPort"
    } else {
        Warn "Tunnel health endpoint responded but is not ready."
    }
} catch {
    Warn "OpenAI Secure MCP Tunnel is not currently ready on health port $healthPort."
}

if ($mcpToken -and $tunnelId -and $tunnelKey -and (Test-Path "openai-tunnel.ps1")) {
    Write-Host ""
    Write-Host "Running tunnel-client doctor..." -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\openai-tunnel.ps1" -Doctor -Port $port -HealthPort $healthPort
    if ($LASTEXITCODE -eq 0) { Ok "tunnel-client doctor passed" }
    else { Fail "tunnel-client doctor failed" }
}

Write-Host ""
Write-Host "=== Doctor result ===" -ForegroundColor Cyan
Write-Host "Failures: $failures"
Write-Host "Warnings: $warnings"
if ($failures -gt 0) {
    Write-Host "CadGPT needs attention before reliable use." -ForegroundColor Red
    exit 1
}

Write-Host "CadGPT environment is healthy. Idle CAD MCP is expected." -ForegroundColor Green
exit 0
