[CmdletBinding()]
param(
    [ValidateSet("Debug","Release")]
    [string]$Configuration = "Release",
    [string]$AutoCadInstallDir
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildScript = Join-Path $PSScriptRoot "build-autocad-addin.ps1"
$bundleSource = Join-Path $repoRoot "addins\cadgpt-autocad\bin\bundle\CadGPT.bundle"

$userPluginsRoot = Join-Path $env:APPDATA "Autodesk\ApplicationPlugins"
$machinePluginsRoot = Join-Path $env:ProgramData "Autodesk\ApplicationPlugins"
$bundleTarget = Join-Path $userPluginsRoot "CadGPT.bundle"

$productCode = "{8F64FC7A-9F8C-4DEB-984D-B8024721967F}"
$dllName = "CadGpt.AutoCad.dll"

if (Get-Process acad -ErrorAction SilentlyContinue) {
    Write-Error "AutoCAD is running. Save drawings and close AutoCAD before installing CadGPT."
    exit 2
}

function Test-CadGptBundle {
    param([string]$BundlePath)

    if (-not (Test-Path -LiteralPath $BundlePath -PathType Container)) {
        return $false
    }

    $manifest = Join-Path $BundlePath "PackageContents.xml"
    if (Test-Path -LiteralPath $manifest -PathType Leaf) {
        try {
            $text = Get-Content -LiteralPath $manifest -Raw
            if (
                $text -match [regex]::Escape($productCode) -or
                $text -match [regex]::Escape($dllName) -or
                $text -match 'Name="CadGPT(?: Stage 0)?"'
            ) {
                return $true
            }
        }
        catch {
        }
    }

    return Test-Path -LiteralPath (Join-Path $BundlePath "Contents\Windows\$dllName")
}

Write-Host "Scanning for legacy CadGPT AutoCAD bundles..."

$pluginRoots = @(
    $userPluginsRoot,
    $machinePluginsRoot
) | Select-Object -Unique

$legacyFailures = @()

foreach ($root in $pluginRoots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        continue
    }

    $candidates = @(
        Get-ChildItem -LiteralPath $root -Directory -Filter "*.bundle" -ErrorAction SilentlyContinue
    )

    foreach ($candidate in $candidates) {
        if (-not (Test-CadGptBundle -BundlePath $candidate.FullName)) {
            continue
        }

        Write-Host "Removing old CadGPT bundle: $($candidate.FullName)"
        try {
            Remove-Item -LiteralPath $candidate.FullName -Recurse -Force -ErrorAction Stop
        }
        catch {
            $legacyFailures += $candidate.FullName
        }
    }
}

if ($legacyFailures.Count -gt 0) {
    Write-Host ""
    Write-Error (
        "Could not remove legacy CadGPT bundle(s): " +
        ($legacyFailures -join "; ") +
        ". Re-run cadaddin.bat from an elevated terminal (Run as administrator)."
    )
    exit 5
}

Write-Host "Building CadGPT AutoCAD add-in..."
& $buildScript -AutoCadInstallDir $AutoCadInstallDir -Configuration $Configuration
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (-not (Test-Path (Join-Path $bundleSource "PackageContents.xml"))) {
    Write-Error "CadGPT bundle manifest was not produced: $bundleSource"
    exit 3
}

if (-not (Test-Path (Join-Path $bundleSource "Contents\Windows\$dllName"))) {
    Write-Error "CadGPT bundle DLL was not produced: $bundleSource"
    exit 3
}

New-Item -ItemType Directory -Force -Path $userPluginsRoot | Out-Null
Copy-Item $bundleSource $bundleTarget -Recurse -Force

$installedManifest = Join-Path $bundleTarget "PackageContents.xml"
$installedDll = Join-Path $bundleTarget "Contents\Windows\$dllName"

if (-not (Test-Path $installedManifest) -or -not (Test-Path $installedDll)) {
    Write-Error "CadGPT add-in installation verification failed."
    exit 4
}

$manifestText = Get-Content $installedManifest -Raw
if ($manifestText -notmatch 'LoadOnAutoCADStartup="True"') {
    Write-Error "Installed CadGPT bundle is not configured for AutoCAD startup loading."
    exit 4
}

$remainingLegacy = @()
foreach ($root in $pluginRoots) {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) {
        continue
    }

    foreach ($candidate in @(Get-ChildItem -LiteralPath $root -Directory -Filter "*.bundle" -ErrorAction SilentlyContinue)) {
        if (
            $candidate.FullName -ne $bundleTarget -and
            (Test-CadGptBundle -BundlePath $candidate.FullName)
        ) {
            $remainingLegacy += $candidate.FullName
        }
    }
}

if ($remainingLegacy.Count -gt 0) {
    Write-Error (
        "Legacy CadGPT bundle still exists after install: " +
        ($remainingLegacy -join "; ")
    )
    exit 5
}

Write-Host ""
Write-Host "[OK] CadGPT AutoCAD add-in installed cleanly."
Write-Host "Bundle  : $bundleTarget"
Write-Host "Command : CADGPT"
Write-Host "Autoload: enabled on AutoCAD startup"
Write-Host "Legacy  : none detected"
