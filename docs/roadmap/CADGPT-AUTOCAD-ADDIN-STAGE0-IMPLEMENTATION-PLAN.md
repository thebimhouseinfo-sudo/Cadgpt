# CadGPT AutoCAD Add-in — Stage 0 Detailed Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement task-by-task after the human authorizes implementation. Checkboxes track implementation; this document does not authorize a later architecture Job.

**Status:** IMPLEMENTATION PLAN DRAFT FOR REVIEW; no add-in implemented or real-host result claimed
**Updated:** 2026-10-03
**Goal:** Automatically create ChatGPT conversation B and automatically invoke `@cg` inside AutoCAD, proving independent admission and resumability of A/B.
**Architecture:** A minimal WPF/WebView2 palette provides test-only UI navigation. CadGPT backend emits correlated outcome metadata; a local evidence collector evaluates it without assigning authority from UI state. Production session/work/binding behavior stays intact.
**Tech Stack:** Managed .NET AutoCAD API, WPF, WebView2, existing TypeScript/Node MCP runtime, Node test runner. Exact .NET/SDK/WebView2 versions are selected and recorded in Task 1 against the installed release/build.
**Spec:** [Stage 0 feasibility spec](CADGPT-AUTOCAD-ADDIN-STAGE0-PLAN.md)

## Global constraints

- Both creation of B and invocation/connect of `@cg` in B are automatic. Manual rescue invalidates the attempt.
- One supported AutoCAD process; browser CadGPT and existing Python/COM remain supported.
- No production conversation pairing, durable drawing binding, multi-drawing implementation, or capacity lending.
- No scraping cookies, authentication tokens, raw connector identity, chat content, or work handles.
- No admission bypass, continuation-handle injection, manual backend tool calls counted as UI success, or persistent logical-key redesign.
- Runtime restart means fresh admission, not retained work authority.
- Normal diagnostics remain fail-open. Missing evidence blocks the experiment verdict rather than normal CadGPT work.
- Use fixtures; preserve existing local TBH and diagnostics/test changes. Commits contain only the task's explicitly selected files.
- Existing GSA handle `J-3B81` is a reference; do not message/update GSA or launch a downstream Job from this plan.
- No shared profile with Edge/Chrome. No browser-profile deletion on hide/reload/reopen.

## Review focus

| Condition | Expected behavior | Owning task |
| --- | --- | --- |
| Wrong/unsupported AutoCAD build or missing WebView runtime | Stop prerequisite; report actual versions; AutoCAD remains usable | 1–2 |
| Palette hidden/recreated during async initialization | No duplicate controls, UI deadlock, or abandoned handlers | 2 |
| Another chat request, stale record, missing identity, or tool failure | Evidence rejected; no false admission success or PASS | 3–4 |
| Selector drift, timeout, challenge or manual rescue | Attempt classified; never silently downgrade automation | 5 |
| CadGPT restarts or loses persisted diagnostics key | Compare logical identity only within a runtime; fresh admission required | 4, 6 |

## File map and ownership

All paths below are planned relative to repository root. Files are created during implementation only.

| Area | Planned files | Responsibility |
| --- | --- | --- |
| Host evidence | `scripts/probe-autocad-addin-host.ps1`; `docs/roadmap/CADGPT-AUTOCAD-ADDIN-STAGE0-HOST.md` | Read-only discovery and sanitized host/build record |
| Add-in shell | `addins/cadgpt-autocad/CadGpt.AutoCad.csproj`; `EntryPoint.cs`; `Commands.cs`; `PaletteController.cs`; `ChatView.xaml`; `ChatView.xaml.cs`; `WebViewProfile.cs` | Assembly entry point, one palette, async UI lifecycle/profile |
| UI probe | `addins/cadgpt-autocad/Stage0/ChatNavigationAdapter.cs`; `ChatReference.cs`; `ExperimentController.cs`; `ExperimentModels.cs` | Test-only automatic UI flow and non-secret observations |
| Deployment | `addins/cadgpt-autocad/bundle/PackageContents.xml`; `scripts/build-autocad-addin.ps1`; `addins/cadgpt-autocad/README.md` | Exact-target build, bundle staging, developer load/runbook |
| Host-independent tests | `addins/cadgpt-autocad/Stage0/PaletteLifecycleState.cs`; `addins/cadgpt-autocad.tests/CadGpt.AutoCad.Tests.csproj`; `PaletteLifecycleTests.cs`; `ChatNavigationAdapterTests.cs`; `ExperimentControllerTests.cs` | State/adapter tests without launching AutoCAD |
| Backend evidence | `src/cadgpt/lib/continuity-request-context.ts`; edits in `src/index.ts`, `src/cadgpt/lib/continuity-diagnostics.ts`, `src/cadgpt/tools/admission.ts`, `src/cadgpt/server-factory.ts` | Request context and completion metadata only |
| Collector | `scripts/stage0-evidence.mjs`; `scripts/lib/stage0-evidence.mjs`; `tests/stage0-evidence.test.mjs`; `tests/stage0-admission-evidence.test.mjs` | Bounded step capture, conservative matching and report |
| Outcome | `docs/roadmap/CADGPT-AUTOCAD-ADDIN-STAGE0-RESULTS.md` | Sanitized actual environment/results/decision |

