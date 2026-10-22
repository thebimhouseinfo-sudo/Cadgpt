# CadGPT — đối chiếu Criteria và sửa workflow

Ngày 2026-10-23 (giờ Việt Nam). Authority: Human yêu cầu tự tìm bug/gate, lập lại kế hoạch, thực hiện và đáp ứng toàn bộ Criteria. Đã đọc toàn bộ `docs/CRITERIA.md`; nội dung Criteria giữ nguyên. Kế hoạch hiện tại: `../plans/CADGPT_CRITERIA_REPAIR_2026-10-23.md`.

Nhánh `feature/core-function-v5`, HEAD nền `ac436a1`. Bản sửa hiện ở working tree, chưa commit/push/merge. Không ghi GSA approval, CR PASS, release hay native acceptance. Hooks Bootstrap vẫn staged.

## Kết quả chính

Đã tái hiện và sửa các đường lỗi thực qua MCP production server, không cần Human cung cấp bug. Source/runtime gate chỉ còn dùng đúng ownership/operation, thay vì buộc người dùng đi theo nhãn Work hoặc thủ tục nội bộ.

| Sai lệch tìm được | Hành vi sau sửa |
|---|---|
| Work mang jobId/ownerId cũ chặn helper của runtime vừa prepare | Runtime hiện hành quyết định owner; helper chỉ được chạy từ tools của đúng Job đó |
| finish(failed) xóa context làm cg/update mất target | Giữ selection source gần nhất trong logical session; không cấp quyền ghi chỉ vì nhớ selection |
| Builder target cũ thắng Job vừa chạy hoặc Lisp vừa chọn | Selection theo thao tác hiện hành; command chọn target mới thay context cũ |
| Grant bị buộc executionId, Work renewal bắt unlock lại | Repair cùng operation/target tiếp tục qua Work; stale/foreign credentials vẫn bị chặn |
| Retry control/admission làm mất grant hoặc bắt Human nhập lệnh lại | Retry cùng target idempotent; đổi saved target vẫn cần exact Human command |
| cg/update sau cg/stop không thể bắt đầu Work | cg/update được nhận là một explicit workflow restart |
| RUN source path bị chặn bởi nhãn Builder, target cũ, hoặc điều kiện absolute path sai trên Linux | Managed source RUN không cần quyền sửa source hay đăng ký trước; boundary filesystem vẫn giữ |
| Sửa source bắt caller có SHA | Source API tự snapshot/CAS; caller revision tùy chọn vẫn phát hiện stale; không yêu cầu Human hash |
| Target Builder bị khóa cả Work | Có thể tạo package mới khác trong cùng Work; grant update-only không cho tạo foreign package |
| cg/cl yêu cầu reuse Work nhưng không bật author capability | Bật capability nội bộ trên Work tương thích, không replace/rebind hay thêm dialog |
| Quyền sửa còn theo Operator hoặc unrelated operation | Registered/Internal Operator dispatch, explicit stop, done, publication hoặc chọn source khác thu hồi grant; session end xóa toàn bộ |
| Publish quét lại cả library, sửa metadata sibling và công bố helper/runtime như Jobs | Canonical Publish chỉ index/upsert package đang chọn; JOB.md đại diện package, helpers/runtime không thành Jobs độc lập; siblings được giữ nguyên |
| Completed Temp cleanup bị chặn bởi Work còn hoạt động | Dọn Temp đã xong khi riêng runner/LOAD của nó không còn dùng source; Temp khác và Work tiếp tục |
| Temp LOAD có drawing_id khiến tracking quên Temp id | Lease giữ Temp identity trước drawing id, cleanup không xóa source đang LOAD |
| Prompt compatibility vẫn tuyên bố hard-block/scan trước RUN | Instructions/welcome chỉ còn diagnostic notice, không yêu cầu scan/migration/test/promote trước RUN |
| Production công bố và bật Human Power source-policy bypass | Chỉ development đăng ký/quảng bá bypass; production chặn cả activation qua admission và shared core API |
| Dynamic Lisp legacy patch ghi persistent Engine bất kỳ chỉ bằng job_id | Persistent Engine seed/patch dùng cùng exact cg/update root, canonical resolver và source fence; existing Engine read/reuse không cần unlock; runtime Data không bị source gate |

