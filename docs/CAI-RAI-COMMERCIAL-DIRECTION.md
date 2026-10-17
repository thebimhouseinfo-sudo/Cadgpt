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

- **ChatGPT là AI client chính thức/ưu tiên** cho phát triển và trải nghiệm CAI; CAI/RAI **không phụ thuộc độc quyền** vào ChatGPT. **Định danh sản phẩm không phụ thuộc AI backend:** CAI/RAI là các Autodesk Add-in có panel; MCP-backed và Native AI là hai hướng kỹ thuật ở dưới cùng sản phẩm, không phải hai SKU/add-in buộc khách hàng tự chọn.
- Ưu tiên hỗ trợ **Microsoft 365 Copilot / Copilot Chat dành cho doanh nghiệp** (ứng dụng Microsoft mà nhân viên sử dụng; **không phải GitHub Copilot trong VS Code**). Nhiều công ty kỹ thuật đã có hệ sinh thái Microsoft 365 nên CAI cần tận dụng kênh làm việc và cơ chế quản trị tập trung sẵn có.
- Hỗ trợ thêm **Claude**; bổ sung **Grok (xAI)** làm ứng viên nghiên cứu beta vì ứng dụng Grok Web hỗ trợ Custom Remote MCP Connector. **Gemini: DEFERRED / không ưu tiên beta**, do Custom MCP trong Gemini Apps chưa phù hợp phân phối phổ thông/doanh nghiệp tại Việt Nam và đường Gemini Spark có rào cản chi phí/điều kiện truy cập. Qwen Chat, DeepSeek Chat và AI client khác chỉ tiếp tục theo dõi.
- **Remote MCP Mode:** nền tảng AI bên thứ ba (ChatGPT/Copilot/Claude...) tự chịu trách nhiệm model, reasoning, conversation, quota và chi phí AI; CAI/RAI không xây module quản lý quota nhà cung cấp của họ. **Native AI Mode thương mại:** CAI/RAI **là bên bán dịch vụ AI tích hợp**, chịu trách nhiệm chọn/điều phối model, trả phí inference theo hợp đồng với upstream (hoặc cung cấp bundle model cho AI server doanh nghiệp), quản lý chi phí và AI credits của CAI/RAI. Hai mô hình trách nhiệm khác nhau, không gộp.
- Người dùng không phải **tạo plugin hoặc Cloudflare Tunnel riêng** cho từng cá nhân/máy. Mục tiêu là **một public/distributable integration và một endpoint MCP chung cho từng sản phẩm**, kết nối đến đúng máy của người dùng qua Gateway.
- Cùng một CAI subscription/request balance có thể được dùng từ các AI client được hỗ trợ; không bắt khách mua lại CAI chỉ vì đổi ứng dụng AI.

### Cần nghiên cứu/kiểm chứng

- Mỗi AI provider có **cơ chế xuất bản, phê duyệt, xác thực và hỗ trợ remote MCP khác nhau**. Cùng một MCP backend **không đồng nghĩa** với cùng một gói plugin cài được trên mọi client.
- Đánh giá đường phát hành phù hợp cho **ChatGPT**, **Microsoft 365 Copilot** (agent/connector và quản trị viên tổ chức), **Claude**, **Grok**; các client khác chỉ tái đánh giá khi khả năng sử dụng thực tế đáp ứng thị trường mục tiêu. Không cam kết tính năng hoặc quyền sử dụng của một gói AI cụ thể trước khi kiểm thử.
- **Grok (đã xác nhận tài liệu, chưa E2E CAI):** xAI hỗ trợ thêm Custom MCP server URL trên ứng dụng Grok Web và xác thực tương ứng; cần thử thực tế tool discovery, OAuth, thực thi và routing. Nguồn chính thức: https://docs.x.ai/grok/connectors và https://x.ai/news/grok-connectors (2026-05-06).
- **Gemini (DEFERRED — không đưa vào CAI Cloud Beta):** Google có tài liệu về cách kết nối MCP URL trong Gemini Apps, **không đúng khi khẳng định Gemini hoàn toàn không hỗ trợ Custom MCP**. Tuy nhiên, hướng dẫn hiện giới hạn ở **tài khoản Google cá nhân tại Mỹ, từ 18 tuổi, tiếng Anh và bật Keep Activity**, chưa hỗ trợ tài khoản công ty/trường học. Tài liệu khác của Google gắn kết nối custom với **Gemini Spark**, là đường trả phí/điều kiện truy cập không phù hợp về kinh tế và trải nghiệm với CAI hiện tại. Chưa có cơ sở khẳng định luôn cần phê duyệt để thêm bất kỳ MCP nào; cần phân biệt giới hạn quyền truy cập với quy trình phê duyệt phát hành công khai. **Không triển khai/kiểm thử Gemini trong beta hiện tại**; chỉ tái cân nhắc khi có Custom MCP cho người dùng và doanh nghiệp tại thị trường mục tiêu với chi phí phù hợp. Nguồn: https://support.google.com/gemini/answer/17209137 và https://support.google.com/gemini/answer/17094507 .
- **Qwen / DeepSeek (chưa xác nhận trong consumer chat):** **Qwen Code** có Remote MCP (https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/); **DeepSeek Harness** có MCP client (https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md). Đây là các **developer/harness clients**, không phải bằng chứng rằng ứng dụng **Qwen Chat** hoặc **DeepSeek Chat** có cơ chế thêm Remote MCP tương tự Grok. Giữ ở trạng thái **WATCH / UNVERIFIED consumer app**, không kết luận các model không thể gọi tool.
- Khả năng công bố Public Plugin và cơ chế phân phối beta phải tuân thủ yêu cầu hiện hành của từng nền tảng; không xem việc có URL MCP là đã phát hành Public Plugin thành công.

### Hướng nghiên cứu bổ sung: Native Add-in + CAI/RAI-managed AI (CANDIDATE)

