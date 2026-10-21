# CadGPT V5 — Human Live AutoCAD Acceptance Gate

**Gate status:** Prepared, **NOT YET PASSED**. This is an actual native AutoCAD acceptance test, not a required Job TEST/promotion stage. V5 code lives only on `feature/core-function-v5`; remote `main` remains unchanged. Source CI Windows/Linux results are necessary developer evidence but never substitute for real bound DWG proof.

## Safety boundary — before any runtime switch

- Use a **copy** of an AutoCAD DWG, never the only production original. Save and close AutoCAD before any optional add-in action.
- V5 must use `%LOCALAPPDATA%\CadGPT-V5-Acceptance` as separate AppData; verify the effective root via `file_roots` before mutating anything. Do not access production Job results for test writes.
- Do not run two CadGPT runtimes using the same CAD MCP ports, tray mutex or tunnel. Stop the normal main runtime first. Do **not** modify Windows autostart registration, add-in DLL, scheduled startup tasks or live production DWG.
- Use an isolated V5 worktree pointing at **exactly** `origin/feature/core-function-v5`; no subbranch, no merge/rebase of main. Preserve original `.env` only as local config; never commit it.
- If Python runtime or tunnel fails to start, STOP/REPORT the real error, do not bypass drawing security or invent a fallback URL.

## Prepare the test-only worktree (PowerShell; human-run)

```powershell
$ErrorActionPreference = "Stop"
$main = "D:\00 Other Works\Vibecode\Cadgpt"
$v5 = "D:\00 Other Works\Vibecode\Cadgpt-V5-Acceptance"

git -C $main fetch origin feature/core-function-v5
if ($LASTEXITCODE -ne 0) { throw "V5 fetch failed" }
if (Test-Path $v5) {
  if (-not (Test-Path "$v5\.git")) { throw "V5 target exists but is not a worktree" }
  if (git -C $v5 status --porcelain) { throw "V5 worktree has local changes" }
  git -C $v5 switch --detach origin/feature/core-function-v5
} else {
  git -C $main worktree add --detach $v5 origin/feature/core-function-v5
}
if ($LASTEXITCODE -ne 0) { throw "V5 worktree checkout failed" }
Copy-Item "$main\.env" "$v5\.env" -Force
Set-Location $v5
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "V5 build failed" }
npm test
if ($LASTEXITCODE -ne 0) { throw "V5 source regressions failed" }

if (-not (Test-Path ".venv-cad\Scripts\python.exe")) {
  py -3 -m venv .venv-cad
  if ($LASTEXITCODE -ne 0) { throw "Python venv creation failed" }
  & ".\.venv-cad\Scripts\python.exe" -m pip install -r "runtimes\cad-mcp\requirements.lock.txt"
  if ($LASTEXITCODE -ne 0) { throw "Python CAD MCP requirements failed" }
}

git status -sb
git rev-parse --short HEAD
```

Do not proceed with native DWG mutations if any preparatory step fails. If V5 `.env` contains an explicit `CADGPT_APPDATA_ROOT`, override or remove that entry in the *test copy only*, then verify the effective root before mutation.

## Temporary switch — only after preflight succeeds

In one PowerShell session, stop the existing runtime from the main installation. Set the V5 test AppData override before launching the V5 tray, then verify it is reflected by the V5 FILE tools.

```powershell
$ErrorActionPreference = "Stop"
$main = "D:\00 Other Works\Vibecode\Cadgpt"
$v5 = "D:\00 Other Works\Vibecode\Cadgpt-V5-Acceptance"

& "$main\run.bat" stop
if ($LASTEXITCODE -ne 0) { throw "Main runtime stop failed" }

$env:CADGPT_APPDATA_ROOT = Join-Path $env:LOCALAPPDATA "CadGPT-V5-Acceptance"
& "$v5\run.bat" start
if ($LASTEXITCODE -ne 0) { throw "V5 runtime did not start" }
& "$v5\run.bat" status
```

