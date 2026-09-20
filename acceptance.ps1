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

function Step([string]$Message) { Write-Host ""; Write-Host "=== $Message ===" -ForegroundColor Cyan }
function Fail([string]$Message, [int]$Code = 1) { Write-Host "[FAIL] $Message" -ForegroundColor Red; exit $Code }
function Pass([string]$Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Warn([string]$Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CadGPT Local Acceptance" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "This gate validates admission, lazy runtime, explicit work authority and a safe blank AutoCAD drawing."

if (-not (Test-Path ".env")) { Fail ".env is missing. Run setup.bat first." }
if (-not (Test-Path "resources\cad\CADGPT_LOAD_SMOKE.lsp")) { Fail "Internal CadGPT AutoLISP smoke resource is missing." }

$portValue = Get-DotEnvValue "PORT"
$port = if ($portValue) { [int]$portValue } else { 3000 }
$mcpToken = Get-DotEnvValue "MCP_TOKEN"
$mcpPath = if ($mcpToken) { "/mcp/$mcpToken" } else { "/mcp" }
$mcpUrl = "http://127.0.0.1:$port$mcpPath"

if (-not $SkipStart) {
    Step "Start tray runtime through run.bat"
    & cmd.exe /d /c "call run.bat start"
    if ($LASTEXITCODE -ne 0) { Fail "run.bat start failed. Run doctor.bat for diagnostics." }
    Pass "Tray/runtime start contract passed"
}

Step "Doctor"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$ScriptDir\doctor.ps1"
if ($LASTEXITCODE -ne 0) { Fail "doctor.ps1 reported a blocking failure." }
Pass "Doctor passed"

Step "MCP session"
$headers = @{ Accept = "application/json, text/event-stream" }
$initBody = @{
    jsonrpc = "2.0"; id = 1; method = "initialize";
    params = @{ protocolVersion = "2025-06-18"; capabilities = @{}; clientInfo = @{ name = "cadgpt-local-acceptance"; version = "2.0" } }
} | ConvertTo-Json -Depth 10
try {
    $initResp = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $headers -ContentType "application/json" -Body $initBody -TimeoutSec 10
} catch { Fail "Could not initialize CadGPT MCP at $mcpUrl : $($_.Exception.Message)" }
$sessionId = @($initResp.Headers["Mcp-Session-Id"])[0]
if (-not $sessionId) { Fail "MCP initialize returned no session id" }
$mcpHeaders = @{ Accept="application/json, text/event-stream"; "Mcp-Session-Id"=$sessionId; "Mcp-Protocol-Version"="2025-06-18" }
$null = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $mcpHeaders -ContentType "application/json" -Body (@{ jsonrpc="2.0"; method="notifications/initialized" } | ConvertTo-Json) -TimeoutSec 10

$script:RpcId = 10
function Invoke-Mcp([string]$Method, $Params) {
    $script:RpcId += 1
    $body = @{ jsonrpc="2.0"; id=$script:RpcId; method=$Method; params=$Params } | ConvertTo-Json -Depth 40
    $resp = Invoke-WebRequest -Uri $mcpUrl -Method Post -Headers $mcpHeaders -ContentType "application/json" -Body $body -TimeoutSec 60
    return ($resp.Content | ConvertFrom-Json)
}
function Invoke-Tool([string]$Name, $Arguments = @{}) {
    return (Invoke-Mcp "tools/call" @{ name=$Name; arguments=$Arguments }).result
}
function Merge-Args($Base, $Extra) {
    $merged = @{}
    foreach ($k in $Base.Keys) { $merged[$k] = $Base[$k] }
    if ($Extra) { foreach ($k in $Extra.Keys) { $merged[$k] = $Extra[$k] } }
    return $merged
}

$toolsJson = Invoke-Mcp "tools/list" @{}
$initialToolNames = @($toolsJson.result.tools | ForEach-Object { $_.name })
foreach ($required in @("cadgpt_admission","cadgpt_work_start","cadgpt_work_status","cadgpt_work_stop")) {
    if ($initialToolNames -notcontains $required) { Fail "Required slim control tool is missing: $required" }
}
if ($initialToolNames -contains "drawing_list") { Fail "CAD tools were exposed before valid admission/work start." }
Pass "Slim pre-admission surface is present; CAD family remains unloaded"

Step "Hard admission gate"
$inactive = Invoke-Tool "cadgpt_admission" @{ user_turn = "Please inspect this drawing" }
if ($inactive.structuredContent.data.mode -ne "inactive") {
    Fail "CadGPT admitted a user turn without literal @cadgpt."
}
Pass "Uninvoked CadGPT request is rejected"

$admission = Invoke-Tool "cadgpt_admission" @{ user_turn = "@cadgpt run the local acceptance test" }
if ($admission.isError -eq $true -or $admission.structuredContent.data.mode -ne "active") {
    Fail "Explicit @cadgpt admission did not become ACTIVE."
}
$admissionToken = [string]$admission.structuredContent.data.admission_token
if (-not $admissionToken) { Fail "ACTIVE admission returned no admission_token." }
Pass "Explicit @cadgpt admission returned an authority token"

Step "CAD work registration"
$work = Invoke-Tool "cadgpt_work_start" @{
    admission_token = $admissionToken
    owner_type = "direct-cad"
    owner_id = "local-acceptance"
    execution_path = "cad"
}
if ($work.isError -eq $true -or -not $work.structuredContent.data.work_handle.execution_id) {
    Fail "cadgpt_work_start did not return a work handle."
}
$executionId = [string]$work.structuredContent.data.work_handle.execution_id
$authorityToken = [string]$work.structuredContent.data.work_handle.authority_token
$workAuth = @{
    admission_token = $admissionToken
    execution_id = $executionId
    authority_token = $authorityToken
}
function Invoke-WorkTool([string]$Name, $Arguments = @{}) {
    return Invoke-Tool $Name (Merge-Args $workAuth $Arguments)
}

$toolsJson = Invoke-Mcp "tools/list" @{}
$toolNames = @($toolsJson.result.tools | ForEach-Object { $_.name })
foreach ($required in @(
    "cad_status", "drawing_list", "drawing_bind", "drawing_status", "drawing_create_test",
    "cad__cad_load_lisp_file", "cad__cad_run_lisp_command"
)) {
    if ($toolNames -notcontains $required) { Fail "Required CAD work tool is missing after CAD work start: $required" }
}
Pass "CAD family loaded only after admitted CAD work registration"

Step "AutoCAD host discovery"
$drawingsResult = Invoke-WorkTool "drawing_list"
if ($drawingsResult.isError -eq $true -or $drawingsResult.structuredContent.ok -eq $false) {
    Fail "AutoCAD host/drawing discovery failed. Start AutoCAD and open a drawing, then rerun acceptance.bat."
}
$drawings = @($drawingsResult.structuredContent.data.drawings)
if ($drawings.Count -lt 1) { Fail "AutoCAD is reachable but no drawing is open." }
Pass "AutoCAD reachable; open drawings: $($drawings.Count)"

if ($SkipCadSmoke) {
    Warn "Blank-drawing smoke skipped. Admission/lazy/runtime connectivity passed, but local acceptance is INCOMPLETE."
    exit 2
}

Step "Safe blank-drawing acceptance"
Write-Host "CadGPT will create a NEW UNSAVED blank drawing. No existing/project drawing will be used."
$answer = Read-Host "Create the blank test drawing and verify AutoLISP loading now? [Y/n]"
if ($answer -and $answer.Trim().ToLowerInvariant() -notin @("y", "yes")) {
    Warn "User declined CAD smoke. Local acceptance is INCOMPLETE."
    exit 2
}

$createResult = Invoke-WorkTool "drawing_create_test"
if ($createResult.isError -eq $true -or $createResult.structuredContent.ok -eq $false) {
    Warn "CadGPT could not create a blank test drawing automatically. Open one manually and rerun acceptance.bat."
    exit 3
}
$drawingId = [string]$createResult.structuredContent.data.drawing.drawing_id
if (-not $drawingId) { Fail "Blank test drawing returned no drawing_id." }

$statusResult = Invoke-WorkTool "drawing_status" @{ drawing_id = $drawingId }
if ($statusResult.isError -eq $true -or $statusResult.structuredContent.data.bound -ne $true -or $statusResult.structuredContent.data.available -ne $true) {
    Fail "Blank test drawing was created but execution-scoped binding is unavailable."
}
Pass "New blank test drawing created and bound as $drawingId"

Step "Verified AutoLISP load"
$fixture = (Resolve-Path "resources\cad\CADGPT_LOAD_SMOKE.lsp").Path
$loadResult = Invoke-WorkTool "cad__cad_load_lisp_file" @{ drawing_id=$drawingId; path=$fixture }
$loadJson = $loadResult | ConvertTo-Json -Depth 20 -Compress
if ($loadJson -notmatch '"loaded"\s*:\s*true') {
    Write-Host $loadJson
    Fail "Verified AutoLISP load did not return loaded=true."
}
Pass "Verified AutoLISP load passed"

$runResult = Invoke-WorkTool "cad__cad_run_lisp_command" @{ drawing_id=$drawingId; name="CADGPT_LOAD_SMOKE"; args=@() }
if ($runResult.isError -eq $true) { Fail "Safe no-op AutoLISP command dispatch failed." }
Pass "Safe AutoLISP command dispatch accepted"

$stop = Invoke-Tool "cadgpt_work_stop" @{ execution_id=$executionId; authority_token=$authorityToken }
if ($stop.isError -eq $true) { Warn "Work stop returned an error; runtime idle cleanup remains fallback." }

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  CadGPT LOCAL ACCEPTANCE PASSED" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "A blank UNSAVED test drawing was intentionally left open. Close it manually without saving when finished."
exit 0
