# Cadgpt — bản sửa source guard đầu tiên

Phạm vi: tiếp tục nhóm ưu tiên 1 của `CADGPT_PLAN_REVIEW_2026-10-22.md` theo chỉ dẫn “tiếp tục” của người dùng. Nhánh `feature/core-function-v5`, baseline `eadc45b5f0c993c0977c9047c84c49732688d9b2`. Thay đổi đang ở working tree, chưa commit/push/merge/deploy. Không ghi GSA Run, approval ledger hoặc trạng thái Reviewer/CR chính thức.

## Hành vi đã sửa

- Source Job/Lisp mới do chính logical session tạo được tiếp tục authoring qua Work mới, kể cả sau cleanup Work đầy đủ. Bằng chứng tạo source được giữ theo session và exact owned root, không suy ra từ việc source thiếu Registry entry.
- Source có sẵn/không rõ provenance cần exact `cg/update` cho một target, áp dụng cùng cơ chế cho Job và Lisp trong luồng V5. Lệnh cũ `cg/jobupdate` không còn là unlock; control schema từ chối route cũ. Admission, control, help/menu, README và server instructions được đồng bộ.
- Nếu target đã được Builder chọn thì tái sử dụng; nếu library/folder chỉ khớp một kind thì tự nhận diện Job/Lisp. Chỉ hỏi target/kind khi thực sự thiếu hoặc mơ hồ. Job Python không bị ép phải có JOB.md chỉ để chọn source folder.
- Publication thành công qua managed/import/external-registration chấm dứt exemption của những package thực sự được index, không khóa package unfinished khác trong cùng library. Publication thất bại không tự kết thúc authoring.
- Source edits độc lập vẫn có thể chạy đồng thời. Chỉ publication source/Registry metadata tạo một fence ngắn quanh source I/O; các source writes xếp sau phải kiểm lại quyền sau publication. Job runtime/Data/CAD queue không dùng fence này. Nó không phải dialog, bước test hay gate thao tác mới cho người dùng.
- Logical session kết thúc thì xóa bằng chứng authoring tạm và grant; Work cleanup không xóa provenance authoring mới. Exact target, SHA conflict, canonical path/symlink và foreign-owner checks được giữ.

## Kiểm chứng

Đã xem bốn tests đầu fail đúng lỗi trước khi sửa: continuation Job mới, existing Lisp thiếu guard, publication không kết thúc exemption, command cũ được nhận. Các ca external publication, unfinished sibling và MCP kind inference cũng đã được thấy fail trước bản điều chỉnh tương ứng. Ca tái sử dụng target đã chọn cũng được thấy fail rồi pass.

- `CADGPT_APPDATA_ROOT=/workspace/cadgpt-data npm test`: **288 tests, 288 pass, 0 fail, 0 skipped**, gồm build TypeScript.
- `tests/v5-source-continuation.test.mjs`: 10 tests mới kiểm continuation, source grants, publication, concurrent source I/O và MCP SDK in-memory. Test MCP chạy initialize → admission → control → edit → chọn lại target có sẵn; kiểm route cũ bị từ chối mà Work không bị dừng.
- Các test hiện có được sửa contract từ `cg/jobupdate` sang `cg/update`; test publish/update được tăng assertion DENY trước unlock rồi ALLOW đúng target, không giảm kiểm tra negative.
- Review độc lập đã tìm lỗi external-publication bypass/race ở bản nháp; sau sửa reviewer không còn báo lỗi quan trọng trong fence/lock ordering. Đây là review kỹ thuật của diff, không phải GSA attributed CR PASS.
- `git diff --check`: pass. Control plane cloud được build/reload và smoke HTTP/MCP; schema có `update`, không có `jobupdate`, forged authority bị chặn, FILE work/cleanup pass. Không kích hoạt CAD.

## Giới hạn và việc kế tiếp

Đây là bản sửa nhóm source-authoring/update, không phải tuyên bố Cadgpt đã phục hồi mọi luồng. Temp source read/continuation, legacy tool-surface và skill draft–test–promote, cùng native completion/Save vẫn cần các patch tương ứng trong plan. Không đổi Criteria hay mở lại P0 điều tra.

Provenance authoring hiện chỉ tồn tại trong logical session của runtime. Sau runtime restart, source không có provenance mới trong bộ nhớ được giữ protected; không tự kết luận “chưa đăng ký = mới”. Publication là một sự kiện đã biết kết thúc exemption, không được dùng làm định nghĩa duy nhất của mọi trạng thái source saved/established. Không thêm schema lifecycle bền vững hoặc cơ chế approval mới trong patch này.

Không có Windows/AutoCAD host trong cloud: chưa xác minh COM, bản cài desktop, DWG mutations hoặc native Save. Source/MCP PASS không phải native CAD acceptance hay cho phép release. Bootstrap hooks vẫn staged theo yêu cầu người dùng.
