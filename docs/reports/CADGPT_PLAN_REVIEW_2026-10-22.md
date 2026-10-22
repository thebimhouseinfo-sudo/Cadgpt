# Cadgpt — kiểm tra lại plan và gate sau cập nhật

Ngày: 2026-10-22. Người dùng yêu cầu kiểm tra lại code do phiên bản gần đây cản trở workflow; P0 đã đóng. Đây là báo cáo kiểm tra, không phải phê duyệt plan, GSA Run, release hay native AutoCAD PASS. Không thay đổi code ứng dụng, tests, lockfile hoặc Criteria.

## Kết luận

Plan R3 đúng về các nhóm lỗi chính nhưng chưa phải bằng chứng sửa lỗi. Code hiện tại vẫn có điều kiện chặn sai, thiếu API đọc source Temp và hướng dẫn/tool đời cũ mâu thuẫn với V5. Có thể tái hiện một hồi quy source-edit độc lập với AutoCAD. Không có căn cứ từ Linux để kết luận nguyên nhân của mọi lỗi native hoặc rằng sản phẩm đã hoạt động lại.

P0 **đã đóng điều tra source**, theo phần đầu `PHASE0_CLOSURE.md` trong GSA commit `6c58e8f050239b87e1c10e1f2db1e1ab1f366d45`. Phần này supersede handoff REOPENED cũ cho phạm vi điều tra. Không mở lại toàn bộ P0 và không coi đóng điều tra là lỗi đã được sửa. Các dòng BOOTSTRAP trước đây còn ghi reopened là metadata cũ, được đính chính riêng.

## Baseline và phương pháp

- Source: `feature/core-function-v5`, HEAD `eadc45b5f0c993c0977c9047c84c49732688d9b2`; remote branch cùng SHA khi kiểm tra. Main hiện ở `9aaf863...`, bản merge cùng code ứng dụng; chưa xác định phiên bản thực tế đang cài trên máy người dùng.
- Thực thi handler/runtime TypeScript đã build, sử dụng AppData tạm độc lập; kiểm tra qua Work/ToolLease thật. Không mô phỏng kết quả mong muốn bằng predicate tự viết.
- Đọc tool surface từ server MCP thực qua SDK. Không gọi CAD, COM hay sửa DWG.
- So sánh handler trước commit `759feb8` với handler hiện tại trên cùng runtime/fixture; historical source được đặt ngoài checkout, chỉ điều chỉnh đường dẫn import để dùng cùng dependency. Đây là A/B của guard, không phải chạy toàn bộ sản phẩm lịch sử.

## Phát hiện theo tác động

### F1 — P1: Job mới bị xem như Job cần unlock khi đổi Work

Luồng đã chạy: tạo `JOB.md` mới chưa Registry → sửa trong Work tạo nó thành công → kết thúc Work và tạo Work authoring mới trong cùng session → sửa đúng file với hash hiện tại hoặc thêm file `lisp/fix.lsp` vào đúng Job đều bị chặn:

`JOB_UPDATE_EXPLICIT_COMMAND_REQUIRED: cg/jobupdate must authorize this exact existing Job.`

Nguyên nhân: `tools/v5-builder-source.ts:32–37` chỉ nhận new-package marker theo execution; `:99–114` dùng sự tồn tại của folder để kích hoạt guard. `runtime/job-update-grant.ts:42–52` giữ marker trong map execution. Không phân loại source mới đang authoring bằng trạng thái đã thiết lập/saved.

So sánh A/B: handler trước commit `759feb83bb34479f0cb275db26b4a93faf8f7d35` **ALLOW**, handler hiện tại **DENY**, cùng fixture và runtime. Commit 19/10 thêm chính điều kiện này. Đây là hồi quy source xác định được, chưa chứng minh đó là toàn bộ lỗi trên bản Windows đang cài.

Phạm vi sửa tối thiểu đề nghị: khôi phục continuation đúng owner của source mới; chỉ áp dụng unlock cho tài sản đã saved theo nguồn trạng thái có thẩm quyền. Không mở quyền toàn thư viện, không suy ra saved từ folder có tồn tại hay thiếu Registry; không invent thêm dialog.

### F2 — P1: Lệnh bảo vệ source không khớp Criteria

`runtime/job-update-grant.ts:15–18` chỉ nhận exact `cg/jobupdate`. Probe xác nhận `cg/update` trả false, lệnh cũ trả true. Control schema `tools/control.ts:105–125` chỉ có `jobupdate`; MCP thực cũng không có surface update. Quickstart tiếp tục quảng bá lệnh cũ.

