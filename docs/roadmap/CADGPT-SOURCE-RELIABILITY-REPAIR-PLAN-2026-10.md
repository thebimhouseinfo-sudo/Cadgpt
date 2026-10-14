# CadGPT — Source Reliability Findings & Repair Plan (14 October 2026)

## GOAL

Sửa **những lỗi có bằng chứng** trong CadGPT hiện tại có thể tạo kết quả sai âm thầm, mất dữ liệu hoặc khiến model phải kiểm tra/đi đường vòng; xác minh riêng các nghi vấn chỉ suy ra từ code. Giữ hệ thống hiện hành ổn định, đúng bản vẽ đã bind, báo lỗi thật và không thêm cơ chế thực thi mới nếu chưa cần.

**Product outcome:** đọc CAD đúng hoặc báo lỗi có chứng cứ; patch Lisp đúng nguyên văn; thao tác ghi file an toàn; trạng thái thực thi được diễn đạt đúng (`queued` không đồng nghĩa `completed`); không làm giảm tương thích của Saved Jobs/Direct Jobs.

**State:** **DRAFT / REVIEW & REPAIR PROPOSAL ONLY**. Chưa sửa application code, không chạy AutoCAD, chưa có CI/CR PASS, chưa được phép merge/deploy. Đây **không phải** Reliable Worker Harness Draft R2 và không tự thay thế các roadmap/GSA Jobs đang chạy.

**Reviewed source baseline:** `thebimhouseinfo-sudo/Cadgpt main@b174ca41800bf017e3c11c296c2113d09cd6da8d`. Đối chiếu nhận xét kỹ thuật bên ngoài với `diagnostics/cad/ERROR_LOG.md`, những source/tests nêu dưới đây. Chưa chứng minh các giả thuyết bằng AutoCAD thật. Recheck fresh HEAD trước mỗi implementation.

## 1. Evidence classification — không đánh đồng code fact với production bug

