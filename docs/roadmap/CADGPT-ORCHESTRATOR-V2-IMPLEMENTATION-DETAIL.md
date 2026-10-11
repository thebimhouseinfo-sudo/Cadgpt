# CadGPT — Orchestrator & Job Architecture V2: Detailed Implementation Plan

> **Planning annex** of GSA Job **J-6B01**, planning revision **3**, lifecycle **READY**, planning review **PASS**. This file describes *how to implement and verify* the already-approved objective. It is **not** an instruction to rewrite existing promoted Custom Jobs or to create another GSA/CadGPT Job.
>
> Baseline source: `main@516efce04950a896dca71eb2652f19710063d5f7` (2026-10-11). Strict-Harness candidate: `fix/cad-workflow-strict-execution-20261011@c76ebb26ba7a3a154d6792a682fe0b18150a7725`. Recheck HEAD/diff before implementation. Plan-only branch contains no executable runtime changes.

## 1. Đích đến và các quyết định không được đảo ngược

CadGPT phân biệt **lập workflow** với **thực thi workflow**:

- **Job Builder**: suy luận, thiết kế, viết và thử Custom Job mới. Quy tắc authoring/review áp dụng ở đây.
- **Custom Job Execution**: lấy workflow được promote mới nhất, chọn nhánh theo entry condition được workflow quy định và **làm đúng các bước/điểm dừng của nhánh đó**. Không tự thêm reasoning, kiểm tra hậu quả, audit CAD, readback hoặc nhánh xử lý mới nếu workflow không yêu cầu. Vẫn xử lý lỗi thực sự do tool/platform trả về, Drawing Binding hợp lệ, quyền và safety.
- **Temp Job**: chuỗi tác vụ phát sinh, **kế hoạch ngắn → user xác nhận một lần → chạy → báo kết quả → trở lại ngữ cảnh trước**. Temp không có `JOB.md`, Job ID, draft, promote, Registry entry, per-Temp thư mục hoặc Job Runtime mới. Không tự tạo cơ chế scheduler/concurrency/interrupt riêng. Nếu một file Lisp vật lý là cần thiết, dùng scratch chung rồi dọn.

**Execution paths hiện tại là đúng thiết kế, không sửa để đi đường tắt:**

| Work mode | Chỉ được sử dụng |
| --- | --- |
| `CAD` (CAD-only) | CAD MCP / CAD-observator; không gọi `file_*` hay `job_*` cần FILE |
| `FILE` (FILE-only) | Metadata, filesystem, knowledge, job/lisp authoring; không gọi CAD MCP |
| `HYBRID` | Cả FILE và CAD MCP, đúng cho metadata → batch Lisp → AutoCAD |

Không có finding khi CAD-only bị từ chối FILE tool. Không thay đổi `assertFamilyAllowedForWork` hoặc `toolFamily` để cho phép cross-family. Có thể cần **chuyển Work hợp lệ sang HYBRID** cho yêu cầu mới; đó là hạ tầng, không phải tạo Temp Job runtime.

Ưu tiên latency: **metadata hiện có → tool/batch updater đã có → CAD MCP khi cần**. Không có full-drawing scan nếu bước đã được thỏa từ dữ liệu có nguồn đáng tin. Không hứa thời gian 10 giây khi chưa đo thực tế.

## 2. Source map và giới hạn quyền