Keep the original `scripts/session-continuity-test.mjs` usable for its existing purpose. Do not silently change its old latest-request report into Stage 0 evidence.

## Shared contracts

### UI adapter

Use plain DTO classes compatible with the selected .NET target; do not require modern runtime features before Task 1 records support.

```csharp
Task<ChatReference> CaptureCurrentReferenceAsync(CancellationToken token);
Task<NavigationObservation> CreateNewConversationAsync(CancellationToken token);
Task<NavigationObservation> OpenConversationAsync(ChatReference reference, CancellationToken token);
Task<InvocationObservation> InvokeCadGptAsync(CancellationToken token);
Task<InvocationObservation> SendContinuationProbeAsync(CancellationToken token);
```

- `ChatReference`: local label A/B, ordinary ChatGPT conversation URL, observation timestamp. It stays in the local profile/runtime evidence directory; published reports use a label/hash. No raw connector identity.
- `NavigationObservation`: success, method/version, start/end timestamps, observed page-reference hash, failure code, manual intervention flag.
- `InvocationObservation`: UI action timestamps, actual connector selection/send method, failure code and manual intervention flag. It cannot assert backend admission.
- Adapter operates only on the visible ChatGPT UI in the dedicated WebView; it never reads cookies, browser storage, hidden session metadata, or network identity headers.
- Start B performs New Chat plus connector selection/composer invocation/send automatically. An empty chat landing page is not yet a durable B reference; capture B's URL after submission establishes the conversation.
- Continuation prompt: `Use CadGPT to call job_list once and show the job names. Do not call cadgpt_admission, start work, select a drawing, or execute a job.`
- Probe success must come from the real session-authorized `job_list` result, not model prose. An unexpected re-admission invalidates retained-admission evidence.
- Adapter implementations may use UI selectors or UI interaction; record which. Navigation references remain test metadata, never authority.

### Backend completion metadata

Add request-scoped context with Node `AsyncLocalStorage`; do not use a process-global current request:

```typescript
withContinuityRequestContext<T>(req: Request, action: () => Promise<T>): Promise<T>
currentContinuityRequestContext(): ContinuityRequestContext | undefined
```

Context contains a generated observation ID, start timestamp, transport fingerprint, request-ID fingerprint, and connector identity-bound state. Resolve logical identity using the existing helper; discard raw headers after computing approved fingerprints. Log no path containing MCP_TOKEN. Internal recovery requests get their own context.

Add allowlisted completion events:

- `admission_completed`: after `checkAdmission` and `onActive` successfully finish and before returning the normal tool result. Include `success`, decision `mode`, `claimed`, and allowlisted `launch_mode`.
- `admission_failed`: on rejection/exception; fixed failure category only, then preserve the original throw/result behavior.
- `session_probe_completed`: only for the existing `job_list` session-authority wrapper, after `assertSessionClaimed` and a result with `isError !== true` and `structuredContent.ok === true`.
- `session_probe_failed`: original assertion/callback/result failure, without modifying admission or the original response.

Every event has schema version 1, timestamp, runtime ID, observation ID, transport fingerprint, request-ID fingerprint, logical fingerprint, connector-bound boolean, tool/event name, success/claimed flags, and fixed failure category. Missing context is explicitly invalid for the experiment. Context's connector key must match the callback's server logical key before `connector_bound=true`; a fingerprint of a fallback transport never counts.

Use existing safe header fingerprints for subject/session as optional diagnostic comparisons. They are not a substitute for completed admission/probe. Never serialize original arguments, output payload, exception text, user turn, jobs, drawing paths, confirmation tokens, or work handles.

No new MCP tool or tool-list surface is needed. Instrumentation reports existing decisions; it does not change them.

### Evidence collector