| ID | Hiện tượng / bằng chứng | Verdict ở baseline | Ưu tiên kiểm tra/sửa | Owner |
| --- | --- | --- | --- | --- |
| R01 | `job_dynamic_lisp_patch` dùng `updated.replace(old_text, new_text)`: replacement string có `$$`, `$&`, `token dollar-backtick`, `$'` có ngữ nghĩa đặc biệt của JavaScript; nhánh split/join không có ngữ nghĩa đó. | **CONFIRMED CODE-LEVEL**; nguy cơ ghi Lisp sai nội dung, không cần AutoCAD để chứng minh | A / fix nhỏ sau test đỏ | Dynamic Lisp authoring |
| R02 | `replace_all=false` cho phép `old_text` xuất hiện nhiều lần, nhưng thay lần đầu và ghi `occurrences: 1`. | **CONFIRMED CODE-LEVEL**; xem như defect nếu contract “exact section” đòi duy nhất, cần chốt quy tắc rõ trong test | A / fail-closed với ambiguous match | Dynamic Lisp authoring |
| R03 | `entity_service.py::_entities` nuốt lỗi COM từ Count/Item; `_spaces` cũng skip lỗi layout. | **CONFIRMED CODE-LEVEL**; mock COM để chứng minh partial/empty sai, chưa có incident AutoCAD trong ERROR_LOG | A / test+fix | Existing J03 CAD MCP foundation |
| R04 | `utils/filters.py` default `limit=200`, tối đa 5000; `list_entities` trả `list[dict]` ngay khi đạt limit, **không metadata incomplete/truncated**. | **CONFIRMED CODE-LEVEL**; chưa chứng minh ca sử dụng thực tế | A / test+contract fix tương thích | Existing J03 |
| R05 | `lisp_service.py::run_lisp_command` gọi `_send` rồi trả `queued:true`; `cad-proxy.ts` chuyển kết quả; không phải completed command. | **CONFIRMED API SEMANTICS**, không phải bằng chứng failure/COM busy; test tình huống đọc ngay sau command kéo dài | B / đo+host test | Lisp execution boundary |
| R06 | AutoLISP globals hoặc data file lỗi có thể khiến engine dùng data cũ. | **HYPOTHESIS**; chưa rà hết engine/data của Saved Job và chưa có incident log | B / static+host test trước sửa | Specific affected Lisp only |
| R07 | `_serialize_arg` giữ nguyên chuỗi không chứa whitespace/quote: `(exit)` không được bao quote. | **CONFIRMED SERIALIZER BEHAVIOR**, tác động trên AutoCAD command line chưa chứng minh | B / unit+host safety test | Lisp service |
| R08 | `job_dynamic_lisp.ts::atomicWrite` temp+rename không có chính sách retry EPERM/EBUSY; file Lisp và `.source.json` được commit qua **hai lần ghi**. | **CONFIRMED CODE STRUCTURE**; Windows/partial-failure impact chưa chứng minh | B / injected I/O failure + Windows | Dynamic Lisp / existing J02 security |
| R09 | `cad-proxy.ts` lưu owned command names trong `Set` theo Work/drawing, không pin source/loaded hash ở lệnh gọi. | **CONFIRMED CODE STRUCTURE**; load→patch→run có thực sự chạy định nghĩa cũ/ngoài ý muốn hay không cần test | B / targeted test | Lisp execution boundary |
| R10 | `lisp_service.py` dùng `USERS5` sentinel cho verified load và `run_lisp_function_sync`; `_LOAD_TIMEOUT_SECONDS = 8.0`, reset USERS5 best-effort; sync function chỉ truyền text ngắn qua biến. | **CONFIRMED CODE STRUCTURE**; không mặc định đây là bug/timeouts là sai; test failure/restore/late dispatch | B / host test | Lisp service |
| R11 | Lisp UTF-8 BOM/no-BOM, Unicode path, tiếng Việt, Windows rename/lock. | **ENVIRONMENT-DEPENDENT, UNVERIFIED**; cần AutoCAD R22.0 trên Windows | B / host-only test | Host compatibility |
| R12 | `path-security.ts` trường hợp `lstat` thành công nhưng `realpath` trả ENOENT (dangling symlink) rơi qua nhánh create parent; test hiện mới bao phủ symlink/junction hợp lệ. | **PLAUSIBLE SECURITY BUG FROM SOURCE**, chưa có exploit verified; cần negative test trước fix | A / negative security test | Existing J02 permission boundary |
| R13 | Prompt injection qua TEXT/MTEXT/ATT/layer/Xref từ DWG vào model. | **THREAT / DESIGN RISK**, chưa có incident; không tự phát triển sandbox mới | B / threat model và guard khi có trust-crossing thực | Security review |
| R14 | Direct Request router, all-in-one `job_dynamic_lisp_run`, mặc định Undo Group, blanket Engine+Data rewrite, instructions length, LICENSE/README/release. | **ARCHITECTURE PROPOSALS / REPO HYGIENE**, không phải defects | DEFER / ngoài repair scope hiện tại | Reliable Worker Draft R2 hoặc roadmap riêng |

**Evidence limitation:** `ERROR_LOG.md` ghi các lỗi điều hướng “vẽ lại” sang image, trả lời CAD cũ, model workaround khi `tbh` Direct Job thất bại, và các case AppData/Anchor (status trong log). **Không** có chứng cứ đã ghi cho `queued` gây lỗi, COM bận trả rỗng hay stale engine data. Incident logs và cấu trúc source là hai loại bằng chứng khác nhau.

**Source references:** `src/cadgpt/tools/job-dynamic-lisp.ts` (atomicWrite, prepare, patch); `runtimes/cad-mcp/services/entity_service.py`; `runtimes/cad-mcp/utils/filters.py`; `runtimes/cad-mcp/services/lisp_service.py`; `src/cadgpt/tools/cad-proxy.ts`; `src/cadgpt/lib/path-security.ts`; `tests/job-dynamic-lisp.test.mjs`; `tests/path-security.test.mjs`; `knowledge/cad/WORKING_KNOWLEDGE.md`.

