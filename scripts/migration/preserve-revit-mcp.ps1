param(
    [string]$SourceRepo = "..\CAD-Agent",
    [string]$Destination = "preserved\revit-mcp\source",
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

function Test-GeneratedArtifact([string]$RelativePath) {
    $normalized = $RelativePath.Replace('/', '\')
    $segments = $normalized.Split('\')
    $generatedDirs = @('__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.vs', 'bin', 'obj', 'logs', 'node_modules')
    foreach ($segment in $segments) {
        if ($generatedDirs -contains $segment) { return $true }
    }
    $extension = [System.IO.Path]::GetExtension($normalized).ToLowerInvariant()
    if ($extension -in @('.pyc', '.pyo', '.log', '.tmp', '.pdb')) { return $true }
    return $false
}

$sourceRepoFull = Normalize-Path (Join-Path $RepoRoot $SourceRepo)
$sourceRoot = Join-Path $sourceRepoFull "runtimes\Revit-mcp"
$destRoot = Normalize-Path (Join-Path $RepoRoot $Destination)
$preservedRoot = Split-Path -Parent $destRoot

Write-Host ""
Write-Host "=== Revit MCP preservation ===" -ForegroundColor Cyan
Write-Host "Source      : $sourceRoot"
Write-Host "Destination : $destRoot"
Write-Host "Mode        : $(if ($DryRun) { 'DRY RUN' } else { 'COPY + VERIFY' })"
Write-Host ""

if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Source Revit-mcp folder not found: $sourceRoot`nClone CAD-Agent next to Cadgpt or pass -SourceRepo <path>."
}

$sourceCommit = "unknown"
try {
    $sourceCommit = (& git -C $sourceRepoFull rev-parse HEAD 2>$null).Trim()
    if (-not $sourceCommit) { $sourceCommit = "unknown" }
} catch {
    $sourceCommit = "unknown"
}

$allSourceFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File | Sort-Object FullName)
$sourceFiles = @($allSourceFiles | Where-Object {
    $relative = Get-RelativePath $sourceRoot $_.FullName
    -not (Test-GeneratedArtifact $relative)
})
$excludedCount = $allSourceFiles.Count - $sourceFiles.Count

if ($sourceFiles.Count -eq 0) {
    throw "Source Revit-mcp contains no preservable source files."
}

Write-Host "Preserved files : $($sourceFiles.Count)"
Write-Host "Excluded generated artifacts: $excludedCount"
Write-Host "Source commit   : $sourceCommit"

if ($DryRun) {
    foreach ($file in $sourceFiles) {
        $relative = Get-RelativePath $sourceRoot $file.FullName
        Write-Host "PRESERVE $relative"
    }
    Write-Host ""
    Write-Host "Dry run complete. No files were changed." -ForegroundColor Yellow
    exit 0
}

New-Item -ItemType Directory -Force -Path $destRoot | Out-Null

$sourceRelativeSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceRoot $file.FullName
    $null = $sourceRelativeSet.Add($relative)
}

# Remove only stale files inside the dedicated preserved source mirror.
# Never recursively delete the preservation root or any source repository path.
$staleRemoved = 0
$existingDestFiles = @(Get-ChildItem -LiteralPath $destRoot -Recurse -File -ErrorAction SilentlyContinue)
foreach ($file in $existingDestFiles) {
    $relative = Get-RelativePath $destRoot $file.FullName
    if (-not $sourceRelativeSet.Contains($relative)) {
        Remove-Item -LiteralPath $file.FullName -Force
        $staleRemoved++
    }
}

$copied = 0
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceRoot $file.FullName
    $target = Join-Path $destRoot $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    $copied++
}

$errors = New-Object System.Collections.Generic.List[string]
foreach ($file in $sourceFiles) {
    $relative = Get-RelativePath $sourceRoot $file.FullName
    $target = Join-Path $destRoot $relative
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
        $errors.Add("Missing target: $relative")
        continue
    }
    if ((Get-FileSha256 $file.FullName) -ne (Get-FileSha256 $target)) {
        $errors.Add("Hash mismatch: $relative")
    }
}

$destFiles = @(Get-ChildItem -LiteralPath $destRoot -Recurse -File)
if ($destFiles.Count -ne $sourceFiles.Count) {
    $errors.Add("Destination file count $($destFiles.Count) does not match preserved source count $($sourceFiles.Count)")
}

New-Item -ItemType Directory -Force -Path $preservedRoot | Out-Null
$provenancePath = Join-Path $preservedRoot "MIGRATION_PROVENANCE.md"
$timestamp = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
$provenance = @"
# Revit MCP Preservation Provenance

- Source repository: `thebimhouseinfo-sudo/CAD-Agent`
- Source local path: `$sourceRepoFull`
- Source commit: `$sourceCommit`
- Original source folder: `runtimes/Revit-mcp/`
- Preserved source folder: `preserved/revit-mcp/source/`
- Preservation time: `$timestamp`
- Preserved source file count: $($sourceFiles.Count)
- Excluded generated artifact count: $excludedCount
- Stale preserved files removed: $staleRemoved

Policy: source is preserved for future RevitGPT work and is inactive in CadGPT. Generated caches/build outputs are intentionally excluded. CadGPT active runtime must not import or execute files from `preserved/revit-mcp/**`.
"@
Set-Content -LiteralPath $provenancePath -Value $provenance -Encoding UTF8

if ($errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Verification failures:" -ForegroundColor Red
    $errors | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "Revit MCP preservation verification failed."
}

Write-Host ""
Write-Host "[OK] Preserved and SHA256-verified $copied Revit MCP source files." -ForegroundColor Green
Write-Host "[OK] Removed $staleRemoved stale files from the dedicated preserved source mirror." -ForegroundColor Green
Write-Host "[OK] Provenance written to $provenancePath" -ForegroundColor Green
Write-Host ""
Write-Host "Next: review git status and commit preserved/revit-mcp/ as inactive source material." -ForegroundColor Cyan
