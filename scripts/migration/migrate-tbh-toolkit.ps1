param(
    [string]$SourceRepo = "..\CAD-Agent",
    [string]$Destination = "appdata\libraries\lisp\tbh-toolkit",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $RepoRoot

function Normalize-Path([string]$Path) { return [System.IO.Path]::GetFullPath($Path) }
function Get-RelativePath([string]$Base, [string]$Path) {
    $baseUri = New-Object System.Uri((Normalize-Path $Base).TrimEnd('\') + '\')
    $pathUri = New-Object System.Uri((Normalize-Path $Path))
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}
function Get-FileSha256([string]$Path) { return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

$sourceRepoFull = Normalize-Path (Join-Path $RepoRoot $SourceRepo)
$sourceToolkit = Join-Path $sourceRepoFull "tool-kit"
$destRoot = Normalize-Path (Join-Path $RepoRoot $Destination)
$provenanceName = "MIGRATION_PROVENANCE.md"
$provenancePath = Join-Path $destRoot $provenanceName

Write-Host ""
Write-Host "=== TBH Toolkit beta managed-library migration ===" -ForegroundColor Cyan
Write-Host "Source      : $sourceToolkit"
Write-Host "Destination : $destRoot"
Write-Host "Mode        : $(if ($DryRun) { 'DRY RUN' } else { 'EXACT MIRROR + VERIFY' })"
Write-Host ""

if (-not (Test-Path -LiteralPath $sourceToolkit -PathType Container)) {
    throw "Source tool-kit folder not found: $sourceToolkit`nClone CAD-Agent next to Cadgpt or pass -SourceRepo <path>."
}

$sourceCommit = "unknown"
try {
    $sourceCommit = (& git -C $sourceRepoFull rev-parse HEAD 2>$null).Trim()
    if (-not $sourceCommit) { $sourceCommit = "unknown" }
} catch { $sourceCommit = "unknown" }

$sourceFiles = @(Get-ChildItem -LiteralPath $sourceToolkit -Recurse -File | Sort-Object FullName)
if ($sourceFiles.Count -eq 0) { throw "Source tool-kit contains no files." }

$sourceRelativeSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceToolkit $file.FullName
    $null = $sourceRelativeSet.Add($relative)
}

Write-Host "Source files : $($sourceFiles.Count)"
Write-Host "Source commit: $sourceCommit"

if ($DryRun) {
    foreach ($file in $sourceFiles) {
        $relative = Get-RelativePath $sourceToolkit $file.FullName
        Write-Host "COPY $relative"
    }
    if (Test-Path -LiteralPath $destRoot -PathType Container) {
        foreach ($file in @(Get-ChildItem -LiteralPath $destRoot -Recurse -File)) {
            $relative = Get-RelativePath $destRoot $file.FullName
            if ($relative -ieq $provenanceName) { continue }
            if (-not $sourceRelativeSet.Contains($relative)) { Write-Host "REMOVE STALE $relative" }
        }
    }
    Write-Host "Dry run complete. No files were changed." -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

# Historical migration helper only. Product runtime uses library_import, whose
# external source folder is read-only and whose managed copy lives in AppData.
$staleRemoved = 0
foreach ($file in @(Get-ChildItem -LiteralPath $destRoot -Recurse -File -ErrorAction SilentlyContinue)) {
    $relative = Get-RelativePath $destRoot $file.FullName
    if ($relative -ieq $provenanceName) { continue }
    if (-not $sourceRelativeSet.Contains($relative)) {
        Remove-Item -LiteralPath $file.FullName -Force
        $staleRemoved++
    }
}

$copied = 0
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceToolkit $file.FullName
    $target = Join-Path $destRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    $copied++
}

$errors = New-Object System.Collections.Generic.List[string]
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceToolkit $file.FullName
    $target = Join-Path $destRoot $relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        $errors.Add("Missing target: $relative")
        continue
    }
    if ((Get-FileSha256 $file.FullName) -ne (Get-FileSha256 $target)) { $errors.Add("Hash mismatch: $relative") }
}

$destFiles = @(Get-ChildItem -LiteralPath $destRoot -Recurse -File | Where-Object {
    (Get-RelativePath $destRoot $_.FullName) -ine $provenanceName
})
if ($destFiles.Count -ne $sourceFiles.Count) {
    $errors.Add("Destination file count $($destFiles.Count) does not match source file count $($sourceFiles.Count)")
}

$timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
$provenance = @"
# TBH Toolkit Migration Provenance

- Source repository: `thebimhouseinfo-sudo/CAD-Agent`
- Source local path: `$sourceRepoFull`
- Source commit: `$sourceCommit`
- Original source folder: `tool-kit/`
- Target managed library: `appdata/libraries/lisp/tbh-toolkit/`
- Migration time: `$timestamp`
- Source file count: $($sourceFiles.Count)
- Copied file count: $copied
- Stale destination files removed: $staleRemoved

Migration policy: preserve source files and relative structure as-is. Do not normalize/refactor AutoLISP during import. `write-lisp` may normalize the working draft only after the user explicitly asks to edit a capability.
"@
Set-Content -LiteralPath $provenancePath -Value $provenance -Encoding UTF8

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "TBH Toolkit migration verification failed."
}

Write-Host "[OK] Exact-mirrored and SHA256-verified $copied TBH Toolkit files." -ForegroundColor Green
Write-Host "[OK] Removed $staleRemoved stale destination files." -ForegroundColor Green
Write-Host "[OK] Provenance written to $provenancePath" -ForegroundColor Green
