# AGENTS.md — QUY TẮC BẮT BUỘC CHO AI CODING

> Dự án: Website blog SEO và bán vòng dâu tằm, kèm CMS quản trị riêng.
> Mục tiêu: đúng chức năng, bảo mật, nhanh, dễ đọc, dễ debug, dễ kiểm thử, dễ duy trì và mở rộng; **không overengineering**.
> Đây là quy tắc làm việc lâu dài. `PROJECT_PLAN.md` mô tả phạm vi và các giai đoạn sản phẩm.

## 1. THỨ TỰ ƯU TIÊN VÀ NGUYÊN TẮC CỐT LÕI

1. An toàn dữ liệu và bảo mật > tính đúng đắn > sự ổn định > sự rõ ràng > hiệu năng đo được > tốc độ triển khai.
2. **Đơn giản trước, trừu tượng hóa sau**. Chỉ tạo lớp/hàm/hệ thống khi giải quyết nhu cầu thật; không thiết kế trước cho quy mô chưa tồn tại.
3. **Không làm ngoài phạm vi** của yêu cầu hiện tại và `PROJECT_PLAN.md`. Nếu phát hiện vấn đề ảnh hưởng trực tiếp, nêu rõ và xử lý ở mức tối thiểu an toàn.
4. **Đọc code hiện có trước khi sửa**: tìm luồng dữ liệu, convention, component, helper và test có thể tái sử dụng. Không viết lại thứ đã có.
5. **Một nguồn chân lý** cho mỗi quy tắc nghiệp vụ: status, schema, validation, cấu hình, đường dẫn, SEO và thiết kế giao diện không được định nghĩa rải rác mâu thuẫn.
6. Ưu tiên **code tường minh, dễ truy vết**, tên có nghĩa; không dùng mẹo khó hiểu để tiết kiệm vài dòng.
7. Không có “file tạm”, “bản v2”, “backup code”, “test linh tinh” trong source chính; không để code chết, TODO mơ hồ hoặc chức năng nửa vời.
8. Mọi thay đổi phải tối thiểu, có lý do, kiểm tra được và không làm hỏng chức năng đang chạy.
9. Khi thiếu dữ kiện không ảnh hưởng lớn, chọn phương án bảo thủ và ghi rõ giả định. Với thay đổi phá hủy dữ liệu, quyền truy cập, tiền hoặc production: **không tự thực hiện nếu chưa được cho phép**.
10. Không tuyên bố “đã chạy”, “đã test”, “không lỗi” nếu chưa thực sự chạy và kiểm tra.

## 2. STACK CÔNG NGHỆ — KHÔNG TỰ Ý THAY ĐỔI

- Astro + TypeScript (`strict`), Svelte cho **thành phần thực sự cần tương tác**.
- Tailwind CSS và design tokens thống nhất.
- Astro Server Endpoints/SSR trên Cloudflare Workers.
- Cloudflare D1 (SQLite), Drizzle ORM và migrations.
- Cloudflare R2 cho tệp hình ảnh; D1 chỉ lưu metadata/key.
- Tiptap mã nguồn mở cho trình soạn thảo CMS.
- npm và một lockfile duy nhất (`package-lock.json`); Git/GitHub.
- Một repository, một ứng dụng Astro cho website công khai và `/admin`.
- **Không thêm** framework backend, state-management, ORM, UI kit, queue, microservice, Redis hoặc thư viện lớn khi chưa có nhu cầu thực tế và lý do rõ ràng.
- Chỉ dùng API/runtime tương thích Cloudflare Workers; không giả định Node.js APIs luôn có trong Worker.
- Khi có thay đổi phiên bản/API quan trọng, kiểm tra tài liệu chính thức và phiên bản được cài trong `package.json` trước khi code.

## 3. QUY TRÌNH BẮT BUỘC TRƯỚC KHI CODE

1. Đọc `AGENTS.md`, `KE-HOACH.md`, `package.json`, cấu hình Astro/Wrangler/Drizzle và các file liên quan trực tiếp.
2. Xác định yêu cầu, luồng user, dữ liệu vào/ra, rủi ro và tiêu chí hoàn thành; không tự mở rộng phạm vi.
3. Tìm code có thể tái sử dụng bằng cách đọc nơi đang dùng, không suy đoán theo tên file.
4. Trình bày ngắn: **sẽ sửa file nào, vì sao, có cần migration hoặc dependency không, cách kiểm tra**.
5. Chỉ tạo file mới khi có trách nhiệm rõ ràng và không có vị trí phù hợp trong file/module hiện có.
6. Nếu thay đổi nhiều bước, làm theo từng lát cắt nhỏ hoạt động được; kiểm tra trước khi làm bước kế tiếp.
7. Không ghi đè thay đổi của người dùng, không tự xóa file lạ, không thay đổi cấu hình production ngoài phạm vi.

