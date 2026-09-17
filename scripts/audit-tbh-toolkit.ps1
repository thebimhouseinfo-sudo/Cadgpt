param(
    [string]$SourceRepo = "..\CAD-Agent",
    [switch]$SkipImport,
    [switch]$NoNormalizeHeaders
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $RepoRoot

if (-not $SkipImport) {
    & (Join-Path $RepoRoot "scripts\migration\migrate-tbh-toolkit.ps1") -SourceRepo $SourceRepo
    if ($LASTEXITCODE -ne 0) { throw "TBH Toolkit import failed." }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) { throw "Python is required to run the TBH Toolkit audit." }

$argsList = @(
    (Join-Path $RepoRoot "scripts\audit-tbh-toolkit.py"),
    "--library-root", (Join-Path $RepoRoot "appdata\libraries\lisp\tbh-toolkit"),
    "--registry", (Join-Path $RepoRoot "appdata\registry\user\capabilities.json")
)
if ($NoNormalizeHeaders) { $argsList += "--no-normalize-headers" }

& $python.Source @argsList
if ($LASTEXITCODE -ne 0) { throw "TBH Toolkit audit failed." }

Write-Host "[OK] Full TBH Toolkit import/audit finished." -ForegroundColor Green
Write-Host "[OK] Function bodies were not intentionally modified; review AUDIT_NOTES.md for static issues." -ForegroundColor Green
