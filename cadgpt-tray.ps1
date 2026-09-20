# CadGPT source tray host for Windows.
param(
    [switch]$InstallStartup,
    [switch]$RemoveStartup,
    [switch]$StopInstalled,
    [switch]$StatusOnly,
    [switch]$RestartRuntimeOnStart
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

$StartupKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$StartupName = "CadGPT"

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

$appDataConfigured = Get-DotEnvValue "CADGPT_APPDATA_ROOT"
if (-not $appDataConfigured) { $appDataConfigured = "appdata" }
$AppDataRoot = if ([System.IO.Path]::IsPathRooted($appDataConfigured)) {
    [System.IO.Path]::GetFullPath($appDataConfigured)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $appDataConfigured))
}
$LogDir = Join-Path $AppDataRoot "logs"
$StateDir = Join-Path $AppDataRoot "state"
$TrayLog = Join-Path $LogDir "tray.log"
$TrayReadyPath = Join-Path $StateDir "tray-ready.json"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-TrayLog([string]$Message) {
    Add-Content -Path $TrayLog -Value "[$((Get-Date).ToString('s'))] $Message" -Encoding UTF8
}

function Get-StartupCommand {
    return 'powershell.exe -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
}

function Install-StartupRegistration {
    New-Item -Path $StartupKey -Force | Out-Null
    New-ItemProperty -Path $StartupKey -Name $StartupName -Value (Get-StartupCommand) -PropertyType String -Force | Out-Null
    Write-Host "[OK] CadGPT will start automatically when this Windows user signs in." -ForegroundColor Green
}

function Remove-StartupRegistration {
    Remove-ItemProperty -Path $StartupKey -Name $StartupName -ErrorAction SilentlyContinue
    Write-Host "[OK] CadGPT Windows auto-start removed." -ForegroundColor Green
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

$CadGptPortValue = Get-DotEnvValue "PORT"
$CadGptPort = if ($CadGptPortValue) { [int]$CadGptPortValue } else { 3000 }
$TunnelHealthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
$TunnelHealthPort = if ($TunnelHealthValue) { [int]$TunnelHealthValue } else { 8080 }

function Get-CadGptHealth {
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$CadGptPort/health" -TimeoutSec 2
        if ($resp.status -eq "ok" -and $resp.name -eq "cadgpt") { return $resp }
    } catch {}
    return $null
}

function Test-TunnelHealthy {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$TunnelHealthPort/readyz" -UseBasicParsing -TimeoutSec 2
        return $resp.StatusCode -eq 200 -and $resp.Content -match "ready"
    } catch {
        return $false
    }
}

function Wait-ForCondition([scriptblock]$Condition, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Stop-VerifiedRuntime {
    $cadPid = Get-PortOwnerPid -TargetPort $CadGptPort
    if ($cadPid -and (Get-CadGptHealth)) {
        Stop-Process -Id $cadPid -Force -ErrorAction SilentlyContinue
    }

    $tunnelPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
    if ($tunnelPid) {
        $proc = Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue
        if ((Test-TunnelHealthy) -or ($proc -and $proc.ProcessName -eq "tunnel-client")) {
            Stop-Process -Id $tunnelPid -Force -ErrorAction SilentlyContinue
        }
    }

    [void](Wait-ForCondition { -not (Get-PortOwnerPid -TargetPort $CadGptPort) } 5)
    [void](Wait-ForCondition { -not (Get-PortOwnerPid -TargetPort $TunnelHealthPort) } 5)
}

function Stop-TrayHostFromMarker {
    if (-not (Test-Path $TrayReadyPath)) { return }
    try {
        $state = Get-Content $TrayReadyPath -Raw | ConvertFrom-Json
        $trayPid = [int]$state.pid
        if ($trayPid -gt 0 -and $trayPid -ne $PID) {
            Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
}

if ($InstallStartup) {
    Install-StartupRegistration
    exit 0
}
if ($RemoveStartup) {
    Remove-StartupRegistration
    exit 0
}
if ($StopInstalled) {
    Stop-TrayHostFromMarker
    Stop-VerifiedRuntime
    Write-Host "[OK] CadGPT tray/runtime stopped." -ForegroundColor Green
    exit 0
}
if ($StatusOnly) {
    $health = Get-CadGptHealth
    $trayReady = Test-Path $TrayReadyPath
    Write-Host "Tray             : $(if ($trayReady) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Slim MCP         : $(if ($health) { 'READY' } else { 'OFFLINE' })"
    if ($health) {
        Write-Host "Loaded families  : $(@($health.loaded_families) -join ', ')"
        Write-Host "Active work      : $($health.active_work_registrations)"
        Write-Host "CAD MCP          : $(if ($health.cad_mcp.connected) { 'CONNECTED' } else { 'SLEEPING' })"
    }
    Write-Host "Secure tunnel    : $(if (Test-TunnelHealthy) { 'READY' } else { 'OFFLINE' })"
    exit 0
}

if ($env:OS -ne "Windows_NT") { throw "CadGPT tray host is Windows-only." }
if (-not (Test-Path ".env")) { throw ".env is missing. Run setup.bat first." }
if (-not (Test-Path "dist\index.js")) { throw "dist\index.js is missing. Run setup.bat/npm run build first." }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\CadGPTTray", [ref]$createdNew)
if (-not $createdNew) {
    Write-TrayLog "Another CadGPT tray instance owns the mutex; exiting duplicate."
    exit 0
}

$script:CadGptLauncher = $null
$script:TunnelLauncher = $null
$script:RuntimeState = "Starting"
$script:Exiting = $false

function Update-TrayStatus {
    if (-not $notify) { return }
    $status = Get-RuntimeStatus
    $statusItem.Text = "Status: $status"
    $notify.Text = "CadGPT - $status"
}

function Start-CadGptRuntime {
    $script:RuntimeState = "Starting"
    Update-TrayStatus

    if (-not (Get-CadGptHealth)) {
        $existingPid = Get-PortOwnerPid -TargetPort $CadGptPort
        if ($existingPid) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "CadGPT port occupied by unknown/unhealthy PID $existingPid; refusing to kill it."
            return
        }

        $node = (Get-Command node -ErrorAction Stop).Source
        $startParams = @{
            FilePath = $node
            ArgumentList = @("dist\index.js")
            WorkingDirectory = $ScriptDir
            WindowStyle = "Hidden"
            RedirectStandardOutput = (Join-Path $LogDir "cadgpt.out.log")
            RedirectStandardError = (Join-Path $LogDir "cadgpt.err.log")
            PassThru = $true
        }
        $script:CadGptLauncher = Start-Process @startParams

        if (-not (Wait-ForCondition { $null -ne (Get-CadGptHealth) } 25)) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            return
        }
    }

    if (-not (Test-TunnelHealthy)) {
        $existingPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
        if ($existingPid) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "Tunnel health port occupied by unknown/unhealthy PID $existingPid; refusing to kill it."
            return
        }

        $tunnelParams = @{
            FilePath = "powershell.exe"
            ArgumentList = @(
                "-NoProfile", "-ExecutionPolicy", "Bypass",
                "-File", (Join-Path $ScriptDir "openai-tunnel.ps1"),
                "-Port", "$CadGptPort",
                "-HealthPort", "$TunnelHealthPort"
            )
            WorkingDirectory = $ScriptDir
            WindowStyle = "Hidden"
            RedirectStandardOutput = (Join-Path $LogDir "tunnel.out.log")
            RedirectStandardError = (Join-Path $LogDir "tunnel.err.log")
            PassThru = $true
        }
        $script:TunnelLauncher = Start-Process @tunnelParams

        if (-not (Wait-ForCondition { Test-TunnelHealthy } 65)) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            return
        }
    }

    $script:RuntimeState = "Ready"
    Update-TrayStatus
}