## 4. CẤU TRÚC THƯ MỤC CHUẨN

Cấu trúc định hướng; **chỉ tạo thư mục/file khi thực sự dùng**, không scaffold toàn bộ thư mục trống:

```text
src/
  pages/                 # Astro routes: website, /admin, /api
    index.astro
    kien-thuc/
    san-pham/
    admin/
    api/
  layouts/               # PublicLayout, AdminLayout khi cần
  components/
    ui/                  # Button, Input, Dialog... thực sự dùng chung
    public/              # Header, Footer, PostCard...
    admin/               # Sidebar, Toolbar, DataTable...
  features/              # Chỉ tạo module khi nghiệp vụ đã đủ lớn
    posts/               # schema, repository, service, component đặc thù
    products/
    orders/
    media/
    auth/
  lib/
    db/                  # drizzle client, schema, database helpers
    cloudflare/          # R2/D1 binding access khi cần
    seo/                 # metadata, canonical, structured data
    validation/          # schema chia sẻ thực sự dùng chung
  styles/                # global.css, tokens/theme
  middleware.ts          # Chỉ khi cần middleware toàn cục
migrations/              # SQL/Drizzle migration có thứ tự
public/                  # File tĩnh không qua CMS
scripts/                 # Chỉ script tái sử dụng để vận hành
AGENTS.md
PROJECT_PLAN.md
README.md
astro.config.mjs
wrangler.jsonc
package.json
```

**Quy tắc tổ chức:**
- `src/pages` **chỉ điều phối route**: parse input, gọi service, chọn response/render; không chứa truy vấn SQL và nghiệp vụ dài.
- `components` tập trung hiển thị; không truy cập DB, R2 hoặc chứa secrets.
- `features/<feature>` sở hữu nghiệp vụ cụ thể. Logic dùng chung chỉ đưa vào `lib` khi thật sự chia sẻ.
- `repository` thực hiện truy xuất dữ liệu; `service` xử lý nghiệp vụ nếu có logic đủ đáng tách. Không bắt buộc tạo đủ tầng cho CRUD đơn giản.
- Không tạo thư mục `helpers`, `common`, `misc`, `temp`, `new`, `final`, `v2` để chứa code vô tổ chức.
- Không lồng thư mục quá sâu; ưu tiên 2–4 mức có ý nghĩa, tránh “mỗi hàm một file”.
- Mỗi file có **một trách nhiệm chính**, nhưng không chia vụn các file chỉ vài dòng không mang lại lợi ích.
- Không để nhiều bản của cùng một component; thay thế và xóa bản cũ sau khi xác minh không còn được dùng.

## 5. TÊN FILE, TÊN HÀM VÀ QUY ƯỚC CODE

- Component Astro/Svelte: `PascalCase` (`PostCard.astro`, `PostEditor.svelte`).
- Hàm/biến: `camelCase` có ý nghĩa (`getPublishedPosts`, `createOrder`).
- Type/interface/class: `PascalCase`. Constant dùng chung: `UPPER_SNAKE_CASE` khi thực sự là hằng số.
- Tên file tiện ích/feature: `kebab-case.ts` hoặc convention hiện có, nhưng **nhất quán một kiểu**.
- SQL table/column: `snake_case` (`created_at`, `order_items`). Route/slug: `kebab-case`.
- Không dùng tên chung chung như `data`, `stuff`, `handle`, `helper2`, `finalNew` khi có thể đặt tên đúng nghiệp vụ.
- Không hardcode lại giá trị cấu hình, trạng thái đơn hàng, route hoặc màu sắc ở nhiều nơi.
- TypeScript `strict`; tránh `any`, non-null assertion `!`, `@ts-ignore`. Nếu ngoại lệ thật sự cần, giải thích tại chỗ và giới hạn phạm vi.
- Hàm ngắn, tập trung; dùng early return cho lỗi/điều kiện biên; hạn chế lồng `if` sâu.
- Chỉ comment **vì sao** có lựa chọn không hiển nhiên, không comment nhắc lại điều code đã nói.
- Không tối ưu hóa bằng cú pháp khó đọc hoặc generic phức tạp nếu không có lợi ích đo được.

