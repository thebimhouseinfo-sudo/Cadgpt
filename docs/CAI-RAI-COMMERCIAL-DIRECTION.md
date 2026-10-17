# CAI / RAI — Định hướng thương mại và nghiên cứu Cloud Beta

> **Trạng thái:** Định hướng sản phẩm, ghi nhận ngày 2026-10-17. **Không phải lệnh triển khai, không phải plan refactor, không thay thế roadmap kỹ thuật hiện hành.**
>
> **Nguồn:** Các quyết định/trao đổi trực tiếp với chủ sản phẩm. Nội dung được chia thành **đã chốt**, **cần nghiên cứu/kiểm chứng** và **chưa thuộc phạm vi hiện tại** để tránh biến giả thuyết thành yêu cầu kỹ thuật.
>
> **Phạm vi tài liệu:** Lưu tại repository CadGPT để tham chiếu cho hướng thương mại tương lai của **CAI** và, ở cấp hệ sinh thái, **RAI**. Không tự động thay đổi repository RevitGPT.

## 1. Tên gọi, hiện trạng và ranh giới

### Đã chốt

- **CAI = CAD AI**: tên thương mại dự kiến thay cho **CadGPT**.
- **RAI = Revit AI**: tên thương mại dự kiến cho sản phẩm **RevitGPT**.
- Hai sản phẩm **vẫn đang phát triển**. Hiện CAI làm việc với **Autodesk AutoCAD**; RAI làm việc với **Autodesk Revit**. Những tên CadGPT/RevitGPT trong repository, service, command, path và runtime hiện tại **chưa mặc định được đổi**.
- Hệ sinh thái có thể mở rộng về sau sang **BricsCAD** và các ứng dụng **CAD/BIM khác**, nhưng đó chỉ là **định hướng tương lai**; không đưa vào các milestone phát triển hiện tại.
- Việc nghiên cứu thương mại hóa được làm **từng bước, song song và độc lập** với CAI/RAI Core Development. Không mở rộng scope, tạo thêm gate hoặc refactor core chỉ vì tài liệu này.

## 2. Trải nghiệm sản phẩm và phân phối đa nền tảng AI

### Đã chốt

- **ChatGPT là AI client chính thức/ưu tiên** cho phát triển và trải nghiệm CAI; CAI/RAI **không phụ thuộc độc quyền** vào ChatGPT.
- Ưu tiên hỗ trợ **Microsoft 365 Copilot / Copilot Chat dành cho doanh nghiệp** (ứng dụng Microsoft mà nhân viên sử dụng; **không phải GitHub Copilot trong VS Code**). Nhiều công ty kỹ thuật đã có hệ sinh thái Microsoft 365 nên CAI cần tận dụng kênh làm việc và cơ chế quản trị tập trung sẵn có.
- Hỗ trợ thêm **Claude**, và nghiên cứu **Gemini** hoặc AI client khác khi có phương thức kết nối phù hợp.
- **AI provider** chịu trách nhiệm model, reasoning, conversation, hạn mức và chi phí AI. **CAI/RAI** chỉ chịu trách nhiệm công cụ CAD/BIM, kết nối, thực thi local, license và hạn mức sử dụng CAI/RAI. Không xây module theo dõi quota/model/giá của Microsoft, OpenAI hay Anthropic.
- Người dùng không phải **tạo plugin hoặc Cloudflare Tunnel riêng** cho từng cá nhân/máy. Mục tiêu là **một public/distributable integration và một endpoint MCP chung cho từng sản phẩm**, kết nối đến đúng máy của người dùng qua Gateway.
- Cùng một CAI subscription/request balance có thể được dùng từ các AI client được hỗ trợ; không bắt khách mua lại CAI chỉ vì đổi ứng dụng AI.

### Cần nghiên cứu/kiểm chứng

- Mỗi AI provider có **cơ chế xuất bản, phê duyệt, xác thực và hỗ trợ remote MCP khác nhau**. Cùng một MCP backend **không đồng nghĩa** với cùng một gói plugin cài được trên mọi client.
- Đánh giá đường phát hành phù hợp cho **ChatGPT**, **Microsoft 365 Copilot** (agent/connector và quản trị viên tổ chức), **Claude**; Gemini và các client khác tùy khả năng thực tế. Không cam kết tính năng hoặc quyền sử dụng của một gói AI cụ thể trước khi kiểm thử.
- Khả năng công bố Public Plugin và cơ chế phân phối beta phải tuân thủ yêu cầu hiện hành của từng nền tảng; không xem việc có URL MCP là đã phát hành Public Plugin thành công.