| Thành phần | Nguồn hiện tại | Vấn đề / điều phải giữ |
| --- | --- | --- |
| MCP instruction assembly | `src/cadgpt/server-factory.ts`; `knowledge/jobs/REASONING_HARNESS.md`; `knowledge/cad/WORKING_KNOWLEDGE.md` | Hướng dẫn cũ có READ→PLAN→REVIEW→READBACK sau mutation; chưa phải Strict Custom Execution |
| Strict branch đã viết | `knowledge/cad/WORKFLOW_EXECUTION_HARNESS.md`, `src/cadgpt/server-factory.ts`, `tests/strict-custom-job-execution.test.mjs` trên nhánh candidate | Kiểm tra nội dung và merge **có chọn lọc**, không coi string-assertion là behavioral test |
| Registry discovery | `src/cadgpt/tools/registry.ts` | User entries hiện chỉ chấp nhận `lisp` hoặc `job`; không có callable per-Job subtool dispatcher |
| Job bundle | `src/cadgpt/lib/job-bundle.ts`; `src/cadgpt/tools/jobs.ts` | Bundle gồm entrypoint và `lisp/`, `dynamic-lisp/`, `tools/`; `job_get` đã có inspection |
| Job lifecycle | `src/cadgpt/tools/jobs.ts`; `src/cadgpt/runtime/job-transition.ts` | `job_runtime_prepare` / `job_run_direct` có thể giải phóng prior Job authority: **không gọi để thực thi subtool hoặc Temp** |
| Work control | `src/cadgpt/tools/work-control.ts`; `src/cadgpt/lib/work-registration.ts` | Work owner/path mới có thể cleanup Work cũ; FILE→HYBRID có `cadgpt_work_upgrade`, trả handle mới |
| Drawing metadata | `src/cadgpt/tools/drawing-persistence.ts`; `src/cadgpt/runtime/drawing-persistence.ts` | `drawing_metadata_location` luôn đi qua CAD runtime/anchor validation; có cache verified root theo execution |
| File access | `src/cadgpt/tools/filesystem.ts`; `src/cadgpt/lib/path-security.ts` | Reasoning Job write chỉ ở own runtime/result; generic non-Job file writes có thể rộng hơn patch theo trường |
| Lisp | `src/cadgpt/lib/lisp-path-policy.ts`; Lisp loader; Lisp authoring validators | `appdata/runtime/dynamic-lisp` loadable nhưng không là generic writable root |
| Contract epoch | `src/cadgpt/lib/job-local-compat.ts` | Epoch 2 hash `JOB_RULES.md`, `REASONING_HARNESS.md`, `LOCAL_COMPAT_UPDATE.md`; không tự thay contract để né migration |

Source có thay đổi sau baseline phải đối chiếu và cập nhật implementation diff, không áp dụng patch mù.

## 3. A0 — Baseline & contract classification (không đổi runtime)

**Làm:** Ghi SHA main/strict branch, grep callers thực sự của Work start/upgrade, Job prepare/finish/direct, file scopes và tool registration. Chạy test suite hiện hữu, ghi outcome có bằng chứng. Đối chiếu Hash/Epoch và đánh giá chính xác: thay Strict execution có phải sửa **canonical Job contract** tương thích ngược hay không; không đổi fingerprint ngoài nhận thức, không kích hoạt CONTRACT UPDATE chỉ vì export tools.

**File đọc:** `package.json`, `server-factory.ts`, `job-local-compat.ts`, `REASONING_HARNESS.md`, `JOB_RULES.md`, `registry.ts`, `work-control.ts`, `job-transition.ts`, drawing persistence, file access, Lisp path. **Test:** `npm run build`, `npm test`; ghi số lượng PASS/FAIL, không suy đoán kết quả khi chưa chạy.

**Deliverable:** `BASELINE_MATRIX` ngắn gồm source/behavior hiện tại, protected invariants, scope và test evidence. **Exit:** A0 PASS mới thực hiện A1, A2, A3.

## 4. A1 — Orchestrator + Strict Custom Execution (sau A0)

**Runtime policy theo mode, tránh xung đột instruction:**

1. Job Builder đi qua authoring/planning guidance hiện tại; không áp Strict execution khi đang xây Job.
2. Custom Job (Reasoning `.md`): đọc **current promoted `JOB.md`**, xác định entry condition/nhánh và execute đúng thứ tự. Nếu Job quy định `READBACK` thì thực hiện; nếu không, tool result thành công là đủ trừ platform safety/actual error. Không tự tạo PLAN→REVIEW→READBACK ngoài workflow. Direct `.py` tiếp tục chạy fixed executor.
3. Temp: chỉ lập plan một lần trước user confirmation; sau duyệt không re-plan/reconfirm hoặc tự mở thêm stage trừ khi có lỗi/đổi phạm vi cần user quyết định.
4. Đối với lỗi: báo đúng mã/thông báo tool, không giả định success hay tự gọi một workflow khác.

