# CadGPT — Temp, public authoring và bound Save

Ngày 2026-10-22. Nhánh `feature/core-function-v5`, baseline `eadc45b5f0c993c0977c9047c84c49732688d9b2`. Người dùng yêu cầu tiếp tục phần không phụ thuộc chuyển COM → DLL; chỉ sửa CAD execution/Save nếu nhỏ. Thay đổi ở working tree, chưa commit/push/merge/deploy. Không đổi Criteria, không mở lại P0 điều tra, không ghi approval hay GSA CR PASS.

## Phần đã hoàn thành

1. **Temp continuation và đọc source:** thêm `temp_job_source_read` trả đúng text, bytes, SHA-256. Session tạo Temp có thể tiếp tục sửa sau Work cleanup bằng Work hiện hành. Execution cũ và session khác vẫn bị chặn. Metadata được bảo vệ cả tên khác hoa/thường; source hoàn tất không được sửa. Read/create/update/result/done/cleanup được phối hợp bằng lock của Temp root; cleanup không xóa source khi session có Work kế tiếp hoặc ToolLease đang chạy dù Work cũ đã closing. Giữ kiểm tra canonical path, symlink, CAS và owner của kết quả.
2. **Public tools V5:** ẩn 10 API cũ khỏi MCP list, MCP invocation và Tool Registry: `job_draft_new`, `job_checkout`, `job_draft_validate`, `job_promote_draft`, `job_run_direct_draft`, `lisp_checkout`, `lisp_draft_validate`, `lisp_promote_draft`, `file_temp_lisp_create`, `file_temp_lisp_cleanup`. Các implementation cũ còn trong source để kiểm compatibility nội bộ; không còn là entrypoint công khai. Source authoring dùng `v5_source_create/update/publish`, Temp dùng API riêng.
3. **Scaffold:** trả nội dung và optional `source_target` trong final owner folder, không gợi ý draft, không cần tạo library trước và không ghi file. `lisp_validate` nhận đúng một trong raw `source` hoặc managed `path`, cùng validator hiện có.
4. **Hướng dẫn và callers:** đồng bộ jobcreate/write-lisp, harness và coding guidance, Job rules, Orchestrator, README và compatibility guide với V5. Yêu cầu thực hiện công việc thông thường không tự chuyển thành permanent authoring. Không áp đặt chuỗi draft/test/promote hay scan compatibility trước RUN. Giữ quy tắc TBH HVAC, import read-only, exact source grant, runtime ownership và evidence thật. Không tăng epoch lịch sử thành release gate. Hai CI authoring smoke cũ dùng draft được thay bằng test MCP SDK V5; HTTP smoke Windows phase1 được cập nhật discovery assertions. Các bước setup/build và HTTP/session smoke còn lại được giữ.
5. **Save nhỏ, không đổi COM:** `cad__acad_save_bound_document` không nhận document identity từ caller; proxy buộc ID bản vẽ đã bind. Chỉ ghi Save witness khi backend xác nhận `saved:true` cho đúng identity; sai bằng chứng trả `BOUND_SAVE_UNVERIFIED`. Retry thất bại không giữ witness cũ. Invalidation trong host lock xử lý cả trường hợp hai Save xếp hàng. Không đổi hàng đợi native, timeout hoặc cơ chế thực thi COM.

Bản source-guard trước đó vẫn được giữ; xem `CADGPT_SOURCE_GUARD_FIX_2026-10-22.md`.

## Kiểm chứng

- Các lỗi Temp continuation/read, public tool retirement, scaffold và Save schema được thấy RED trước khi sửa, rồi GREEN.
- `CADGPT_APPDATA_ROOT=/tmp/cadgpt-validation-data npm test`: **300 tests, 300 pass, 0 fail, 0 skipped**, gồm build TypeScript. Lần đầu chạy không đặt managed AppData root thất bại do default root ngoài workspace; lần kiểm chứng dùng root riêng có quyền ghi, không sửa runtime để né quyền filesystem.
- Test MCP SDK chạy initialize/admission/Work/source edit/publication/Temp correction trên server production qua in-memory transport. Kiểm negative retired calls, generic managed-source writes và Registry isolation.
- Temp tests có Unicode/hash, Work continuation, stale/foreign denial, metadata/traversal, symlink escape, completed mutation, cleanup trong successor Work và closing session có ToolLease.
- Save tests dùng backend mô phỏng, kiểm forced bound identity, mismatched evidence, exception/error, và hai Save overlap: A thành công, B xếp hàng rồi lỗi, witness cuối phải false.
- Review độc lập tìm Save overlap race; đã sửa và reviewer xác nhận khép lỗi. Không có finding quan trọng khác trong phạm vi Temp/surface/scaffold review.
- Reload control plane cloud; HTTP MCP smoke qua với **131 public tools**, `update` có / `jobupdate` không có, 10 retired tools vắng mặt, Temp read có, forged authority bị chặn, admission/FILE Work/roots/cleanup qua; CAD không được kích hoạt.
- Workflow YAML parse và `git diff --check` qua. Chưa chạy Windows PowerShell/GitHub Actions runner.

## Còn lại theo chỉ dẫn COM → DLL

- Để đợt DLL xử lý cơ chế native CAD execution/completion, command dispatch, timeout và queue liên quan COM; không vá sâu cơ chế sắp thay thế.
- Sau khi có Windows/AutoCAD host: kiểm copied-DWG load/run, completion, Save/readback, lỗi/partial output và binding identity qua native host. Cloud Linux không chứng minh các mục này đã hoạt động.
- Caller hoặc Job cũ còn tham chiếu 10 API đã retired cần chuyển rõ sang V5 khi được sử dụng/được yêu cầu sửa; không tự rewrite toàn bộ thư viện người dùng hay bật migration gate.
- Chưa có trace hội thoại người dùng mới để khẳng định mọi trường hợp GPT chọn nhầm luồng đã hết. Source/MCP regression đã có; native và end-user acceptance còn cần kiểm chứng.

Bootstrap hooks vẫn staged, không được kích hoạt khóa trong lượt này.