function Restart-CadGptRuntime {
    $script:RuntimeState = "Starting"
    Update-TrayStatus
    Stop-VerifiedRuntime
    Start-Sleep -Milliseconds 600
    Start-CadGptRuntime
}

function Get-RuntimeStatus {
    if ($script:RuntimeState -eq "Starting") { return "Starting" }
    $health = Get-CadGptHealth
    if (-not $health -or -not (Test-TunnelHealthy)) { return "Degraded" }
    if ($health.cad_mcp.connected) { return "CAD Connected" }
    if ([int]$health.active_work_registrations -gt 0) { return "Working" }
    return "Ready"
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = "CadGPT - Starting"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Enabled = $false
$statusItem.Text = "Status: Starting"
[void]$menu.Items.Add($statusItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$logsItem = New-Object System.Windows.Forms.ToolStripMenuItem
$logsItem.Text = "Open diagnostics/logs"
[void]$menu.Items.Add($logsItem)

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "Restart CadGPT"
[void]$menu.Items.Add($restartItem)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit CadGPT"
[void]$menu.Items.Add($exitItem)

$notify.ContextMenuStrip = $menu
$notify.Visible = $true

@{
    pid = $PID
    ready = $true
    started_at = (Get-Date).ToString("o")
    script = $PSCommandPath
} | ConvertTo-Json | Set-Content -Path $TrayReadyPath -Encoding UTF8

$logsItem.Add_Click({
    if (Test-Path $LogDir) { Start-Process explorer.exe $LogDir }
})
$restartItem.Add_Click({
    try { Restart-CadGptRuntime }
    catch {
        Write-TrayLog "Restart failed: $($_.Exception.Message)"
        $script:RuntimeState = "Degraded"
        Update-TrayStatus
    }
})
$exitItem.Add_Click({
    if ($script:Exiting) { return }
    $script:Exiting = $true
    try { Stop-VerifiedRuntime } catch {}
    $notify.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$menu.Add_Opening({ Update-TrayStatus })

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 60000
$statusTimer.Add_Tick({ Update-TrayStatus })
$statusTimer.Start()

$bootstrapTimer = New-Object System.Windows.Forms.Timer
$bootstrapTimer.Interval = 250
$bootstrapTimer.Add_Tick({
    $bootstrapTimer.Stop()
    try {
        if ($RestartRuntimeOnStart) { Stop-VerifiedRuntime }
        Start-CadGptRuntime
    } catch {
        Write-TrayLog "Runtime bootstrap failed: $($_.Exception.Message)"
        $script:RuntimeState = "Degraded"
        Update-TrayStatus
    }
})
$bootstrapTimer.Start()

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    $statusTimer.Stop()
    $bootstrapTimer.Stop()
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
    $notify.Visible = $false
    $notify.Dispose()
    $menu.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
