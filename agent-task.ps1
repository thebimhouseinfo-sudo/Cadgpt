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
    $healthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
    $script:CadGptPort = if ($portValue) { [int]$portValue } else { 3000 }
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

function Test-CadGptHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$CadGptPort/health" -TimeoutSec 2
        return ($health.status -eq "ok" -and $health.name -eq "cadgpt")
    } catch { return $false }
}

function Test-TunnelHealth {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200 -and $r.Content -match "ready")
    } catch { return $false }
}

function Stop-VerifiedChildren {
    $connectorPid = Get-PortOwnerPid $CadGptPort
    if ($connectorPid -and (Test-CadGptHealth)) {
        Stop-Process -Id $connectorPid -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Stopped verified CadGPT local MCP process (PID $connectorPid)."
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
    if (-not (Test-Path "cadgpt-agent.ps1")) { throw "cadgpt-agent.ps1 is missing" }
    if (-not (Test-Path ".env")) { throw ".env is missing; run setup.bat first" }

    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $agentScript = Join-Path $ScriptDir "cadgpt-agent.ps1"
    $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$agentScript`""

    $taskAction = New-ScheduledTaskAction -Execute $psExe -Argument $arguments
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
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "[OK] CadGPT background agent start requested."
}

function Stop-AgentTask {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500
    }
    Stop-VerifiedChildren
}

function Show-Status {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Host "Scheduled task : installed ($($task.State))"
    } else {
        Write-Host "Scheduled task : NOT INSTALLED"
    }
    Write-Host "Local MCP      : $(if (Test-CadGptHealth) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Secure tunnel  : $(if (Test-TunnelHealth) { 'READY' } else { 'OFFLINE' })"
    Write-Host "CAD MCP policy : ON-DEMAND (not started by Windows autostart)"
}

function Wait-AgentReady {
    foreach ($i in 1..60) {
        if ((Test-CadGptHealth) -and (Test-TunnelHealth)) {
            Write-Host "[OK] CadGPT background listener and Secure MCP Tunnel are ready."
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "CadGPT background agent did not become ready. Run doctor.bat and inspect .runtime/cadgpt-agent.log."
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

if ($WaitReady -and $Action -in @("install", "start", "restart")) {
    Wait-AgentReady
}

if ($Action -ne "status") { Show-Status }
