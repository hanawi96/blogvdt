Dự án: Website blog SEO, bán vòng dâu tằm và CMS tại /admin.
Mục tiêu: Đúng yêu cầu, an toàn, dễ bảo trì, nhanh và gọn; không overengineering.
Ưu tiên: Bảo mật/dữ liệu > đúng chức năng > ổn định > dễ hiểu > hiệu năng thực tế > tốc độ làm.

1. Phạm vi và cách làm việc
- Chỉ làm việc được yêu cầu; không tự thêm chức năng, refactor diện rộng hoặc thay đổi hành vi hiện có. Ưu tiên sửa ít file, ít code, ít dependency nhất mà vẫn đúng và an toàn.
- Trước khi sửa, đọc đúng các file liên quan để hiểu luồng dữ liệu, cách tổ chức, component và helper sẵn có. Tìm kiếm có mục tiêu; không đọc/in toàn bộ repository hoặc tài liệu dài nếu không cần.
- Tham khảo PROJECT_PLAN.md hoặc KE-HOACH.md nếu tồn tại và liên quan; yêu cầu hiện tại quyết định phạm vi thực thi. Không tự triển khai các giai đoạn kế hoạch khác.
- Việc nhỏ: triển khai trực tiếp. Việc lớn/rủi ro: nêu ngắn phương án, file dự kiến sửa, migration/dependency nếu có; thực hiện theo các bước nhỏ, kiểm tra từng bước.
- Tái sử dụng code trước khi tạo mới; chỉ trừu tượng hóa khi có nhu cầu thực. Một quy tắc nghiệp vụ chỉ có một nguồn định nghĩa; không tạo tầng kiến trúc chỉ để phục vụ CRUD đơn giản.
- Nếu thiếu thông tin nhỏ, chọn giả định an toàn và nêu rõ. Hỏi trước nếu thiếu dữ kiện quyết định hoặc thao tác có thể gây mất dữ liệu, phát sinh chi phí, thay đổi quyền/production.
- Không ghi đè thay đổi không liên quan của người dùng; không để file thử, bản sao v2/final, code chết, log debug hoặc TODO mơ hồ.
2. Công nghệ cố định
- Astro + TypeScript strict; Svelte chỉ cho UI cần tương tác; Tailwind CSS và design tokens hiện có.
- Astro SSR/Server Endpoints trên Cloudflare Workers; Cloudflare D1 (SQLite) + Drizzle ORM + migrations; Cloudflare R2 lưu ảnh/tệp, D1 lưu metadata/key.
- Tiptap cho trình soạn thảo CMS; npm + package-lock.json; một repository, một ứng dụng Astro cho website công khai và /admin.
- Không tự đổi stack, thêm backend framework, ORM, state manager, UI kit, queue, Redis, microservice hay thư viện lớn. Chỉ thêm dependency khi thật cần, tương thích Workers và được bảo trì.
- Không mặc định Node.js API dùng được trên Workers. Khi API/phiên bản chưa chắc chắn, kiểm tra package.json và tài liệu chính thức phù hợp.
3. Cấu trúc và quy ước code
- src/pages/: routes, /admin, /api; chỉ xử lý request, xác thực, gọi nghiệp vụ và render/response, tránh nhồi SQL/logic dài.
- src/components/: UI hiển thị, không truy cập DB/R2 hoặc chứa secrets; src/features/: nghiệp vụ đủ lớn; src/lib/: logic thật sự dùng chung; src/styles/: theme/tokens; migrations/: migration được quản lý.
- Repository phụ trách truy xuất dữ liệu; service chỉ tách khi logic đủ phức tạp. Không bắt buộc tạo đủ tầng, không chia vụn file, không lồng thư mục vô ích.
- Tên: component PascalCase; biến/hàm camelCase; bảng/cột SQL snake_case; URL/slug kebab-case; ưu tiên convention đã có khi có khác biệt.
- TypeScript strict: tránh any, @ts-ignore, ép kiểu và non-null assertion không cần thiết. Đặt tên rõ nghĩa; hàm tập trung, early return; comment lý do khó thấy, không nhắc lại code.
- Khi sửa interface/logic dùng chung, tìm tất cả nơi sử dụng; không để hai implementation cũ/mới tồn tại song song. Không hardcode lặp trạng thái, route, màu hoặc cấu hình.
4. API, dữ liệu và đơn hàng
- Luồng chuẩn: UI → route/API → auth + validate → nghiệp vụ (nếu cần) → DB/R2. Không import module server vào client; không tạo endpoint nếu Astro server gọi trực tiếp an toàn được.
- Luôn validate lại phía server; kiểm tra quyền từng thao tác. HTTP status/error nhất quán; thông báo người dùng dễ hiểu, không lộ stack trace, SQL hoặc secrets.
- Danh sách lớn phải có phân trang, giới hạn và thứ tự ổn định; tránh lọc cả bảng ở browser, SELECT * không cần thiết và truy vấn N+1.
- Đơn hàng: xác thực giá, số lượng, lựa chọn sản phẩm ở server; chống gửi đơn trùng (idempotency/cơ chế tương đương), kiểm tra chuyển trạng thái hợp lệ.
- Schema Drizzle là nguồn định nghĩa dữ liệu; mọi thay đổi schema phải có migration lưu trong Git. Không sửa/xóa migration đã áp dụng hoặc chỉnh schema production thủ công.
- Truy vấn tham số hóa/Drizzle; dùng UNIQUE, NOT NULL, foreign key và index theo nhu cầu thực; đảm bảo tính toàn vẹn dữ liệu nhiều bước theo khả năng D1.
- Thống nhất quy ước thời gian (ưu tiên UTC); bảo vệ dữ liệu cá nhân, chỉ lưu dữ liệu cần thiết.
- D1/R2 local tách biệt production. Không chạy --remote, migrate/deploy production, xóa dữ liệu thật hoặc seed dữ liệu thật nếu chưa được cho phép rõ ràng.
5. R2, xác thực và bảo mật
- Upload/xóa media chỉ qua endpoint có xác thực/phân quyền; kiểm tra kích thước, MIME thực, loại tệp và số lượng; tạo object key an toàn, duy nhất. Không cho input tùy ý quyết định R2 key/path/domain.
- D1 chỉ lưu key và metadata cần thiết. Không xóa file R2 còn được tham chiếu; xử lý lỗi DB/upload để tránh dữ liệu mồ côi. Ảnh responsive, có kích thước rõ; không lazy-load ảnh LCP một cách máy móc.
- Tất cả trang /admin và API quản trị phải kiểm tra session/quyền ở server; ẩn nút không phải phân quyền.
- Mật khẩu hash bằng giải pháp an toàn tương thích Workers; session đủ ngẫu nhiên, có hạn dùng/thu hồi; cookie HttpOnly, Secure ở production, SameSite phù hợp.
- Chống CSRF cho thao tác thay đổi dữ liệu; hạn chế đăng nhập/form spam bằng rate limit hoặc biện pháp phù hợp.
- Nội dung HTML từ Tiptap và đầu vào không tin cậy phải được sanitize/escape trước khi render; chống XSS, kiểm soát tag/attribute/URL scheme được phép.
- Không log hoặc đưa lên Git/client mật khẩu, token, session, secrets, thông tin khách hàng. Secrets chỉ nằm ở server/bindings; không dùng PUBLIC_* cho secrets.
- Không vô hiệu hóa validation, TypeScript, kiểm tra quyền hoặc biện pháp bảo mật để né lỗi.
6. Website, SEO và giao diện
- Ưu tiên .astro và HTML render sẵn cho bài viết; chỉ hydrate Svelte khi cần, với directive nhẹ nhất. Không biến blog thành SPA hoặc thêm animation/JS nặng vô ích.
- Nội dung công khai từ D1 dùng SSR hoặc cơ chế cập nhật rõ ràng; trang tĩnh có thể prerender. Cache nội dung công khai có chiến lược làm mới; không public-cache admin/session/đơn hàng/dữ liệu riêng tư.
- SEO được xử lý tập trung: title, description, canonical, Open Graph, breadcrumb, robots, sitemap và structured data. Chỉ cho index URL đủ điều kiện; draft, admin, trang cảm ơn và nội dung riêng tư không được index.
- Slug duy nhất, ổn định; đổi URL công khai phải xử lý 301 redirect. HTML ngữ nghĩa, một H1 chính, heading có thứ bậc, ảnh có alt phù hợp; SSR trả nội dung thật cho bot.
- Structured data chỉ mô tả thông tin có thật; không nhồi từ khóa, bịa đánh giá hoặc tạo nội dung SEO hàng loạt kém chất lượng. Với nội dung mẹ/bé, phân biệt quan niệm dân gian và chứng cứ khoa học; không tự khẳng định vòng có tác dụng chữa bệnh hay giúp bé ngủ ngon.
- Giao diện sáng, sạch, dễ đọc, phù hợp thương hiệu thủ công dành cho mẹ và bé. Dùng Tailwind và tokens hiện có; không hardcode màu mới tùy ý.
- CMS ưu tiên ít thao tác; có thông báo lỗi/empty state, xác nhận thao tác nguy hiểm. Form xử lý loading/error/success, validation, bàn phím; luồng đặt hàng ngắn, không bắt khách đăng ký.
- Kiểm tra responsive/mobile, focus/label và accessibility cơ bản. Chỉ tối ưu khi có vấn đề hoặc số liệu; ưu tiên giảm truy vấn, JS, payload và tối ưu ảnh.
7. Kiểm tra, môi trường và bàn giao
- Sửa lỗi theo trình tự: tái hiện → xác định nguyên nhân gốc → sửa tối thiểu → kiểm tra hồi quy. Không che lỗi bằng retry vô hạn, timeout tùy tiện hoặc bỏ qua exception.
- Bổ sung/cập nhật test theo rủi ro và hành vi thay đổi; chú ý success/failure, dữ liệu không hợp lệ, thiếu quyền, lỗi DB/R2, thao tác trùng. Test không gọi production, dùng dữ liệu giả.
- Chạy các script có thật trong package.json và liên quan phạm vi sửa: Astro/typecheck, lint, test, build. Không tuyên bố đã kiểm tra nếu chưa chạy; nếu không chạy được, nói rõ lý do.
- Không tự nâng cấp package hàng loạt, đổi package manager hoặc chỉnh file sinh tự động bằng tay. Giữ lockfile đồng bộ; không commit .env, .dev.vars, node_modules, dist, .wrangler hay dữ liệu local.
- Chỉ sửa README khi cách cài, cấu hình hoặc vận hành thay đổi. Deploy, migration production, DNS, xóa dữ liệu và thao tác phá hủy phải được cho phép rõ ràng.
8. Tiết kiệm token khi làm việc với AI
- Đọc theo nhu cầu: chỉ mở file và đoạn code ảnh hưởng tác vụ; ưu tiên tìm vị trí bằng tên hàm/route, rồi đọc vùng liên quan. Không quét lặp lại hoặc gửi lại nguyên file đã biết nếu không cần.
- Trao đổi ngắn: không diễn giải lại yêu cầu hay chép nguyên code dài vào câu trả lời; ưu tiên sửa trực tiếp vào file. Chỉ trình bày lý do/đánh đổi khi có quyết định kỹ thuật đáng lưu ý.
- Dùng công cụ có mục tiêu: gộp thao tác tìm kiếm hợp lý; tránh chạy lại test không liên quan hoặc in log dài. Khi thất bại, kiểm tra nguyên nhân trước khi thử lại.
- Không hy sinh chất lượng để tiết kiệm token: bảo mật, tính đúng đắn, migration và kiểm thử cần thiết luôn được ưu tiên.
9. Điều kiện hoàn thành và định dạng báo cáo
Chỉ xem là xong khi thay đổi đúng phạm vi, không phá chức năng cũ, không có file/dependency thừa, đã xử lý quyền/validation/lỗi, có migration nếu đổi schema và đã kiểm tra được những phần cần thiết.
Báo cáo ngắn sau mỗi tác vụ (không lặp nội dung):
1. Đã làm: kết quả cụ thể.
2. File sửa: chỉ file thực sự thay đổi (gộp nhóm nếu nhiều).
3. Kiểm tra: lệnh và kết quả thật; nói rõ phần chưa kiểm tra.
4. Lưu ý: chỉ khi có rủi ro, migration, cấu hình hoặc bước thủ công.
Nguyên tắc cuối: Ít code, ít token, ít phức tạp — nhưng đủ đúng, an toàn và dễ bảo trì.