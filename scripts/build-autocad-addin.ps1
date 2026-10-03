[CmdletBinding()]
param(
    [string]$AutoCadInstallDir,
    [ValidateSet("Debug","Release")]
    [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$probe = Join-Path $PSScriptRoot "probe-autocad-addin-host.ps1"
$hostJson = Join-Path $env:LOCALAPPDATA "CadGPT\runtime\autocad-addin\stage0-host.json"
$hostMarkdown = Join-Path $repoRoot "docs\roadmap\CADGPT-AUTOCAD-ADDIN-STAGE0-HOST.md"

& $probe -AutoCadInstallDir $AutoCadInstallDir -JsonOut $hostJson -MarkdownOut $hostMarkdown
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$hostInfo = Get-Content $hostJson -Raw | ConvertFrom-Json
if ($hostInfo.status -ne "SUPPORTED") {
    Write-Error "Stage 0 host probe is not supported: $($hostInfo.reason)"
    exit 2
}

$tfm = [string]$hostInfo.build.target_framework
$installDir = [string]$hostInfo.build.install_dir
$series = [string]$hostInfo.build.autocad_series

if (-not $tfm -or -not $installDir -or -not $series) {
    Write-Error "Host descriptor is incomplete."
    exit 2
}

if ($tfm -match '^net(?<major>\d+)\.') {
    $requiredSdkMajor = [int]$Matches.major
    $installedSdks = @(& dotnet --list-sdks)
    if (-not ($installedSdks | Where-Object { $_ -match "^$requiredSdkMajor\." })) {
        Write-Error ".NET SDK $requiredSdkMajor.x is required by the selected AutoCAD runtime but is not installed."
        exit 2
    }
}

$project = Join-Path $repoRoot "addins\cadgpt-autocad\CadGpt.AutoCad.csproj"
$tests = Join-Path $repoRoot "addins\cadgpt-autocad.tests\CadGpt.AutoCad.Tests.csproj"

$testTfm = $tfm
if ($testTfm -match '^net4\d+$') {
    # The lifecycle tests are host-independent. Keep them on the installed modern SDK;
    # only the AutoCAD add-in assembly itself needs to target the legacy CLR.
    $testTfm = "net8.0"
}
elseif ($testTfm -match '^net(?<major>\d+)\.(?<minor>\d+)-windows$') {
    $testTfm = "net$($Matches.major).$($Matches.minor)"
}

Write-Host "Running host-independent lifecycle tests for $testTfm..."
& dotnet test $tests --configuration $Configuration "-p:CadGptTestTargetFramework=$testTfm"
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$props = @(
    "-p:CadGptTargetFramework=$tfm",
    "-p:CadGptHostValidated=true",
    "-p:AutoCadInstallDir=$installDir"
)

Write-Host "Restoring add-in for $tfm..."
& dotnet restore $project @props --use-lock-file
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "Building add-in for $tfm..."
& dotnet build $project --configuration $Configuration --no-restore @props
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$outputDir = Join-Path $repoRoot "addins\cadgpt-autocad\bin\$Configuration\$tfm"
$dll = Join-Path $outputDir "CadGpt.AutoCad.dll"

if (-not (Test-Path $dll)) {
    Write-Error "Expected output was not produced: $dll"
    exit 3
}

$stageRoot = Join-Path $repoRoot "addins\cadgpt-autocad\bin\stage0-bundle\CadGPT.Stage0.bundle"
$stageContents = Join-Path $stageRoot "Contents\Windows"

if (Test-Path $stageRoot) {
    Remove-Item $stageRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stageContents | Out-Null
Copy-Item (Join-Path $outputDir "*") $stageContents -Recurse -Force

foreach ($name in @("AcCoreMgd.dll","AcDbMgd.dll","AcMgd.dll")) {
    Get-ChildItem $stageContents -Recurse -Filter $name -ErrorAction SilentlyContinue |
        Remove-Item -Force
}

$templatePath = Join-Path $repoRoot "addins\cadgpt-autocad\bundle\PackageContents.xml"
$manifest = (Get-Content $templatePath -Raw).Replace("__AUTOCAD_SERIES__", $series)
$manifest | Set-Content -Encoding UTF8 (Join-Path $stageRoot "PackageContents.xml")

$copiedApi = @(
    Get-ChildItem $stageContents -Recurse -File |
        Where-Object { $_.Name -in @("AcCoreMgd.dll","AcDbMgd.dll","AcMgd.dll") }
)

if ($copiedApi.Count -gt 0) {
    Write-Error "AutoCAD managed API DLLs must not be redistributed in the bundle."
    exit 3
}

Write-Host ""
Write-Host "CadGPT Stage 0 add-in build succeeded."
Write-Host "Target framework : $tfm"
Write-Host "AutoCAD series   : $series"
Write-Host "Bundle           : $stageRoot"
Write-Host "DLL              : $dll"
Write-Host "Host record      : $hostMarkdown"
