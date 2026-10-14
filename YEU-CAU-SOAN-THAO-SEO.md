# YÊU CẦU NÂNG CẤP TRANG SOẠN THẢO BÀI VIẾT VÀ HỆ THỐNG SEO CHO CMS

## 1. VAI TRÒ VÀ MỤC TIÊU

Hãy đóng vai một Senior Full-stack Developer, chuyên gia UI/UX, Technical SEO và Software Architect có nhiều kinh nghiệm xây dựng hệ thống CMS chuyên nghiệp.

Tôi đang phát triển website blog SEO và bán vòng dâu tằm, sử dụng:

- Astro + TypeScript.
- Svelte cho các thành phần tương tác.
- Tiptap Rich Text Editor.
- Cloudflare Workers.
- Cloudflare D1.
- Cloudflare R2.
- Drizzle ORM.
- Tailwind CSS.

Hiện tại tôi đã có trang thêm/sửa bài viết với các trường tiêu đề, slug, danh mục, ảnh đại diện, nội dung, SEO title, mô tả SEO và trạng thái bài viết.

Tuy nhiên, giao diện còn đơn giản, thao tác chưa thuận tiện và chưa có đầy đủ các tính năng hỗ trợ SEO.

**Mục tiêu:** Nâng cấp trang viết bài thành một công cụ biên tập nội dung chuyên nghiệp, hiện đại, dễ sử dụng, tối ưu SEO Google và hỗ trợ xuất bản bài viết nhanh chóng.

Trải nghiệm mong muốn tương tự WordPress kết hợp Rank Math SEO, nhưng không sao chép toàn bộ tính năng và không làm hệ thống phức tạp.

## 2. NGUYÊN TẮC BẮT BUỘC

Trước khi sửa code:

1. Đọc toàn bộ `AGENTS.md` và `PROJECT_PLAN.md`.
2. Kiểm tra cấu trúc source code hiện tại.
3. Kiểm tra trang thêm và chỉnh sửa bài viết.
4. Kiểm tra Tiptap Editor hiện đang sử dụng.
5. Kiểm tra database schema, API, validation và cơ chế lưu bài viết.
6. Xác định các chức năng đã tồn tại để tái sử dụng.
7. Đề xuất kế hoạch nâng cấp ngắn gọn trước khi triển khai.

Yêu cầu tuyệt đối:

- KHÔNG xây dựng lại CMS từ đầu.
- KHÔNG thay đổi framework hoặc kiến trúc hiện tại khi không cần thiết.
- KHÔNG tự ý xóa hay làm mất bài viết và dữ liệu cũ.
- KHÔNG viết lại chức năng đã hoạt động ổn định nếu có thể tái sử dụng.
- KHÔNG tạo thêm thư viện, component hoặc file không cần thiết.
- KHÔNG phức tạp hóa hệ thống.
- Mọi tính năng phải có logic hoạt động thực tế, không chỉ là UI giả.
- Ưu tiên code sạch, tái sử dụng hợp lý, dễ debug và dễ bảo trì.
- Chỉ thêm database migration khi thật sự cần thiết.
- Không tự ý triển khai production hoặc sửa dữ liệu production.

## 3. THIẾT KẾ LẠI GIAO DIỆN TRANG VIẾT BÀI

### 3.1. Bố cục tổng thể

Thiết kế lại giao diện desktop thành hai cột:

**Cột trái — khoảng 70%:**
- Tiêu đề bài viết.
- Khu vực soạn thảo nội dung Tiptap.
- Khu vực tối ưu SEO.
- Google Search Preview.

**Cột phải — khoảng 30%:**
- Trạng thái xuất bản.
- Danh mục bài viết.
- Ảnh đại diện.
- Đường dẫn slug.
- Thông tin bài viết.
- SEO Checklist.

Sidebar có thể sticky khi phù hợp, nhưng không gây khó khăn khi cuộn trang.

Trên điện thoại, bố cục chuyển thành một cột, các khu vực cài đặt có thể thu gọn thành accordion.