## 6. TÁI SỬ DỤNG CODE MỘT CÁCH THÔNG MINH

1. Trước khi tạo component/hàm mới: **search nơi có chức năng tương tự** và kiểm tra API của code hiện có.
2. Logic nghiệp vụ/validation được dùng ở nhiều nơi phải đưa về một nguồn dùng chung.
3. Component giống nhau về **hành vi và cấu trúc** mới nên gộp; không ép các UI khác nhau vào một component với hàng chục props/flags.
4. Có thể giữ một ít trùng lặp rõ ràng nếu trừu tượng hóa sẽ khó hiểu hơn. Không tạo abstraction chỉ vì hai đoạn code tình cờ có vài dòng giống nhau.
5. Ưu tiên composition, hàm thuần và dependency tường minh; tránh inheritance và hệ thống plugin tự chế.
6. Khi sửa logic chung, tìm và kiểm tra **tất cả nơi gọi**, xử lý các trường hợp tương thích ngược.
7. Không tạo global store khi state chỉ thuộc một form/component. Svelte chỉ hydrate các đảo tương tác cần thiết.

## 7. LUỒNG DỮ LIỆU VÀ API

- Luồng chuẩn: **UI → Route/API → validate/auth → service (nếu cần) → repository → D1/R2**.
- Không import server-only module vào browser bundle. Không gửi secrets, DB binding hoặc mã nghiệp vụ nhạy cảm xuống client.
- Thống nhất kiểu dữ liệu/DTO và validation tại ranh giới hệ thống; **luôn xác thực lại dữ liệu ở server**.
- HTTP method, status code và error response nhất quán; không trả 200 khi thao tác thất bại.
- Lỗi người dùng phải rõ ràng; lỗi kỹ thuật nội bộ không hiển thị stack trace, SQL hoặc secrets.
- Danh sách lớn có phân trang, giới hạn số bản ghi và sắp xếp ổn định; không lấy toàn bộ orders/posts để lọc trên trình duyệt.
- Chống gửi trùng đơn hàng (idempotency hoặc cơ chế tương đương), validate số lượng và các lựa chọn sản phẩm phía server.
- Không tự tạo REST endpoint cho dữ liệu chỉ được sử dụng server-side trong chính Astro nếu route có thể gọi trực tiếp service an toàn.
- Không tạo nhiều phiên bản endpoint chỉ để giải quyết cùng một tác vụ.

## 8. DATABASE D1 + DRIZZLE

- Database schema là nguồn chân lý; tất cả thay đổi schema phải có migration được lưu trong Git.
- Không sửa schema production thủ công; không chỉnh/xóa migration đã áp dụng để che lỗi.
- Dùng tham số truy vấn/Drizzle; không nối chuỗi input vào SQL.
- Thêm `UNIQUE`, `NOT NULL`, foreign key và index dựa trên nghiệp vụ và mẫu truy vấn thực tế.
- Tránh index quá nhiều; khi truy vấn chậm, đo và kiểm tra query/index trước khi tối ưu.
- Chỉ select cột cần dùng; tránh truy vấn lặp N+1 và `SELECT *` ở những luồng dữ liệu lớn.
- Thay đổi nhiều bản ghi có liên quan phải đảm bảo tính toàn vẹn theo khả năng giao dịch/batch được runtime hỗ trợ.
- Trạng thái bài viết, đơn hàng được định nghĩa tập trung; chuyển trạng thái phải hợp lệ và được kiểm tra server-side.
- Lưu thời gian theo quy ước thống nhất (ưu tiên UTC), chuyển đổi múi giờ khi hiển thị.
- Bảo vệ thông tin cá nhân trong đơn hàng; chỉ lưu dữ liệu cần dùng, có quy trình backup và phục hồi.
- Local D1 và production D1 **tách biệt**; không chạy lệnh `--remote` hoặc migration production nếu chưa có yêu cầu rõ ràng.
- Dữ liệu demo/seed chỉ dành cho local/test, không tự chèn vào production.

## 9. MEDIA VÀ CLOUDFLARE R2