**Implementation seam:** nghiên cứu merge *selectively* nhánh Strict Harness vào `server-factory.ts`. Giải quyết tận gốc mâu thuẫn với file `knowledge/jobs/REASONING_HARNESS.md`: tách authoring/reasoning planning khỏi execution step policy trong lời hướng dẫn nạp cho model; không chỉ đặt hai quy tắc mâu thuẫn cạnh nhau rồi gọi một cái là "highest priority". Nếu canonical contract có đổi hành vi, ghi phân loại compatible/incompatible và áp dụng cơ chế migration hiện tại một cách minh bạch. Không sửa workflow của user-installed Jobs vô cớ.

**Behavior simulation:** stub các tool và selected Job branch, thu tool-call trace. Case không yêu cầu hậu kiểm: chỉ đúng N action/condition calls, không thêm CAD scan/READBACK. Case workflow yêu cầu hậu kiểm: hậu kiểm được gọi. Case `loaded=false`, stale binding, permission-denied: dừng đúng vị trí, báo lỗi gốc. Case `load Lisp then wait`: dừng, không chạy stage sau. Direct Job dispatch không đổi.

**Exit A1:** không có prompt contract trái nhau ở đường nạp thực tế; behavioral tests kiểm chứng tool-call trace; suite Job Steps/Direct/Reasoning không regression.

## 5. A2 — Lazy Custom Job Capability Export (sau A1)

**Quy trình first use:**

`Custom Job invoked OR tool requested → resolve registered Job & current bundle → compare per-Job fingerprint → scan if missing/stale → validate entrypoints → atomically refresh exported capability index → continue`.

- Scan **bắt buộc** ở lần sử dụng Custom Job tiếp theo và khi Temp cần tool chưa index. Không scan toàn bộ Jobs khi bật plugin, không yêu cầu user đăng ký thủ công.
- Reuse `inspectJobBundle` và source hash nếu đã được đọc trong `job_get`; cache index riêng dưới managed AppData state. Không ghi `kind=tool` vào user Registry JSON hiện chỉ cho `lisp/job`. Thêm aggregate *read-only* exported entries vào effective Registry và một callable dispatcher riêng.
- Export chỉ **entrypoint có contract thực** (command/function, input, output, effect, required work mode, ownership, version/fingerprint và way-to-invoke). Quét helper chỉ để hiểu dependencies; không coi mọi file `.lsp` thành lệnh chạy được. Unknown/ambiguous: `unavailable/not-exported`, mô tả nguyên nhân; đã scan và ghi kết quả, không tự bịa wrapper.
- Namespaced IDs ví dụ `custom:<canonical-job-id>:<capability-id>`. Chống collision; check permission/registered source hash mỗi lần invoke để tránh chạy code đã đổi; fail closed on stale or invalid export.
- **Dispatcher chạy một capability**, không dùng `job_run_direct` hoặc `job_runtime_prepare`, không chạy lại Stage 1 hay full workflow, không gây Job transition. **Nối scan vào các điểm thực sự khởi chạy User Job** (`job_runtime_prepare` cho Reasoning; `job_run_direct` cho Direct; khi `job_get` chuẩn bị Job thì có thể tận dụng bundle inspection đang thực hiện). Không trigger scan mọi lần `registry_list`/MCP startup. Scan thất bại ở một subtool không được chặn workflow Job hợp lệ. Với capability cần FILE thì dùng FILE/HYBRID; cần cả FILE và CAD thì dùng HYBRID. **CAD-only chỉ gọi CAD MCP**, không ép FILE tool vào CAD-only.
- Existing Custom Job phải vẫn chạy bình thường nếu helper không thể export; báo trạng thái degraded export, không chặn workflow chính nếu không ảnh hưởng việc thực thi của Job đó. Nếu phát hiện bản thân Job source không hợp lệ theo contract hiện có, giữ hành vi fail-safe hiện hữu.
- **Versioning:** Job bundle signature riêng phục vụ capability scan; không dùng Global `JOB_LOCAL_COMPAT_EPOCH` làm chỉ mục xuất tool.

