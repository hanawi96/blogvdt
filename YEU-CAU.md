# Yêu cầu xây dựng website blog SEO và bán vòng dâu tằm

Tài liệu này ghi lại toàn bộ yêu cầu dự án. Chưa có kế hoạch triển khai chi tiết và chưa có mã nguồn.

## 1. Mục tiêu dự án

Xây dựng website chuyên về vòng dâu tằm thủ công cho trẻ em, với hai mục tiêu chính:

1. Blog chia sẻ kiến thức về vòng dâu tằm, tối ưu SEO để thu hút khách từ Google.
2. Giới thiệu sản phẩm và cho phép khách đặt mua trực tiếp trên website.

Tự phát triển một CMS riêng để quản lý nội dung, sản phẩm và đơn hàng. Chỉ làm các chức năng cơ bản, thực sự cần thiết. Không dùng WordPress hay CMS có sẵn phức tạp.

### Ràng buộc chung

- Giao diện đẹp, hiện đại, chuyên nghiệp, dễ dùng.
- Tải trang nhanh, tối ưu Core Web Vitals.
- Thiết kế Mobile-first, dùng tốt trên mọi thiết bị.
- Tối ưu SEO Google ngay từ kiến trúc ban đầu.
- Không thuê VPS hay hosting truyền thống.
- Ưu tiên dịch vụ miễn phí của Cloudflare trong hạn mức.
- Phát triển, chạy thử và kiểm tra trên localhost.
- Sau khi hoàn thiện, triển khai lên Cloudflare mà không viết lại hệ thống.
- Kiến trúc đơn giản, dễ mở rộng và bảo trì lâu dài.
- Không xây chức năng phức tạp, không cần thiết.

## 2. Công nghệ bắt buộc

| Thành phần | Công nghệ |
|---|---|
| Frontend | Astro + TypeScript |
| CSS | Tailwind CSS |
| UI tương tác | Svelte |
| Backend | Astro Server Endpoints |
| Database | Cloudflare D1 |
| ORM | Drizzle ORM |
| Lưu trữ hình ảnh | Cloudflare R2 |
| Rich Text Editor | Tiptap (mã nguồn mở) |
| Hosting / Runtime | Cloudflare Workers |
| Quản lý source | Git + GitHub |
| Authentication | Session bảo mật bằng HttpOnly Cookies |

- Dùng phiên bản ổn định, tương thích mới nhất theo tài liệu chính thức.
- Một dự án Astro duy nhất: frontend công khai, CMS và server endpoints.
- SSR cho trang lấy nội dung từ database, để đăng bài mới không cần build lại.
- Cache phù hợp để giảm truy vấn D1 và tăng tốc truy cập.

## 3. Website công khai

### 3.1. Trang chủ

- Header: logo, menu điều hướng.
- Banner giới thiệu thương hiệu vòng dâu tằm.
- Đặc điểm nổi bật của sản phẩm.
- Danh sách sản phẩm nổi bật.
- Danh sách bài viết mới nhất.
- Khu vực giới thiệu quy trình sản xuất thủ công.
- Nút xem sản phẩm và đặt hàng.
- Footer: thông tin liên hệ, chính sách, liên kết cần thiết.

### 3.2. Trang blog

- Danh sách bài viết dạng card.
- Ảnh đại diện, tiêu đề, mô tả ngắn, ngày đăng.
- Phân trang khi có nhiều bài.
- Lọc theo danh mục.
- URL rõ ràng, thân thiện SEO.

### 3.3. Trang chi tiết bài viết

- Tiêu đề H1.
- Nội dung đầy đủ: H2, H3, danh sách, hình ảnh, bảng, liên kết.
- Mục lục tự động từ các heading.
- Breadcrumb.
- Ngày đăng và ngày cập nhật.
- Bài viết liên quan.
- Khu vực sản phẩm liên quan.
- Nút đặt hàng hoặc xem sản phẩm.
- Giao diện đọc dễ chịu, tối ưu trên điện thoại.

### 3.4. Trang sản phẩm

- Danh sách sản phẩm: ảnh đại diện, tên, giá bán.
- Trang chi tiết: album hình, mô tả, lựa chọn cơ bản, nút đặt hàng.

### 3.5. Đặt hàng

Form đơn giản:

- Họ tên.
- Số điện thoại.
- Địa chỉ nhận hàng.
- Sản phẩm.
- Số lượng.
- Lựa chọn kích thước hoặc mẫu vòng.
- Ghi chú bổ sung.

Khi khách gửi đơn:

- Kiểm tra dữ liệu phía server.
- Chống spam và gửi đơn trùng lặp.
- Lưu đơn vào Cloudflare D1.
- Thông báo đặt hàng thành công.
- Đơn xuất hiện trong CMS.

