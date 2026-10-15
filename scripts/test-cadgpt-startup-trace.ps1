# Isolated Windows startup trace smoke; never changes HKCU or launches the real Tray.
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$fixture = Join-Path $env:TEMP ('cadgpt-startup-smoke-' + [guid]::NewGuid().ToString('N'))
$originalLocalAppData = $env:LOCALAPPDATA

try {
    New-Item -ItemType Directory -Force -Path $fixture | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'cadgpt-tray.vbs') -Destination $fixture
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'cadgpt-tray.ps1') -Destination $fixture
    New-Item -ItemType Directory -Force -Path (Join-Path $fixture 'scripts') | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'scripts\cadgpt-startup-registry.ps1') -Destination (Join-Path $fixture 'scripts')
    $env:LOCALAPPDATA = Join-Path $fixture 'local'
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA | Out-Null
    $trace = Join-Path $env:LOCALAPPDATA 'CadGPT\logs\startup-launch.log'

    # A missing PS script must fail at the VBS stage, without a visible terminal
    # or any real CadGPT process. This is the part before PowerShell can log.
    $vbs = Join-Path $fixture 'cadgpt-tray.vbs'
    $ps1 = Join-Path $fixture 'cadgpt-tray.ps1'
    $hidden = Join-Path $fixture 'cadgpt-tray.ps1.hold'
    Move-Item -LiteralPath $ps1 -Destination $hidden
    try {
        & cscript.exe //nologo $vbs 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 3) { throw "VBS missing-script status: expected 3, got $LASTEXITCODE" }
        $stages = @(Get-Content -LiteralPath $trace -ErrorAction Stop)
        if (-not ($stages -match 'wscript_invoked')) { throw 'VBS missing wscript_invoked' }
        if (-not ($stages -match 'tray_script_missing')) { throw 'VBS missing tray_script_missing' }
    } finally {
        Move-Item -LiteralPath $hidden -Destination $ps1
    }

    # Preflight must log its boundary on Windows PowerShell 5.1 and PS 7.
    # No .env or dist exists in this fixture, so no runtime/tunnel is started.
    foreach ($engine in @('powershell.exe', 'pwsh.exe')) {
        & $engine -NoProfile -ExecutionPolicy Bypass -File $ps1 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { throw "$engine unexpectedly started without .env" }
        $stages = @(Get-Content -LiteralPath $trace -ErrorAction Stop)
        foreach ($required in @('powershell_entry', 'preflight_start', 'env_missing', 'fatal_at_env_missing')) {
            if (-not ($stages -match [regex]::Escape($required))) {
                throw "$engine missing trace stage $required"
            }
        }
        Write-Host "$engine startup preflight trace PASS"
    }

    $source = Get-Content -LiteralPath $ps1 -Raw
    foreach ($required in @('mutex_acquired', 'slim_starting', 'slim_ready',
        'tunnel_starting', 'tunnel_ready', 'tray_icon_visible',
        'tray_state_written', 'message_loop_enter', 'runtime_bootstrap_failed')) {
        if ($source -notmatch [regex]::Escape("Set-StartupStage '$required'")) {
            throw "Startup stage contract missing $required"
        }
    }
    if ($source -match '(?i)RevitGPT|GPTWorker') { throw 'Startup implementation contains other app names' }
    Write-Host 'CadGPT isolated startup trace smoke PASS'
} finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}

# Child preflight processes intentionally exit nonzero; the test itself passed.
exit 0
