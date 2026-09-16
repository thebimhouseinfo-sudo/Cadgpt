param(
    [switch]$SkipStart,
    [switch]$SkipCadSmoke
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

function Get-DotEnvValue([string]$Name) {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object {
        $_ -match "^\s*$Name\s*=" -and -not $_.TrimStart().StartsWith("#")
    } | Select-Object -First 1
    if (-not $line) { return $null }
    return (($line -split "=", 2)[1].Trim()).Trim("'").Trim('"')
}

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Fail([string]$Message, [int]$Code = 1) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    exit $Code
}

function Pass([string]$Message) {
    Write-Host "[OK]   $Message" -ForegroundColor Green
}

function Warn([string]$Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CadGPT Local Acceptance" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "This gate validates the BAT-first runtime on a real Windows/AutoCAD host."
Write-Host "It never mutates an existing project drawing automatically."

if (-not (Test-Path ".env")) {
    Fail ".env is missing. Run setup.bat first."
}

$portValue = Get-DotEnvValue "PORT"
$port = if ($portValue) { [int]$portValue } else { 3000 }
$mcpToken = Get-DotEnvValue "MCP_TOKEN"
$mcpPath = if ($mcpToken) { "/mcp/$mcpToken" } else { "/mcp" }
$mcpUrl = "http://127.0.0.1:$port$mcpPath"

if (-not $SkipStart) {
    Write-Step "Start stack through run.bat"
    $oldNoPause = $env:CADGPT_NO_PAUSE
    $env:CADGPT_NO_PAUSE = "1"
    try {
        & cmd.exe /d /c "call run.bat"
        if ($LASTEXITCODE -ne 0) {
            Fail "run.bat failed. Run doctor.bat for diagnostics."
        }
        Pass "run.bat startup contract passed"
    }
    finally {
        if ($null -eq $oldNoPause) { Remove-Item Env:CADGPT_NO_PAUSE -ErrorAction SilentlyContinue }
        else { $env:CADGPT_NO_PAUSE = $oldNoPause }
    }
}

Write-Step "Doctor"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\doctor.ps1"
if ($LASTEXITCODE -ne 0) {
    Fail "doctor.ps1 reported a blocking failure."
}
Pass "Doctor passed"

Write-Step "MCP session"
$headers = @{ Accept = "application/json, text/event-stream" }
$initBody = @{
    jsonrpc = "2.0"
    id = 1
    method = "initialize"
    params = @{
        protocolVersion = "2025-06-18"
        capabilities = @{}
        clientInfo = @{ name = "cadgpt-local-acceptance"; version = "1.0" }
    }
} | ConvertTo-Json -Depth 10

try {
    $initResp = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $headers -ContentType "application/json" -Body $initBody -TimeoutSec 10
} catch {
    Fail "Could not initialize CadGPT MCP session at $mcpUrl : $($_.Exception.Message)"
}
if ($initResp.StatusCode -ne 200) { Fail "MCP initialize returned HTTP $($initResp.StatusCode)" }
$sessionId = $initResp.Headers["Mcp-Session-Id"]
if (-not $sessionId) { Fail "MCP initialize returned no session id" }

$mcpHeaders = @{
    Accept = "application/json, text/event-stream"
    "Mcp-Session-Id" = $sessionId
    "Mcp-Protocol-Version" = "2025-06-18"
}
$initializedBody = @{ jsonrpc = "2.0"; method = "notifications/initialized" } | ConvertTo-Json
$null = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $mcpHeaders -ContentType "application/json" -Body $initializedBody -TimeoutSec 10

$script:RpcId = 10
function Invoke-Mcp([string]$Method, $Params) {
    $script:RpcId += 1
    $body = @{ jsonrpc = "2.0"; id = $script:RpcId; method = $Method; params = $Params } | ConvertTo-Json -Depth 20
    $resp = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $mcpHeaders -ContentType "application/json" -Body $body -TimeoutSec 30
    if ($resp.StatusCode -ne 200) { throw "MCP call failed: $Method (HTTP $($resp.StatusCode))" }
    return ($resp.Content | ConvertFrom-Json)
}

$toolsJson = Invoke-Mcp "tools/list" @{}
$toolNames = @($toolsJson.result.tools | ForEach-Object { $_.name })
$requiredTools = @(
    "cad_status",
    "drawing_list",
    "drawing_bind",
    "drawing_status",
    "drawing_create_test",
    "lisp_scaffold",
    "lisp_validate",
    "skill_list",
    "skill_get",
    "cad__cad_load_lisp_file",
    "cad__cad_run_lisp_command"
)
foreach ($name in $requiredTools) {
    if ($toolNames -notcontains $name) { Fail "Required MCP tool is missing: $name" }
}
Pass "Required MCP surface present ($($requiredTools.Count) acceptance tools checked)"

function Invoke-Tool([string]$Name, $Arguments = @{}) {
    $response = Invoke-Mcp "tools/call" @{ name = $Name; arguments = $Arguments }
    return $response.result
}

Write-Step "AutoCAD host discovery"
$cadStatus = Invoke-Tool "cad_status"
$drawingsResult = Invoke-Tool "drawing_list"
if ($drawingsResult.isError -eq $true -or $drawingsResult.structuredContent.ok -eq $false) {
    $message = $drawingsResult.structuredContent.summary
    Fail "AutoCAD host/drawing discovery failed: $message. Start AutoCAD and open at least one drawing, then run acceptance.bat again."
}
$drawings = @($drawingsResult.structuredContent.data.drawings)
if ($drawings.Count -lt 1) {
    Fail "AutoCAD is reachable but no drawing is open. Open a drawing and run acceptance.bat again."
}
Pass "AutoCAD reachable; open drawings: $($drawings.Count)"
foreach ($dwg in $drawings) {
    $id = if ($dwg.full_name) { $dwg.full_name } else { $dwg.name }
    Write-Host "       - $id"
}

if ($SkipCadSmoke) {
    Warn "Safe blank-drawing smoke was skipped. Core connectivity passed, but pre-EXE local acceptance is INCOMPLETE."
    exit 2
}

Write-Step "Safe blank-drawing acceptance"
Write-Host "CadGPT will create a NEW UNSAVED blank drawing for this test."
Write-Host "No existing/project drawing will be used or modified."
$answer = Read-Host "Create the blank test drawing and verify AutoLISP loading now? [Y/n]"
if ($answer -and $answer.Trim().ToLowerInvariant() -notin @("y", "yes")) {
    Warn "User declined the safe CAD smoke. Pre-EXE local acceptance is INCOMPLETE."
    exit 2
}

$createResult = Invoke-Tool "drawing_create_test"
if ($createResult.isError -eq $true -or $createResult.structuredContent.ok -eq $false) {
    $message = $createResult.structuredContent.summary
    Warn "CadGPT could not create a new drawing automatically: $message"
    Write-Host "Open a blank/test drawing manually in AutoCAD, then rerun acceptance.bat."
    Write-Host "The write-lisp skill has the same fallback: it asks the user to open a test drawing manually instead of using a project DWG."
    exit 3
}
Pass "New blank test drawing created and bound"

$statusResult = Invoke-Tool "drawing_status"
if ($statusResult.isError -eq $true -or $statusResult.structuredContent.data.bound -ne $true -or $statusResult.structuredContent.data.available -ne $true) {
    Fail "New test drawing was created but CadGPT binding did not become available."
}
$boundDrawing = $statusResult.structuredContent.data.drawing
$boundId = if ($boundDrawing.full_name) { $boundDrawing.full_name } else { $boundDrawing.name }
Pass "Bound test drawing confirmed: $boundId"

Write-Step "Verified AutoLISP load"
$fixture = "lisp/_cadgpt-system/CADGPT_LOAD_SMOKE.lsp"
$loadResult = Invoke-Tool "cad__cad_load_lisp_file" @{ path = $fixture }
$loadJson = $loadResult | ConvertTo-Json -Depth 20 -Compress
if ($loadJson -notmatch '"loaded"\s*:\s*true') {
    Write-Host $loadJson
    Fail "Verified AutoLISP load did not return loaded=true. Review returned load error/log evidence."
}
Pass "Verified AutoLISP load passed: $fixture"

$runResult = Invoke-Tool "cad__cad_run_lisp_command" @{ name = "CADGPT_LOAD_SMOKE"; args = @() }
if ($runResult.isError -eq $true) {
    Fail "Safe no-op AutoLISP command dispatch failed."
}
Pass "Safe AutoLISP command dispatch accepted"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CadGPT LOCAL ACCEPTANCE PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Validated: setup/runtime prerequisites, run.bat startup, doctor, tunnel, MCP session,"
Write-Host "AutoCAD discovery, blank test-drawing creation/binding, verified AutoLISP load, and command dispatch."
Write-Host ""
Write-Host "A blank UNSAVED test drawing was intentionally left open in AutoCAD."
Write-Host "Close it manually without saving when finished."
exit 0
