# Windows-only: isolated HKCU sandbox; NEVER touches the production Run key.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cadgpt-startup-registry.ps1')

$root = 'HKCU:\Software\CadGPT-Startup-Regression-' + [guid]::NewGuid().ToString('N')
$key = Join-Path $root 'Run'
$sentinels = [ordered]@{
    RevitGPT = 'wscript.exe "C:\RevitGPT\revitgpt-tray.vbs"'
    GPTWorker = 'wscript.exe "C:\GPTWorker\gptworker-tray.vbs"'
    AnotherApp = '"C:\Example\startup.exe"'
}
$command = 'wscript.exe "C:\CadGPT\cadgpt-tray.vbs"'

function Assert-Sentinels {
    foreach ($name in $sentinels.Keys) {
        $value = (Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop).$name
        if ($value -cne $sentinels[$name]) { throw "Unrelated Run value changed: $name" }
    }
}

try {
    # Only the sandbox parent is created; the test Run key starts absent.
    New-Item -Path $root -ErrorAction Stop | Out-Null
    # Missing-key case: create a nested test Run key without touching real Run.
    Install-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT' -Command $command
    if (-not (Test-Path -LiteralPath $key)) { throw 'Missing-key install failed' }
    if ((Get-ItemProperty -LiteralPath $key -Name 'CadGPT').CadGPT -cne $command) {
        throw 'CadGPT value mismatch'
    }
    Remove-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT'
    if ((Get-ItemProperty -LiteralPath $key -Name 'CadGPT' -ErrorAction SilentlyContinue)) {
        throw 'Uninstall left its own value behind'
    }

    foreach ($name in $sentinels.Keys) {
        New-ItemProperty -Path $key -Name $name -Value $sentinels[$name] -PropertyType String -Force | Out-Null
    }
    # Existing Run key with unrelated values: repeated installs are idempotent.
    foreach ($i in 1..3) {
        Install-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT' -Command $command
        Assert-Sentinels
    }
    # Update only CadGPT when its own launcher moves.
    $updated = 'wscript.exe "D:\CadGPT-R7\cadgpt-tray.vbs"'
    Install-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT' -Command $updated
    if ((Get-ItemProperty -LiteralPath $key -Name 'CadGPT').CadGPT -cne $updated) {
        throw 'CadGPT update was not applied'
    }
    Assert-Sentinels
    Remove-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT'
    Remove-CadGptStartupValue -RegistryKey $key -ValueName 'CadGPT'
    Assert-Sentinels
    if ((Get-ItemProperty -LiteralPath $key -Name 'CadGPT' -ErrorAction SilentlyContinue)) {
        throw 'CadGPT value unexpectedly remains'
    }
    Write-Host 'CadGPT isolated Registry sandbox: PASS'
} finally {
    if (Test-Path -LiteralPath $root) {
        Remove-Item -LiteralPath $root -Recurse -Force
    }
}