## 3. Kiến trúc thương mại mục tiêu

```text
ChatGPT ───────────────┐
Microsoft 365 Copilot ─┼──► CAI Remote MCP endpoint (dùng chung)
Claude / AI khác ──────┘                    │
                                          ▼
                              Cloudflare ingress / Cloud Gateway
                                Auth · Tenant · Quota · Routing
                                          │
                                   Outbound secure session
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
                       CAI Local A                     CAI Local B
                          │                               │
                       AutoCAD A                       AutoCAD B
```

### Đã chốt — nguyên tắc

- **Một endpoint công khai chung, nhiều Local Connectors**. Không yêu cầu một Cloudflare account, tunnel ID hay plugin riêng cho từng khách hàng.
- **Local Connector chủ động kết nối ra Gateway** (giao thức truyền tải cụ thể sẽ thử nghiệm); không mở cổng AutoCAD trực tiếp ra Internet.
- Gateway xác định đúng **organization/tenant, user, device, connection** rồi chỉ gửi yêu cầu đến thiết bị được phép. Hai tổ chức, người dùng hoặc thiết bị không được nhận nhầm lệnh/kết quả của nhau.
- Xử lý AutoCAD/Revit và dữ liệu bản vẽ chính nằm **trên máy khách hàng**. Gateway làm xác thực, cấp quyền, điều phối, đếm/ghi nhận lượt sử dụng và chuyển thông điệp/kết quả cần thiết.
- Giữ nguyên nguyên tắc **drawing/work binding và execution authority** của runtime hiện hành; Cloud Gateway **không thay thế** thẩm quyền CAD local, không tự ý chọn drawing và không bỏ qua các xác nhận an toàn cho lệnh ghi.
- Mỗi thiết bị có định danh/chứng thực riêng; không dùng shared credential nhúng trong tất cả bộ cài, không tin vào user ID/device ID do model tự khai báo.

### Chưa chốt — lựa chọn hạ tầng

- **Cloudflare Tunnel dùng chung tới Gateway tự host** và **Cloudflare Workers + Durable Objects/D1** là những phương án cần đánh giá, **chưa phải quyết định triển khai cố định**.
- Nếu dùng Workers, request quota của Cloudflare tính theo quy tắc dịch vụ cloud tương ứng; nếu chỉ proxy qua Tunnel tới origin không dùng Workers thì **không áp dụng quota Workers chỉ vì đi qua Tunnel**.
- WebSocket/session dài hạn, reconnect, routing state, storage, chi phí, giới hạn free/paid và tải đồng thời phải được **đo bằng beta**, không suy diễn từ số máy cài hay giả định mỗi lệnh luôn đúng một request hạ tầng.

## 4. Subscription, request quota và top-up

### Đã chốt — mô hình kinh doanh

**Subscription theo gói + hạn mức lượt thực thi trong kỳ + mua thêm khi hết hạn mức (top-up).**

- **CAI Request** là đơn vị thương mại: một **lượt gọi thực thi MCP tool hợp lệ** cho CAI, **không phải** HTTP/Workers request nội bộ. Việc tool trả dữ liệu qua response **không tự tạo thêm lượt CAI**.
- AI suy luận/chat mà **không gọi CAI tool**: không tiêu thụ CAI Request.
- Những hoạt động hạ tầng như auth, khám phá tool, heartbeat, reconnect, kiểm tra quota, quản lý phiên: không tự động tiêu thụ CAI Request.
- Một lần thực thi đọc, ghi hoặc ghi rồi trả kết quả đều có thể là **một lượt CAI**. Việc một tác vụ gồm **nhiều lần gọi tool** có thể tiêu thụ nhiều lượt; chưa chốt giá/trọng số riêng cho các tool nặng.
- Phải phân biệt **logical execution/request ID** với số request HTTP/Cloudflare thực tế. Các lượt retry trùng cùng một intent không được tính phí nhiều lần; không được blind retry thao tác thay đổi bản vẽ khi kết quả chưa rõ.
- Gateway phải ghi trạng thái đủ để **reserve/commit/reconcile** quota khi gửi lệnh, thành công, từ chối trước thực thi, mất kết nối hoặc outcome chưa xác định. Không tự tuyên bố exactly-once trong mọi lỗi mạng.
- Quota gói được cấp lại theo kỳ; khách hàng có thể mua thêm credits. Quy tắc chi tiết về thời hạn credits, rollover, đơn giá, giá gói, giới hạn thiết bị và xử lý thất bại **chưa chốt**.