Criteria dùng một lệnh `cg/update` cho đúng một Job hoặc Lisp đã saved. Do đó người dùng làm đúng contract vẫn không có unlock đúng. Phạm vi sửa cần đồng bộ admission/control, target selection, guard, public instructions và tests; chỉ đổi chữ trong prompt là không đủ. Không giữ lệnh cũ thành một bypass độc lập.

### F3 — P1: Hướng dẫn/tool cũ còn cạnh tranh với luồng V5

MCP thực công bố 140 tools, trong đó còn `file_temp_lisp_create`, `file_temp_lisp_cleanup`, `lisp_checkout`, `lisp_promote_draft`, `job_checkout`, `job_draft_validate`, `job_promote_draft`.

`skills/write-lisp/SKILL.md:62` vẫn hướng dẫn checkout thành draft; `skills/jobcreate/SKILL.md:349–360` đưa sáu điều kiện và nói promote-draft là đường bình thường duy nhất để ghi Job permanent. Trong khi control prompt và `knowledge/cad/ORCHESTRATOR_HARNESS.md` nói authoring trực tiếp, không bắt buộc draft/test/promote.

Đây là mâu thuẫn source và advertised surface được xác nhận. Nó giải thích cơ chế GPT có thể chọn nhầm luồng; chưa có model/tool trace mới để nói mọi yêu cầu hiện đều bị route sai. Cần thống nhất đường chuẩn và kiểm caller trước khi ẩn API cũ; không xóa source cũ của người dùng.

### F4 — P1: Temp thiếu đường đọc source và khóa vào Work cũ

Probe đăng ký tools xác nhận không có `temp_job_source_read`; server MCP thực cũng không có. Generic path resolver từ chối đọc source trong chính Temp root vì root đó không thuộc managed FILE roots. Sau khi hash thay đổi hoặc context thiếu nội dung hiện tại, vòng đọc → sửa không có typed read chuẩn tương ứng với create/update.

Probe riêng: Temp create/update trong Work ban đầu thành công; Work authoring mới cùng session sửa đúng source với đúng hash bị `TEMP_JOB_NOT_OWNED`. `runtime/temp-job-v5.ts:50–58` so exact owner_execution và owner_session. Chuyển Work thủ công đã được kiểm tra; không đánh đồng mọi MCP transport rotation với việc đổi Work.

Ca âm: session khác bị từ chối đúng. Sửa continuity phải giữ ca âm này; không mở generic FILE vào toàn bộ Temp root hoặc xóa ranh giới owner.

### F5 — P2: Guard vừa chặn quá mức ở Job mới, vừa không thống nhất ở source đã có

`tools/v5-builder-source.ts:33` bỏ qua existing-edit gate cho mọi reusable-lisp. Handler đã sửa một Lisp source có sẵn mà không cần grant update. Fixture này chứng minh bất đối xứng guard, không chứng minh mọi asset published/saved native đều đã được kiểm tra.

Probe khác publish Job trong Work tạo nó rồi update vẫn thành công mà không có update grant. Đây là sự kiện Registry đã quan sát được; không tự coi publication là định nghĩa đầy đủ của saved. Hai kết quả cùng F1 cho thấy map new-package-per-execution không biểu diễn đúng lifecycle sản phẩm.

Không nên xử lý bằng thêm gate mới cho mọi thao tác. Cần một phân loại lifecycle/owner thống nhất theo Criteria, tái sử dụng bằng chứng hiện có trước khi đề xuất metadata mới.

### F6 — Source-confirmed, native impact chưa kiểm: timeout/hoàn thành CAD

`runtimes/cad-mcp/services/lisp_service.py:44–45` còn timeout LOAD/CALL 8 giây; `:283–299` hết deadline sẽ báo lỗi. `tools/jobs.ts:667` còn timeout Direct Python 5 phút. Source còn cơ chế chặn late queued LOAD sau timeout.

Đây là vấn đề WP4 đã dự kiến; chưa được thực thi trên AutoCAD trong lần review này. Không bỏ mọi timeout một cách máy móc, không retry CAD write chưa rõ đã thực hiện; phân biệt connect timeout với thời gian thực thi và xác nhận completion/Save thật.

## Vì sao test xanh nhưng workflow vẫn hỏng

Chạy lại 5 tests hiện có thuộc builder end-to-end, jobupdate grant, Temp lifecycle và MCP surface: **5 pass, 0 skipped**. Tuy nhiên:

- Builder end-to-end chỉ sửa trong cùng Work và còn xác nhận sửa thành công sau publish; không kiểm authoring continuation qua Work mới.
- Jobupdate test khóa contract vào `cg/jobupdate`, không phải lệnh canonical `cg/update` của Criteria.
- Temp lifecycle kiểm create/fix/done trong cùng Work, không thay thế ca continuation/readback.
- Surface contract kiểm capability có mặt, không đảm bảo obsolete tools đã bị loại khỏi đường quảng bá.

Do đó test PASS bảo toàn những contract hiện có, chưa chứng minh contract user đang cần. Cần thêm positive-path oracles bên cạnh ca DENY; không giảm assertions hoặc xem probe phát hiện lỗi là sản phẩm PASS.

## Đánh giá và điều chỉnh plan đề nghị

Giữ Criteria và phạm vi WP1–WP6. Không làm lại P0; WP0 chỉ pin baseline, đối chiếu phiên bản cài thực tế và map caller cần thiết cho patch. Không mở một đợt kiểm kê gate không giới hạn.

| Thứ tự | GOAL người dùng quan sát được | Nhóm plan hiện có | Bằng chứng cần đạt |
|---|---|---|---|
| 1 | Tạo Job mới, chạy thử và tiếp tục sửa đúng Job không bị unlock nhầm; sửa asset đã saved bằng đúng `cg/update` | WP3 + phần route WP1 | F1/F2 có RED rồi GREEN; saved Job/Lisp cần exact target; foreign write vẫn DENY |
| 2 | GPT dùng một luồng authoring/run chuẩn, không tự kéo người dùng qua draft/test/promote | WP1, caller map tối thiểu WP0 | Instructions/tool surface nhất quán; ngữ cảnh “vẽ” không tự tạo permanent asset; legacy callers được xử lý có kiểm soát |
| 3 | Temp có thể đọc, sửa, chạy lại trong continuation hợp lệ mà không mất owner | WP2 | Typed read+hash, own create/read/update, continuation PASS; foreign owner/hash sai DENY |
| 4 | Lệnh CAD thực sự chạy xong và được Save; không báo DONE hay timeout giả | WP4 + kiểm native liên quan | Source integration trước, copied-DWG completion/Save sau; không replay uncertain writes |
| 5 | Job cũ, bind và multi-chat chạy ổn sau các patch cụ thể | WP5/WP6 | Ca tích hợp tập trung từng luồng; native Windows PASS/FAIL rõ, release chỉ theo Human decision |

Không coi WP4 là điều kiện phải hoàn tất mới được điều tra/sửa một lỗi bind/multi-chat độc lập đang chặn user. Không đổi cả kiến trúc concurrency vì thấy `JOB_RUNTIME_BUSY`: source hiện dùng runtime root của cùng Job, nên phải kiểm contention thực và bảo vệ dữ liệu trước khi thay đổi exclusion.

Các probe tập trung nêu trên là regression tasks cần có trong patch tương ứng; không cần dựng test framework mới hoặc chạy hết native acceptance để cho phép sửa source. Native acceptance là bằng chứng hoàn tất chức năng/release, không phải gate chặn điều tra hoặc sửa bug.

Plan vẫn candidate; báo cáo này không tự ghi Reviewer/CR PASS, không thay GSA lifecycle/approval. Chưa cập nhật implementation plan có phê duyệt mới và chưa dispatch code.

## Artifact và khả năng lặp lại

- `/workspace/cadgpt-cloud/review-gates.mjs` và `review-gates-results.json`: 9 quan sát source thực thi có ca kiểm soát.
- `/workspace/cadgpt-cloud/compare-builder.mts`, `builder-before-759feb8.mts`, `review-builder-ab.json`: A/B guard trước commit gây hồi quy.
- `/workspace/cadgpt-cloud/review-tool-surface.json`: tool discovery thực tế.
- Chạy probe: `node /workspace/cadgpt-cloud/review-gates.mjs`; A/B: `/workspace/Cadgpt/node_modules/.bin/tsx /workspace/cadgpt-cloud/compare-builder.mts`.

Giới hạn còn lại: chưa có bản build/log/call trace từ Windows của người dùng, không có AutoCAD host ở cloud. Các hành vi native, startup/connect và toàn bộ lỗi “gần như không hoạt động” vẫn cần kiểm chứng theo phiên bản và thao tác thực tế; không tự gán tất cả cho một commit.