Giai đoạn đầu chưa cần: giỏ hàng phức tạp, tài khoản khách, thanh toán trực tuyến, kết nối vận chuyển.

## 4. CMS quản trị (`/admin`)

Giao diện đẹp, hiện đại, sáng, chuyên nghiệp, dễ thao tác, dùng tốt trên desktop.

Bố cục: sidebar điều hướng, header quản trị, vùng nội dung chính.

Chỉ các module dưới đây.

### 4.1. Đăng nhập

- Đăng nhập bằng tài khoản và mật khẩu.
- Bảo vệ toàn bộ trang quản trị.
- Session bảo mật.
- Cookie HttpOnly; Secure khi production.
- Mật khẩu hash bằng thuật toán an toàn.
- Đăng xuất và hết hạn phiên.
- Giới hạn đăng nhập sai.
- Một vai trò Administrator.

### 4.2. Dashboard

- Tổng số bài viết.
- Số bài đã xuất bản.
- Tổng số sản phẩm.
- Tổng số đơn hàng.
- Số đơn hàng mới.
- Danh sách đơn hàng gần đây.

Không làm biểu đồ phức tạp.

### 4.3. Quản lý bài viết

- Danh sách, tìm kiếm, lọc theo trạng thái.
- Tạo, sửa, xóa (có xác nhận).
- Lưu nháp, xuất bản, gỡ xuất bản.
- Quản lý danh mục.

Form bài viết:

- Tiêu đề.
- Slug tự tạo từ tiêu đề, chỉnh sửa được.
- Ảnh đại diện.
- Danh mục.
- Nội dung.
- SEO Title.
- Meta Description.
- Trạng thái.

Tiptap, toolbar gọn:

- Heading H2, H3.
- In đậm, in nghiêng.
- Danh sách.
- Liên kết.
- Chèn hình ảnh.
- Trích dẫn.
- Undo / Redo.

Nội dung lưu có cấu trúc, hiển thị đúng trên website, an toàn trước XSS.

### 4.4. Quản lý sản phẩm

- Danh sách; thêm, sửa, xóa.
- Tên và slug.
- Giá bán.
- Ảnh đại diện và album.
- Mô tả.
- Trạng thái đang bán hoặc ngừng bán.
- SEO Title và Meta Description.

### 4.5. Quản lý đơn hàng

- Danh sách và chi tiết khách hàng, sản phẩm.
- Tìm kiếm.
- Lọc theo trạng thái.
- Cập nhật trạng thái: Mới, Đã xác nhận, Đang chuẩn bị, Đã gửi, Hoàn thành, Đã hủy.
- Lưu thời gian tạo và cập nhật.

### 4.6. Thư viện hình ảnh

- Upload lên Cloudflare R2.
- Xem danh sách ảnh.
- Chọn ảnh chèn vào bài viết hoặc sản phẩm.
- Đổi tên tệp an toàn khi upload.
- Kiểm tra định dạng và kích thước.
- Alt text.
- Chặn loại file nguy hiểm.
- Tối ưu kích thước ảnh khi phù hợp.
- Không lưu dữ liệu nhị phân ảnh trong D1.

### 4.7. Cài đặt website

- Tên website.
- Logo.
- Favicon.
- Mô tả website.
- Thông tin liên hệ.
- Số điện thoại.
- Liên kết Facebook / Zalo.
- SEO mặc định.

## 5. Database

Cloudflare D1 và Drizzle ORM. Schema tối giản, đủ dùng:

- `admin_users`
- `sessions`
- `categories`
- `posts`
- `products`
- `media`
- `orders`
- `order_items` (nếu cần)
- `site_settings`

Yêu cầu:

- Primary key, foreign key và index hợp lý.
- Unique slug cho bài viết và sản phẩm.
- `created_at`, `updated_at` khi cần.
- Database migrations.
- Không viết SQL thiếu an toàn; truy vấn có tham số.
- Dữ liệu mẫu để chạy demo.
- Hướng dẫn backup và khôi phục database.

## 6. SEO Google

- HTML render phía server cho nội dung công khai.
- SEO Title và Meta Description riêng từng trang.
- Canonical URL.
- Open Graph và Twitter Cards.
- Sitemap XML tự cập nhật khi có bài mới.
- `robots.txt`.
- Breadcrumb.
- Schema Article.
- Schema Product khi phù hợp.
- Cấu trúc heading chuẩn.
- URL thân thiện SEO.
- Tối ưu hình ảnh, alt text, lazy loading phù hợp.
- Liên kết nội bộ.
- Redirect 301 khi đổi slug.
- Trang 404.
- Không index trang admin và trang không cần thiết.
- Bản nháp không xuất hiện công khai.
- Cache và cơ chế làm mới nội dung khi chỉnh sửa.
- Google đọc được nội dung bài viết từ HTML, không cần chạy JavaScript trên trình duyệt.