### Hai đối tượng khách hàng

| | Individual | Business / Enterprise |
| --- | --- | --- |
| Chủ sở hữu gói và thanh toán | Cá nhân | **Doanh nghiệp** |
| Người cài đặt | Người dùng nếu được phép | **IT doanh nghiệp triển khai và cập nhật tập trung** |
| Người cấp/thu hồi quyền | Chủ tài khoản | Quản trị viên doanh nghiệp |
| Quota | Gắn với tài khoản | **Pool của tổ chức**, có thể quản lý phân bổ theo user/device |
| Top-up | Chủ tài khoản | Công ty hoặc người được ủy quyền |
| AI client | Client tương thích | Ưu tiên Microsoft 365 Copilot; cũng có thể dùng ChatGPT/Claude |

- Không thiết kế Business theo giả định **nhân viên tự mua CAI/RAI hoặc tự cài phần mềm**: trên máy doanh nghiệp họ thường không được phép làm vậy.
- Hỗ trợ identity của tổ chức, quyền admin, phân quyền user và device, thu hồi truy cập; doanh nghiệp có quyền quản trị việc mua thêm quota.
- CAI và RAI có thể **chia sẻ hạ tầng tài khoản/billing** về sau nhưng quota và quyền sản phẩm cần được phân biệt; **không triển khai chung ngay** nếu chưa cần.

## 5. Language — do AI xử lý

### Đã chốt

- **Không mặc định tiếng Việt theo nơi bán hoặc vị trí của người dùng**; ngay tại Việt Nam cũng có kỹ sư nước ngoài.
- Language mặc định là **Auto**: AI tự thích nghi theo **conversation history mà AI client cung cấp** và **current user input**; ưu tiên yêu cầu ngôn ngữ trực tiếp/gần nhất khi người dùng đổi ngôn ngữ.
- Nếu cần Language Setting thủ công, giữ đơn giản: **Auto (default), English, Tiếng Việt**. Lựa chọn thủ công là tùy chọn override, không phải điều kiện bắt buộc để AI hiểu ngôn ngữ.
- Chỉ cần **một chỉ dẫn ngắn trong system/developer instructions** của từng integration, không xây language detection engine, hệ thống dịch thuật hoặc gate riêng.
- **Không dịch** tên layer, family, block, handle, system, identifier kỹ thuật, dữ liệu CAD/BIM, tên MCP tool hay giá trị do người dùng nhập.
- Gateway **không được mặc định có quyền đọc toàn bộ conversation history** từ ChatGPT/Copilot/Claude; lịch sử để AI suy luận ngôn ngữ là lịch sử **client thực sự cung cấp cho model**.

Ví dụ instruction tham khảo (không buộc chèn nguyên văn):

> Communicate naturally in the user's preferred language based on the available conversation history and current input. Follow explicit language requests and preserve technical identifiers and CAD/BIM data exactly.

## 6. MCP Dev & Repair ở bản thương mại

### Đã chốt

- **Development:** vẫn có thể phát triển, thử nghiệm, sửa chữa và đăng ký/promote các MCP tools đã kiểm chứng trong môi trường dành cho nhà phát triển.
- **Commercial release:** **loại bỏ MCP Dev & Repair khỏi bản phân phối/capability khách hàng**. Người dùng chỉ gọi các MCP tools đã được phát hành và cho phép.
- Công cụ nội bộ dev/repair **không được lộ thành public MCP tool hoặc quyền tự sửa mã nguồn trên máy khách hàng**.
- Việc thêm/sửa MCP tool đưa tới khách hàng thông qua quy trình phát hành/cập nhật sản phẩm, không cho khách tự thay đổi tool registry nội bộ.
- Đây là **ranh giới của commercial build tương lai**; **không phải lệnh xóa tool dev/repair ngay** khỏi bản development hiện tại.

## 7. Nghiên cứu CAI Cloud Beta — nhỏ, tách khỏi Core

### Đã chốt