**Test:** first use => one scan and valid exports callable; repeat unchanged => no deep scan; bundle hash changed => only this Job rescan; helper có lệnh chưa rõ => unavailable, Job vẫn chạy; wrong mode => được từ chối đúng luật; no duplicate entry; no whole Job lifecycle; crash mid-index-write => index cũ không bị làm sai.

**Exit A2:** Registry tra cứu được capability thực sự gọi được; dispatcher được mô phỏng qua happy/failure path; không làm thay đổi Job transition.

## 6. A3 — Metadata-first + Scoped Cross-Job Result Patch (sau A0)

**Fast path đọc:** sử dụng **Drawing Anchor đã được xác minh trong execution/session** để đọc result metadata khi binding vẫn hợp lệ theo chứng cứ hiện có. Không gọi `drawing_metadata_location` chỉ để đánh thức CAD nếu dữ liệu identity hợp lệ đã có. Nếu chưa có hoặc identity stale/ambiguous, fail closed và yêu cầu binding/hybrid validation; **không đoán anchor theo tên DWG**. Phân biệt "đọc bản lưu metadata" với user hỏi "trạng thái CAD hiện tại": yêu cầu live-state vẫn phải gọi CAD.

**Scoped mutation:** xây đường `FILE`-family dedicated (tên dự kiến `file_job_result_read/patch`, xác định tại implementation) nhận *validated anchor handle*, canonical target Job result identifier + **explicit field/handle selectors**, typed patch + expected SHA/version. **Scope phải được kiểm soát server-side theo allowlist của result schema và phạm vi đã được user duyệt trong lần lập kế hoạch**; không tin một chuỗi absolute path hoặc `approved=true` do caller tự gửi để mở thêm quyền. Tận dụng phạm vi phiên/Work hiện có, không yêu cầu user xác nhận lần hai. Giới hạn result/field/handle, không cấp write toàn bộ drawing root, không sửa source package/runtime Job hoặc metadata drawing khác. CAS/file mutation lock, atomic persist, trả hash mới. Chỉ dùng khi FILE hoặc HYBRID Work; **không qua CAD-only**. Cross-Job result là drawing data chia sẻ; **không** nới `reasoningJobStorageScopeWasEntered`/Job-owned result write policy.

**Metadata → CAD sync:** Temp đã duyệt có thể patch dữ liệu rồi gọi existing exported batch updater trên HYBRID. Nếu update CAD thất bại sau persist, report **metadata updated / CAD pending** (có thể retry sync trong đúng scope); không tự undo, rescan, viết lại Job workflow hoặc khởi động lại Custom Job.

**Test:** correct anchor + correct SHA + allowed field -> patch success; old SHA -> `RESOURCE_CONFLICT`; wrong anchor/no binding/other field/symlink/relative traversal -> denied; already-verified metadata FILE Work -> zero CAD MCP calls; fresh live CAD-state user request -> CAD read required; CAS + crash consistent; partial sync reported accurately.

**Exit A3:** file-only operation không gọi CAD chỉ để xác định dữ liệu đã xác minh, không lộ quyền ghi rộng, metadata của đúng drawing được cập nhật.

## 7. A4 — Disposable Temp Execution, Work Continuity & Lisp (sau A1, A2, A3)

**Đường chọn Work (không tạo Temp Job owner hoặc Job Runtime):**

