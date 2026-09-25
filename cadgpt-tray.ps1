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
$script:IsTrayHost = $false
$IndexPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "dist\index.js"))
$TrayScriptPath = [System.IO.Path]::GetFullPath($PSCommandPath)
$TrayLauncherPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "cadgpt-tray.vbs"))
$TunnelProfilePath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "profiles\cadgpt.yaml"))

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
    if (-not (Test-Path $TrayLauncherPath)) {
        throw "cadgpt-tray.vbs is missing. Re-run setup from the current source tree."
    }
    return 'wscript.exe "' + $TrayLauncherPath + '"'
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

function Get-ProcessInfo([int]$ProcessId) {
    try {
        return Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    } catch {
        return $null
    }
}

function Test-CommandLineContains([int]$ProcessId, [string]$Needle) {
    $info = Get-ProcessInfo -ProcessId $ProcessId
    if (-not $info -or -not $info.CommandLine) { return $false }
    return $info.CommandLine.IndexOf($Needle, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
}

function Test-OwnedCadGptProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^node(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $IndexPath
}

function Test-OwnedTunnelProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^tunnel-client(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $TunnelProfilePath
}

function Test-OwnedTrayProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $false }
    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc -or $proc.ProcessName -notmatch '^(powershell|pwsh)(?:\.exe)?$') { return $false }
    return Test-CommandLineContains -ProcessId $ProcessId -Needle $TrayScriptPath
}

$CadGptPortValue = Get-DotEnvValue "PORT"
$CadGptPort = if ($CadGptPortValue) { [int]$CadGptPortValue } else { 3100 }
$TunnelHealthValue = Get-DotEnvValue "OPENAI_TUNNEL_HEALTH_PORT"
$TunnelHealthPort = if ($TunnelHealthValue) { [int]$TunnelHealthValue } else { 8180 }

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