- Ảnh/file lưu ở R2; D1 chỉ lưu object key, alt text, kích thước, MIME type, metadata cần thiết.
- Chỉ endpoint đã xác thực và phân quyền mới được upload/xóa ảnh quản trị.
- Kiểm tra kích thước, MIME thực tế/định dạng cho phép, số lượng và tên file; sinh key duy nhất an toàn.
- Không cho người dùng kiểm soát tùy ý đường dẫn R2 key, domain, filesystem path hoặc URL đích.
- Tối ưu kích thước hiển thị, `width`/`height`, responsive images và lazy load **phù hợp**; ảnh LCP không lazy-load bừa bãi.
- Tránh lưu cùng một ảnh nhiều bản không cần thiết. Chỉ xóa object R2 khi chắc chắn không còn nội dung tham chiếu.
- Có chiến lược cho URL ảnh công khai/cache và xử lý lỗi upload/DB để tránh dữ liệu rác.
- Mặc định dùng R2 local khi phát triển, không tự kết nối/sửa bucket thật.

## 10. AUTHENTICATION VÀ BẢO MẬT CMS

- Mọi trang `/admin` và **mọi endpoint quản trị** phải kiểm tra session/quyền tại server. Ẩn nút trong UI **không phải phân quyền**.
- Chỉ cho phép tài khoản admin cần thiết; hash mật khẩu với thuật toán an toàn, tương thích Workers, dùng thư viện được kiểm chứng.
- Session token đủ ngẫu nhiên, có hạn dùng, thu hồi được; cookie `HttpOnly`, `Secure` ở production, `SameSite` phù hợp.
- Chống CSRF cho request thay đổi trạng thái; kiểm tra Origin và áp dụng CSRF token/biện pháp phù hợp với mô hình xác thực.
- Rate limit đăng nhập và form đặt hàng, có thể thêm Turnstile nếu phát sinh spam.
- Kiểm tra quyền sở hữu/truy cập trên mỗi thao tác đọc đơn hàng, sửa bài, upload/xóa tệp.
- Sanitize/escape nội dung từ Tiptap và mọi HTML không tin cậy trước khi render; chỉ cho phép tag, attribute, URL scheme cần thiết. Không dùng `set:html` trực tiếp cho nội dung không được kiểm soát.
- Không log mật khẩu, session, token, địa chỉ, số điện thoại hoặc dữ liệu cá nhân; không đưa secrets vào Git, HTML hoặc client JS.
- Không lưu secrets trong `PUBLIC_*`; sử dụng binding/secrets phía server và file môi trường được gitignore.
- Không vô hiệu hóa TypeScript, validation, CORS, CSP hoặc kiểm tra quyền chỉ để “chạy cho được”.

## 11. ASTRO, SVELTE, SSR VÀ HIỆU NĂNG

- Ưu tiên `.astro` cho nội dung tĩnh và các trang đọc. Chỉ dùng Svelte cho bộ soạn thảo, bộ lọc tương tác, dialog, các form có trạng thái UI phức tạp.
- Tránh `client:load` mặc định; chọn hydration directive nhẹ nhất đáp ứng trải nghiệm. Không biến blog thành SPA không cần thiết.
- Trang nội dung lấy từ D1 cần SSR hoặc chiến lược xuất bản có cơ chế cập nhật rõ ràng; không rebuild toàn site sau mỗi bài nếu đã chọn SSR.
- Trang tĩnh không phụ thuộc dữ liệu có thể prerender; không ép toàn bộ hệ thống SSR khi không cần.
- Cache nội dung công khai có thời hạn/làm mới rõ ràng; **không cache công khai** admin, session, nội dung riêng tư hoặc response đặt hàng.
- Chỉ tối ưu sau khi xác định điểm nghẽn bằng đo đạc; ưu tiên query ít hơn, payload nhỏ hơn, ảnh phù hợp và JS ít hơn.
- Không cài thư viện animation, slider, icon pack hoặc UI framework nặng chỉ cho một tác vụ nhỏ.
- Tránh tải tài nguyên không cần thiết, tránh gọi API trùng lặp, debounce tìm kiếm khi cần.
- Kiểm tra mobile, màn hình nhỏ, bàn phím, label, focus và accessibility cơ bản.

## 12. DESIGN SYSTEM VÀ GIAO DIỆN