- Đã có **FILE Work** và Temp cần file/metadata: reuse FILE.
- Đã có **CAD Work** và Temp chỉ cần CAD MCP: reuse CAD.
- Đã có **HYBRID Work**: reuse cho FILE/CAD kết hợp và cả tác vụ hẹp hơn, không downgrade.
- **FILE → HYBRID** nếu Temp cần CAD: dùng `cadgpt_work_upgrade` hiện có, truyền selector Drawing rõ ràng/được user chọn từ nguồn hợp lệ, lấy **new handle**. Sau upgrade, Job Builder tiếp tục với new handle; draft/source đang lưu vẫn còn.
- **CAD → HYBRID** nếu Temp cần **bất kỳ FILE action nào**, kể cả chỉ sửa metadata (không cần CAD mutation) hoặc metadata→CAD: hiện `cadgpt_work_upgrade` chỉ chấp nhận FILE. Bổ sung *controlled CAD→HYBRID successor/handoff* vào Work control hoặc phương án tương đương giữ Drawing Binding và kết quả công việc. Temp FILE-only phát sinh khi đang CAD Work được xử lý qua HYBRID successor (không tạo/đổi owner thành Temp Job, cũng không downgrade CAD Work rồi mất binding). Không lén gọi FILE tool trên CAD Work. Không lặp lại xác nhận đã có; chỉ yêu cầu lựa chọn drawing khi binding không còn xác định.
- Nếu no active Work: start một Work FILE, CAD hoặc HYBRID thích hợp theo yêu cầu hiện tại (Work infrastructure thông thường, **không phải Temp Job**).

**Không** gọi `cadgpt_work_start` với `owner_type=job` cho Temp; không gọi `job_runtime_prepare`, `job_run_direct`, `job_runtime_finish` hoặc `releasePriorJobAuthorityForStart` để borrow một capability. Không có interrupt scheduler: chuỗi tác vụ được user xác nhận và thực thi tuần tự theo cuộc trò chuyện.

**Temp AutoLISP:** nếu existing reusable Lisp phù hợp, ưu tiên nó. Nếu thiếu và user đã duyệt hành động, tạo `.lsp` UUID dưới root scratch chung `appdata/runtime/dynamic-lisp` bằng một **scoped authoring action** thuộc FILE family, validate cú pháp/nguồn AutoLISP, giới hạn kích thước/quyền, không dùng generic global AppData write. Load/run bằng CAD MCP trong **HYBRID Work**, kiểm tra tool success, cleanup file sau khi không còn cần. Báo orphan scratch nếu không xóa được; không tạo per-Temp thư mục.

**Test Work:** Builder FILE → Temp FILE → Builder (same handle); Builder FILE → HYBRID → Temp CAD → Builder (new handle valid, old stale, draft preserved); CAD-only → CAD-only no FILE calls; CAD-only → HYBRID for metadata-only OR metadata+CAD (no arbitrary Work cleanup, verified drawing preserved); work upgrade failure leaves old handle/draft; no-job-runtime tool-call assertions.

**Exit A4:** thông suốt các nhánh thành công/thất bại, không mất Job Builder; Temp không tạo managed Job resource.

## 8. A5 — Behavior/Regression/Performance & rollout (sau A1–A4)

Chạy từ repo root: `npm run build`; `npm test` (build + Node tests); `npm run test:lisp-syntax` nếu có thay đổi liên quan AutoLISP. **Không tuyên bố đã chạy** cho đến khi có stdout/CI evidence.

**Regression targets:** `tests/job-transition.test.mjs`, `job-local-compat.test.mjs`, `job-hybrid-default.test.mjs`, `job-runtime.test.mjs`, `job-steps-lifecycle.test.mjs`, `job-sequential-drawing-handoff.test.mjs`, `reasoning-job-storage-write-scope.test.mjs`, `work-upgrade.test.mjs`, `drawing-persistence.test.mjs`, `job-bundle-lifecycle.test.mjs`, `job-owned-lisp-path.test.mjs`, `direct-job-lifecycle.test.mjs`, `lisp-loader-error-contract.test.mjs`, `cad-working-knowledge.test.mjs`. Add narrow tests only for changed contracts.

**Mandatory executable simulations (mock tools, assert tool-call traces and real branch paths):**