**Hard safety observation (not a Job workflow gate):** before tests, `file_roots` must report the V5 test-only AppData root, and `cg/status` must confirm the intended bound copied DWG. If it shows production AppData or the wrong DWG, do not mutate anything.

The existing AutoCAD add-in DLL should work for these Node/knowledge changes; do not run `cadaddin.bat` unless a genuinely changed add-in DLL is separately proven necessary.

## Real CAD acceptance matrix (human observes, assistant may execute approved steps)

| ID | Real use case | Exact acceptance observation |
|---|---|---|
| H01 | Start V5 + bind a copied DWG | V5 tool root isolated; correct host/drawing identity, bound drawing read succeeds |
| H02 | Builder creates new reusable `JOB.md` in its *final owned* folder; RUN via `source_path` | No `job_draft_new`, checkout or promotion prerequisite; real step outcomes visible |
| H03 | Builder edits that Job source with expected SHA, reruns affected safe step | Source changed once and is read fresh, no stale old JOB.md or hidden retry |
| H04 | User explicitly publishes reusable Job or Lisp | Registry entry only on publication request; later in-place updates refresh existing registry |
| H05 | Temp Job with UUID scratch + selected Lisp LOAD, actual command or verified autorun | Lisp source belongs to Temp; `loaded=true` and real AutoCAD operation distinguishable |
| H06 | Temp result with human-chosen folder name | Persisted under verified Drawing Anchor; no UUID-named result; `cg/cleartempjob` does not delete result |
| H07 | Temp file-only Python helper with JSON input | SHA-verified owned source executes; never used to bypass CAD host |
| H08 | A registered Reasoning Job and second independent Job/Builder execution | No unnecessary cross-Job `JOB_RUNTIME_BUSY`; scratch and JOB_STEPS isolated, no cross-owner WRITE |
| H09 | Borrow registered Lisp capability from Job A in another authorized Work | Runs under caller execution/drawing; no source/result ownership transfer |
| H10 | Job mutates copied DWG, invokes `job_runtime_save_now` after last mutation | Verified bound Save; finish does not Save twice if no further CAD call |
| H11 | Read-only/FILE-only Job | `dwg_changed=false` ends without Save; a recorded possible CAD mutation prevents false read-only DONE |
| H12 | Failure after uncertain CAD action or Save failure | STOP/REPORT real error, preserve results/runtime, no silent replay or false DONE |
| H13 | Cleanup completed/inactive Temp source (including crashed owner) | Active Temp preserved; eligible scratch removed; named results/registered Lisp retained |
| H14 | Restart/reconnect/reopen copied DWG | Verified Anchor continuity; no wrong-document Save; expected owned results remain |

Run only safe, user-approved actions on the copied drawing. A source lint/CI result is not a PASS for these native cases. Not all cases need to be run in one conversation; record actual tool outcomes and exact failures without inventing missing proof.

## Rollback after the human session

```powershell
$ErrorActionPreference = "Stop"
$main = "D:\00 Other Works\Vibecode\Cadgpt"
$v5 = "D:\00 Other Works\Vibecode\Cadgpt-V5-Acceptance"

& "$v5\run.bat" stop
if ($LASTEXITCODE -ne 0) { throw "V5 stop failed — inspect processes before main restart" }
Remove-Item Env:\CADGPT_APPDATA_ROOT -ErrorAction SilentlyContinue
& "$main\run.bat" start
if ($LASTEXITCODE -ne 0) { throw "Main restart failed" }
& "$main\run.bat" status
```

The test-specific AppData and V5 worktree are deliberately retained for inspection after failure. They are **not** automatically deleted. No V5→main promotion/merge happens at this gate.

## Decision rule

- Mark `HUMAN_ACCEPTANCE_PASS` only if applicable real CAD cases have actual verified outcomes, correct bound-DWG Save and no owner/registry/data loss.
- Otherwise mark `CHANGES_REQUIRED` with exact failed test case and observed error, fix only on `feature/core-function-v5`, rerun CI, then repeat the affected native case.
- Even after human acceptance, replacement of remote main needs a **separate explicit human approval**, safety backup/tag and reviewed maintenance delta handling.