**Quyết định sản phẩm (2026-10-17):** Native AI Mode là **dịch vụ AI tích hợp do CAI/RAI quản lý**, không phải môi trường để người dùng chọn nhà cung cấp, model, API endpoint hoặc nhập API key. **Nhà phát triển CAI/RAI chọn sẵn model phù hợp**, có thể phối hợp nhiều cloud API hoặc self-hosted model; người dùng chỉ tương tác với **CAI AI / RAI AI** và mua gói/AI credits. Chi tiết model/routing là cấu hình nội bộ, **không hiển thị trên giao diện người dùng**. AI inference diễn ra bên ngoài CAD host; tool dispatcher/CAD execution vẫn nằm trên máy kỹ sư. **Không có Cloudflare Tunnel/Public Plugin/Cloud MCP Gateway trên đường điều khiển CAD trong Native AI Mode.**

```text
CAI Add-in (AutoCAD) / RAI Add-in (Revit)
  ├── Native Chat UI + scripted workflow/state-machine engine
  │    └── Chỉ gọi AI ở các step cần suy luận hoặc xử lý ngữ nghĩa
  ├── CAI/RAI-managed model router (không có user model picker)
  │    ├── CAI AI Proxy → contracted cloud API provider(s)
  │    ├── [Business] CAI-approved bundle → company Ollama/API server qua LAN/VPN
  │    └── [không khuyến nghị mặc định] model trên cùng workstation
  └── Local tool dispatcher → local CAD/BIM Core → AutoCAD / Revit

Model response / tool call → Local dispatcher → CAD/BIM result → Model API
```

#### Những nguyên tắc đã chốt

- **Provider-agnostic nội bộ:** CAI/RAI có adapter để **nhà phát triển** cấu hình providers, endpoints, model profiles, credentials và routing; **không cung cấp model picker, BYOK/API-key settings hoặc custom API URL cho người dùng bản thương mại**. DeepSeek/Ollama Cloud chỉ là ứng viên upstream. Không giả định mọi API/model có tool-calling giống nhau; mỗi cấu hình phải được kiểm thử/kiểm soát.
- **Cloud AI do CAI/RAI cung cấp:** Native Add-in gửi inference qua **CAI/RAI AI Proxy** (HTTPS) tới các upstream providers đã được chọn và có quyền thương mại phù hợp; upstream credentials chỉ lưu phía server. Local Add-in nhận tool/function calls, kiểm tra quyền rồi thực thi CAD/BIM. **Không có BYOK trong trải nghiệm khách hàng thương mại.**
- **Shared local AI server cho doanh nghiệp (hướng triển khai riêng):** IT có thể triển khai **máy chủ AI/GPU riêng** (ví dụ Ollama) trong LAN/VPN để nhiều workstation dùng chung, nhưng **CAI/RAI phát hành và kiểm soát model bundle/profiles và routing được hỗ trợ**; khách hàng không tự chọn model. IT quản lý cơ sở hạ tầng, không phải model selection. Cấu hình thực tế, hợp đồng hỗ trợ và năng lực vận hành vẫn cần nghiên cứu; không bắt buộc tunnel.
- **Model local trên workstation:** về mặt kỹ thuật có thể nếu máy đủ mạnh, nhưng **không coi là mặc định hoặc phương án mục tiêu**. AutoCAD/Revit đã dùng nhiều CPU, RAM và đôi khi GPU; chạy LLM nặng cùng máy có thể làm giảm hiệu suất thiết kế. Chỉ xem là ngoại lệ thử nghiệm tùy cấu hình.
- **Ollama là một API server:** hỗ trợ REST API, tool calling và một **phần** OpenAI-compatible API, ví dụ local `http://localhost:11434/v1/` khi chạy cùng host (cấu hình địa chỉ theo triển khai thực tế). Ollama mặc định bind localhost; LAN deployment do IT quản lý, không tự mở port ra public Internet. Tham khảo: https://docs.ollama.com/api/openai-compatibility , https://docs.ollama.com/capabilities/tool-calling , https://docs.ollama.com/faq .
- **Bảo mật LAN:** không coi token placeholder của API-compatible Ollama là xác thực thật. Với máy chủ dùng chung cần giới hạn mạng, phân quyền truy cập, TLS/authenticated reverse proxy hoặc biện pháp tương đương do IT quản lý; không chia sẻ server trần ra Internet. Doanh nghiệp quyết định chính sách xử lý dữ liệu dự án và AI usage.
- **Không lẫn với Remote MCP Mode:** native mode không cần ứng dụng DeepSeek Chat / Qwen Chat hỗ trợ Custom MCP và không dùng cloud để route các CAD tool calls. Nếu cần kiểm tra license/quota thương mại, có thể sử dụng **kênh HTTPS license/usage riêng**, không nằm trong đường thực thi CAD. Đơn vị CAI/RAI request thương mại và chi phí token/model inference là hai khái niệm riêng; chi tiết local ledger, offline policy và chống gian lận chưa chốt.
- **CAI/RAI Core vẫn là authoritative executor:** mọi model tool call cần qua local allowlist, quyền user, đúng drawing/document binding, xác nhận khi thay đổi dữ liệu và readback. Không cho model gửi lệnh CAD tùy ý vượt các contract đã có.
- **Native Add-in chưa hoàn thiện:** Add-in CadGPT hiện tại chủ yếu host ChatGPT; **native chat orchestration**, bộ điều phối model nội bộ, AI Proxy/AI credits và shared Ollama server là **các khả năng tương lai cần nghiên cứu**, không phải chức năng đã sẵn có.

#### Kênh phân phối chính thức: một CAI/RAI Add-in trên Autodesk Marketplace (định hướng thương mại đã chốt)

**Làm rõ quyết định (2026-10-17):** **CAI cho AutoCAD** và **RAI cho Revit** là **mỗi sản phẩm một Add-in có panel tích hợp vào phần mềm Autodesk**, có thể đóng gói và đề xuất phát hành/bán trên **Autodesk Design and Make Marketplace** (Autodesk App Store trước đây). **Không bắt buộc chuyển AI sang Native API mới được phát hành.** Kiến trúc hiện tại với **panel tích hợp + MCP/local tool layer bên dưới** đã là dạng Add-in phân phối được về nguyên tắc, nếu đáp ứng review, packaging, licensing và các điều kiện Marketplace. Native AI chỉ là **một cách vận hành nội bộ có thể phát triển về sau**, **không phải SKU/sản phẩm độc lập cần giới thiệu hoặc bán tách riêng**.

