# CadGPT-only Scheduled Task authority. Dot-source from cadgpt-tray.ps1.
# Ownership is checked BEFORE any replace/delete. Never touch foreign tasks.
function Get-CadGptScheduledTask {
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) {
        throw 'Task Scheduler inspection unavailable.'
    }
    Get-ScheduledTask -TaskName $StartupTaskName -TaskPath '\' -ErrorAction SilentlyContinue
}
function Get-CadGptTaskLauncher {
    if (-not (Test-Path -LiteralPath $TrayLauncherPath -PathType Leaf)) {
        throw 'CadGPT tray VBS launcher missing.'
    }
    $exe = Join-Path $env:WINDIR 'System32\wscript.exe'
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Windows Script Host missing.' }
    @{ Execute = $exe; Arguments = ('"' + $TrayLauncherPath + '"'); WorkingDirectory = $ScriptDir }
}
function Test-CadGptTaskOwnership($Task, [string]$CurrentUser) {
    if (-not $Task -or @($Task.Actions).Count -ne 1) { return $false }
    $action = @($Task.Actions)[0]
    $expectedExe = Join-Path $env:WINDIR 'System32\wscript.exe'
    if ($action.Execute -ine $expectedExe) { return $false }
    # Recognize a previous checkout, but never another arbitrary script/task.
    $argsText = [string]$action.Arguments
    if ($argsText -notmatch '^"([^"]+\\cadgpt-tray\.vbs)"$') { return $false }
    $candidate = $Matches[1]
    if (-not [IO.Path]::IsPathRooted($candidate)) { return $false }
    $priorRoot = Split-Path -Parent $candidate
    if (-not (Test-Path -LiteralPath (Join-Path $priorRoot 'cadgpt-tray.ps1') -PathType Leaf)) { return $false }
    if ([IO.Path]::GetFullPath([string]$action.WorkingDirectory).TrimEnd('\') -ine
        [IO.Path]::GetFullPath($priorRoot).TrimEnd('\')) { return $false }
    if ($Task.Principal.UserId -ine $CurrentUser) { return $false }
    if (@($Task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -ne 1) { return $false }
    return $true
}
function Test-CadGptTaskContract($Task, $Launcher, [string]$CurrentUser) {
    if (-not (Test-CadGptTaskOwnership $Task $CurrentUser)) { return $false }
    $a = @($Task.Actions)[0]
    if ($a.Arguments -cne $Launcher.Arguments -or $a.WorkingDirectory -ine $Launcher.WorkingDirectory) { return $false }
    $trigger = @($Task.Triggers)[0]
    if ($trigger.UserId -ine $CurrentUser -or [string]$trigger.Delay -ne 'PT10S' -or -not $trigger.Enabled) { return $false }
    $p = $Task.Principal
    if ([string]$p.LogonType -notin @('Interactive','3')) { return $false }
    if ([string]$p.RunLevel -notin @('Limited','0')) { return $false }
    $settings = $Task.Settings
    if (-not $settings.StartWhenAvailable -or $settings.DisallowStartIfOnBatteries -or
        $settings.StopIfGoingOnBatteries -or [string]$settings.MultipleInstances -notin @('IgnoreNew','2')) { return $false }
    return $true
}
function Remove-CadGptScheduledTask {
    $task = Get-CadGptScheduledTask
    if (-not $task) { return }
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    if (-not (Test-CadGptTaskOwnership $task $user)) { throw 'Foreign or unverifiable CadGPT Startup task; refusing deletion.' }
    if (-not (Get-Command Unregister-ScheduledTask -ErrorAction SilentlyContinue)) { throw 'Task removal unavailable.' }
    Unregister-ScheduledTask -TaskName $StartupTaskName -TaskPath '\' -Confirm:$false -ErrorAction Stop
    if (Get-CadGptScheduledTask) { throw 'Scheduled Task removal verification failed.' }
}
function Install-CadGptScheduledTask {
    $launcher = Get-CadGptTaskLauncher
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $existing = Get-CadGptScheduledTask
    if ($existing) {
        if (-not (Test-CadGptTaskOwnership $existing $user)) {
            throw 'Foreign or unverifiable CadGPT Startup task; refusing overwrite.'
        }
        if (Test-CadGptTaskContract $existing $launcher $user) { return 'UNCHANGED' }
    }
    foreach ($name in @('Register-ScheduledTask','New-ScheduledTaskAction','New-ScheduledTaskTrigger',
                        'New-ScheduledTaskPrincipal','New-ScheduledTaskSettingsSet')) {
        if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "Task Scheduler command unavailable: $name" }
    }
    $action = New-ScheduledTaskAction -Execute $launcher.Execute -Argument $launcher.Arguments -WorkingDirectory $launcher.WorkingDirectory
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $trigger.Delay = 'PT10S'
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $StartupTaskName -TaskPath '\' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    $actual = Get-CadGptScheduledTask
    if (-not (Test-CadGptTaskContract $actual $launcher $user)) {
        throw 'CadGPT Task readback contract mismatch.'
    }
    'REGISTERED'
}