### 3.2. Thanh công cụ trên cùng

Tạo thanh hành động sticky gồm:

- Quay lại danh sách bài viết.
- Trạng thái: Đã lưu / Đang lưu / Lưu thất bại.
- Lưu nháp.
- Xem trước.
- Xuất bản hoặc Cập nhật.

Sử dụng icon hợp lý, tooltip khi cần và trạng thái loading rõ ràng.

Không đặt nút Xóa bài viết sát nút Lưu hoặc Xuất bản. Chuyển thao tác xóa vào menu riêng, có xác nhận trước khi thực hiện.

### 3.3. Phong cách thiết kế

- Giao diện sáng, tối giản, hiện đại.
- Đồng nhất với Design System CMS hiện tại.
- Khoảng trắng hợp lý.
- Border nhẹ, bo góc vừa phải.
- Typography rõ ràng.
- Các trường nhập liệu có kích thước phù hợp.
- Không sử dụng những nút quá lớn gây tốn diện tích.
- Có đầy đủ hover, focus, disabled, loading và error states.
- Đảm bảo keyboard accessibility.

## 4. NÂNG CẤP TRÌNH SOẠN THẢO TIPTAP

Tiếp tục sử dụng Tiptap hiện có.

Nếu đang dùng phiên bản giao diện Simple Editor thì ưu tiên giữ lại và tối ưu, không thay thế bằng editor khác.

### 4.1. Thanh công cụ soạn thảo

Hỗ trợ:

- Heading H2, H3.
- Đoạn văn thông thường.
- In đậm, in nghiêng, gạch chân.
- Danh sách dấu chấm và danh sách đánh số.
- Trích dẫn.
- Chèn liên kết và bỏ liên kết.
- Chèn hình ảnh.
- Chèn bảng cơ bản.
- Undo/Redo.
- Phím tắt thông dụng.

Ưu tiên icon toolbar nhỏ gọn, tooltip tiếng Việt.

Không thêm các chức năng định dạng ít sử dụng.

### 4.2. Trải nghiệm viết bài

- Vùng soạn thảo rộng rãi, dễ đọc.
- Không giới hạn chiều cao khiến người viết phải cuộn trong editor và ngoài trang cùng lúc.
- Placeholder rõ ràng khi chưa có nội dung.
- Hỗ trợ bôi đen và định dạng văn bản.
- Giữ vị trí con trỏ ổn định khi chỉnh sửa.
- Không bị mất focus khi thao tác toolbar.
- Không bị giật hoặc render lại toàn bộ editor khi nhập liệu.
- Hỗ trợ dán nội dung từ nguồn bên ngoài, làm sạch định dạng không cần thiết.
- Giữ đúng dấu tiếng Việt và các ký tự Unicode.

### 4.3. Chèn và quản lý hình ảnh

Tích hợp trực tiếp với thư viện ảnh R2 đang có:

- Upload ảnh mới.
- Chọn ảnh đã upload.
- Chèn vào vị trí con trỏ hiện tại.
- Thay đổi kích thước hiển thị hợp lý.
- Thêm mô tả ALT.
- Thêm caption nếu cần.
- Xóa ảnh khỏi nội dung mà không tự động xóa file R2.
- Hiển thị loading khi upload.
- Xử lý upload thất bại.

Tái sử dụng API và component quản lý ảnh hiện có.

Chỉ tải Tiptap và các thư viện editor trong CMS, không tải chúng lên trang blog công khai.

## 5. BỔ SUNG CÁC TRƯỜNG SEO CẦN THIẾT

Giữ các trường hiện có, bổ sung hoặc cải tiến:

### 5.1. SEO Title

- Tùy chỉnh riêng cho từng bài.
- Nếu để trống thì mặc định sử dụng tiêu đề bài viết.
- Hiển thị số ký tự.
- Cảnh báo khi quá dài hoặc quá ngắn theo mức tham khảo.
- Không giới hạn cứng số ký tự.

### 5.2. Meta Description