Shared functions in `scripts/lib/stage0-evidence.mjs`:

```typescript
selectStepEvidence(records, step): StepEvidence
evaluateRound(round): RoundVerdict
evaluateRun(rounds, prerequisites): RunVerdict
```

Represent types with JS documentation/type descriptions; production runtime remains TypeScript.

- `Step`: run ID, step ID, case, round, label A/B, expected event, begin/end timestamps, expected runtime ID, expected logical fingerprint where known, UI observation and intervention flag.
- `StepEvidence`: UNIQUE_SUCCESS, NO_SUCCESS, AMBIGUOUS, FAILED, or PREREQUISITE_BLOCKED plus allowlisted supporting records.
- Select all candidates from the exact bounded window, including failures and competing unexpected completions. Never use `.at(-1)` as identity evidence.
- Accept exactly one unique successful expected event with a verified connector identity and coherent observation/runtime/transport mapping. Deduplicate identical records by observation/event ID; distinct attempts are not duplicates.
- Any conflicting A/B fingerprint, failed completion, unplanned admission, manual intervention, missing identity, unreadable/missing log interval or competing candidate invalidates the step. Use a fixed reason code.
- A page action alone cannot associate an arbitrary backend request with a WebView. The procedure therefore serializes steps and quiets all other CG clients; inability to establish this controlled window is AMBIGUOUS.
- Persist local artifacts under `%LOCALAPPDATA%\CadGPT\logs\stage0\<run-id>`; do not reset or overwrite existing logs/runs. Copy sanitized output to the repository results artifact.
- Do not depend on rotated NDJSON history remaining available: collect the current and previous log segment at step end and retain the matching records. If collection loses an interval, reject it.

CLI in `scripts/stage0-evidence.mjs`:

```text
node scripts/stage0-evidence.mjs start --run <run-id>
node scripts/stage0-evidence.mjs begin --run <run-id> --step <step-id> --case <case> --round <n> --chat A|B --expect admission|probe
node scripts/stage0-evidence.mjs wait --run <run-id> --step <step-id>
node scripts/stage0-evidence.mjs end --run <run-id> --step <step-id> --ui-observation <absolute-json-path>
node scripts/stage0-evidence.mjs report --run <run-id>
```

The experiment controller invokes these local commands asynchronously. They only capture/report; they never call MCP tools, create admission, or change drawings. `begin` finishes before the UI action; `wait` watches the bounded log window until a candidate/failure appears or the shared deadline expires. Its candidate is provisional: `end` re-evaluates the complete window with the finished UI observation before accepting evidence. Duplicate open step IDs and overlapping capture windows are rejected. Exit codes: 0 valid/provisional success, 2 prerequisite blocked, 3 invalid/failed evidence, 4 ambiguity, 5 timeout. `report` prints the verdict but exits nonzero for incomplete/ambiguous runs.

## Task 1 — Host probe and build skeleton (T1)

**Consumes:** installed Windows/AutoCAD host; existing repo.
**Produces:** host record, one selected target/build, project/bundle skeleton and deterministic build command.

- [ ] Add the read-only host probe. Record exact `acad.exe` release/build/path/PID, x64 architecture, installed SDK/toolchain, AutoCAD API assembly versions, WebView2 runtime/version and writable profile path.
- [ ] Choose the target only from actual release/build compatibility. Do not assume every AutoCAD 2025/2026 patch uses the same .NET runtime. Unsupported or unavailable SDK/runtime is PREREQUISITE_BLOCKED, not architecture FAIL.
- [ ] Create the csproj with WPF and x64, exact compatible NuGet versions and lock files. Reference installed AutoCAD assemblies with copy-local disabled; do not redistribute them.
- [ ] Set the WebView profile to `%LOCALAPPDATA%\CadGPT\runtime\autocad-addin\stage0-webview2`.
- [ ] Create a bundle skeleton targeting only the verified supported release. Stage build output under ignored `addins/cadgpt-autocad/bin/stage0-bundle`.
- [ ] Add `build-autocad-addin.ps1` with validated `AutoCadInstallDir`, configuration and output parameters. It cannot overwrite installed CAD files or change global load security.
- [ ] Build: `powershell -NoProfile -File scripts/build-autocad-addin.ps1 -AutoCadInstallDir '<verified-install-dir>' -Configuration Debug`. Expected: build succeeds, expected DLL and bundle metadata exist, no AutoCAD API DLLs copied.
- [ ] Document developer NETLOAD/trusted-path setup and the separate deployable bundle path. Use a scoped trusted development location; do not disable SECURELOAD globally.
- [ ] Checkpoint only this task's new files; preserve unrelated uncommitted source/tests.