Cho phép **nghiên cứu dần** và tổ chức **một nhóm beta giới hạn** để kiểm chứng cơ chế dùng chung. Không cần đợi sản phẩm hoàn thiện; không kéo scope Beta thành một chương trình thương mại lớn. Dùng các tool đọc CAD ổn định và fixture/test drawing phù hợp trước khi thử thao tác ghi có kiểm soát.

### Ba giả thuyết tối thiểu phải đo (không phải release gates mới)

1. **Routing:** Một integration/remote MCP endpoint chung điều khiển đúng local device đã ghép cặp; nhiều user, nhiều máy, đồng thời, ngắt và reconnect; không rò rỉ quyền giữa tenant/user/device.
2. **Counting:** Một logical tool execution được ghi đúng một lượt theo chính sách; không đếm vào quota những lần chỉ khởi động/chat, auth/reconnect, yêu cầu bị từ chối trước dispatch; retry và lost response có trạng thái để đối soát.
3. **Distribution:** Cấp quota cho individual và **organization pool**; nhân viên cùng công ty chia sẻ số dư theo quyền; tổ chức khác không ảnh hưởng; thử tiêu hết quota, bổ sung top-up giả lập và concurrency.

**Dấu hiệu beta đủ dùng:** báo cáo được thiết bị nào nhận yêu cầu nào, ledger trước/sau, số dư quota và bất kỳ outcome chưa rõ. Không cần xây checkout, thu tiền thật, storefront, bảng giá hay full admin portal để chứng minh ba cơ chế này.

### Có thể thử sau khi ba cơ chế trên ổn

- Đăng ký/phân phối integration thử nghiệm trên ChatGPT; kiểm tra phát hành theo cơ chế thực tế của nền tảng.
- Thử client **Microsoft 365 Copilot doanh nghiệp**, **Claude** và sau đó các AI client tương thích khác qua cùng Gateway và cùng local app; kiểm chứng MCP protocol/auth/tool invocation/result trên từng client.
- Đo lưu lượng thật để lựa chọn Tunnel-to-origin hay Workers/DO, tối ưu chi phí free/paid khi cần.

**Không tự phát sinh:** milestone/gate mới cho CAI/RAI Core, refactor transport, đổi tên codebase hàng loạt, mở rộng sang BricsCAD/BIM mới hoặc triển khai billing production trong beta.

## 8. Ranh giới dữ liệu, tương thích và quyết định còn mở

- Thiết kế tối thiểu cần bảo vệ phiên đăng nhập, xác thực OAuth/token, tenant isolation, ghép cặp/thu hồi device, chống gửi nhầm kết quả, và an toàn với các lệnh CAD mutating. Không truyền toàn bộ DWG qua cloud nếu không cần.
- **Chưa chốt:** tên miền cụ thể; nhà cung cấp dịch vụ auth/billing; kiểu host Gateway; chính sách credits và đơn giá; số requests cho từng gói; giới hạn số máy/nhân viên; thời điểm đưa vào bản thương mại; hướng phát hành chính xác cho từng AI client.
- **Không suy diễn:** số lượt CAI Requests = số Workers requests; Tunnel Free = hạ tầng vô hạn; một model có sẵn trong Copilot = mọi định dạng MCP/agent đều dùng được không cần tích hợp; AI có toàn bộ lịch sử hội thoại trong Gateway.
- Với mỗi thử nghiệm, chỉ ghi **kết quả quan sát thực tế**, phần chưa thử ghi **UNVERIFIED**. Tài liệu này không chứng nhận capability đã hoàn thành.

## 9. Tóm tắt quyết định

> **CAI/RAI hướng tới nền tảng CAD/BIM automation mở đối với AI client: ChatGPT-first, ưu tiên Microsoft 365 Copilot doanh nghiệp, một remote integration/gateway dùng chung, nhiều local connectors riêng được xác thực; bán theo gói quota tool executions + top-up; doanh nghiệp mua và IT triển khai; ngôn ngữ do AI thích nghi; MCP Dev & Repair chỉ ở Development.**
>
> **Hiện tại:** tiếp tục phát triển core CAI/RAI; có thể nghiên cứu Cloud Beta nhỏ để kiểm chứng routing, counting và quota distribution. Mở rộng CAD/BIM khác và triển khai thương mại toàn diện **chưa nằm trong phạm vi hiện tại**.