- Cho phép nhập mô tả riêng.
- Có bộ đếm ký tự.
- Có hướng dẫn độ dài tham khảo.
- Không chặn lưu chỉ vì mô tả dài hoặc ngắn.
- Nếu bỏ trống, có thể tạo mô tả dự phòng từ phần tóm tắt bài viết.

### 5.3. Slug

- Tự động tạo slug thân thiện SEO từ tiêu đề tiếng Việt.
- Loại bỏ dấu tiếng Việt và ký tự không phù hợp.
- Kiểm tra slug trùng.
- Cho phép chỉnh sửa thủ công.
- Không tự thay đổi slug của bài đã xuất bản khi sửa tiêu đề.
- Nếu thay slug của bài đã xuất bản, phải tạo redirect 301 từ URL cũ sang URL mới.

### 5.4. Tóm tắt bài viết

Bổ sung trường Excerpt:

- Nội dung mô tả ngắn của bài.
- Hiển thị trên danh sách bài blog.
- Có thể dùng làm fallback cho Meta Description.
- Không bắt buộc nhập nếu hệ thống có thể tạo bản tóm tắt phù hợp.

### 5.5. Từ khóa trọng tâm

Thêm trường Focus Keyword tùy chọn:

- Dùng để hỗ trợ kiểm tra nội dung trong CMS.
- Không phải Meta Keywords HTML.
- Không sử dụng để ép mật độ từ khóa.
- Không bắt buộc có từ khóa mới được xuất bản.

## 6. GOOGLE SEARCH PREVIEW

Xây dựng component mô phỏng kết quả hiển thị trên Google Search.

Hiển thị:

- Tên website.
- Domain và đường dẫn bài viết.
- SEO Title.
- Meta Description.

Yêu cầu:

- Xem trước thay đổi ngay khi nhập dữ liệu.
- Sử dụng dữ liệu thực tế từ form.
- Có giao diện gọn, giống kết quả tìm kiếm Google ở mức tham khảo.
- Có thể xem cách hiển thị trên desktop và mobile nếu triển khai đơn giản.
- Không cần gọi Google API.
- Ghi rõ đây chỉ là bản xem trước, Google có thể sử dụng title hoặc snippet khác.

Tách component này để tái sử dụng cho bài viết và trang sản phẩm sau này.

## 7. HỆ THỐNG SEO CHECKLIST

Tạo hệ thống kiểm tra SEO tự động dựa trên dữ liệu bài viết đang soạn.

### 7.1. Các kiểm tra cơ bản

- Bài viết có tiêu đề.
- Slug hợp lệ và không trùng.
- Có nội dung.
- Có SEO Title hoặc fallback.
- Có Meta Description hoặc fallback.
- Có ảnh đại diện.
- Ảnh có ALT phù hợp.
- Cấu trúc Heading hợp lý.
- Có liên kết nội bộ nếu phù hợp.
- Có thông tin tác giả và ngày đăng.

### 7.2. Cách hiển thị

Mỗi mục có một trong ba trạng thái:

- Đạt.
- Cần cải thiện.
- Chưa kiểm tra hoặc không áp dụng.

Cho phép bấm vào mục cảnh báo để di chuyển đến trường cần chỉnh sửa khi có thể.

Phân biệt:

**Lỗi bắt buộc xử lý:** Ví dụ thiếu tiêu đề, slug trùng, dữ liệu không hợp lệ.

**Gợi ý SEO:** Ví dụ thiếu ảnh đại diện hoặc liên kết nội bộ.

Chỉ lỗi dữ liệu thực sự nghiêm trọng mới chặn thao tác xuất bản.

Không cần xây dựng thuật toán chấm điểm SEO phức tạp.

Không sử dụng số điểm SEO làm tiêu chí đảm bảo thứ hạng Google.

## 8. CHỨC NĂNG XEM TRƯỚC BÀI VIẾT

Thêm nút Xem trước để quản trị viên kiểm tra bài viết trước khi xuất bản.

Yêu cầu:

- Nội dung hiển thị bằng giao diện thực tế của website.
- Hiển thị đúng tiêu đề, ảnh và các thành phần nội dung.
- Có thể kiểm tra trên desktop/mobile.
- Bài nháp không xuất hiện trong danh sách blog công khai.
- Không cho phép người chưa được xác thực truy cập bản nháp.
- Nếu sử dụng preview token thì token phải có thời hạn và được kiểm tra phía server.
- URL preview không được Google lập chỉ mục.

Đối với bài đang chỉnh sửa chưa lưu, cần có cơ chế preview dữ liệu đang soạn mà không bắt buộc phải xuất bản.

## 9. TỰ ĐỘNG LƯU BÀI VIẾT

Triển khai autosave với nguyên tắc:

- Chỉ lưu khi dữ liệu thực sự thay đổi.
- Debounce khoảng 2–3 giây sau khi ngừng nhập.
- Không gửi request liên tục cho mỗi ký tự.
- Hiển thị trạng thái Đang lưu, Đã lưu, Lưu thất bại.
- Nếu lỗi mạng, không làm mất nội dung đang soạn.
- Không xóa nội dung form khi request thất bại.
- Chống request lưu cũ ghi đè phiên bản mới.
- Không gây lưu trùng lặp.
- Không tự động xuất bản bài đang là bản nháp.

Nếu bài đã xuất bản được chỉnh sửa, cần xác định rõ autosave chỉ cập nhật dữ liệu nào và thời điểm thay đổi được hiển thị công khai. Không vô tình công khai nội dung chưa hoàn thiện.

Ưu tiên cơ chế đơn giản, đáng tin cậy hơn các hệ thống versioning phức tạp.

## 10. QUẢN LÝ XUẤT BẢN

Trạng thái bài viết tối thiểu:

- Draft.
- Published.

Các chức năng:

- Lưu nháp.
- Xuất bản.
- Cập nhật bài đã xuất bản.
- Chuyển bài đã xuất bản về nháp.
- Xóa bài có xác nhận.

Lưu thông tin:

- created_at.
- updated_at.
- published_at.
- updated_by nếu hệ thống hiện có hỗ trợ.

Không cần làm tính năng lên lịch đăng bài ở giai đoạn này.

## 11. SEO KỸ THUẬT PHÍA WEBSITE ASTRO

Không chỉ nâng cấp form quản trị. Phải kiểm tra và hoàn thiện SEO thực tế của các trang blog công khai.

### 11.1. HTML và Metadata

- Nội dung blog được server-render bằng Astro.
- Có title và meta description hợp lệ.
- Canonical URL chính xác.
- Open Graph metadata.
- Twitter Card metadata.
- Ngôn ngữ HTML là `vi`.
- Heading H1 duy nhất theo cấu trúc trang, nội dung bắt đầu từ H2/H3.
- Ảnh responsive và có kích thước phù hợp.

### 11.2. Sitemap

- Tạo sitemap XML tự động.
- Bao gồm các bài viết Published có thể lập chỉ mục.
- Không đưa bài Draft vào sitemap.
- Hỗ trợ lastmod chính xác khi phù hợp.
- Sitemap hoạt động khi thêm, sửa, xóa bài mà không cần deploy lại ứng dụng.

### 11.3. Robots và Canonical

- Trang admin không được lập chỉ mục.
- Trang preview không được lập chỉ mục.
- Không cho phép công khai nội dung bài Draft.
- Tạo canonical chính thức cho từng bài.
- Không tạo URL trùng nội dung không cần thiết.

### 11.4. Structured Data

Tự sinh JSON-LD khi phù hợp:

- BlogPosting.
- BreadcrumbList.

Dữ liệu phải lấy từ bài viết thực tế, không tự bịa thông tin tác giả, ngày đăng hay hình ảnh.

### 11.5. Redirect

Khi bài viết đã xuất bản thay đổi slug:

- Lưu URL cũ.
- Redirect 301 sang URL mới.
- Không tạo vòng lặp chuyển hướng.
- Kiểm tra tránh xung đột slug.
- Không làm hỏng các liên kết bài viết cũ.