- Màu, typography, khoảng cách, radius, shadow dùng token/theme tập trung; không hardcode màu mới tùy ý trong từng component.
- Ưu tiên UI sạch, sáng, dễ đọc, phù hợp thương hiệu vòng dâu tằm thủ công cho mẹ và bé.
- Component dùng chung chỉ tạo khi có ít nhất một nhu cầu tái sử dụng rõ ràng; không viết framework UI nội bộ.
- Tất cả form có trạng thái `loading`, `success`, `error`, validation và khả năng gửi bằng bàn phím.
- Luồng CMS ít thao tác, thao tác nguy hiểm có xác nhận; có empty state và lỗi dễ hiểu.
- Luồng đặt hàng ngắn, nút hành động rõ, không đòi đăng ký tài khoản khách hàng.
- Không hy sinh tính dễ đọc, khả năng tiếp cận và hiệu năng để lấy hiệu ứng trang trí.

## 13. SEO VÀ TÍNH ĐÚNG ĐẮN NỘI DUNG

- SEO title, description, canonical, Open Graph, breadcrumb, sitemap, robots và structured data được xử lý tập trung.
- Chỉ index bài `published`; bản nháp, trang admin, trang đặt hàng thành công và nội dung riêng tư không được index.
- Slug unique, ổn định; khi đổi slug phải có redirect 301 từ URL cũ.
- Một H1 chính/trang; heading phân cấp hợp lý; HTML ngữ nghĩa, ảnh có alt đúng nội dung.
- SSR trả về HTML có nội dung thực để công cụ tìm kiếm đọc được mà không cần client JS.
- Sơ đồ dữ liệu `Article`/`Product` chỉ xuất các thông tin có thật, đúng nội dung trang.
- Không nhồi từ khóa, không tạo nội dung hàng loạt kém chất lượng, không tạo mô tả/đánh giá sản phẩm giả.
- Nội dung liên quan em bé phải phân biệt niềm tin dân gian với bằng chứng khoa học; không tự khẳng định vòng chữa bệnh, giúp ngủ ngon hoặc bảo đảm an toàn.

## 14. KIỂM THỬ VÀ DEBUG

- Mỗi lỗi phải được **tái hiện → tìm nguyên nhân gốc → sửa tối thiểu → thêm/cập nhật test → chạy lại**. Không chữa bằng timeout, retry vô hạn, ép kiểu hoặc bỏ qua exception.
- Kiểm tra cả đường đi thành công lẫn sai dữ liệu, không có quyền, dữ liệu thiếu, lỗi DB/R2 và thao tác trùng.
- Ưu tiên unit test cho hàm thuần; integration test cho API/auth/db; e2e tối thiểu cho: đăng nhập, xuất bản bài, xem bài, đặt hàng.
- Test phải quyết định được pass/fail, không gọi production và không phụ thuộc dữ liệu thật.
- Dùng dữ liệu giả không mang PII thật. Mock tại ranh giới ngoài khi cần; không mock cả logic cần kiểm tra.
- Sau khi sửa, chạy các script **thực sự có trong `package.json`**: typecheck/Astro check, lint, test, build và các test liên quan.
- Nếu thiếu script kiểm tra cần thiết, bổ sung một cách tối thiểu; không nói đã chạy một command chưa tồn tại.
- Console log chỉ dùng để debug có chủ đích; xóa log tạm sau khi xử lý. Với lỗi server, log có ngữ cảnh kỹ thuật và mã lỗi, không tiết lộ dữ liệu nhạy cảm.
- Nếu không thể chạy test do môi trường, ghi rõ **chưa kiểm chứng gì, vì sao, lệnh/nghiệm thu thủ công nào cần thực hiện**.

## 15. DEPENDENCIES, BUILD VÀ MÔI TRƯỜNG

- Trước khi cài package: kiểm tra thư viện hiện có và API nền tảng có làm được không; chọn dependency được duy trì, tương thích Workers và giấy phép phù hợp.
- Không tự nâng cấp hàng loạt phiên bản; không chạy auto-fix phá thay đổi hoặc thay package manager tùy tiện.
- Khóa version bằng lockfile; không commit `.env`, `.dev.vars`, token, dữ liệu local, `node_modules`, `dist`, `.wrangler`.
- Không chỉnh sửa file được sinh tự động bằng tay nếu có nguồn tạo chính thức.
- Có hướng dẫn rõ lệnh cài, dev, migrate local, seed local, check, build, deploy trong README.
- D1/R2 development mặc định dùng mô phỏng local; không đồng bộ dữ liệu local sang production tùy tiện.
- Migrations production, deploy production, xóa dữ liệu hay thay đổi DNS cần có yêu cầu/phê duyệt rõ ràng.
- Mọi cấu hình môi trường phải có tên dễ hiểu, giá trị mẫu không chứa secrets và báo lỗi rõ khi thiếu binding bắt buộc.