## 2. Ownership and overlap with existing plans

- **R03/R04:** `docs/roadmap/CADGPT-INTEGRATED-MCP-HARDENING-PLAN-2026-10.md` **J03** already owns `_find_entity`, COM enumeration failure/incomplete read, typed schemas and batch/pagination. Add exact regression cases to that owner's future checkpoint; **do not instantiate a second CAD MCP rewrite**.
- **R12 and file I/O aspects of R08:** the same integrated roadmap **J02 SYSTEM SECURITY/EXCEL** already owns cross-job/symlink/locked-file/interrupted-write tests. Reuse boundary fixtures and coordinate changes, but R08's Job-owned Lisp/provenance semantics remain with Dynamic Lisp implementation.
- **R05/R07/R09/R10/R11:** preserve Job runtime, `cad-proxy` Work/drawing identity, tool authority and existing verified Lisp load path. Any source change touching these boundaries must reconcile with **Orchestrator V2 J-6B01** and one-off Temp Lisp continuity work; don't change WorkRegistration/leases/header/add-in to resolve an unproven hypothesis.
- **R14:** defer broader model behavior/harness design to `CADGPT-RELIABLE-WORKER-HARNESS-DRAFT-R2-2026-10.md` on its separate plan branch. Do not integrate it now; review against actual implementation only after the appropriate previously agreed phases.
- **No duplicated lifecycle:** this document is an implementation evidence/repair backlog linked to existing owners, *not* a new Job Registry item, an Operator/Builder workflow, or automatic replan/supersession of GSA `J-6B01`, `J-5DF2` or current active host-recovery Jobs.
- **Current integrated roadmap status:** Revision 11 is CR-PENDING and source is not auto-approved for execution. Do not rewrite its revision, copy its work into a new Job or claim CR passed solely because this supplement exists.

## Phase 0 — Evidence and executable regression baseline
### GOAL
Establish exact reproduction and non-overlap before a source change; classify failures that would otherwise appear successful.

**Tasks**
1. Re-read main HEAD/current branches, manifests and exact source positions; diff against this baseline. Owner matrix KEEP/ADD/VERIFY/DEFER for all R01–R14.
2. Add/finalize **failing tests first** for deterministic issues: `$$`/replacement tokens, duplicate `old_text`, COM Count/Item exceptions, 201/250 entity truncation; ensure negative controls really fail with old behavior. Existing `tests/job-dynamic-lisp.test.mjs` and `tests/path-security.test.mjs` are the starting point.
3. Stub COM enumeration/serialized args without AutoCAD; test dangling symlink case with an outside target that does **not yet exist** and reject any create/write escape. Check both generic path resolver and mutation resolver. Test that only explicitly supported entity types are counted/reported.
4. Record API consumers of `cad_list_entities` (including direct MCP and manifest gateway) before changing a `list[dict]` response; define compatible versioning/metadata or explicit incomplete-result error. No silent schema break.
5. Record Windows/AutoCAD-only evidence gaps separately; **no host PASS claim** from mocks.

**Exit/PASS:** source snapshot + owned regression cases + reviewer-confirmed red tests, compatibility map, host-test list. If an alleged bug cannot be reproduced under its declared conditions, mark `NO_CHANGE_REQUIRED` or `UNVERIFIED`; never implement speculative fixes.

## Phase 1 — Small source correctness and security repairs
### GOAL
Prevent wrong Lisp patch content, ambiguous patch placement and unauthorized filesystem writes with minimal local code changes.

