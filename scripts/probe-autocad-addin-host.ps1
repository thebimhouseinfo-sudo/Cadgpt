[CmdletBinding()]
param(
    [string]$AutoCadInstallDir,
    [string]$JsonOut,
    [string]$MarkdownOut
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($JsonOut)) {
    $JsonOut = Join-Path $env:LOCALAPPDATA "CadGPT\runtime\autocad-addin\stage0-host.json"
}

if ([string]::IsNullOrWhiteSpace($MarkdownOut)) {
    $MarkdownOut = Join-Path $PSScriptRoot "..\docs\roadmap\CADGPT-AUTOCAD-ADDIN-STAGE0-HOST.md"
}

function Resolve-AutoCadInstallDir {
    param([string]$ExplicitDir)

    if ($ExplicitDir) {
        $resolved = (Resolve-Path $ExplicitDir).Path
        if (-not (Test-Path (Join-Path $resolved "acad.exe"))) {
            throw "acad.exe was not found in AutoCadInstallDir: $resolved"
        }
        return $resolved
    }

    $running = @(Get-Process acad -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -ExpandProperty Path -Unique)
    if ($running.Count -eq 1) { return Split-Path -Parent $running[0] }
    if ($running.Count -gt 1) { throw "Multiple AutoCAD executable paths are running. Pass -AutoCadInstallDir explicitly." }

    $roots = @()
    if ($env:ProgramFiles) {
        $autodeskRoot = Join-Path $env:ProgramFiles "Autodesk"
        if (Test-Path $autodeskRoot) {
            $roots = @(Get-ChildItem $autodeskRoot -Directory -Filter "AutoCAD *" -ErrorAction SilentlyContinue |
                ForEach-Object { Join-Path $_.FullName "acad.exe" } |
                Where-Object { Test-Path $_ })
        }
    }

    if ($roots.Count -eq 1) { return Split-Path -Parent $roots[0] }
    if ($roots.Count -gt 1) { throw "Multiple AutoCAD installations were found. Pass -AutoCadInstallDir explicitly." }

    throw "No AutoCAD installation could be resolved. Start AutoCAD or pass -AutoCadInstallDir."
}

function Get-FileRecord {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return $null }
    $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    return [ordered]@{
        name = [System.IO.Path]::GetFileName($Path)
        file_version = $info.FileVersion
        product_version = $info.ProductVersion
    }
}

function Get-RuntimeTarget {
    param([string]$InstallDir, [string]$ReleaseNumber)

    $runtimeFiles = @(Get-ChildItem $InstallDir -File -Filter "*.runtimeconfig.json" -ErrorAction SilentlyContinue)
    $preferred = $runtimeFiles | Where-Object { $_.Name -match '^acad(\.exe)?\.runtimeconfig\.json$' } | Select-Object -First 1

    if ($preferred) {
        try {
            $runtime = Get-Content $preferred.FullName -Raw | ConvertFrom-Json
            $tfm = [string]$runtime.runtimeOptions.tfm
            if ($tfm -match '^net(?<major>\d+)\.(?<minor>\d+)') {
                return [ordered]@{
                    target_framework = "net$($Matches.major).$($Matches.minor)-windows"
                    source = $preferred.Name
                    runtime_tfm = $tfm
                }
            }

            $frameworkVersion = [string]$runtime.runtimeOptions.framework.version
            if ($frameworkVersion -match '^(?<major>\d+)\.') {
                return [ordered]@{
                    target_framework = "net$($Matches.major).0-windows"
                    source = $preferred.Name
                    runtime_tfm = $frameworkVersion
                }
            }
        } catch {
        }
    }

    if ($ReleaseNumber -eq "25.0") {
        return [ordered]@{
            target_framework = "net8.0-windows"
            source = "AutoCAD release 25.0 compatibility rule"
            runtime_tfm = ".NET 8.0"
        }
    }

    if ($ReleaseNumber -eq "24.3") {
        return [ordered]@{
            target_framework = "net48"
            source = "AutoCAD release 24.3 compatibility rule"
            runtime_tfm = ".NET Framework 4.8"
        }
    }

    return $null
}

function Get-WebView2Runtime {
    $programFilesX86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    $programFiles = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $roots = @(
        (Join-Path $programFilesX86 "Microsoft\EdgeWebView\Application"),
        (Join-Path $programFiles "Microsoft\EdgeWebView\Application")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $records = foreach ($root in $roots) {
        Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $exe = Join-Path $_.FullName "msedgewebview2.exe"
            if (Test-Path $exe) {
                $v = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
                [pscustomobject]@{ version = $v.FileVersion; path = $exe }
            }
        }
    }

    return @($records | Sort-Object { [version]$_.version } -Descending | Select-Object -First 1)
}