A build proves the skeleton, not embedded ChatGPT compatibility.

## Task 2 — Palette, WebView lifecycle and existing chat (T1)

**Consumes:** Task 1 target/profile/build.
**Produces:** `CGSTAGE0` command opens one palette; ChatGPT loads; existing chat A can be accessed.

- [ ] Write `PaletteLifecycleTests` covering open twice → one instance; hide → same instance; recreate → old handlers disposed; cancellation during initialize → no late attach.
- [ ] Introduce host-independent lifecycle state in `Stage0/PaletteLifecycleState.cs` with `Closed → Initializing → Ready`, plus `Failed` and `Disposing`. Keep that state and adapter/controller contracts free of Autodesk API types. Tests link the pure units and inject fake UI/navigation operations rather than loading Autodesk assemblies or real ChatGPT. Tests must fail before the implementation exists.
- [ ] Implement entry point and command; create WebView only on its WPF/UI STA dispatcher. Await initialization; no `.Result`, blocking `.Wait()`, or nested modal loop.
- [ ] Normal palette close hides/reuses the view. Explicit Recreate disposes the view/handlers, then reopens using the same profile. Application termination performs best-effort disposal without killing unrelated browser processes.
- [ ] Show initialization failures in the panel. Profile write failure, missing runtime, login failure and navigation failure remain prerequisites. Retry creates a clean UI instance.
- [ ] Login uses normal visible UI. Popup/new-window handling may use the dedicated profile or user-assisted setup; do not intercept authentication secrets.
- [ ] Run `dotnet test addins/cadgpt-autocad.tests/CadGpt.AutoCad.Tests.csproj`. Expected lifecycle cases pass.
- [ ] In actual AutoCAD: open/hide/reopen palette three times; perform Recreate; complete login; access an existing chat; continue a harmless message; reopen AutoCAD and verify profile persistence. Record host observations.
- [ ] Verify no drawing mutation command/binding control exists in the add-in. A remains the setup reference for later tasks.

## Task 3 — Request context and outcome events (T2)

**Consumes:** existing admission/session wrappers and diagnostics.
**Produces:** allowlisted completion events with the shared schema; tool results/authority unchanged.

- [ ] Write `tests/stage0-admission-evidence.test.mjs`: successful bare admission emits one completed event; inactive/control decisions never count; `onActive` failure emits failure and preserves original throw.
- [ ] Add cases: two interleaved requests keep distinct observation contexts; missing identity is invalid; server-key/header-key mismatch is invalid; the normal welcome response and tool-list definitions are unchanged.
- [ ] Add `job_list` probe cases: asserted claim + successful result counts; unclaimed session, thrown callback and `isError/ok:false` each fail; no admission is created by probing.
- [ ] Add secret sentinel arguments/output/exception text to fixtures and assert none occur in serialized evidence. Add disabled/unwritable diagnostics cases: normal tool behavior continues, experiment evidence is unavailable.
- [ ] Implement the shared context around `handlePost` in `src/index.ts`. Carry it through normal routing/recovery to callback events; use request-local storage, not a shared global.
- [ ] Instrument `tools/admission.ts` only around its existing decision/onActive/result flow. Determine claim/mode explicitly; do not modify `checkAdmission` or return shape.
- [ ] Instrument only the existing `job_list` session wrapper in `server-factory.ts`; await its existing callback before judging its result.
- [ ] Extend diagnostic metadata helpers as needed. Preserve local fail-open fingerprint initialization; expose whether fingerprint storage is persistent/runtime-only in safe runtime metadata.
- [ ] Run `npm run build`, then `node --test --test-isolation=none tests/stage0-admission-evidence.test.mjs tests/continuity-diagnostics-startup.test.mjs`.
- [ ] Run existing targeted regressions: `node --test --test-isolation=none --test-name-pattern='continuity diagnostics|same OpenAI conversation|existing MCP transport rejects|production MCP router preserves' tests/runtime-isolation.test.mjs`.
- [ ] Run `npm test`; document any environment-blocked process spawn separately. Do not call the full suite green when it is blocked.

## Task 4 — Bounded capture and conservative verdicts (T2)

**Consumes:** Task 3 completion events and local UI observations.
**Produces:** collector CLI and fixture-tested evaluation functions.

