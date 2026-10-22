# CadGPT — kế hoạch đáp ứng Criteria và bỏ gate cản workflow

Ngày 2026-10-23 (giờ Việt Nam). Authority: Human yêu cầu tự tìm lỗi, rà gate, lập lại kế hoạch và thực hiện; `docs/CRITERIA.md` giữ nguyên. Đây là kế hoạch triển khai hiện tại trong chat, không phải GSA Run/reviewer approval hay native acceptance. Nhánh `feature/core-function-v5`; không tự merge/release lượt này.

## Mục tiêu quan sát được

Người dùng chạy Job, nhận lỗi thật, ra đúng `cg/update`, sửa đúng source rồi chạy tiếp mà không bị chặn bởi Work/role/target cũ, đọc hay SHA thủ công. Authoring mới không cần đăng ký, chuyển Work hoặc unlock. Publish chỉ thay capability được chọn. Các chat và Job vẫn độc lập, Operator không tự sửa Engine, runtime/result của Job khác không được ghi.

## Kế hoạch thực hiện

1. **Luồng thực thay vì chỉ guard đơn lẻ.** MCP production initialize → admission → Work → prepare/real Python helper → lỗi → update → đa file repair → rerun; thêm Direct Python, finish(failed), đổi Work, cg/stop rồi update, đổi Job/Lisp và gọi lặp. Test phải RED ở lỗi thực trước sửa.
2. **Scope sửa thuộc operation/target.** Bỏ liên kết grant với generation Work và không bắt gọi lại control/admission khi retry cùng target. Giữ exact Human command và exact root. Nhớ target gần nhất qua failure cleanup, ưu tiên thao tác hiện hành. Hết operation khi done, dừng rõ ràng, bắt đầu Operator run hoặc việc khác; session khác và source khác không thừa hưởng grant.
3. **Bỏ gate không phục vụ quyền.** Runtime đã prepare quyết định helper owner; không dùng ownerId/jobId/Builder label cũ. RUN source path không phải source mutation và không cần Builder unlock. Sửa source không cần SHA từ caller; nếu caller có SHA vẫn kiểm stale, còn không thì hash/CAS nội bộ. New-package authoring không bị khóa bởi target cũ cả Work.
4. **Source/Registry tách biệt.** Canonical publish chỉ index/upsert package được chọn, bảo toàn byte/metadata capability khác, không publish-before-run hoặc auto-publish khi edit. Các route đăng ký/import cả library vẫn thực hiện đúng scope library được người dùng yêu cầu.
5. **Ma trận Criteria đầy đủ.** Đối chiếu các nhóm dưới đây với code/test; chạy full suite và review diff. Hướng dẫn Operator/Builder phải phản ánh behavior sau sửa. Không claim native PASS từ mock/source.

## Ma trận đối chiếu Criteria

| Nhóm yêu cầu | Hành động / chứng cứ cần có |
|---|---|
| Một brain, Human-assist; không thêm planner | Giữ ChatGPT reasoning, không thêm engine điều phối hoặc approval runtime |
| Drawing Workspace/Standalone | Author/run file-only không cần DWG; bind đúng drawing và native test tách biệt |
| Source mới/cg/update saved source | Tests positive creation, exact command, target, foreign/session denial; không draft/checkout/registration |
| Operation-limited unlock | Work renewal giữ repair, Operator/unrelated task/done/session end thu hồi |
| Operator helper/Data vs Engine | Prepared runtime là owner; helper foreign denied; Data không cần update; Engine saved cần exact grant |
| Registry chỉ capability chọn | Hai Job và Lisp entries; publish target không đổi metadata/bytes sibling |
| Read không cần unlock | Public read source managed trước cg/update vẫn thành công |
| Dynamic Engine + Data | Data Lisp/JSON thuộc runtime, Engine byte-identical; không bắt format toàn cục |
| Temp | UUID owner, read/fix, continuation, active cleanup protection, durable results không bị clear |
| Concurrent Jobs/multi-chat | File processing độc lập, same Job exclusion, FIFO chỉ CAD; giữ các regression hiện có |
| Stop/restart | jobstop chỉ runtime; cg/stop là explicit stop, cg/update là explicit restart; không tự reconnect/mất binding |
| Lisp self-check/tool choice | Validator hỗ trợ trước LOAD; không mandatory live TEST hay hierarchy tool; giữ native loaded evidence |
| Save và partial failure | Giữ verified bound Save/error semantics; không retry uncertain mutation |
| Dev vs production | Production không discover/invoke MCP source-write, regression hiện có phải qua |
| CAI/COM→DLL | Không xây CAI/provider hay sửa sâu COM trong đợt này; completion/Save native còn UNVERIFIED |

## Gate giữ lại và lý do cụ thể

Exact source root/session chống sửa nhầm asset trong nhiều chat; canonical path chống alias/symlink sang owner khác; CAS nội bộ tránh hai file writes đè nhau; runtime helper source/hash/input scope tránh chạy helper của Job khác; CAD identity/host FIFO chống sửa nhầm hoặc lệnh AutoCAD overlap; failed Save không được DONE. Tất cả thực hiện phía runtime, không yêu cầu Human orchestrate leases/hash/test ceremonies.

## Hoàn tất và giới hạn

Cập nhật trạng thái từng nhóm bằng kết quả chạy thật sau patch. Các yêu cầu DWG copied/native, header/tray Windows, bền vững qua SaveAs/reopen và native long command không thể kết luận từ Linux. Giữ UNVERIFIED, không thêm gate runtime để che thiếu bằng chứng. Kế hoạch R3/GSA lịch sử và P0 source closure không được giả ghi thành native PASS.

## Kết quả triển khai source

- Đã thực hiện các bước 1–4; test xuyên MCP/Python thật bổ sung cho repair, source/Registry, role và production boundary. Chi tiết và số test cuối cùng được ghi tại `../reports/CADGPT_CRITERIA_REPAIR_2026-10-23.md`.
- Rà toàn bộ Criteria phát hiện thêm prompt compatibility còn hard-block, production Human Power bypass, Create Lisp không bật capability dù yêu cầu tái sử dụng Work, cleanup completed Temp phụ thuộc cả session Work. Đã sửa đúng phạm vi thay vì bỏ owner/host boundaries.
- Phạm vi đang giữ nguyên: host FIFO và binding, Data/Engine ownership, scoped helper execution, Save không được false DONE. Native acceptance chưa được chứng minh, không coi source PASS là tất cả Criteria đã đạt.
