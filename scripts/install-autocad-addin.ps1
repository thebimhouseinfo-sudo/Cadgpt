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
$pluginsRoot = Join-Path $env:APPDATA "Autodesk\ApplicationPlugins"
$bundleTarget = Join-Path $pluginsRoot "CadGPT.bundle"
$legacyTarget = Join-Path $pluginsRoot "CadGPT.Stage0.bundle"

if (Get-Process acad -ErrorAction SilentlyContinue) {
    Write-Error "AutoCAD is running. Save drawings and close AutoCAD before installing CadGPT."
    exit 2
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

if (-not (Test-Path (Join-Path $bundleSource "Contents\Windows\CadGpt.AutoCad.dll"))) {
    Write-Error "CadGPT bundle DLL was not produced: $bundleSource"
    exit 3
}

New-Item -ItemType Directory -Force -Path $pluginsRoot | Out-Null

foreach ($old in @($bundleTarget, $legacyTarget)) {
    if (Test-Path $old) {
        Remove-Item $old -Recurse -Force
    }
}

Copy-Item $bundleSource $bundleTarget -Recurse -Force

$installedManifest = Join-Path $bundleTarget "PackageContents.xml"
$installedDll = Join-Path $bundleTarget "Contents\Windows\CadGpt.AutoCad.dll"

if (-not (Test-Path $installedManifest) -or -not (Test-Path $installedDll)) {
    Write-Error "CadGPT add-in installation verification failed."
    exit 4
}

$manifestText = Get-Content $installedManifest -Raw
if ($manifestText -notmatch 'LoadOnAutoCADStartup="True"') {
    Write-Error "Installed CadGPT bundle is not configured for AutoCAD startup loading."
    exit 4
}

Write-Host ""
Write-Host "[OK] CadGPT AutoCAD add-in installed."
Write-Host "Bundle  : $bundleTarget"
Write-Host "Command : CADGPT"
Write-Host "Autoload: enabled on AutoCAD startup"