- [ ] Write failing selection fixtures: zero success, one success, two competing successes, stale window, identical duplicate, missing connector identity, failed result, logical mismatch, runtime change and log gap.
- [ ] Write round fixtures: A admission → B admission → A probe → B probe passes only for distinct A/B and consistent runtime. Different transport IDs with one logical key fails. Different runtimes cannot establish within-runtime distinctness.
- [ ] Write intervention/retention cases: manual B creation/invocation invalidates; unplanned A re-admission invalidates retained-claim case; initial login setup is allowed; cold-runtime admission is allowed only in its dedicated case.
- [ ] Write verdict fixtures: three consecutive successes for every required case with no unresolved capability failure → PASS; controlled capability failure repeated three times → FAIL; blocked prerequisite, mixed valid capability outcomes, unknown identity or missing case → AMBIGUOUS. A documented corrective revision starts a fresh evaluation sequence while retaining all prior attempts; three later successes alone cannot erase an unexplained failure.
- [ ] Implement shared pure functions and CLI. `begin/end` owns file positions/time window; runtime changes are explicit. Reading logs and writing reports cannot invoke CAD/MCP.
- [ ] Bound one step at 120 seconds. UI navigation/composer actions have a 30-second budget per action; backend waits use the remainder. No automatic send retry within an attempt, because it can create duplicate chats/messages.
- [ ] A timeout is recorded with screenshots/UI observation and backend events. Clear the environment cause or reproduce capability failure in fresh attempts; never silently extend the budget.
- [ ] Run `node --test --test-isolation=none tests/stage0-evidence.test.mjs`. Expected all positive/negative fixtures pass.
- [ ] Dry-run collector CLI on synthetic records and verify reports contain no raw URL, header, token, tool arguments/result or user content. Mark this SYNTHETIC, never real-host evidence.

## Task 5 — Automatic UI adapter and experiment controller (T2)

**Consumes:** ready WebView, shared adapter contracts, Task 4 collector CLI.
**Produces:** one Start Experiment flow; automatic B creation/`@cg`, reference return, and capture windows.

- [ ] Write `ChatNavigationAdapterTests` with a local HTML fixture matching only the adapter contract: new-chat action, composer, connector selector, send, ordinary URL transition, saved-chat return.
- [ ] Assert no credential/storage/network-secret APIs are used; a missing/ambiguous selector stops instead of clicking a guessed target.
- [ ] Write `ExperimentControllerTests`: Start B opens evidence before action; create → invoke/send → durable URL → completion; returning A invokes only continuation probe; cancellation stops further sends; no manual retry passes.
- [ ] Implement selectors in one replaceable adapter. Require the actual connector UI mechanism present on the user's account; merely typing text containing `@cg` is not proof of connection.
- [ ] Capture navigation references using visible ordinary page URLs only. The full refs remain local; repo report uses reference hashes.
- [ ] Controller serializes actions, integrates collector CLI asynchronously, and records visible status plus exact failure stage. Unexpected dialogs/challenges stop the attempt.
- [ ] Expose only experiment controls: Start, Cancel, Reload WebView, Recreate Palette, and local report. No drawing binding controls.
- [ ] Run .NET fixture tests and inspect cancellation/UI dispatcher behavior.
- [ ] Perform one pilot in the actual hosted ChatGPT UI. Fixture pass does not prove selectors, embedded login or real connector support.
- [ ] Record adapter version/actions and verify B's actual successful admission from Task 3 evidence. If unsupported, retain manual observation as diagnosis only.

## Task 6 — Controlled real-host matrix (T3)

**Consumes:** verified shell/adapter/collector and working browser control.
**Produces:** retained rounds and explicit per-case results; no final architecture implementation.

Preparation:

- [ ] Record source HEAD plus hashes/patch provenance for relevant uncommitted files, build DLL hash, host/.NET/WebView2 versions, adapter version, diagnostics availability and CadGPT runtime ID.
- [ ] Use one `acad.exe`, two blank unsaved fixture drawings, and no selection. Bare admission should remain READY; verify rather than assume. If actual behavior differs, stop and classify.
- [ ] Check normal browser `@cg` works on the same account. Close/quiet other CG chat activity before embedded capture; browser remains supported and is rechecked at the end.
- [ ] Manually complete initial login/one-time connector setup and select A. Record local A reference. Then run initial A invocation automatically and verify successful connector-bound admission.
- [ ] Start a fresh run directory; confirm no previous capture window is open.

Each main round: verify/open A → establish/confirm A admission as appropriate → Start B automatically → successful B admission → automatically return A and execute `job_list` continuation probe → return B and probe B. No continuation handles are supplied. A and B keys must differ within that round's runtime.

