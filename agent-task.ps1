param(
    [ValidateSet("install", "start", "stop", "restart", "status", "uninstall")]
    [string]$Action = "status",
    [switch]$WaitReady
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$TaskName = "CadGPT Background Agent"

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

function Resolve-Ports {
    $portValue = Get-DotEnvValue "PORT"
    $coreValue = Get-DotEnvValue "CADGPT_INTERNAL_PORT"
    $healthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
    $script:CadGptPort = if ($portValue) { [int]$portValue } else { 3000 }
    $script:CorePort = if ($coreValue) { [int]$coreValue } else { $CadGptPort + 1 }
    $script:TunnelHealthPort = if ($healthValue) { [int]$healthValue } else { 8080 }
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

function Get-WakeHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$CadGptPort/health" -TimeoutSec 2
        if ($health.status -eq "ok" -and $health.name -eq "cadgpt" -and $health.wake_agent -eq $true) { return $health }
    } catch {}
    return $null
}

function Get-CoreHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$CorePort/health" -TimeoutSec 2
        if ($health.status -eq "ok" -and $health.name -eq "cadgpt" -and $health.wake_agent -ne $true) { return $health }
    } catch {}
    return $null
}

function Test-TunnelHealth {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200 -and $r.Content -match "ready")
    } catch { return $false }
}

function Stop-VerifiedProcesses {
    $wake = Get-WakeHealth
    $wakePid = Get-PortOwnerPid $CadGptPort
    if ($wake -and $wakePid) {
        Stop-Process -Id $wakePid -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Stopped CadGPT wake-agent (PID $wakePid)."
    }

    $core = Get-CoreHealth
    $corePid = Get-PortOwnerPid $CorePort
    if ($core -and $corePid) {
        Stop-Process -Id $corePid -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Stopped full CadGPT MCP (PID $corePid)."
    }

    $tunnelPid = Get-PortOwnerPid $TunnelHealthPort
    if ($tunnelPid) {
        $proc = Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue
        $isTunnel = (Test-TunnelHealth) -or ($proc -and $proc.ProcessName -eq "tunnel-client")
        if ($isTunnel) {
            Stop-Process -Id $tunnelPid -Force -ErrorAction SilentlyContinue
            Write-Host "[OK] Stopped verified Secure MCP Tunnel process (PID $tunnelPid)."
        }
    }
}

function Install-AgentTask {
    if (-not (Test-Path "dist\wake-agent.js")) { throw "dist/wake-agent.js is missing; run npm run build first" }
    if (-not (Test-Path ".env")) { throw ".env is missing; run setup.bat first" }

    $node = (Get-Command node -ErrorAction Stop).Source
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $wakeScript = Join-Path $ScriptDir "dist\wake-agent.js"
    $arguments = "`"$wakeScript`""

    $taskAction = New-ScheduledTaskAction -Execute $node -Argument $arguments -WorkingDirectory $ScriptDir
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
    $task = New-ScheduledTask -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Write-Host "[OK] Installed per-user autostart task: $TaskName"
}

function Start-AgentTask {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) { throw "CadGPT background task is not installed. Run setup.bat or run.bat install." }
    if (Get-WakeHealth) {
        Write-Host "[OK] CadGPT wake-agent is already running."
        return
    }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[OK] CadGPT wake-agent start requested."
}

function Stop-AgentTask {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    Stop-VerifiedProcesses
}

function Show-Status {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $wake = Get-WakeHealth
    $core = Get-CoreHealth
    if ($task) { Write-Host "Scheduled task : installed ($($task.State))" }
    else { Write-Host "Scheduled task : NOT INSTALLED" }

    if ($wake) {
        Write-Host "Wake listener   : READY ($($wake.mode))"
        Write-Host "AutoCAD detect  : $($wake.autocad_running)"
    } else { Write-Host "Wake listener   : OFFLINE" }

    Write-Host "Full CadGPT MCP : $(if ($core) { 'ACTIVE' } else { 'SLEEPING' })"
    Write-Host "Secure tunnel   : $(if (Test-TunnelHealth) { 'READY' } else { 'OFFLINE' })"
    if ($core -and $core.cad_mcp.connected) {
        Write-Host "CAD MCP         : ACTIVE (PID $($core.cad_mcp.pid))"
    } else {
        Write-Host "CAD MCP         : SLEEPING / not connected"
    }
}

function Wait-AgentReady {
    foreach ($i in 1..60) {
        if ((Get-WakeHealth) -and (Test-TunnelHealth)) {
            Write-Host "[OK] CadGPT wake listener and Secure MCP Tunnel are ready."
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "CadGPT background agent did not become ready. Run doctor.bat and inspect .runtime/wake-agent.log."
}

Resolve-Ports

switch ($Action) {
    "install" {
        Install-AgentTask
        Start-AgentTask
    }
    "start" { Start-AgentTask }
    "stop" { Stop-AgentTask }
    "restart" {
        Stop-AgentTask
        Start-Sleep -Milliseconds 500
        Start-AgentTask
    }
    "status" { Show-Status }
    "uninstall" {
        Stop-AgentTask
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        }
        Write-Host "[OK] Removed CadGPT autostart task. Configuration and dependencies were kept."
    }
}

if ($WaitReady -and $Action -in @("install", "start", "restart")) { Wait-AgentReady }
if ($Action -ne "status") { Show-Status }