function Get-AutoCadProbeStatus {
    $processes = @(Get-Process -Name "acad" -ErrorAction SilentlyContinue)
    if ($processes.Count -eq 0) {
        return [pscustomobject]@{
            running = $false
            attached = $false
            drawing_count = 0
            active_document = $null
            state = "OFF"
        }
    }

    $progIds = @(
        "AutoCAD.Application",
        "AutoCAD.Application.24.3",
        "AutoCAD.Application.24.2",
        "AutoCAD.Application.24.1",
        "AutoCAD.Application.24",
        "AutoCAD.Application.23.1",
        "AutoCAD.Application.23",
        "AutoCAD.Application.22"
    )

    foreach ($progId in $progIds) {
        try {
            $app = [System.Runtime.InteropServices.Marshal]::GetActiveObject($progId)
            if (-not $app) { continue }

            $count = [int]$app.Documents.Count
            $activeName = $null
            if ($count -gt 0) {
                try { $activeName = [string]$app.ActiveDocument.Name } catch {}
            }
            return [pscustomobject]@{
                running = $true
                attached = $true
                drawing_count = $count
                active_document = $activeName
                state = "ON"
            }
        } catch {}
    }

    return [pscustomobject]@{
        running = $true
        attached = $false
        drawing_count = $null
        active_document = $null
        state = "ON"
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

function Read-TrayState {
    if (-not (Test-Path $TrayReadyPath)) { return $null }
    try { return Get-Content $TrayReadyPath -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Write-TrayState {
    @{
        pid = $PID
        ready = $true
        started_at = $script:TrayStartedAt
        script = $TrayScriptPath
        cadgpt_pid = $script:CadGptPid
        tunnel_pid = $script:TunnelPid
        autocad_running = [bool]$script:CadProbe.running
        autocad_attached = [bool]$script:CadProbe.attached
        autocad_drawing_count = $script:CadProbe.drawing_count
        autocad_active_document = $script:CadProbe.active_document
        autocad_probe_at = $script:CadProbeAt
    } | ConvertTo-Json | Set-Content -Path $TrayReadyPath -Encoding UTF8
}

function Resolve-OwnedCadGptPid {
    $state = Read-TrayState
    if ($state -and $state.cadgpt_pid) {
        $candidate = [int]$state.cadgpt_pid
        if (Test-OwnedCadGptProcess -ProcessId $candidate) { return $candidate }
    }

    $portPid = Get-PortOwnerPid -TargetPort $CadGptPort
    if ($portPid -and (Test-OwnedCadGptProcess -ProcessId $portPid)) { return $portPid }
    return $null
}

function Resolve-OwnedTunnelPid {
    $state = Read-TrayState
    if ($state -and $state.tunnel_pid) {
        $candidate = [int]$state.tunnel_pid
        if (Test-OwnedTunnelProcess -ProcessId $candidate) { return $candidate }
    }

    $portPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
    if ($portPid -and (Test-OwnedTunnelProcess -ProcessId $portPid)) { return $portPid }
    return $null
}

function Stop-VerifiedRuntime {
    $cadPid = Resolve-OwnedCadGptPid
    if ($cadPid) {
        Stop-Process -Id $cadPid -Force -ErrorAction SilentlyContinue
        [void](Wait-ForCondition { -not (Get-Process -Id $cadPid -ErrorAction SilentlyContinue) } 5)
    } elseif (Get-PortOwnerPid -TargetPort $CadGptPort) {
        Write-TrayLog "CadGPT port $CadGptPort is occupied by an unowned process; refusing to kill it."
    }

    $tunnelPid = Resolve-OwnedTunnelPid
    if ($tunnelPid) {
        Stop-Process -Id $tunnelPid -Force -ErrorAction SilentlyContinue
        [void](Wait-ForCondition { -not (Get-Process -Id $tunnelPid -ErrorAction SilentlyContinue) } 5)
    } elseif (Get-PortOwnerPid -TargetPort $TunnelHealthPort) {
        Write-TrayLog "Tunnel health port $TunnelHealthPort is occupied by an unowned process; refusing to kill it."
    }

    $script:CadGptPid = $null
    $script:TunnelPid = $null
    if ($script:IsTrayHost -and (Test-Path $TrayReadyPath)) { Write-TrayState }
}

function Stop-TrayHostFromMarker {
    $state = Read-TrayState
    if (-not $state -or -not $state.pid) {
        Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
        return
    }

    $trayPid = [int]$state.pid
    if ($trayPid -gt 0 -and $trayPid -ne $PID) {
        if (Test-OwnedTrayProcess -ProcessId $trayPid) {
            Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
        } else {
            Write-TrayLog "Tray marker PID $trayPid is not an owned CadGPT tray process; refusing to kill it."
        }
    }
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
    # Runtime ownership is recorded in the tray marker, so stop runtime first.
    Stop-VerifiedRuntime
    Stop-TrayHostFromMarker
    Write-Host "[OK] CadGPT tray/runtime stop requested for verified owned processes only." -ForegroundColor Green
    exit 0
}
if ($StatusOnly) {
    $health = Get-CadGptHealth
    $state = Read-TrayState
    $trayPid = if ($state -and $state.pid) { [int]$state.pid } else { 0 }
    $trayReady = $trayPid -gt 0 -and (Test-OwnedTrayProcess -ProcessId $trayPid)
    Write-Host "Tray             : $(if ($trayReady) { 'READY' } else { 'OFFLINE' })"
    Write-Host "Slim MCP         : $(if ($health) { 'READY' } else { 'OFFLINE' })"
    if ($health) {
        Write-Host "Loaded families  : $(@($health.loaded_families) -join ', ')"
        Write-Host "Active work      : $($health.active_work_registrations)"
        Write-Host "Active leases    : $($health.active_tool_leases)"
        Write-Host "CAD MCP          : $(if ($health.cad_mcp.connected) { 'CONNECTED' } else { 'SLEEPING' })"
    }
    Write-Host "Secure tunnel    : $(if (Test-TunnelHealthy) { 'READY' } else { 'OFFLINE' })"
    if ($state -and $null -ne $state.autocad_running) {
        if (-not [bool]$state.autocad_running) {
            Write-Host "AutoCAD          : OFF"
        } elseif ([bool]$state.autocad_attached) {
            Write-Host "AutoCAD          : ON - $($state.autocad_drawing_count) drawing(s)"
        } else {
            Write-Host "AutoCAD          : ON - COM unavailable"
        }
    } else {
        $probe = Get-AutoCadProbeStatus
        if (-not $probe.running) {
            Write-Host "AutoCAD          : OFF"
        } elseif ($probe.attached) {
            Write-Host "AutoCAD          : ON - $($probe.drawing_count) drawing(s)"
        } else {
            Write-Host "AutoCAD          : ON - COM unavailable"
        }
    }
    exit 0
}

if ($env:OS -ne "Windows_NT") { throw "CadGPT tray host is Windows-only." }
if (-not (Test-Path ".env")) { throw ".env is missing. Run setup.bat first." }
if (-not (Test-Path $IndexPath)) { throw "dist\index.js is missing. Run setup.bat/npm run build first." }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, "Local\CadGPTTray", [ref]$createdNew)
if (-not $createdNew) {
    Write-TrayLog "Another CadGPT tray instance owns the mutex; exiting duplicate."
    exit 0
}

$script:IsTrayHost = $true
$script:CadGptLauncher = $null
$script:TunnelLauncher = $null
$script:CadGptPid = $null
$script:TunnelPid = $null
$script:RuntimeState = "Starting"
$script:Exiting = $false
$script:TrayStartedAt = (Get-Date).ToString("o")
$script:CadProbe = [pscustomobject]@{
    running = $false
    attached = $false
    drawing_count = 0
    active_document = $null
    state = "OFF"
}
$script:CadProbeAt = $null

function Set-TrayTooltip([string]$RuntimeStatus) {
    if (-not $notify) { return }
    $cadText = if (-not $script:CadProbe.running) {
        "CAD OFF"
    } elseif ($script:CadProbe.attached) {
        "CAD $($script:CadProbe.drawing_count) dwg"
    } else {
        "CAD ON"
    }
    $text = "CadGPT $RuntimeStatus | $cadText"
    if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
    $notify.Text = $text
}

function Update-CadProbeStatus {
    $script:CadProbe = Get-AutoCadProbeStatus
    $script:CadProbeAt = (Get-Date).ToString("o")

    if ($cadItem) {
        if (-not $script:CadProbe.running) {
            $cadItem.Text = "AutoCAD: OFF"
        } elseif ($script:CadProbe.attached) {
            $suffix = if ([int]$script:CadProbe.drawing_count -eq 1) { "drawing" } else { "drawings" }
            $cadItem.Text = "AutoCAD: ON · $($script:CadProbe.drawing_count) $suffix"
        } else {
            $cadItem.Text = "AutoCAD: ON · COM unavailable"
        }
    }

    Set-TrayTooltip -RuntimeStatus (Get-RuntimeStatus)
    Write-TrayState
}

function Update-TrayStatus {
    if (-not $notify) { return }
    $status = Get-RuntimeStatus
    $statusItem.Text = "CadGPT: $status"
    Set-TrayTooltip -RuntimeStatus $status
    Write-TrayState
}

function AdoptExistingCadGpt {
    $ownerPid = Get-PortOwnerPid -TargetPort $CadGptPort
    if (-not $ownerPid) { return $false }
    if (-not (Get-CadGptHealth)) { return $false }
    if (-not (Test-OwnedCadGptProcess -ProcessId $ownerPid)) {
        Write-TrayLog "Healthy-looking CadGPT service on port $CadGptPort is not owned by this source tree; refusing to adopt PID $ownerPid."
        return $false
    }
    $script:CadGptPid = $ownerPid
    return $true
}

function AdoptExistingTunnel {
    $ownerPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
    if (-not $ownerPid -or -not (Test-TunnelHealthy)) { return $false }
    if (-not (Test-OwnedTunnelProcess -ProcessId $ownerPid)) {
        Write-TrayLog "Healthy-looking tunnel on port $TunnelHealthPort is not owned by this CadGPT profile; refusing to adopt PID $ownerPid."
        return $false
    }
    $script:TunnelPid = $ownerPid
    return $true
}

function Start-CadGptRuntime {
    $script:RuntimeState = "Starting"
    Update-TrayStatus

    if (-not (AdoptExistingCadGpt)) {
        $existingPid = Get-PortOwnerPid -TargetPort $CadGptPort
        if ($existingPid) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "CadGPT port occupied by unowned/unhealthy PID $existingPid; refusing to kill or replace it."
            return
        }

        $node = (Get-Command node -ErrorAction Stop).Source
        $quotedIndexPath = '"' + ($IndexPath -replace '"', '\"') + '"'
        $startParams = @{
            FilePath = $node
            ArgumentList = $quotedIndexPath
            WorkingDirectory = $ScriptDir
            WindowStyle = "Hidden"
            RedirectStandardOutput = (Join-Path $LogDir "cadgpt.out.log")
            RedirectStandardError = (Join-Path $LogDir "cadgpt.err.log")
            PassThru = $true
        }
        $script:CadGptLauncher = Start-Process @startParams
        $script:CadGptPid = $script:CadGptLauncher.Id
        Write-TrayState

        if (-not (Wait-ForCondition { $null -ne (Get-CadGptHealth) } 25)) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            return
        }
        if (-not (Test-OwnedCadGptProcess -ProcessId $script:CadGptPid)) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "Started node process failed CadGPT ownership verification."
            return
        }
    }

    if (-not (AdoptExistingTunnel)) {
        $existingPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
        if ($existingPid) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "Tunnel health port occupied by unowned/unhealthy PID $existingPid; refusing to kill or replace it."
            return
        }

        $tunnelScript = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "openai-tunnel.ps1"))
        $tunnelOut = Join-Path $LogDir "tunnel.out.log"
        $tunnelErr = Join-Path $LogDir "tunnel.err.log"
        Remove-Item $tunnelOut,$tunnelErr -Force -ErrorAction SilentlyContinue

        $escapedTunnelScript = $tunnelScript.Replace("'", "''")
        $command = "& '$escapedTunnelScript' -Port $CadGptPort -HealthPort $TunnelHealthPort"
        $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
        $tunnelParams = @{
            FilePath = "powershell.exe"
            ArgumentList = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedCommand"
            WorkingDirectory = $ScriptDir
            WindowStyle = "Hidden"
            RedirectStandardOutput = $tunnelOut
            RedirectStandardError = $tunnelErr
            PassThru = $true
        }
        $script:TunnelLauncher = Start-Process @tunnelParams
        Write-TrayLog "Started tunnel PowerShell launcher PID $($script:TunnelLauncher.Id) for health port $TunnelHealthPort."

        $deadline = (Get-Date).AddSeconds(65)
        $tunnelReady = $false
        do {
            if (Test-TunnelHealthy) {
                $tunnelReady = $true
                break
            }
            $script:TunnelLauncher.Refresh()
            if ($script:TunnelLauncher.HasExited) {
                $exitCode = $script:TunnelLauncher.ExitCode
                Write-TrayLog "Tunnel PowerShell launcher exited before readiness with code $exitCode."
                if (Test-Path $tunnelErr) {
                    $tail = (Get-Content $tunnelErr -Tail 20 -ErrorAction SilentlyContinue) -join " | "
                    if ($tail) { Write-TrayLog "Tunnel stderr: $tail" }
                }
                if (Test-Path $tunnelOut) {
                    $tail = (Get-Content $tunnelOut -Tail 20 -ErrorAction SilentlyContinue) -join " | "
                    if ($tail) { Write-TrayLog "Tunnel stdout: $tail" }
                }
                break
            }
            Start-Sleep -Milliseconds 500
        } while ((Get-Date) -lt $deadline)

        if (-not $tunnelReady) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "Secure tunnel did not become ready on health port $TunnelHealthPort."
            return
        }

        $script:TunnelPid = Get-PortOwnerPid -TargetPort $TunnelHealthPort
        if (-not $script:TunnelPid -or -not (Test-OwnedTunnelProcess -ProcessId $script:TunnelPid)) {
            $script:RuntimeState = "Degraded"
            Update-TrayStatus
            Write-TrayLog "Started tunnel failed ownership verification."
            return
        }
        Write-TrayState
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
    if (-not $script:CadGptPid -or -not (Test-OwnedCadGptProcess -ProcessId ([int]$script:CadGptPid))) { return "Degraded" }
    if (-not $script:TunnelPid -or -not (Test-OwnedTunnelProcess -ProcessId ([int]$script:TunnelPid))) { return "Degraded" }
    if ($health.cad_mcp.connected) { return "CAD Connected" }
    if ([int]$health.active_work_registrations -gt 0) { return "Working" }
    return "Ready"
}