$installDir = Resolve-AutoCadInstallDir -ExplicitDir $AutoCadInstallDir
$acadExe = Join-Path $installDir "acad.exe"
$apiNames = @("AcCoreMgd.dll", "AcDbMgd.dll", "AcMgd.dll")
$api = @{}
foreach ($name in $apiNames) {
    $record = Get-FileRecord (Join-Path $installDir $name)
    if ($record) { $api[$name] = $record }
}

$core = $api["AcCoreMgd.dll"]
$releaseNumber = $null
if ($core -and $core.file_version -match '^(?<major>\d+)\.(?<minor>\d+)') {
    $releaseNumber = "$($Matches.major).$($Matches.minor)"
}

$runtimeTarget = Get-RuntimeTarget -InstallDir $installDir -ReleaseNumber $releaseNumber
$webView = @(Get-WebView2Runtime)
$dotnetSdks = @()
try { $dotnetSdks = @(& dotnet --list-sdks 2>$null) } catch { $dotnetSdks = @() }

$missingApi = @($apiNames | Where-Object { -not $api.ContainsKey($_) })
$status = "SUPPORTED"
$reason = $null
if ($missingApi.Count -gt 0) {
    $status = "PREREQUISITE_BLOCKED"
    $reason = "Missing AutoCAD managed API assemblies: $($missingApi -join ', ')"
} elseif (-not $releaseNumber) {
    $status = "PREREQUISITE_BLOCKED"
    $reason = "Could not derive the AutoCAD release number from AcCoreMgd.dll."
} elseif (-not $runtimeTarget) {
    $status = "PREREQUISITE_BLOCKED"
    $reason = "Could not determine a supported target framework from the installed AutoCAD runtime."
} elseif ($webView.Count -eq 0) {
    $status = "PREREQUISITE_BLOCKED"
    $reason = "Microsoft Edge WebView2 Runtime was not detected."
}

$runningPids = @(Get-Process acad -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $acadExe } | Select-Object -ExpandProperty Id)

$record = [ordered]@{
    schema_version = 1
    status = $status
    reason = $reason
    generated_utc = [DateTime]::UtcNow.ToString("o")
    autocad = [ordered]@{
        release_number = $releaseNumber
        executable = Get-FileRecord $acadExe
        running_process_count = $runningPids.Count
        running_pids = $runningPids
        api_assemblies = $api
    }
    build = [ordered]@{
        install_dir = $installDir
        target_framework = if ($runtimeTarget) { $runtimeTarget.target_framework } else { $null }
        target_source = if ($runtimeTarget) { $runtimeTarget.source } else { $null }
        runtime_tfm = if ($runtimeTarget) { $runtimeTarget.runtime_tfm } else { $null }
        autocad_series = if ($releaseNumber) { "R$releaseNumber" } else { $null }
        dotnet_sdks = $dotnetSdks
        webview2_runtime_version = if ($webView.Count -gt 0) { $webView[0].version } else { $null }
        profile_path = (Join-Path $env:LOCALAPPDATA "CadGPT\runtime\autocad-addin\stage0-webview2")
    }
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $JsonOut) | Out-Null
$record | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $JsonOut

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $MarkdownOut) | Out-Null
$markdown = @"
# CadGPT AutoCAD Add-in — Stage 0 Host Record

Generated: $($record.generated_utc)
Status: $status
Reason: $(if ($reason) { $reason } else { "None" })

## AutoCAD

- Release number: $releaseNumber
- acad.exe version: $($record.autocad.executable.file_version)
- Running process count for selected install: $($record.autocad.running_process_count)
- AcCoreMgd.dll: $($api["AcCoreMgd.dll"].file_version)
- AcDbMgd.dll: $($api["AcDbMgd.dll"].file_version)
- AcMgd.dll: $($api["AcMgd.dll"].file_version)

## Build target

- Target framework: $($record.build.target_framework)
- Target source: $($record.build.target_source)
- AutoCAD series: $($record.build.autocad_series)
- WebView2 runtime: $($record.build.webview2_runtime_version)
- WebView profile: %LOCALAPPDATA%\CadGPT\runtime\autocad-addin\stage0-webview2

## Notes

This file contains sanitized host evidence only. The local JSON record retains the resolved install path for the build script. Do not infer Stage 0 PASS/FAIL from this host probe.
"@
$markdown | Set-Content -Encoding UTF8 $MarkdownOut

Write-Host "Stage 0 host probe: $status"
Write-Host "JSON: $JsonOut"
Write-Host "Markdown: $MarkdownOut"
if ($runtimeTarget) { Write-Host "Target framework: $($runtimeTarget.target_framework)" }
if ($reason) { Write-Warning $reason }
if ($status -ne "SUPPORTED") { exit 2 }