**Tasks**
1. R01: replace JS string replacement with a **literal-safe** operation for single occurrence (callback or indexed splice); test `$$`, `$&`, `token dollar-backtick`, `$'` and Vietnamese/multibyte content. Assert unchanged bytes outside approved patch span and correct source SHA/result.
2. R02: for `replace_all=false`, fail explicitly when `old_text` matches more than once (unless already explicitly approved unique-anchor semantics exist); for `replace_all=true`, retain intended all-occurrences behavior. Both paths reject missing target, report correct occurrence count, preserve existing syntax/hash checks.
3. R12: on `forCreate`, distinguish target-absent ENOENT from **existing but dangling symlink**; fail closed if `lstat` succeeded but `realpath` failed. Test link-to-outside missing target, link-to-inside target, root junction, ordinary new path and permissions on Windows and supported test OS.
4. R08: inject `rename` EPERM/EBUSY, unexpected process interruption between Lisp and provenance writes, and source SHA conflict. Implement only a bounded, measured Windows-safe policy that does not delete original or claim two filesystem writes are a single transaction. Reconcile source/provenance mismatch before any reuse/load; avoid blind retry of mutations with uncertain outcome.
5. For R09, preserve **source-versus-loaded-state** distinction: changing Job-owned source file is not proof that the loaded AutoCAD command changed. If test proves an invalid run path, enforce re-load/hash/ownership on the verified existing load route, not a second command scheduler.

**Exit/PASS:** regression/negative tests pass, source and `.source.json` agree or fail closed, no arbitrary filesystem escape, no change to promoted Job semantics, stable existing paths and hashes.

## Phase 2 — CAD read integrity and command result truth
### GOAL
Stop returning misleading empty/incomplete CAD data or misreporting command dispatch as finished execution.

**Tasks**
1. R03: mock Count, Item, layout enumeration errors and COM-busy; ensure a failure cannot turn into an authoritative empty `list_entities` result or false `not_found`. Return actual error or a clearly **incomplete** structured outcome. Preserve real CAD read freshness and bound drawing targeting.
2. R04: test `limit=200` and 250 matching objects. Preserve backward compatibility for existing `list[dict]` consumers: prefer additive/versioned result metadata or documented explicit truncation/error; never silently change list to dict under the same contract. Show whether `limit` was reached and whether completeness is known; reaching exactly the limit is *not* proof of truncation unless one extra element/check confirms it.
3. R07: keep command argument contract explicit; test serializer input `(exit)`, whitespace, quotes, backslashes, numbers and Unicode. Use disposable AutoCAD command that cannot harm the drawing to observe whether the unquoted expression evaluates. If unsafe, modify only the affected string-serialization path with compatibility tests; do **not** blindly quote all inputs and break commands expecting tokens.
4. R05: distinguish `DISPATCHED/QUEUED`, `COMPLETED`, `FAILED`, `UNKNOWN_OUTCOME`. The current `cad_run_lisp_command` intentionally dispatches asynchronously; **do not rename queued to completed** or rely on `CMDACTIVE=0` alone. If a workflow needs completion evidence, use the existing verified/synchronous Lisp function channel where suitable or a Job-owned result file and operation/run identity; do not invent a mandatory new `job_dynamic_lisp_run`.
5. Test Direct Job failure: tool error is not a signal to bypass via ad hoc Lisp load; maintain original error/stop contract from `WORKING_KNOWLEDGE.md`.

**Exit/PASS:** errors do not masquerade as empty results, truncated reads are distinguishable without breaking legacy consumers, `queued` never implies completed, and no extra confirmation/readback is inserted into an already-approved Job.

## Phase 3 — Targeted AutoCAD/Windows investigations
### GOAL
Resolve high-consequence unknowns with a disposable test fixture before choosing any new mechanism.