| ID | Input / setup | Required evidence |
| --- | --- | --- |
| T01 | Fixed Custom Job whose workflow does not request readback | Only specified tool calls; no unsolicited scan/READBACK |
| T02 | Workflow explicitly requests readback and stop point | Performs required readback and stops at exact point |
| T03 | First Custom Job invocation after upgrade | Scan/validate/export exactly that Job; callable dispatcher works |
| T04 | Same Job unchanged; then bundle changed | Cache reuse; selective invalidation and rescan |
| T05 | Invalid/unknown helper export | Not advertised callable; Custom Job remains available |
| T06 | FILE-only Temp patch, verified metadata | CAS patch; **zero CAD MCP calls** |
| T07 | HYBRID Temp patch + existing batch updater | Metadata updated, CAD call only via existing tool, no full Job start |
| T08 | CAD-only request to read CAD layers/entities | CAD MCP only; FILE-family denied by design and **not counted as failure** |
| T09 | CAD-only work receives legitimate **metadata-only OR metadata+CAD** Temp | Controlled transition to HYBRID, then FILE (and CAD only if requested); preserved Drawing Binding |
| T10 | Builder FILE → Temp FILE → Builder | Same Work remains, draft untouched |
| T11 | Builder FILE → upgrade → Temp CAD → Builder | New Work handle valid; old stale; Builder draft/source remains |
| T12 | Work upgrade abort, wrong anchor or CAS conflict | Safe failure, no partial out-of-scope edits, old authority remains valid if upgrade failed |
| T13 | Temp Lisp needed | Shared scratch write, validated load, run, cleanup, no Job resource |
| T14 | Tool failure after metadata persist | Reports metadata updated / CAD unsynced; no speculative re-scan or rewind |
| T15 | Normal Job A→B and Direct/Reasoning Job paths | Existing lifecycle and job authority unchanged |
| T16 | User asks for fresh CAD state | Same-turn live CAD read; metadata cache not misrepresented as current CAD |

**Performance acceptance:** record tool counts per scenario, CAD MCP calls, actual full-drawing scan count, redundant prepare/review calls, elapsed duration against baseline. For metadata-complete cases: zero full-drawing scan and no unnecessary Job lifecycle. Time is measured, not assumed.

**Host-only checkpoint** `checkpoint-cadgpt-v2-host-final` is already recorded in GSA J-6B01 NEXT graph: Windows AutoCAD add-in binding/anchor, actual batch Lisp load/update and Builder continuity. Until observed: `PASS_RETEST_REQUIRED`, never fake PASS. Host-only test is **not** a gate preventing independent source coding.

**Merge discipline:** work in a new code branch from verified current `main`, incorporate strict branch selectively; keep `main` working while implementing, verify diff against baseline and reviewer/tester evidence. Merge/deploy only after source regression PASS and appropriate release approval; host tests may be explicitly deferred. Avoid unnecessary blanket compatibility migration.

## 9. Review traceability và non-goals

- Human-corrected CR: **reject** "CAD-only must invoke FILE tools". Correct behavior is refusal. Do not rewrite `tool-policy.ts` for this.
- Accepted CR: Registered callable subtool without whole Job transition → **A2/T03–T05, T07**.
- Accepted CR: Metadata fast path & bounded cross-Job patch → **A3/T06–T07, T12, T14, T16**.
- Accepted CR: Builder Work preserved through Temp task and upgrades → **A4/T09–T13**.
- Accepted CR: Strict Harness conflicts with unconditional reasoning loop → **A1/T01–T02, T15**.
- Real AutoCAD unknown → **A5 host checkpoint**; no new source-review gate.
- No permanent Temp Job, no extra scheduler, no user-facing approval repeats, no broad write scope, no silent editing of promoted Custom Job business logic, no fabricated tool/benchmark.

**Planned order:** A0 → A1; A0 → A3; A1 → A2; A1 + A2 + A3 → A4; all implementation phases → A5. Gate only where one phase needs verified output of another, not by default after every minor change.