```text
           AUTODESK MARKETPLACE
              CAI Add-in / RAI Add-in
                       │
                       ▼
         AutoCAD / Revit — Integrated Panel
                       │
       ┌───────────────┴────────────────┐
       │                                │
 [Current MCP-backed mode]     [Future Native AI mode]
 Panel + AI client/MCP          Panel + managed API inference
 + remote integration           + script-first orchestration
       │                                │
       └───────────────┬────────────────┘
                       ▼
         Local CAD/BIM Core + tool execution
                       ▼
                Active DWG / RVT
```

- **Một sản phẩm, nhiều cơ chế AI:** customer-facing offering là **CAI** hoặc **RAI**. MCP-backed mode và Native AI mode là **implementation modes / phiên bản năng lực nội bộ**, không quảng bá thành hai ứng dụng khác nhau, không bắt khách mua lại add-in chỉ vì thay backend. Mức hỗ trợ và quyền sử dụng thực tế theo license/gói sẽ thiết kế sau; **không ngầm cam kết một package đã hỗ trợ đủ hai mode hiện tại**.
- **MCP-backed đã có panel:** panel có thể host giao diện AI bên ngoài (như WebView ChatGPT), trong khi MCP/Local Connector/Core xử lý commands và dữ liệu CAD/BIM ở phía dưới. Việc panel không tự chạy inference hoặc workflow chưa phải script-first **không loại trừ** khả năng đóng gói/phân phối add-in qua Autodesk Marketplace.
- **Native AI là nâng cấp kiến trúc, không phải điều kiện phát hành:** nếu sau này triển khai Native API/managed model/script-first, có thể cập nhật cùng CAI/RAI Add-in; không yêu cầu tạo listing riêng chỉ vì thay AI inference/orchestration. Native mode không sử dụng Cloudflare Tunnel/Remote MCP Gateway để route CAD calls; **MCP-backed mode vẫn có dependency, xác thực và hạ tầng riêng cần đáp ứng**.
- **Kênh phân phối vs kênh truy cập:** Autodesk Marketplace phân phối/cài đặt/đăng ký **Add-in host**. ChatGPT, Microsoft 365 Copilot, Claude, Grok... vẫn có thể là **AI clients/kênh điều khiển bên ngoài** thông qua tích hợp MCP, nhưng đó là khả năng mở rộng/cổng truy cập của **cùng CAI/RAI**, **không phải thương hiệu sản phẩm khác**.
- **Trải nghiệm người dùng:** tìm CAI/RAI trên Marketplace, cài Add-in để có panel trong AutoCAD/Revit; trong luồng mua/kích hoạt (theo khả năng platform), **chọn một hoặc nhiều tích hợp ChatGPT, CAI/RAI Native AI, Claude, Grok và thấy giá rõ ràng từng mục + tổng tiền trước thanh toán**. Kích hoạt license và sử dụng các tính năng thực sự được cung cấp. Nếu mode hiện tại yêu cầu đăng nhập dịch vụ AI ngoài, kết nối Internet, tài khoản/gói AI tương thích hoặc MCP integration, **phải công bố trung thực các dependency và chi phí đó**; không quảng cáo là không cần dịch vụ bên ngoài cho tới khi Native AI managed mode được triển khai.
- **Package/host integration:** AutoCAD tuân thủ quy chuẩn autoloader/bundle, `PackageContents.xml`, UI/Ribbon khi áp dụng; Revit tuân thủ `.addin` manifest/bundle, Ribbon; test tương thích, cài đặt/gỡ cài đặt/upgrade, khởi động, host state/drawing binding và không gây crash/ảnh hưởng dữ liệu. Thông số packaging thực tế theo Autodesk publisher guidelines ở thời điểm nộp.
- **License, entitlement và usage:** Marketplace/Autodesk Entitlement API có thể hỗ trợ xác nhận quyền dùng ứng dụng; **không mặc nhiên bao gồm** ledger CAI tool-execution quota, billing AI credits, top-up, B2B seat/license hay reconciliation. Phải xác minh chính sách pricing/trial, purchase flow, khoản thu ngoài Marketplace, thanh toán và tổ chức IT deployment trước release. Một tài khoản/gói CAI/RAI có thể dùng qua các đường truy cập được hỗ trợ, tùy điều khoản/license được chốt sau.
- **Reviewer/security:** tuân thủ Autodesk review về installer, tính ổn định, compatible versions, privacy/security, third-party auth, việc panel tải nội dung online và quyền dữ liệu. Nếu add-in package expose MCP endpoints/tools, kiểm tra điều kiện MCP security declarations/manifest hiện hành. **Được đăng bán không đồng nghĩa Autodesk bảo chứng AI**.
- **Tham khảo Autodesk chính thức:** https://aps.autodesk.com/marketplace/getting-started ; https://aps.autodesk.com/marketplace/publisher-center/autocad-publisher-guidelines ; https://aps.autodesk.com/marketplace/publisher-center/revit-publisher-guidelines . Điều khoản thay đổi theo thời điểm; **chưa đăng, chưa phê duyệt, chưa xác nhận một cấu hình CadGPT/RevitGPT cụ thể đáp ứng toàn bộ yêu cầu**.
- **Ranh giới giai đoạn hiện tại:** giữ nguyên roadmap phát triển Core và beta riêng. Chỉ ghi nguyên tắc sản phẩm/kênh phân phối; **không tự động thực hiện release, packaging, đổi tên code, sửa routing hay tạo roadmap mới**.

#### Native workflow — script-first, AI-in-the-loop (định hướng kiến trúc)