**Tasks**
1. R05: on user-authorized disposable R22.0 DWG, run a harmless ~10-second Lisp command and immediately request a CAD read. Observe queued/busy/empty/completion timings, tool errors and last known drawing; instrument only enough to support diagnosis, not broad queue rewrite.
2. R06: inspect data-loading sequences in **actual affected Job Lisp engines**. Use unique data/run IDs, deliberately fail a *new* data load, then attempt the declared run. Assert old data is not silently used. Add run-token/global reset only if real affected engine has an unsafe path and it is the smallest compatible solution.
3. R09: load a known source, modify/patch it, call command without verified reload within the same Work, inspect which definition executes; repeat after verified load and across two drawings. Do not reinterpret source SHA as proof of live function state.
4. R10: exercise sentinel timeout, late command, `USERS5` restoration, log-mode restoration and failure to set/read variable. The current load expression already checks a pending token to suppress late load; test that safeguard rather than assuming it is absent. Do not treat fixed 8-second load timeout as a defect without real error evidence and approved timeout policy.
5. R11: test UTF-8 BOM/no-BOM, accented Vietnamese text, user path with Unicode and file-lock/rename behavior on actual supported Windows+AutoCAD R22.0. Compare source string with result observed in drawing.
6. R13: prepare a compact threat model for untrusted DWG strings (TEXT/MTEXT/ATT/layer/Xref) and a negative test that source data cannot authorize out-of-scope tools/Lisp writes. Do not build a second authorization stack.

**Exit/PASS:** each case returns `PASS`, `FAIL + exact cause`, `NO_CHANGE_REQUIRED` or `PENDING_REAL_HOST` with evidence. Unobserved failure remains hypothesis. No production drawing mutation.

## Phase 4 — Integration, regression and release decision
### GOAL
Prove only necessary repairs improve reliability without disrupting CadGPT execution, binding or running project plans.

**Tasks**
1. Implement only verified defects within their owning code areas (J02/J03/Job Dynamic Lisp/Lisp service), sequentially, not as a combined architecture rewrite. If J02/J03 already closes an item before this plan runs, mark it `CLOSED_BY_EXISTING_OWNER` with commit+test evidence.
2. Run relevant Node tests, Python unit/mocked COM tests, package build and available CI; name the exact commands from `package.json` and Python setup rather than assuming. Negative controls should fail before fix and pass after. Test false-success paths, not merely strings in source.
3. Verify current Jobs and tools still work: Job-owned Dynamic Lisp prepare/patch/load/run, Direct `tbh`, Saved Job Grille Tag, Temp Lisp, two-drawing binding, Job A→B and cross-Job/file ownership. Keep `loaded=true` separate from executed success.
4. AutoCAD R22.0 host-only tests performed on a disposable copy with bound anchor and state backup; host unavailable → `PENDING_REAL_HOST`, not `PASS`.
5. Reviewer reviews source **and** test assertions, resolves only evidence-backed defects, then request separate Human approval for merge/deploy. Any broader workflow optimization is nominated to Draft R2, never inserted into this repair plan unapproved.

**Exit/PASS:** observed repairs closed, known issues explicitly deferred with owner, no introduced tool/Job compatibility break, clear human acceptance gate. **No automatic merge/deploy.**

## 3. Acceptance, do-not-do list, and change control

- Do not automatically add `job_dynamic_lisp_run`, new Direct Request routing, second runtime/engine, generic global AutoLISP reset, blanket Undo group or arbitrary `CMDACTIVE` polling.
- Do not mark `COMPLETED` on a `queued` response alone, or mark CAD read empty when COM enumeration has errored.
- Do not rewrite registered/promoted JOB.md, TBH Toolkit or source Engine just because an architecture alternative looks simpler.
- Do not change AutoCAD drawing data, Job results, appdata anchors or Current Binding for testing without a separate approved disposable fixture.
- Do not treat error-log status “FIXED awaiting live verification” as host-tested PASS.
- Do not promote CR findings to implementation authority: actual code edit/merge requires user approval of the repair scope and preservation of other in-progress Job ownership.

**Success criterion:** source evidence and regression tests determine *what to fix*; the user-approved workflow determines *what to execute*; the tool/runtime returns truthful evidence of *what actually happened*.
