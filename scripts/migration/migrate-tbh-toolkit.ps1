param(
    [string]$SourceRepo = "..\CAD-Agent",
    [string]$Destination = "lisp\tbh-toolkit",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..\..")
Set-Location $RepoRoot

function Normalize-Path([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

function Get-RelativePath([string]$Base, [string]$Path) {
    $baseUri = New-Object System.Uri((Normalize-Path $Base).TrimEnd('\') + '\')
    $pathUri = New-Object System.Uri((Normalize-Path $Path))
    return [System.Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', '\')
}

function Get-FileSha256([string]$Path) {
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

$sourceRepoFull = Normalize-Path (Join-Path $RepoRoot $SourceRepo)
$sourceToolkit = Join-Path $sourceRepoFull "tool-kit"
$destRoot = Normalize-Path (Join-Path $RepoRoot $Destination)

Write-Host ""
Write-Host "=== TBH Toolkit migration ===" -ForegroundColor Cyan
Write-Host "Source      : $sourceToolkit"
Write-Host "Destination : $destRoot"
Write-Host "Mode        : $(if ($DryRun) { 'DRY RUN' } else { 'COPY + VERIFY' })"
Write-Host ""

if (-not (Test-Path -LiteralPath $sourceToolkit -PathType Container)) {
    throw "Source tool-kit folder not found: $sourceToolkit`nClone CAD-Agent next to Cadgpt or pass -SourceRepo <path>."
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceRepoFull ".git"))) {
    Write-Warning "Source path is not a Git working tree; provenance commit cannot be verified."
}

$sourceCommit = "unknown"
try {
    $sourceCommit = (& git -C $sourceRepoFull rev-parse HEAD 2>$null).Trim()
    if (-not $sourceCommit) { $sourceCommit = "unknown" }
} catch {
    $sourceCommit = "unknown"
}

$sourceFiles = @(Get-ChildItem -LiteralPath $sourceToolkit -Recurse -File | Sort-Object FullName)
if ($sourceFiles.Count -eq 0) {
    throw "Source tool-kit contains no files."
}

Write-Host "Source files : $($sourceFiles.Count)"
Write-Host "Source commit: $sourceCommit"

if ($DryRun) {
    foreach ($file in $sourceFiles) {
        $relative = Get-RelativePath $sourceToolkit $file.FullName
        Write-Host "COPY $relative"
    }
    Write-Host ""
    Write-Host "Dry run complete. No files were changed." -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

$copied = 0
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceToolkit $file.FullName
    $target = Join-Path $destRoot $relative
    $targetDir = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
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
    $srcHash = Get-FileSha256 $file.FullName
    $dstHash = Get-FileSha256 $target
    if ($srcHash -ne $dstHash) {
        $errors.Add("Hash mismatch: $relative")
    }
}

$destFiles = @(Get-ChildItem -LiteralPath $destRoot -Recurse -File | Where-Object {
    $_.Name -ne "MIGRATION_PROVENANCE.md"
})

$provenancePath = Join-Path $destRoot "MIGRATION_PROVENANCE.md"
$timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
$provenance = @"
# TBH Toolkit Migration Provenance

- Source repository: `thebimhouseinfo-sudo/CAD-Agent`
- Source local path: `$sourceRepoFull`
- Source commit: `$sourceCommit`
- Original source folder: `tool-kit/`
- Target folder: `lisp/tbh-toolkit/`
- Migration time: `$timestamp`
- Source file count: $($sourceFiles.Count)
- Copied file count: $copied

Migration policy: preserve source files and relative structure as-is. Do not normalize or refactor AutoLISP during migration. Future edits are governed by `skills/write-lisp/`.
"@
Set-Content -LiteralPath $provenancePath -Value $provenance -Encoding UTF8

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Verification failures:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "TBH Toolkit migration verification failed."
}

Write-Host ""
Write-Host "[OK] Copied and SHA256-verified $copied TBH Toolkit files." -ForegroundColor Green
Write-Host "[OK] Provenance written to $provenancePath" -ForegroundColor Green
Write-Host ""
Write-Host "Next: review `git status`, then commit the migrated asset pack without refactoring it." -ForegroundColor Cyan