**Định hướng đã chốt ngày 2026-10-17:** Native Add-in được ưu tiên về độ ổn định vì các **step runtime sẽ do script/code đã được kiểm thử và version hóa điều phối**, thay vì để AI đọc tuần tự **Job/step mô tả bằng Markdown** rồi tự quyết định có làm đúng các bước hay không. Markdown vẫn hữu ích để **thiết kế Job, giải thích, review và sinh tài liệu** trong giai đoạn development, nhưng **không phải nguồn thực thi/quyết định flow tại runtime Native**.

```text
User intent → Native Workflow Router
                  │
          Trusted Script/State Machine
          (versioned steps + contracts)
                  │
     ┌────────────┼────────────┐
     ▼            ▼            ▼
 Deterministic   AI stage    User Approval
 CAD/BIM Tools   (nếu cần)  (khi bắt buộc)
     │            │            │
     └────────────┴────────────┘
                  ▼
        Validate/Postcondition
                  ▼
         Save / Readback / Result
```

- **Script là authority về trình tự:** định nghĩa step IDs, điều kiện tiền/hậu kiểm, nhánh lỗi, timeout, checkpoint/resume, giới hạn retry, trạng thái kết thúc; AI **không được tự ý nhảy bước, thêm bước, bỏ bước hay quyết định save/commit trái workflow contract**.
- **AI chỉ là một bước được gọi có điều kiện:** Operator 2B–4B dành cho semantic intent/mapping/phân loại dữ liệu có cấu trúc; Builder 7B–16B chỉ khi workflow yêu cầu suy luận hoặc tạo nội dung phức tạp. Các bước thuần quy tắc/chuyển đổi/kiểm tra/sửa bản vẽ dùng **deterministic code/tool**; có thể hoàn thành nhiều Job mà không cần gọi model sau bước nhận intent.
- **Structured interfaces:** đầu vào/đầu ra bước AI, tool và script phải có schema và validation; không để lời văn tự do của model trở thành command/runtime instruction. Kết quả AI không hợp lệ → error rõ ràng hoặc escalation đúng chính sách, **không âm thầm cố đoán**.
- **CAD/BIM host authority:** các script được đóng gói và kiểm thử trong Native Add-in/Job package, thực thi qua API/dispatcher phù hợp với threading, transaction và document/drawing binding của AutoCAD/Revit. **Không thực thi script sinh tùy ý từ phản hồi model** khi chưa qua review, trust boundary và policy của sản phẩm.
- **Mutating steps:** kiểm tra drawing/document anchor, quyền và user approval theo quy định; có idempotency key/checkpoint, readback sau thay đổi và save đúng thời điểm. Không retry mù khi CAD side effect chưa rõ. Error handling, rollback/compensation chỉ áp dụng nơi host/tool thực sự hỗ trợ.
- **Giảm rủi ro, không tuyên bố tuyệt đối:** script-first giảm nondeterminism và overthinking từ LLM, nhưng không tự loại bỏ lỗi ở script, CAD API, data hoặc môi trường. Cần test từng script/phiên bản và kịch bản lỗi, giữ log có thể truy vết nhưng không rò dữ liệu dự án.
- **Phạm vi thời điểm hiện tại:** đây là **hướng thiết kế native sản phẩm tương lai**; không yêu cầu lập tức chuyển đổi/xóa các Job Markdown và runtime MCP/Core hiện tại, không thêm work item vào milestone đang triển khai chỉ nhờ tài liệu định hướng.

#### Cấu hình local models theo vai trò (định hướng sizing, chưa benchmark)

**Giả thuyết cấu hình do chủ sản phẩm đưa ra (2026-10-17):** để tối ưu máy chủ AI nội bộ dùng chung trong doanh nghiệp, phân tách mô hình theo **Operator** và **Builder**. Đây là kích thước model mục tiêu, **chưa phải chứng nhận mọi model trong dải kích thước đó đều chạy đúng**.

| Vai trò | Quy mô model mục tiêu | Inference policy | Phạm vi |
| --- | --- | --- | --- |
| **Operator** | **Khoảng 2B–4B parameters** | **Temperature thấp**, ưu tiên ổn định, schema-constrained tool use (tham khảo 0–0.2 tùy API/model) | Các pha xử lý dữ liệu CAD/BIM thường gặp: đọc/diễn giải dữ liệu có cấu trúc, phân loại, ánh xạ trường, chuẩn hóa, chọn tool, điền tham số, điều phối workflow đã được kiểm chứng |
| **Builder** | **Khoảng 7B–16B parameters** | Cấu hình theo model/tác vụ; không mặc định phải temperature cao | Phân tích/phân rã bài toán CAD/BIM phức tạp, xây phương án, soạn nội dung nghiệp vụ hoặc Lisp/Dynamo/Job trong các workflow **được phép** |