## 16. QUY TẮC KHI THAY ĐỔI / REFACTOR

1. Không refactor toàn bộ dự án chỉ vì đang sửa một lỗi nhỏ.
2. Giữ nguyên API/public behavior nếu không có yêu cầu thay đổi.
3. Khi cần đổi tên/hình thức dữ liệu: tìm toàn bộ nơi sử dụng, cập nhật đồng bộ và kiểm tra migration.
4. Không tạo file mới nếu sửa file hiện có gọn và đúng trách nhiệm hơn.
5. Không xóa code, migration, dữ liệu, ảnh hoặc phụ thuộc khi chưa chắc không còn được dùng.
6. Không để lại implementation cũ song song với implementation mới sau khi chuyển đổi thành công.
7. Tối ưu hiệu năng chỉ khi có số liệu hoặc vấn đề cụ thể; không thêm cache/state/abstraction theo cảm tính.

## 17. ĐỊNH NGHĨA HOÀN THÀNH (DEFINITION OF DONE)

Một tác vụ chỉ được xem là hoàn thành khi:

- Đáp ứng đúng chức năng đã yêu cầu, không tự phát sinh chức năng khác.
- Đặt code đúng thư mục; không có file/thư viện thừa.
- Logic, dữ liệu, quyền truy cập và tình huống lỗi được xử lý đúng.
- Không lộ secrets/PII; có validation và kiểm soát bảo mật phù hợp.
- Đã cập nhật test cho hành vi mới/thay đổi và chạy kiểm tra khả thi.
- Typecheck, lint, build và test liên quan đều đạt, hoặc báo rõ phần chưa chạy và lý do.
- Nếu thay schema đã tạo migration; nếu thay cấu hình/hướng dẫn đã cập nhật README.
- Những thay đổi liên quan nội dung công khai được kiểm tra SEO cơ bản và mobile.
- Hoàn thành một bước có thể demo/chạy thử độc lập trước khi chuyển bước kế tiếp.

## 18. ĐỊNH DẠNG BÁO CÁO SAU MỖI TÁC VỤ

Phản hồi **ngắn, có căn cứ**, gồm:

1. **Đã làm:** chức năng/thay đổi cụ thể.
2. **File thay đổi:** danh sách file chính và lý do (không liệt kê file không sửa).
3. **Đã kiểm tra:** tên lệnh và kết quả thực tế, hoặc giới hạn kiểm thử.
4. **Lưu ý:** migration, biến môi trường, rủi ro, bước thủ công cần thiết.
5. **Bước tiếp theo:** duy nhất bước tiếp theo hợp lý theo `PROJECT_PLAN.md` (nếu có).

Không trả lời chung chung như “đã tối ưu”, “đã bảo mật” hoặc “mọi thứ hoàn hảo” khi không có kiểm chứng.

## 19. CHECKLIST TỰ KIỂM TRA TRƯỚC MỌI COMMIT / BÀN GIAO

- [ ] Tôi đã đọc những file liên quan trước khi sửa?
- [ ] Thay đổi này có đúng yêu cầu, ít file và ít dependency nhất hợp lý?
- [ ] Có đang tạo trùng code/component/logic hoặc tạo abstraction quá sớm?
- [ ] File nằm đúng tầng và tên có rõ trách nhiệm?
- [ ] Validation, authentication/authorization, CSRF/XSS và xử lý lỗi đã phù hợp?
- [ ] D1/R2 local và production có được tách biệt an toàn?
- [ ] Query, ảnh, client JS và cache có hợp lý với mục tiêu tốc độ?
- [ ] SEO và accessibility có bị ảnh hưởng?
- [ ] Test, typecheck và build đã chạy và kết quả được báo trung thực?
- [ ] Không còn file rác, log debug, secrets hoặc code chết?

**Nguyên tắc cuối cùng: Viết ít code nhất có thể, nhưng đủ đúng, đủ an toàn và dễ duy trì. Chỉ thêm độ phức tạp khi có lý do kỹ thuật hoặc nhu cầu sản phẩm cụ thể.**