Không thêm permanent Operator lock: trong lúc registered Operator đang chạy, owner label Builder cũ không tự cấp authoring; explicit Create Job/Lisp có thể chuyển nhiệm vụ trên Work hiện hành. Khi Job xong, một Work Builder gốc có thể tiếp tục authoring mới. Saved-source grant đã hết không được khôi phục từ ownerId.

## Đối chiếu toàn bộ nhóm Criteria

| Criteria | Chứng cứ hiện có / giới hạn |
|---|---|
| Drawing-centric, một AI brain, Human-assist | Không thêm planner/controller/CAI. Source routing vẫn theo tác vụ, không tạo workflow engine mới. Chất lượng reasoning của model cần quan sát hội thoại thật |
| Standalone + Drawing Workspace | Test author/source RUN/helper không cần DWG; các regression binding/multi-chat qua. Native kết nối/header và hành vi DWG còn UNVERIFIED |
| New authoring, exact saved-source update, unrestricted reads | MCP tests tạo hai package cùng Work, source read foreign library không unlock, target-only update, multi-file helper repair, retry/renewal; không draft/checkout/registration gate |
| Scope operation/session, Operator/Builder | Test expiry khi registered/Internal Operator bắt đầu, done/publish, target change; stale token denied; Create Lisp trên existing Work. Generic owner/result boundaries vẫn qua |
| Registry metadata only target | Hai Job và hai Lisp capabilities, sibling metadata có trường custom giữ nguyên, source sibling byte-identical; existing publication recovery suite qua |
| Dynamic stable Engine + per-run Data | Runtime .lsp/JSON được ghi không update; Engine foreign byte-identical; legacy Engine patch không bypass source authority. Native Engine consume Data còn UNVERIFIED |
| Direct/Lisp/Macro/Engine nomination theo suitability | Sửa tool-mapping từ fixed hierarchy/source derivative sang contextual choice; không thêm family escalation gate. Model choices/native latency cần acceptance thật |
| Temp independent workflow | Read/correction không cần caller SHA, continuation, active/completed cleanup và per-target runner tracking; durable-result boundary regressions giữ nguyên |
| Job autonomy/CAD host ordering | Existing multichat, same-Job exclusion, Direct Python FIFO/file-only processing, lifecycle và Job Steps regressions qua. Không thêm lock toàn Work/Job; native queue/completion chưa xác minh |
| Stop/resume, CAD→SYSTEM→CAD | Existing lifecycle/binding/handoff tests qua; cg/update sau stop và helper tiếp tục được test thật qua MCP/Python |
| Write Lisp tự kiểm trước LOAD | Shared validator giữ nguyên; hướng dẫn không ép draft/live-test/promote. Không coi validator PASS là AutoCAD loaded PASS |
| Persistence/real Save/no false DONE | Giữ bound Save/Save-failure regression, không bỏ evidence hay retry uncertain writes. Native copied-DWG Save/readback còn UNVERIFIED |
| Development vs production | MCP discovery/invocation/admission production negative test, core activation block, development tests vẫn qua; docs Human Power đánh dấu internal |
| CAI và quy mô chưa chốt | Không xây CAI/provider/API-direct, RBAC/quota/SaaS hay đổi stack. COM→DLL và native completion sâu theo hướng đã được Human yêu cầu để sau |

## Gate giữ lại — trường hợp, thiệt hại và scope tối thiểu