- **Routing inference theo độ khó/tác vụ** tại Native AI Client (hoặc dịch vụ inference nội bộ): ưu tiên Operator **2B–4B** cho các pha dữ liệu thường gặp và tác vụ theo quy trình/tool schema rõ ràng; chỉ chuyển Builder khi cần suy luận kỹ thuật phức tạp, xử lý ngoại lệ hoặc tạo phương án mới. Các phép tính/kiểm tra chính xác, ghi dữ liệu và cập nhật bản vẽ phải do công cụ deterministic được kiểm tra thực hiện, không phụ thuộc câu trả lời suy đoán của model. Có thể tải Builder theo nhu cầu hoặc dùng server chung tối ưu concurrency, không cần mặc định chạy cả hai model trên workstation.
- **Operator vẫn có thể overthinking dù chỉ 2B–4B và temperature thấp.** Temperature chỉ tác động đến sampling, **không bảo đảm** model suy luận ngắn, dừng đúng lúc hay không gọi tool thừa. Tránh dựa vào câu lệnh prompt chung chung kiểu "do not overthink" như một cơ chế đảm bảo.
- **Operator contract (cấu hình nội bộ, không mở cho user):** nhận nhiệm vụ hẹp, tool/schema allowlist theo pha, input/output có cấu trúc, kết quả và điều kiện hoàn thành rõ; ưu tiên gọi deterministic code cho đọc/ghi, transform/validate dữ liệu có thể xác định bằng quy tắc. Model chỉ xử lý phần thực sự cần ngôn ngữ/semantic interpretation, **không dùng LLM thay cho thuật toán**.
- **Budget/stop policy:** giới hạn số vòng tool calling, lượt suy luận, thời gian và tokens phù hợp từng loại tác vụ; dừng ngay khi đạt postcondition, tránh lặp đọc/thử không có mục tiêu. Nếu thiếu dữ liệu, lỗi schema, vượt budget hoặc không đủ độ chắc chắn thì **trả trạng thái rõ ràng, hỏi xác nhận hoặc chuyển Builder theo tiêu chí định trước**; không tự động kéo dài suy luận, không retry tác vụ CAD mutating chưa rõ kết quả.
- **Stability by design:** provider, model, temperature, budgets, routing và fallback chỉ do đội phát triển CAI/RAI cấu hình, phiên bản hóa và kiểm thử; **không để khách hàng chọn/sửa các thông số đó**. Mỗi thay đổi model/prompt phải qua benchmark trên các workflow điển hình trước khi phát hành; không coi kích thước model là đủ để chứng minh ổn định.
- **Host of record là AutoCAD/Revit trên máy kỹ sư**; AI Server chỉ sinh quyết định/tool call, **không trực tiếp chiếm quyền CAD**. Local dispatcher kiểm tra tool allowlist, schema, drawing/document binding, an toàn, xác nhận và kết quả readback bất kể kích thước model.
- **Không đồng nhất Builder với MCP Dev & Repair:** công cụ phát triển/sửa chữa **MCP tools nội bộ** vẫn loại bỏ khỏi bản thương mại. Builder phục vụ các workflow người dùng được phép; việc tạo hoặc sửa nội dung người dùng (ví dụ Lisp/Job nếu sản phẩm cho phép) phải chịu cùng policy/validation/approval như Core.
- **Tiêu chí kiểm chứng:** chọn tool và truyền tham số chính xác, từ chối thao tác không có quyền, tuân thủ xác nhận CAD mutating, xử lý lỗi và multi-step flow; đo latency, VRAM/RAM, tool-call success rate, số user đồng thời và hiệu quả escalation. Model trong dải 2B–4B vẫn có thể thiếu độ chính xác tool calling, suy luận hoặc xử lý ngữ cảnh dài; nếu benchmark không đạt, điều chỉnh model, bổ sung dữ liệu/schema rõ ràng hoặc escalation sang Builder thay vì nới lỏng xác thực CAD.
- **Không đưa các con số trên thành yêu cầu bắt buộc đối với khách hàng** (cloud providers/AI server nội bộ có khả năng khác nhau); không phải chỉ thị mua GPU/triển khai model ngay trong giai đoạn Core Development.

#### CAI/RAI-managed AI credits từ Cloud API / Ollama Cloud (RESEARCH ONLY — resale rights chưa xác nhận)

**Đã chốt mô hình kinh doanh mục tiêu:** CAI/RAI Native AI là **managed AI service gắn trong sản phẩm**: CAI/RAI bán gói AI/AI credits, **nhà phát triển chọn model và nhà cung cấp upstream**, người dùng không có tùy chọn model/API, không cần mua API key ngoài. **Chưa chốt khả năng thực hiện qua Ollama Cloud cụ thể** vì cần xác minh hợp đồng/quyền phân phối, chi phí và độ ổn định; đây là dịch vụ inference **nhúng trong sản phẩm**, không mặc định là kinh doanh API/white-label API độc lập.

```text
CAI/RAI Native Add-in (chat, CAD/BIM local tool dispatcher)
      │ HTTPS inference request
      ▼
CAI AI Proxy (user/org auth + AI usage/budget + per-user ledger)
      │ Provider key chỉ lưu phía server
      ▼
Ollama Cloud / authorized model API provider
      │ model response + tool call + token usage
      ▼
CAI/RAI Native Add-in → verify tool schema/authority → local CAD/BIM action
```

- **Trải nghiệm khách hàng đã chốt:** chỉ hiển thị thương hiệu **CAI AI / RAI AI**, tính năng/gói, số AI credits hoặc usage còn lại và chính sách dữ liệu; **không hiển thị tên model, kích thước model, model router, upstream API endpoint, temperature hoặc API key**. Operator (2B–4B) / Builder (7B–16B) là phân tầng **nội bộ**, do CAI/RAI quyết định và thay đổi sau khi kiểm thử.
- **Minh bạch đúng phạm vi:** không cần công bố model cụ thể trên UI hoặc để khách chọn model; nhưng các thông tin về **bên xử lý dữ liệu, xử lý trên cloud hay máy chủ nội bộ, vùng xử lý, quyền sử dụng dữ liệu và nghĩa vụ pháp lý/hợp đồng** vẫn phải được cung cấp khi cần. Không quảng cáo sai rằng AI chạy hoàn toàn local nếu inference thực tế qua bên thứ ba.
- **Không có Cloudflare Tunnel hoặc remote MCP routing cho lệnh CAD** ở nhánh Native API. Nếu triển khai proxy/cloud endpoint, nó chỉ quản lý **AI inference** và bảo mật provider credential; license/quota sync có thể là dịch vụ HTTPS riêng.
- **Hai đơn vị tính phí độc lập:** (1) **CAI/RAI execution quota** = số tool executions; (2) **AI credits/tokens** = mức tiêu thụ inference (input, cache, output, multi-turn/tool-result context, từng model). Một tool call có thể cần nhiều model requests; không gộp hai loại thành 1:1.
- **Ollama Cloud pricing ghi nhận 2026-10-17:** có API, bảng giá per-million-token, usage credits, Free pay-as-you-go và gói Pro/Max/Team. Team hiện công bố $500/tháng có $1,000 usage credits chia sẻ, nhưng **đó không phải xác nhận được phép reseller, cũng không phải bằng chứng biên lợi nhuận cố định**; giới hạn concurrent requests/quota và bảng model thay đổi theo plan. Nguồn: https://ollama.com/pricing và https://ollama.com/blog/transparent-pricing .
- **Chưa được phép suy diễn quyền resale:** Điều khoản công khai tại https://ollama.com/terms **không cấp rõ quyền bán lại/white-label/re-export Cloud API** và có điều khoản hạn chế dùng dịch vụ phát triển sản phẩm cạnh tranh. **Yêu cầu xác nhận bằng văn bản/hợp đồng thương mại từ Ollama** cho từng mô hình phân phối (embedded AI feature vs independent API resale) và xem lại giấy phép các model được sử dụng. Chưa có xác nhận thì **không công bố CAI là reseller chính thức và không triển khai bán lại Ollama API**.
- **Kiểm soát chi phí/rủi ro** nếu được phép: API key server-side, per-tenant/user limits và budgets, hard-stop khi hết AI credits, token usage ledger theo provider/model, đối soát hóa đơn, chống retry tính trùng, rate/concurrency protection, xác định thuế/phí, dữ liệu dự án và chính sách xử lý nội dung theo hợp đồng khách hàng.
- **Lựa chọn upstream dự phòng (nội bộ, không phải user choice):** CAI/RAI có thể chuyển sang nhà cung cấp inference có hợp đồng OEM/reseller rõ ràng hoặc cung cấp bản Business dùng **CAI-approved model bundle** trên AI server do IT doanh nghiệp host. **BYOK không nằm trong commercial user flow đã chốt.** Không yêu cầu build billing inference/proxy ở milestone core hay Cloud Beta hiện tại.

