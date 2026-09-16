param(
    [int]$PollSeconds = 10
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$RuntimeDir = Join-Path $ScriptDir ".runtime"
$AgentLog = Join-Path $RuntimeDir "cadgpt-agent.log"
$ConnectorOut = Join-Path $RuntimeDir "connector.out.log"
$ConnectorErr = Join-Path $RuntimeDir "connector.err.log"
$TunnelOut = Join-Path $RuntimeDir "tunnel.out.log"
$TunnelErr = Join-Path $RuntimeDir "tunnel.err.log"
$HeartbeatFile = Join-Path $RuntimeDir "agent-heartbeat.json"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

function Write-AgentLog([string]$Message, [string]$Level = "INFO") {
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -LiteralPath $AgentLog -Value $line -Encoding UTF8
}

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

function Test-CadGptHealth([int]$TargetPort) {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/health" -Method Get -TimeoutSec 2
        return ($health.status -eq "ok" -and $health.name -eq "cadgpt")
    } catch { return $false }
}

function Test-TunnelHealth([int]$TargetPort) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/readyz" -UseBasicParsing -TimeoutSec 2
        return ($response.StatusCode -eq 200 -and $response.Content -match "ready")
    } catch { return $false }
}

function Start-Connector([int]$Port) {
    if (Test-CadGptHealth $Port) { return $true }

    $ownerPid = Get-PortOwnerPid $Port
    if ($ownerPid) {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        Write-AgentLog "Local MCP port $Port is occupied by PID $ownerPid ($name); refusing to kill an unverified process." "WARN"
        return $false
    }

    if (-not (Test-Path "dist\index.js")) {
        Write-AgentLog "dist/index.js is missing. Run setup.bat to build CadGPT." "ERROR"
        return $false
    }

    $env:PORT = "$Port"
    try {
        Start-Process -FilePath "node" -ArgumentList "dist/index.js" -WorkingDirectory $ScriptDir -WindowStyle Hidden -RedirectStandardOutput $ConnectorOut -RedirectStandardError $ConnectorErr | Out-Null
        Write-AgentLog "Started CadGPT local MCP listener on 127.0.0.1:$Port."
    } catch {
        Write-AgentLog "Failed to start local MCP: $($_.Exception.Message)" "ERROR"
        return $false
    }

    foreach ($i in 1..20) {
        if (Test-CadGptHealth $Port) { return $true }
        Start-Sleep -Milliseconds 250
    }
    Write-AgentLog "Local MCP did not become healthy after startup." "WARN"
    return $false
}

function Start-Tunnel([int]$Port, [int]$HealthPort) {
    if (Test-TunnelHealth $HealthPort) { return $true }

    $ownerPid = Get-PortOwnerPid $HealthPort
    if ($ownerPid) {
        $proc = Get-Process -Id $ownerPid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        Write-AgentLog "Tunnel health port $HealthPort is occupied by PID $ownerPid ($name); refusing to kill an unverified process." "WARN"
        return $false
    }

    try {
        $args = @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden",
            "-File", (Join-Path $ScriptDir "openai-tunnel.ps1"),
            "-Port", "$Port", "-HealthPort", "$HealthPort"
        )
        Start-Process -FilePath "powershell.exe" -ArgumentList $args -WorkingDirectory $ScriptDir -WindowStyle Hidden -RedirectStandardOutput $TunnelOut -RedirectStandardError $TunnelErr | Out-Null
        Write-AgentLog "Started Secure MCP Tunnel supervisor on health port $HealthPort."
    } catch {
        Write-AgentLog "Failed to start Secure MCP Tunnel: $($_.Exception.Message)" "ERROR"
        return $false
    }

    foreach ($i in 1..30) {
        if (Test-TunnelHealth $HealthPort) { return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-AgentLog "Secure MCP Tunnel did not become ready after startup." "WARN"
    return $false
}

function Write-Heartbeat([int]$Port, [int]$HealthPort) {
    $state = [ordered]@{
        timestamp = (Get-Date).ToString("o")
        pid = $PID
        local_mcp = (Test-CadGptHealth $Port)
        tunnel = (Test-TunnelHealth $HealthPort)
        cad_runtime_policy = "on-demand"
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $HeartbeatFile -Encoding UTF8
}

$mutex = New-Object System.Threading.Mutex($false, "Local\CadGPTBackgroundAgent")
$ownsMutex = $false
try {
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { exit 0 }

    if (-not (Test-Path ".env")) {
        Write-AgentLog ".env is missing; background agent cannot start. Run setup.bat." "ERROR"
        exit 2
    }

    $portValue = Get-DotEnvValue "PORT"
    $healthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
    $port = if ($portValue) { [int]$portValue } else { 3000 }
    $healthPort = if ($healthValue) { [int]$healthValue } else { 8080 }

    Write-AgentLog "CadGPT background agent started (PID $PID). Local listener=$port, tunnel health=$healthPort."

    while ($true) {
        try {
            $localReady = Start-Connector $port
            if ($localReady) {
                $null = Start-Tunnel $port $healthPort
            }
            Write-Heartbeat $port $healthPort
        } catch {
            Write-AgentLog "Supervisor iteration failed: $($_.Exception.Message)" "ERROR"
        }
        Start-Sleep -Seconds ([Math]::Max(2, $PollSeconds))
    }
}
finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