## 7. Design system và UI/UX

Phong cách: hiện đại, tối giản, chuyên nghiệp. Tông sáng, nhẹ, tự nhiên, phù hợp sản phẩm thủ công cho mẹ và bé. Typography dễ đọc, khoảng trắng hợp lý, button và form rõ ràng. Mobile-first, responsive toàn bộ màn hình.

Tailwind CSS, kèm Design System nhất quán:

- Token tập trung: màu, typography, spacing, border radius.
- Không hardcode màu tùy ý trong từng component.
- Tái sử dụng component chung.
- Đủ loading, empty state, validation, error state.
- Hạn chế animation không cần thiết.
- Ưu tiên trải nghiệm nhanh, dễ dùng.

## 8. Kiến trúc và chất lượng code

- TypeScript strict.
- Cấu trúc thư mục rõ ràng.
- Tách UI, business logic và truy cập database.
- Frontend không truy cập database bằng thông tin bí mật.
- Validate cả client và server.
- Mọi API quản trị được xác thực và phân quyền phía server.
- Chống CSRF và XSS cho thao tác thay đổi dữ liệu.
- Biến môi trường cho cấu hình.
- Không hardcode API token hoặc credentials.
- Xử lý lỗi nhất quán.
- Không cài thư viện khi chưa cần.
- Code đơn giản, rõ, dễ bảo trì.

## 9. Localhost và deploy

Toàn bộ dự án chạy và kiểm tra được trên Windows.

### Local

- Astro trên localhost.
- Wrangler chạy D1 local.
- R2 local hoặc giải pháp giả lập phù hợp.
- Dữ liệu mẫu cho CMS, blog, sản phẩm, đơn hàng.
- Lệnh migrations và seed.
- Hướng dẫn khởi động rõ ràng.

### Production

- Cloudflare Workers.
- D1 production.
- R2 cho hình ảnh.
- Domain riêng, HTTPS.
- Secrets an toàn.
- Deploy từ GitHub.
- Không cần VPS.

Phân biệt rõ development và production để tránh thao tác nhầm dữ liệu.

## 10. Lộ trình đã chốt (làm lần lượt, kiểm tra từng giai đoạn)

### Giai đoạn 1 — Nền tảng

- Khởi tạo Astro.
- Cài Tailwind và Svelte.
- Tích hợp Cloudflare Workers.
- Cấu hình D1, R2, Drizzle.
- Schema và migrations.
- Design System và cấu trúc source code.

### Giai đoạn 2 — CMS

- Đăng nhập quản trị.
- Layout CMS.
- Quản lý bài viết.
- Tiptap Editor.
- Danh mục.
- Upload và chọn ảnh R2.

### Giai đoạn 3 — Website blog

- Trang chủ.
- Danh sách bài viết.
- Trang chi tiết bài.
- Danh mục.
- Dữ liệu từ D1.
- SEO cơ bản và nâng cao.

### Giai đoạn 4 — Bán hàng

- Quản lý sản phẩm.
- Trang sản phẩm.
- Form đặt hàng.
- Lưu và quản lý đơn hàng.

### Giai đoạn 5 — Hoàn thiện

- Responsive.
- Tối ưu hiệu năng.
- Kiểm thử bảo mật.
- Kiểm tra SEO.
- Sitemap và schema.
- Kiểm thử quy trình từ CMS ra website.
- Deploy Cloudflare.
- Hướng dẫn vận hành và backup.

## 11. Cách làm việc

Trước khi viết code (làm khi được yêu cầu, không làm trước):

1. Phân tích yêu cầu và xác nhận kiến trúc kỹ thuật, ưu tiên đơn giản và tiết kiệm tài nguyên.
2. Kế hoạch triển khai chi tiết theo từng giai đoạn.
3. Đề xuất cấu trúc thư mục.
4. Thiết kế database schema.
5. Xác định API endpoints thực sự cần thiết.
6. Liệt kê thư viện cần cài và lý do.
7. Tiêu chí kiểm tra từng giai đoạn hoàn thành.

Nguyên tắc khi phát triển:

- Làm từng giai đoạn, không triển khai ồ ạt.
- Mỗi giai đoạn phải chạy được và kiểm tra thành công trước khi chuyển tiếp.
- Không tự ý thêm chức năng ngoài phạm vi.
- Không viết code giả, không chỉ dựng giao diện khi chức năng cần chạy thật.
- Có hướng dẫn chạy và kiểm tra.
- Ưu tiên giải pháp nhẹ, hiệu quả, dễ mở rộng.

Mục tiêu cuối: website blog SEO và bán vòng dâu tằm, CMS riêng, ổn định, nhanh, bảo mật, dễ dùng, tự quản lý, vận hành trên Cloudflare mà không thuê VPS.