#### Phương án nghiên cứu (không tự động thành work item)

- So sánh chất lượng **tool/function calling**, hiểu CAD/BIM, reasoning nhiều bước, ngữ cảnh dài, latency, concurrent users và chi phí vận hành trên cloud API so với shared Ollama server.
- Kiểm thử bằng fixture/drawing không nhạy cảm; xem xét API-specific adapters, token usage và chuyển giao kết quả tool thay vì giả định một API abstraction dùng được với mọi model.
- DeepSeek API là một ứng viên chi phí thấp; kiểm tra lại model/giá tại https://api-docs.deepseek.com/quick_start/pricing/ trước khi thử nghiệm và quyết định thương mại.
- **Không triển khai AI server của doanh nghiệp, Native Chat, model hosting, provider management portal hoặc refactor core theo tài liệu này.**

## 3. Kiến trúc thương mại mục tiêu — Remote MCP Mode

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

### Đã chốt — nguyên tắc (chỉ áp dụng Remote MCP Mode)

- **Một endpoint công khai chung, nhiều Local Connectors**. Không yêu cầu một Cloudflare account, tunnel ID hay plugin riêng cho từng khách hàng.
- **Local Connector chủ động kết nối ra Gateway** (giao thức truyền tải cụ thể sẽ thử nghiệm); không mở cổng AutoCAD trực tiếp ra Internet.
- Gateway xác định đúng **organization/tenant, user, device, connection** rồi chỉ gửi yêu cầu đến thiết bị được phép. Hai tổ chức, người dùng hoặc thiết bị không được nhận nhầm lệnh/kết quả của nhau.
- Xử lý AutoCAD/Revit và dữ liệu bản vẽ chính nằm **trên máy khách hàng**. Gateway làm xác thực, cấp quyền, điều phối, đếm/ghi nhận lượt sử dụng và chuyển thông điệp/kết quả cần thiết.
- Giữ nguyên nguyên tắc **drawing/work binding và execution authority** của runtime hiện hành; Cloud Gateway **không thay thế** thẩm quyền CAD local, không tự ý chọn drawing và không bỏ qua các xác nhận an toàn cho lệnh ghi.
- Mỗi thiết bị có định danh/chứng thực riêng; không dùng shared credential nhúng trong tất cả bộ cài, không tin vào user ID/device ID do model tự khai báo.

### Chưa chốt — lựa chọn hạ tầng (chỉ áp dụng Remote MCP Mode)

- **Cloudflare Tunnel dùng chung tới Gateway tự host** và **Cloudflare Workers + Durable Objects/D1** là những phương án cần đánh giá, **chưa phải quyết định triển khai cố định**.
- Nếu dùng Workers, request quota của Cloudflare tính theo quy tắc dịch vụ cloud tương ứng; nếu chỉ proxy qua Tunnel tới origin không dùng Workers thì **không áp dụng quota Workers chỉ vì đi qua Tunnel**.
- WebSocket/session dài hạn, reconnect, routing state, storage, chi phí, giới hạn free/paid và tải đồng thời phải được **đo bằng beta**, không suy diễn từ số máy cài hay giả định mỗi lệnh luôn đúng một request hạ tầng.

## 4. Subscription, request quota và top-up

### Đã chốt — mô hình kinh doanh

**Subscription theo gói + hạn mức lượt thực thi trong kỳ + mua thêm khi hết hạn mức (top-up).**

- **CAI Request** là đơn vị thương mại: một **lượt thực thi CAI tool hợp lệ**, dù được gọi qua **Remote MCP Mode** hay **Native API Mode**, **không phải** HTTP/Workers request hoặc API token. Việc trả dữ liệu qua response **không tự tạo thêm lượt CAI**. Chi tiết enforcement/quota sync của native mode chưa chốt.
- AI suy luận/chat mà **không gọi CAI tool**: không tiêu thụ CAI Request.
- Những hoạt động hạ tầng như auth, khám phá tool, heartbeat, reconnect, kiểm tra quota, quản lý phiên: không tự động tiêu thụ CAI Request.
- Một lần thực thi đọc, ghi hoặc ghi rồi trả kết quả đều có thể là **một lượt CAI**. Việc một tác vụ gồm **nhiều lần gọi tool** có thể tiêu thụ nhiều lượt; chưa chốt giá/trọng số riêng cho các tool nặng.
- Phải phân biệt **logical execution/request ID** với số request HTTP/Cloudflare thực tế. Các lượt retry trùng cùng một intent không được tính phí nhiều lần; không được blind retry thao tác thay đổi bản vẽ khi kết quả chưa rõ.
- Gateway phải ghi trạng thái đủ để **reserve/commit/reconcile** quota khi gửi lệnh, thành công, từ chối trước thực thi, mất kết nối hoặc outcome chưa xác định. Không tự tuyên bố exactly-once trong mọi lỗi mạng.
- Quota gói được cấp lại theo kỳ; khách hàng có thể mua thêm credits. Quy tắc chi tiết về thời hạn credits, rollover, đơn giá, giá gói, giới hạn thiết bị và xử lý thất bại **chưa chốt**.