### 11.6. Cache

Sử dụng cache hợp lý để giảm truy vấn Cloudflare D1.

- Không cache nhầm nội dung bản nháp.
- Không cache công khai dữ liệu quản trị.
- Đảm bảo bài mới hoặc bài đã sửa được cập nhật trong thời gian phù hợp.
- Không yêu cầu build lại website sau mỗi lần đăng bài.
- Không đánh đổi tính chính xác dữ liệu để đạt tốc độ.

## 12. LIÊN KẾT NỘI BỘ VÀ SẢN PHẨM LIÊN QUAN

Vì đây là website blog SEO kết hợp bán vòng dâu tằm, bổ sung các chức năng đơn giản:

### 12.1. Liên kết nội bộ

Trong Tiptap, khi chèn liên kết:

- Có thể nhập URL thủ công.
- Có thể tìm kiếm bài viết đã xuất bản trong CMS.
- Chọn bài viết để tự chèn URL.
- Ưu tiên đường dẫn nội bộ đúng với frontend.

### 12.2. Sản phẩm liên quan

Cho phép chọn một hoặc một số sản phẩm liên quan tới bài viết nếu cần.

Website có thể hiển thị khối giới thiệu sản phẩm ở cuối bài.

Thông tin sản phẩm lấy trực tiếp từ database, không copy thủ công giá và tên sản phẩm vào nội dung bài viết.

Nếu chức năng này chưa có sẵn, triển khai sau khi các phần chỉnh sửa và SEO cơ bản hoàn thiện.

## 13. DATABASE VÀ TƯƠNG THÍCH DỮ LIỆU CŨ

Trước khi thay đổi database:

- Kiểm tra cấu trúc bảng posts hiện tại.
- Kiểm tra kiểu dữ liệu content đang lưu.
- Kiểm tra dữ liệu Tiptap JSON hoặc HTML.
- Tận dụng những trường đã có.
- Không tạo các trường trùng chức năng.
- Chỉ tạo migrations cho dữ liệu thực sự thiếu.
- Không xóa bảng hoặc cột đang chứa dữ liệu mà chưa có kế hoạch chuyển đổi an toàn.
- Có phương án rollback khi migration thất bại.

Đặc biệt, nội dung bài viết cũ phải tiếp tục mở, sửa và hiển thị được sau khi nâng cấp.

Không để việc nâng cấp editor làm hỏng định dạng bài viết cũ.

## 14. HIỆU NĂNG, BẢO MẬT VÀ CHẤT LƯỢNG

### Hiệu năng

- Không thêm JavaScript không cần thiết vào website công khai.
- Hạn chế re-render Tiptap.
- Debounce autosave và SEO analysis.
- Không thực hiện truy vấn D1 lặp lại vô ích.
- Tránh N+1 queries.
- Tái sử dụng component phù hợp.
- Tối ưu ảnh R2.
- Tránh layout shift.
- Hạn chế dependencies mới.

### Bảo mật

- Kiểm tra quyền admin tại server.
- Validate tất cả dữ liệu đầu vào.
- Sanitize hoặc render an toàn nội dung Rich Text.
- Chống XSS.
- Chống CSRF cho các thao tác thay đổi dữ liệu.
- Không đưa secret hoặc token database ra frontend.
- Không cho public API đọc bài Draft.
- Upload ảnh phải kiểm tra định dạng, kích thước và quyền truy cập.

### Chất lượng code

- TypeScript strict.
- Không dùng `any` tùy tiện.
- Không tạo duplicate component.
- Không gom toàn bộ logic vào một file lớn.
- Tách validation, business logic và database access hợp lý.
- Không tạo abstraction khi chưa cần thiết.
- Code rõ ràng, dễ đọc, dễ debug.
- Tuân thủ AGENTS.md.

## 15. LỘ TRÌNH TRIỂN KHAI BẮT BUỘC

Chia công việc thành các giai đoạn:

**Giai đoạn 1 — Phân tích hệ thống**
- Kiểm tra source hiện tại.
- Xác định thành phần có thể giữ nguyên.
- Lập danh sách thay đổi cần thiết.

**Giai đoạn 2 — Nâng cấp UI/UX**
- Thiết kế layout 2 cột.
- Sticky action bar.
- Sắp xếp lại các trường nhập.
- Tối ưu giao diện Tiptap.
- Cải thiện ảnh đại diện.

**Giai đoạn 3 — Nâng cấp chức năng biên tập**
- Autosave.
- Preview.
- Slug validation.
- Tóm tắt bài viết.
- Cải thiện chèn ảnh và liên kết.

**Giai đoạn 4 — SEO trong CMS**
- SEO Title và Description.
- Google Search Preview.
- SEO Checklist.
- Liên kết nội bộ.

**Giai đoạn 5 — SEO kỹ thuật**
- Metadata.
- Canonical.
- Sitemap.
- Schema.
- Redirect 301.
- Bảo vệ bản nháp.
- Cache.

**Giai đoạn 6 — Kiểm thử**
- Tạo bài mới.
- Lưu nháp.
- Sửa bài cũ.
- Xem trước.
- Xuất bản.
- Gỡ xuất bản.
- Xóa bài.
- Đổi slug.
- Kiểm tra dữ liệu cũ.
- Kiểm tra trên mobile.
- Kiểm tra các thẻ SEO thực tế.
- Kiểm tra hiệu năng và lỗi console.

Sau mỗi giai đoạn, phải kiểm tra chức năng trước khi chuyển sang giai đoạn tiếp theo.

## 16. TIÊU CHÍ HOÀN THÀNH

Chỉ xem công việc hoàn thành khi:

1. Giao diện trang viết bài chuyên nghiệp, đẹp và dễ sử dụng.
2. Tiptap hoạt động ổn định, không giật lag hay mất nội dung.
3. Tự động lưu hoạt động chính xác.
4. Có thể xem trước bản nháp an toàn.
5. Google Search Preview hiển thị đúng dữ liệu.
6. SEO Checklist đưa ra cảnh báo hợp lý.
7. Bài viết xuất bản được hiển thị chính xác trên website.
8. Bài Draft không thể truy cập công khai.
9. Metadata, canonical, sitemap và schema được kiểm tra trong HTML/HTTP thực tế.
10. Các bài viết cũ không bị mất hoặc lỗi dữ liệu.
11. Không có lỗi TypeScript, lỗi build hoặc lỗi runtime đã biết.
12. Không tạo ra các file, component hoặc dependencies thừa.

## 17. YÊU CẦU CÁCH THỰC HIỆN

Bắt đầu bằng việc kiểm tra dự án thực tế, không tự phỏng đoán cấu trúc code.

Hãy cho tôi biết:
- Những chức năng đã có.
- Những chức năng đang thiếu.
- Những file cần chỉnh sửa.
- Những file mới thực sự cần tạo.
- Những thay đổi database cần thiết.
- Các rủi ro ảnh hưởng dữ liệu hiện tại.

Sau đó triển khai từ Giai đoạn 1 đến Giai đoạn 2 trước.

Không làm tất cả các giai đoạn trong một lần nếu chưa kiểm tra hệ thống.

Sau khi hoàn thành mỗi giai đoạn, báo cáo ngắn gọn:
- Đã làm gì.
- Những file đã thay đổi.
- Đã kiểm tra những gì và kết quả.
- Những vấn đề còn tồn tại.
- Giai đoạn tiếp theo.

**MỤC TIÊU CUỐI CÙNG:** Biến trang thêm/sửa bài viết hiện tại thành một CMS biên tập blog chuyên nghiệp, đơn giản, nhanh, nhẹ, dễ quản trị và có đầy đủ nền tảng SEO quan trọng để phát triển website vòng dâu tằm lâu dài. Không chạy theo số lượng tính năng, chỉ tập trung vào chất lượng, hiệu quả và sự ổn định.
