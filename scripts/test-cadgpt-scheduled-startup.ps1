# Isolated validation of ownership/readback rules. No real scheduled tasks touched.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cadgpt-scheduled-startup.ps1')
$root = Join-Path $env:TEMP ('CadGPT startup spaces ' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    New-Item -ItemType File -Path (Join-Path $root 'cadgpt-tray.ps1') | Out-Null
    $env:WINDIR = $env:WINDIR
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $launcher = @{
        Execute = (Join-Path $env:WINDIR 'System32\wscript.exe')
        Arguments = '"' + (Join-Path $root 'cadgpt-tray.vbs') + '"'
        WorkingDirectory = $root
    }
    $action = [pscustomobject]@{
        Execute = $launcher.Execute
        Arguments = $launcher.Arguments
        WorkingDirectory = $root
    }
    $trigger = [pscustomobject]@{
        CimClass = [pscustomobject]@{ CimClassName = 'MSFT_TaskLogonTrigger' }
        UserId = $user
        Delay = 'PT10S'
        Enabled = $true
    }
    $task = [pscustomobject]@{
        Actions = @($action)
        Triggers = @($trigger)
        Principal = [pscustomobject]@{ UserId=$user; LogonType='Interactive'; RunLevel='Limited' }
        Settings = [pscustomobject]@{
            StartWhenAvailable=$true
            DisallowStartIfOnBatteries=$false
            StopIfGoingOnBatteries=$false
            MultipleInstances='IgnoreNew'
        }
    }
    if (-not (Test-CadGptTaskOwnership $task $user)) { throw 'Owned task not recognized' }
    if (-not (Test-CadGptTaskContract $task $launcher $user)) { throw 'Readback rejected valid task' }
    foreach ($i in 1..3) {
        if (-not (Test-CadGptTaskContract $task $launcher $user)) { throw 'Repeated validation failed' }
    }
    $action.Arguments = '"C:\Foreign\other-tray.vbs"'
    if (Test-CadGptTaskOwnership $task $user) { throw 'Foreign task accepted' }
    $action.Arguments = $launcher.Arguments
    $trigger.Delay = 'PT0S'
    if (Test-CadGptTaskContract $task $launcher $user) { throw 'Wrong delay accepted' }
    $trigger.Delay = 'PT10S'
    $task.Principal.UserId = 'FOREIGN\User'
    if (Test-CadGptTaskOwnership $task $user) { throw 'Foreign user accepted' }
    Write-Host 'CadGPT task ownership/readback isolated test PASS'
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