### Checkout: người mua chọn tích hợp AI và thấy rõ giá (định hướng đã chốt 2026-10-17)

**Quyết định sản phẩm:** khi mua/đăng ký **CAI Add-in** hoặc **RAI Add-in**, khách hàng được **lựa chọn tích hợp ChatGPT (GPT), CAI Native AI (tên hiển thị tương ứng RAI AI cho Revit), Claude, Grok**. Đây là **lựa chọn kênh AI integration/entitlement**, **không phải chọn model hoặc nhà cung cấp inference nội bộ**. Các lựa chọn nằm dưới **cùng một sản phẩm Add-in**; không cần listing app khác hoặc mua lại Core license để đổi integration. Cho phép chọn một hoặc nhiều tích hợp và mở rộng/đổi sau mua theo policy thương mại sẽ chốt.

| Lựa chọn trên checkout | AI path | Giá CAI/RAI phải hiển thị | Chi phí bên ngoài phải công bố |
| --- | --- | --- | --- |
| **ChatGPT / GPT integration** | ChatGPT ↔ CAI/RAI Remote MCP | **Giá integration/chu kỳ, hoặc ghi rõ “Đã gồm / 0” nếu included** | Subscription/quota của OpenAI (nếu cần, khách thanh toán OpenAI; phụ thuộc điều kiện hỗ trợ MCP của plan) |
| **CAI Native AI / RAI Native AI** | Native panel ↔ CAI/RAI-managed inference ↔ local CAD/BIM Core | **Giá tích hợp Native/chu kỳ + AI credits định mức, hoặc giá AI credit top-up**; luôn thể hiện lượng AI credits được cấp | **Không yêu cầu khách có API key hay subscription DeepSeek/Ollama riêng** cho managed cloud variant; inference cost là trách nhiệm CAI/RAI |
| **Claude integration** | Claude ↔ CAI/RAI Remote MCP | **Giá integration/chu kỳ, hoặc “Đã gồm / 0”** | Subscription/quota của Anthropic nếu yêu cầu cho mức sử dụng; khách thanh toán Anthropic |
| **Grok integration** | Grok ↔ CAI/RAI Remote MCP | **Giá integration/chu kỳ, hoặc “Đã gồm / 0”** | Subscription/quota của xAI nếu yêu cầu; khách thanh toán xAI |

**Các số tiền cụ thể chưa được chủ sản phẩm phê duyệt; KHÔNG tự điền số USD/VND giả vào price book hoặc listing.** “Ghi rõ mức giá” là **điều kiện bắt buộc trước khi mở checkout**, nghĩa là mỗi tích hợp được bán phải có **giá số thực tế**, **đơn vị tiền tệ**, **chu kỳ** (tháng/năm/một lần), **quyền lợi đi kèm**, **giá gia hạn**, **thuế/phí**, **đơn giá top-up** nếu có. Nếu integration miễn phí kèm license, **ghi “Đã bao gồm / 0 [đơn vị tiền tệ]”, không bỏ trống**. Nếu một tích hợp chưa triển khai hoặc chưa cho phép mua, ghi **“Sắp ra mắt — chưa thể mua”**, **không hiển thị giá như đang bán**. Không công bố giá bên thứ ba như mức cố định của CAI/RAI.

**Breakdown phải xuất hiện trước nút thanh toán:**

```text
CAI / RAI Add-in base subscription        [AMOUNT] / [PERIOD]
Selected AI integrations:
   [x] ChatGPT (GPT)                       [AMOUNT] / [PERIOD]
   [x] CAI Native AI / RAI Native AI       [AMOUNT] / [PERIOD]
       Included AI credits:                [QUANTITY + UNITS]
       Extra AI credit top-up:             [AMOUNT] per [UNIT]
   [ ] Claude                              [AMOUNT] / [PERIOD]
   [ ] Grok                                [AMOUNT] / [PERIOD]
Included CAD/BIM tool executions:          [QUANTITY]
Extra tool-execution top-up:               [AMOUNT] per [UNIT]
Discounts / Taxes / Other fees:           [AMOUNT]
Total payable today:                      [AMOUNT + CURRENCY]
Recurring renewal:                        [AMOUNT + CURRENCY / PERIOD]
External AI provider costs, if any:       NOT INCLUDED; provider-billed
```