- **Exact Human cg/update + source root/session:** nhiều Jobs/Lisp/chats cùng tồn tại nên sửa nhầm asset là tình huống thực; grant chỉ áp dụng một source operation và không cản read/new author/RUN.
- **Canonical path/alias boundary:** source helper hoặc thư mục junction có thể trỏ sang Job khác; resolver kiểm đúng owner ngay trước ghi, không mở quyền cả library.
- **Internal CAS:** hai tool calls hoặc editor cùng sửa source có thể đè mất nội dung; server snapshot/compare dưới lock target. Caller không phải đưa proof hay Human nhập hash.
- **Helper runtime/source/input scope:** Work được reuse nhưng helper chạy nhầm Job sẽ ghi sai runtime/result; prepared runtime và source/hash/input identity bảo vệ đúng lần thực thi, không đòi đổi Work.
- **CAD host FIFO + bound identity + verified Save:** AutoCAD không hỗ trợ command overlap an toàn và ActiveDocument có thể đổi; gate chỉ áp dụng CAD operation/Save, không khóa independent file work.
- **Temp in-use protection:** runner/queued LOAD còn dùng file thì cleanup có thể phá tác vụ; chỉ giữ Temp đang active hoặc đúng Temp lease đang dùng source. Completed Temp khác không bị chặn bởi Work/session chung.
- **Production dev-source boundary:** Criteria cấm end-user MCP repair capability; production không quảng bá hay bật bypass. Không thêm bước mới cho việc CAD thông thường.

## Kiểm chứng cuối

- `CADGPT_APPDATA_ROOT=/workspace/cadgpt-data npm test`: **329 tests, 329 pass, 0 fail, 0 skipped**, gồm TypeScript build.
- **27 test MCP mới** trong `tests/v5-job-repair-flow.test.mjs`: SDK in-memory transport nhưng server/authority/tools/storage là code production; helpers/Direct Python thực sự chạy, tạo ValueError rồi được sửa và chạy lại. Không mock kết quả thực thi Python.
- Hai test Temp bổ sung: completed cleanup bảo vệ runner đúng target; Temp CAD identity không bị drawing_id che mất. Existing Temp lifecycle được sửa để không tiếp tục khẳng định gate Work-wide là yêu cầu đúng.
- Các vấn đề chính được thấy RED trước patch tương ứng, rồi GREEN. Những assert cũ buộc Builder-only source RUN, new-target DENY hoặc completed-Temp DENY được cập nhật theo Criteria; negative foreign writes/Engine/token/hash vẫn kiểm.
- Python source check: 34 files compile in-memory; bundled Lisp registry 64 files qua; shared Lisp smoke syntax qua. Có SyntaxWarning có sẵn trong docstring script Python, không phải failure.
- Reload cloud control plane từ build cuối; HTTP/MCP smoke qua: health, 131 public tools ở cloud development context, admission, forged-authority denial, FILE Work/roots/cleanup; CAD vẫn ngủ. Production boundary được kiểm riêng dưới profile production.
- `git diff --check` qua. Review độc lập phát hiện Internal Job expiry và Temp LOAD identity gap; đã sửa, reviewer xác nhận. Rà lại Dynamic Engine delta không có finding quan trọng mới. Đây không phải GSA attributed CR PASS.

## Còn lại để chốt toàn bộ Criteria

Không tuyên bố toàn bộ Criteria đã đạt: cloud Linux không có AutoCAD thật, nên native copied-DWG changes, actual completion, Save/reopen, native long-command/queue, Windows tray/add-in và sustained multi-chat UX vẫn **UNVERIFIED**. Code native completion/timeout sâu không được thay thế bằng mock PASS; tiếp tục theo phạm vi COM→DLL mà Human đã nêu.

Chưa tự sửa thư viện Job/Lisp cục bộ trên máy Windows hoặc tự đổi business steps của họ. Job cũ dùng persistent Engine patch để truyền Data cần được sửa rõ sang runtime Data trong đúng target khi Human yêu cầu; không tạo global migration/compat scan gate. Phần đã làm là đáp ứng các boundary source và workflow hiện có, không âm thầm thay workflow nghiệp vụ.

Không tự commit/merge/push bản sửa hiện tại: các lần merge trước chỉ công bố phiên bản trước. Human có thể duyệt tích hợp bản hiện tại sau khi xem kết quả; không có release/native approval mới được suy ra.