$notify = New-Object System.Windows.Forms.NotifyIcon

$trayIconPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "icon.png"))
$trayIconBitmap = $null
$trayIconHandle = [IntPtr]::Zero
try {
    if (Test-Path $trayIconPath) {
        $trayIconBitmap = New-Object System.Drawing.Bitmap($trayIconPath)
        $trayIconHandle = $trayIconBitmap.GetHicon()
        $sourceIcon = [System.Drawing.Icon]::FromHandle($trayIconHandle)
        $notify.Icon = [System.Drawing.Icon]$sourceIcon.Clone()
    } else {
        Write-TrayLog "Tray icon asset missing at $trayIconPath; using system fallback icon."
        $notify.Icon = [System.Drawing.SystemIcons]::Application
    }
} catch {
    Write-TrayLog "Failed to load tray icon from ${trayIconPath}: $($_.Exception.Message); using system fallback icon."
    $notify.Icon = [System.Drawing.SystemIcons]::Application
} finally {
    if ($trayIconBitmap) { $trayIconBitmap.Dispose() }
}
$notify.Text = "CadGPT - Starting"

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$statusItem.Enabled = $false
$statusItem.Text = "CadGPT: Starting"
[void]$menu.Items.Add($statusItem)

$cadItem = New-Object System.Windows.Forms.ToolStripMenuItem
$cadItem.Enabled = $false
$cadItem.Text = "AutoCAD: checking..."
[void]$menu.Items.Add($cadItem)

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
Write-TrayState

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
$menu.Add_Opening({
    Update-CadProbeStatus
    Update-TrayStatus
})

$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 60000
$statusTimer.Add_Tick({ Update-TrayStatus })
$statusTimer.Start()

$cadProbeTimer = New-Object System.Windows.Forms.Timer
$cadProbeTimer.Interval = 15000
$cadProbeTimer.Add_Tick({ Update-CadProbeStatus })
$cadProbeTimer.Start()

$bootstrapTimer = New-Object System.Windows.Forms.Timer
$bootstrapTimer.Interval = 250
$bootstrapTimer.Add_Tick({
    $bootstrapTimer.Stop()
    try {
        if ($RestartRuntimeOnStart) { Stop-VerifiedRuntime }
        Update-CadProbeStatus
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
    $cadProbeTimer.Stop()
    $bootstrapTimer.Stop()
    Remove-Item $TrayReadyPath -Force -ErrorAction SilentlyContinue
    $notify.Visible = $false
    if ($notify.Icon -and $notify.Icon -ne [System.Drawing.SystemIcons]::Application) {
        $notify.Icon.Dispose()
    }
    $notify.Dispose()
    $menu.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
    $mutex.Dispose()
}