- **Đơn vị thương mại tách riêng:** CAI/RAI Core subscription + entitlement/activation của tích hợp (giá có thể bằng 0 hoặc đã kèm gói) + CAI/RAI tool-execution quota/top-up + Native AI credits/top-up. **Không tự áp một khoản phí riêng cho mỗi MCP client khi chưa chốt price book.** Khi đã chốt giá, tổng tiền checkout phải tính rõ ràng và khớp invoice/license.
- **Không ép khách chọn model:** khách chọn **ChatGPT / Native AI / Claude / Grok** như kênh sử dụng; riêng **Native AI** không có API provider/model/temperature/routing picker. CAI/RAI operator chọn upstream models và kiểm thử.
- **Marketplace support chưa xác minh:** Autodesk Marketplace có quy trình bán desktop subscription và entitlement, **chưa xác nhận checkout của Autodesk cho phép một listing chứa nhiều dynamic integration options/add-ons và AI credit top-up**. Chỉ thiết kế **checkout option selector tại Marketplace nếu nền tảng/hợp đồng cho phép**; nếu không, dùng bước **activation/plan selection trong account portal/entitlement flow của CAI/RAI** sau khi cài/mua Add-in, **chỉ khi phù hợp điều khoản Autodesk về thanh toán ngoài Marketplace**. Không tuyên bố native Autodesk checkout đã hỗ trợ UI này.
- **Khả dụng kỹ thuật theo từng mode:** ChatGPT/Claude/Grok còn phải qua điều kiện client-plan, approval/admin và E2E integration tests; Native AI chưa được triển khai. Chỉ bật lựa chọn checkout có khả năng cung cấp thực tế; không bán trước bằng lời hứa không có ngày ra mắt chắc chắn.
- **Organization checkout:** công ty chọn số seats/device/usage pool và các integrations được quản trị viên phê duyệt; các mức giá/cách cấp license và hóa đơn Business cần price book riêng, không giả định nhân viên tự mua qua Marketplace.
- **Chốt giá là quyết định thương mại riêng sau cost modeling:** tham chiếu API token costs, tool workload, gateway operations, commission/tax, hỗ trợ kỹ thuật, concurrency và hạn mức; không biến tài liệu định hướng thành bảng giá public có hiệu lực.

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
- Thử client **Microsoft 365 Copilot doanh nghiệp**, **Claude**, **Grok** và sau đó các AI client tương thích khác qua cùng Gateway và cùng local app; kiểm chứng MCP protocol/auth/tool invocation/result trên từng client. Qwen Chat và DeepSeek Chat chỉ đưa vào thử nghiệm khi xác nhận được hỗ trợ MCP ngay trong ứng dụng chat phù hợp với khách hàng.
- Đo lưu lượng thật để lựa chọn Tunnel-to-origin hay Workers/DO, tối ưu chi phí free/paid khi cần.

**Không tự phát sinh:** milestone/gate mới cho CAI/RAI Core, refactor transport, đổi tên codebase hàng loạt, mở rộng sang BricsCAD/BIM mới hoặc triển khai billing production trong beta.

## 8. Ranh giới dữ liệu, tương thích và quyết định còn mở

- Thiết kế tối thiểu cần bảo vệ phiên đăng nhập, xác thực OAuth/token, tenant isolation, ghép cặp/thu hồi device, chống gửi nhầm kết quả, và an toàn với các lệnh CAD mutating. Không truyền toàn bộ DWG qua cloud nếu không cần.
- **Chưa chốt:** tên miền cụ thể; nhà cung cấp dịch vụ auth/billing; kiểu host Gateway (Remote MCP Mode); chính sách credits và đơn giá; số requests cho từng gói; giới hạn số máy/nhân viên; thời điểm đưa vào bản thương mại; hướng phát hành chính xác cho từng AI client; thiết kế native chat, **provider adapter/model routing nội bộ**, local usage ledger/quota sync, lựa chọn upstream AI cloud hoặc CAI-approved model bundle trên Ollama server doanh nghiệp, **quyền phân phối/reseller/OEM của từng upstream**, đơn giá AI credits và inference proxy. **Đã chốt: không có model selector hoặc BYOK cho người dùng thương mại.**
- **Không suy diễn:** số lượt CAI Requests = số Workers requests; Tunnel Free = hạ tầng vô hạn; một model có sẵn trong Copilot = mọi định dạng MCP/agent đều dùng được không cần tích hợp; AI có toàn bộ lịch sử hội thoại trong Gateway; API function calling = consumer chat app hỗ trợ Custom MCP; mọi model hỗ trợ cùng một tool schema/độ tin cậy; một CAI request = một lần inference/token cost; Native API Mode có Cloudflare Tunnel/MCP Gateway điều phối lệnh CAD; chạy Ollama cùng workstation CAD là cấu hình mặc định; LAN Ollama server đã có bảo vệ xác thực an toàn.
- Với mỗi thử nghiệm, chỉ ghi **kết quả quan sát thực tế**, phần chưa thử ghi **UNVERIFIED**. Tài liệu này không chứng nhận capability đã hoàn thành.

## 9. Tóm tắt quyết định

> **CAI/RAI hướng tới nền tảng CAD/BIM automation mở: (A) Remote MCP Mode — ChatGPT-first, ưu tiên Microsoft 365 Copilot doanh nghiệp, dùng chung remote integration/gateway và nhiều local connectors; (B) Native AI Mode tương lai — chat native trong CAD/BIM Add-in, **CAI/RAI tự chọn và điều phối model/API nội bộ**, có thể dùng cloud providers hoặc CAI-approved Ollama server của doanh nghiệp, tool thực thi local, **không có model picker/BYOK và không đi qua tunnel/MCP Cloud Gateway**. Bản thương mại bán CAI/RAI subscriptions/tool-execution quotas + top-up; Native AI có thể bán thêm AI credits do CAI/RAI quản lý. Doanh nghiệp mua và IT triển khai; ngôn ngữ do AI thích nghi; MCP Dev & Repair chỉ ở Development.**
>
> **Kênh thương mại mục tiêu:** **mỗi CAI (AutoCAD) và RAI (Revit) là một Add-in có panel tích hợp**, có thể phân phối/bán qua **Autodesk Design and Make Marketplace ngay cả khi backend còn dùng MCP**; Native AI là hướng nâng cấp vận hành bên trong cùng sản phẩm, **không phải sản phẩm thứ hai**. **Khi mua hoặc kích hoạt**, khách chọn **ChatGPT (GPT), CAI/RAI Native AI, Claude, Grok** (một hoặc nhiều tích hợp), **thấy rõ giá từng lựa chọn, phí AI bên ngoài và tổng tiền trước thanh toán**; hình thức checkout trong Autodesk hay portal riêng phải kiểm tra điều khoản Marketplace. AI providers ở Native vẫn do CAI/RAI quản lý. Chưa chốt giá số, chưa có bản submit/review được Autodesk chấp nhận.
>
> **Hiện tại:** tiếp tục phát triển core CAI/RAI; có thể nghiên cứu Cloud Beta nhỏ để kiểm chứng routing, counting và quota distribution. Mở rộng CAD/BIM khác và triển khai thương mại toàn diện **chưa nằm trong phạm vi hiện tại**.