| Required case | Procedure | Repetitions / acceptance |
| --- | --- | --- |
| Normal A/B/return | Main round without reload | 3 consecutive complete rounds; retained A and B admissions |
| WebView reload | Establish A/B, reload each view and repeat A/B probes | 3 rounds; same runtime and logical fingerprints; no re-admission rescue |
| Palette recreation | Establish A/B, dispose/recreate palette with same profile, return/probe both | 3 rounds; profile and refs usable; same-runtime retained admissions |
| AutoCAD reopen | Establish A/B, close fixture-only host, reopen add-in, return both | 3 rounds; if runtime unchanged, retained-claim probes; if changed, fresh admissions followed by stable distinctness in that runtime |
| Explicit CadGPT restart | Establish A/B, restart only the owned CadGPT runtime using its documented lifecycle, reopen existing chat refs, automatically re-admit A/B | 3 rounds; no old work-handle use; compare distinctness/returns only within new runtime |

Additional controls, once each:

- [ ] Retain the Task 3 negative test proving an unadmitted session cannot successfully execute `job_list`. Attempt the same control in the UI only if it can reach that tool without automatically admitting first; otherwise mark the UI control unobservable and cite the backend negative test. Do not treat an automatically admitted UI call as the negative control.
- [ ] Confirm existing browser workflow still admits/probes after embedded testing.
- [ ] Close one blank fixture drawing and run one-drawing smoke: record existing auto-bind Workspace Ready and actual host result. No geometry modification/job execution. A CAD failure here is diagnosed separately from chat capability; do not erase it from the report.
- [ ] Confirm cancellation sends no additional message and AutoCAD stays usable.
- [ ] Restore fixture/host state; preserve profile and trial records. Do not delete created chats automatically.

Stop rules: at most five attempts per required case after the pilot. A controlled capability failure reproduced three times permits FAIL. Mixed valid success/failure, a necessary prerequisite still blocked, missing evidence or runtime mismatch produces AMBIGUOUS. Do not discard earlier attempts to fabricate three clean rounds; include the complete sequence and explain any corrected adapter/environment change. A corrective revision requires a fresh three-round sequence for all cases affected by that change.

`cg/list`, `cg/status` or ChatGPT prose alone is not the admission success assertion. Evidence originates from the actual backend completion/probe events.

## Task 7 — Results, review and handoff (T4)

**Consumes:** all trial artifacts and matrix results.
**Produces:** repository result report, verdict and limits; no downstream implementation Job.

- [ ] Write the results file with sections: Environment/Source; Setup; Automation Method; Evidence Table; All Attempts; Runtime Boundaries; Failure Classification; Verdict; Remaining Limits.
- [ ] Evidence table columns: case, round, step A/B, reference hash, runtime ID, observation ID, transport fingerprint, logical fingerprint, admission/probe outcome, manual-intervention flag, reason code.
- [ ] Validate the report against Task 4 evaluator. Missing required rows, incomplete cases or unresolved contradiction cannot become PASS.
- [ ] State separately what is proved about UI creation, real connector admission, same-runtime retention and post-restart re-admission. Stage 0 proves none of the future multi-drawing execution/isolation design.
- [ ] Sanitize screenshots to the experiment area; remove account identity, unrelated chat titles/content and filesystem secrets. Do not commit full raw logs or WebView profile.
- [ ] Run `git diff --check`, verify Markdown links, .NET tests, targeted Node tests and `npm test`; retain full-suite limitations.
- [ ] Review only task-owned files and preserve pre-existing edits. Record scoped commits if implementation work is committed; no force push or automatic publish.
- [ ] Hand off PASS/FAIL/AMBIGUOUS and evidence to the human/Planner. Future architecture requires its own plan and authorization.

## Official technical references

Version selection depends on the exact AutoCAD release/build rather than a hardcoded year rule; use Autodesk's [Managed .NET compatibility](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-Customization/files/GUID-A6C680F2-DE2E-418A-A182-E4884073338A.htm) and the installed release's corresponding documentation during Task 1.

WebView access stays on its UI/STA thread with async calls; see Microsoft's [WebView2 threading model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model).

The dedicated user-data folder must be writable and preserved across normal lifecycle operations; see Microsoft's [user-data folder guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/user-data-folder).

These sources support hosting/runtime requirements. They do not establish that ChatGPT login or connector automation works in WebView2; only Task 6 real-host evidence can establish that.
