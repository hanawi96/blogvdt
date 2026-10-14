# Kế hoạch xây dựng website vòng dâu tằm

Tài liệu này là phạm vi sản phẩm và các giai đoạn. `AGENTS.md` là quy tắc cách viết code. `AGENTS.md` có nhắc tên `PROJECT_PLAN.md`: trong repo, tài liệu đó chính là file này. Không tạo thêm một bản kế hoạch thứ hai.

Chưa viết mã. Mỗi giai đoạn chỉ bắt đầu khi giai đoạn trước đã chạy và được duyệt. Khi làm, đọc `AGENTS.md` trước và giữ đúng thứ tự ưu tiên ở đó: an toàn dữ liệu, đúng chức năng, ổn định, rõ ràng, rồi mới tới hiệu năng.

Mốc đối chiếu tài liệu: 14/10/2026. Astro stable là dòng 7 (7.3.8). Adapter `@astrojs/cloudflare` lấy binding bằng `import { env } from "cloudflare:workers"`. Cài bản stable mới nhất lúc khởi tạo và khóa bằng `package-lock.json`.

## 1. Kiến trúc

Một project Astro duy nhất, render phía server trên Cloudflare Workers.

```text
Trình duyệt
    │
    ▼
Cloudflare Worker  (Astro SSR + server endpoints)
    ├── D1          nội dung, sản phẩm, đơn, phiên đăng nhập
    ├── R2          file ảnh
    └── Cache       HTML công khai, hạn 60 giây
```

Luồng xử lý: trang hoặc endpoint nhận input, kiểm tra dữ liệu và quyền, gọi nghiệp vụ trong `features`, rồi repository mới đụng D1 hoặc R2. Trang không viết SQL. Component không mở database và không giữ bí mật.

Trang công khai lấy dữ liệu từ D1 lúc có request, nên đăng bài mới không cần build lại. Google nhận HTML đầy đủ, không cần chạy JavaScript.

Trang đọc dùng Astro. Svelte chỉ ở chỗ tương tác thật: trình soạn thảo, hộp chọn ảnh, dialog cần trạng thái. Menu, phân trang, lọc danh mục và form đặt hàng là liên kết hoặc form HTML. Đảo Svelte dùng directive nhẹ nhất còn đủ dùng. Riêng trang sửa bài, editor dùng `client:load` vì người dùng cần gõ ngay.

Trang không phụ thuộc database, như trang chính sách, được prerender. Trang đọc D1 thì SSR.

### Quyết định đã chốt

| Việc | Cách làm | Lý do |
|---|---|---|
| Render | `output: 'server'`, prerender từng trang tĩnh | Bài mới có hiệu lực ngay. Trang tĩnh không bị ép SSR |
| Truy cập D1, R2 | `env` từ `cloudflare:workers`, gom ở `lib` | API hiện tại của adapter. Trang không tự đọc binding rải rác |
| Nội dung bài | JSON của Tiptap trong D1 | Có cấu trúc, render lại thành HTML trên server |
| HTML bài viết | `@tiptap/static-renderer`, rồi mới đưa vào trang | Không cần DOM ảo. Không `set:html` với chuỗi chưa đi qua renderer và allowlist |
| Ảnh | Upload R2, phát qua `/media/...` | Local và production cùng một cách phục vụ ảnh |
| Thu nhỏ ảnh | Canvas trên trình duyệt trước khi upload | Workers không chạy thư viện xử lý ảnh native |
| Mật khẩu | PBKDF2-SHA-256, 100.000 vòng, salt riêng, so sánh constant-time, Web Crypto | API có sẵn trên Workers. bcrypt không chạy ở runtime này. Không thêm thư viện hash |
| Phiên | Mã ngẫu nhiên trong cookie HttpOnly, bản ghi ở D1, thu hồi khi đăng xuất | Đúng session đã yêu cầu |
| Cache | `Cache-Control` công khai 60 giây | Đủ giảm đọc D1 và bài sửa xuất hiện trong vòng một phút. Chưa thêm khóa phiên bản hay purge |
| Đơn hàng | Một sản phẩm trên mỗi đơn, lưu trong `orders` | Đúng form giai đoạn đầu |
| Chống đơn trùng | Cùng số điện thoại, cùng sản phẩm và cùng lựa chọn trong 10 phút thì từ chối | Cơ chế tương đương idempotency, không thêm bảng token |
| Slug đổi | Bảng `redirects`, trả 301 | Giữ link cũ |
| Chính sách | Vài trang tĩnh prerender | Footer cần link. Chưa đưa vào CMS |
| Copy sản phẩm | Không ghi công dụng y tế | Niềm tin dân gian không được viết thành cam kết chữa bệnh, ngủ ngon hay an toàn |

Ba bảng thêm so với danh sách gốc, vì chức năng bắt buộc cần chúng:

- `login_attempts` — khóa đăng nhập sau nhiều lần sai.
- `redirects` — chuyển 301 khi đổi slug.
- `product_media` — album ảnh sản phẩm.

Bảng `order_items` để sau, khi có đơn nhiều sản phẩm.

Giới hạn mật khẩu: Workers từ chối PBKDF2 trên 100.000 vòng, thấp hơn khuyến nghị OWASP cho PBKDF2-SHA-256. Bù bằng mật khẩu admin dài, chỉ một tài khoản, và khóa sau 5 lần sai trong 15 phút. Mật khẩu production lấy từ secret, không ghi vào source và không đưa vào seed. Nếu sau này cần thư viện hash khác, đó là thay đổi có chủ đích, không làm trong lúc dựng nền.

Cache 60 giây là cơ chế làm mới. Admin, phiên đăng nhập, bản nháp và response đặt hàng không cache. Chưa làm bộ đếm `content_revision` hay gọi API xóa cache. Chỉ thêm cơ chế đó nếu 60 giây không đủ khi đã có lưu lượng thật.

### Môi trường

| | Local (Windows) | Production |
|---|---|---|
| App | `astro dev` (workerd) | Workers |
| D1 | Miniflare, lệnh có `--local` | Database riêng. Lệnh `--remote` chỉ khi được yêu cầu |
| R2 | Binding local của Wrangler | Bucket riêng |
| Bí mật | `.dev.vars`, không commit | `wrangler secret` |
| Cookie | HttpOnly, SameSite=Lax | HttpOnly, SameSite=Lax, Secure |
| Seed | Chỉ local | Không tự chèn |

Lệnh seed từ chối chạy nếu không phải D1 local. Không migration production, không deploy, không đổi DNS nếu chưa được yêu cầu riêng.

### SEO cần nhớ lúc làm

- Truy vấn công khai chỉ lấy bài `published` và sản phẩm đang bán.
- Bản nháp, `/admin`, trang đặt hàng thành công và 404 đều `noindex`.
- Sitemap và `robots.txt` render từ server, đọc D1.
- Schema Article và Product chỉ ghi thông tin có thật trên trang. Không thêm đánh giá giả.
- Thời điểm lưu UTC (Unix milliseconds). Lúc hiển thị mới đổi sang giờ Việt Nam.
- Trạng thái bài viết và trạng thái đơn nằm mỗi nơi một module, dùng chung cho form, query và kiểm tra server.

## 2. Cấu trúc thư mục

Chỉ tạo thư mục khi có file dùng thật. Không dựng sẵn cây rỗng.

```text
BlogVDT/
├── astro.config.mjs
├── wrangler.jsonc
├── drizzle.config.ts
├── package.json
├── tsconfig.json
├── AGENTS.md
├── KE-HOACH.md
├── README.md
├── .dev.vars.example
├── migrations/                 # SQL do Drizzle sinh, commit vào Git
├── scripts/                    # seed local và lệnh vận hành tái sử dụng
├── public/                     # font, file tĩnh không qua CMS
└── src/
    ├── middleware.ts           # tạo ở giai đoạn 2, khi chặn /admin
    ├── styles/global.css
    ├── layouts/
    ├── pages/
    │   ├── index.astro
    │   ├── kien-thuc/
    │   ├── san-pham/
    │   ├── dat-hang.astro
    │   ├── media/[...key].ts
    │   ├── sitemap.xml.ts
    │   ├── robots.txt.ts
    │   ├── 404.astro
    │   └── admin/
    ├── components/
    │   ├── ui/                 # chỉ component thực sự dùng lại
    │   ├── public/
    │   └── admin/
    ├── features/               # nghiệp vụ theo từng giai đoạn
    │   ├── auth/
    │   ├── posts/
    │   ├── media/
    │   ├── products/
    │   └── orders/
    └── lib/
        ├── db/                 # schema Drizzle và client
        ├── cloudflare/         # đọc binding D1, R2
        ├── seo/
        └── validation/         # luật dùng chung giữa nhiều feature
```

Quy tắc tổ chức, theo `AGENTS.md`:

- `pages` chỉ nhận input, gọi feature, chọn trang hoặc response.
- `features/<tên>` giữ validate riêng, repository và phần nghiệp vụ của đúng module đó. CRUD ngắn không cần đủ lớp repository lẫn service nếu một file vẫn rõ.
- Đưa hàm sang `lib` chỉ khi có ít nhất hai feature dùng.
- Component Astro/Svelte đặt `PascalCase`. File tiện ích `kebab-case.ts`. Bảng và cột `snake_case`.
- Không tạo `helpers`, `common`, `islands`, `temp`. Editor Svelte nằm trong `features/posts` hoặc `components/admin`, tùy file đó đang giữ UI hay nghiệp vụ.
- Không tách file chỉ vài dòng. Không tạo component dùng chung cho đến khi có chỗ thứ hai cần cùng hành vi.

Giai đoạn 1 chỉ tạo những gì nền tảng dùng: cấu hình, `src/lib/db`, `src/styles`, layout tối thiểu, trang chủ đọc được một cài đặt. `features/`, `middleware.ts` và component admin xuất hiện từ giai đoạn 2.

## 3. Database

SQLite trên D1. Khóa chính số tự tăng, trừ `sessions` và `site_settings`. Thời gian là Unix milliseconds, UTC. Slug bài viết, slug sản phẩm và slug danh mục là unique. Query đi qua Drizzle, có tham số. Đổi schema thì có file migration mới trong `migrations/`. Không sửa migration đã áp dụng để che lỗi.

Chỉ select cột cần dùng. Danh sách bài, sản phẩm và đơn có giới hạn và thứ tự ổn định. Đổi slug gồm cập nhật bản ghi và thêm redirect trong một `db.batch()`.

### admin_users

| Cột | Ghi chú |
|---|---|
| id | khóa chính |
| username | unique |
| password_hash | thuật toán, số vòng, salt, hash |
| created_at, updated_at | |

### sessions

| Cột | Ghi chú |
|---|---|
| id | token ngẫu nhiên, khóa chính |
| admin_user_id | khóa ngoại, xóa user thì xóa phiên |
| csrf_token | |
| expires_at | phiên sống 8 giờ |
| created_at | |
| index | admin_user_id, expires_at |

### login_attempts

| Cột | Ghi chú |
|---|---|
| ip_hash | unique. Không lưu IP thô |
| fail_count | |
| locked_until | |
| updated_at | |

### categories

| Cột | Ghi chú |
|---|---|
| id, name, slug unique | |
| description | có thể trống |
| created_at, updated_at | |

Danh mục nằm trong feature bài viết. Chưa tách thành feature riêng.

### posts

| Cột | Ghi chú |
|---|---|
| category_id | khóa ngoại, xóa danh mục thì để null |
| title, slug unique, excerpt | |
| cover_media_id | khóa ngoại tới media, để null nếu ảnh bị xóa |
| content_json | JSON Tiptap |
| seo_title, meta_description | trống thì dùng tiêu đề và mô tả ngắn |
| status | `draft` hoặc `published` |
| published_at | có giá trị khi đã xuất bản |
| created_at, updated_at | |
| index | status + published_at, category_id |

### media

| Cột | Ghi chú |
|---|---|
| r2_key | unique, dạng `2026/10/{id}.webp` |
| filename | tên hiển thị đã làm sạch |
| alt_text, mime_type, size_bytes | |
| width, height | chống nhảy layout |
| created_at | |

Không có cột blob. Xóa object R2 chỉ khi không còn bài viết, sản phẩm, logo hay favicon nào trỏ tới media đó.

### products

| Cột | Ghi chú |
|---|---|
| name, slug unique | |
| price | số nguyên VND |
| description | văn bản |
| cover_media_id | |
| options_json | mảng nhãn, ví dụ cỡ vòng |
| status | `active` hoặc `inactive` |
| is_featured | hiện ở trang chủ |
| sort_order | |
| seo_title, meta_description | |
| created_at, updated_at | |
| index | status, is_featured |

### product_media

| Cột | Ghi chú |
|---|---|
| product_id, media_id | khóa chính kép, khóa ngoại |
| sort_order | thứ tự album |

### orders

| Cột | Ghi chú |
|---|---|
| code | unique, ví dụ `VD20261014-0042` |
| customer_name, phone, address, note | |
| product_id | để null nếu sản phẩm bị xóa |
| product_name, unit_price, quantity, option_label, total_price | bản chụp lúc đặt |
| status | `new`, `confirmed`, `preparing`, `shipped`, `completed`, `cancelled` |
| ip_hash | chống gửi trùng. Không hiện ở giao diện, không ghi log |
| created_at, updated_at | |
| index | status, created_at, phone |

Admin đổi trạng thái chỉ được ghi một trong sáu giá trị trên. Danh sách này nằm một chỗ trong `features/orders`.

### redirects

| Cột | Ghi chú |
|---|---|
| from_path | unique, ví dụ `/kien-thuc/slug-cu` |
| to_path | |
| created_at | |

### site_settings

| Cột | Ghi chú |
|---|---|
| key | khóa chính |
| value | |
| updated_at | |

Các key: `site_name`, `site_description`, `phone`, `contact_info`, `facebook_url`, `zalo_url`, `logo_media_id`, `favicon_media_id`, `default_seo_title`, `default_seo_description`.

### Dữ liệu mẫu local

Một admin, vài danh mục, bốn bài trong đó có bài nháp, bốn sản phẩm, ba đơn ở các trạng thái khác nhau, vài dòng cài đặt. Tên và số điện thoại đều giả. Mô tả mẫu không khẳng định công dụng chữa bệnh. Mật khẩu local chỉ ghi trong hướng dẫn chạy máy dev. Không có lệnh seed cho production. Tạo admin production là thao tác riêng, khi được yêu cầu, đọc mật khẩu từ secret.

### Backup

Ghi chi tiết ở Giai đoạn 5. Lệnh chính: `wrangler d1 export` và tải object R2. Phục hồi bằng file SQL export trên database trống, rồi đồng bộ lại ảnh.

## 4. Đường dẫn

Thao tác admin là form POST trên chính trang quản trị. Không tạo endpoint REST cho dữ liệu mà trang Astro đã đọc được ở server. Upload ảnh là ngoại lệ: editor cần phản hồi JSON, nên `POST /admin/media` trả JSON cho đảo Svelte. Không tạo thêm một đường `/api` làm cùng việc.

### Công khai

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| GET | `/` | Trang chủ |
| GET | `/kien-thuc` | Danh sách bài, `?page=` |
| GET | `/kien-thuc/danh-muc/{slug}` | Bài theo danh mục |
| GET | `/kien-thuc/{slug}` | Bài viết. Slug cũ thì 301 |
| GET | `/san-pham` | Danh sách đang bán |
| GET | `/san-pham/{slug}` | Chi tiết sản phẩm |
| GET | `/dat-hang` | Form, nhận `?san-pham=` |
| POST | `/dat-hang` | Tạo đơn, rồi chuyển sang trang thành công |
| GET | `/dat-hang/thanh-cong` | Báo thành công, `noindex`, không đưa số điện thoại lên URL |
| GET | `/media/{key}` | Đọc ảnh từ R2 |
| GET | `/sitemap.xml` | Bài đã xuất bản và sản phẩm đang bán |
| GET | `/robots.txt` | Chặn `/admin` |
| GET | trang chính sách prerender | Nội dung trong source |
| GET | 404 | `noindex` |

Một cách lọc danh mục: trang `/kien-thuc/danh-muc/{slug}`. Không làm thêm bản lọc bằng query song song.

Đường dẫn dùng ở nhiều layout được gom một module nhỏ lúc có header, để khỏi gõ lại chuỗi ở nhiều file.

### Quản trị

`src/middleware.ts` chặn mọi đường `/admin` trừ `/admin/login`. Ẩn nút trên giao diện không thay cho bước này. Chưa đăng nhập thì về `/admin/login`.

| Phương thức | Đường dẫn | Việc |
|---|---|---|
| GET, POST | `/admin/login` | Đăng nhập |
| POST | `/admin/logout` | Xóa phiên |
| GET | `/admin` | Dashboard |
| GET, POST | `/admin/posts` | Danh sách, lọc trạng thái, tìm kiếm |
| GET, POST | `/admin/posts/new` | Tạo bài |
| GET, POST | `/admin/posts/{id}` | Sửa bài |
| POST | `/admin/posts/{id}/delete` | Xóa, có xác nhận |
| GET, POST | `/admin/categories` | Danh mục |
| GET, POST | `/admin/products`, `/new`, `/{id}`, `/{id}/delete` | Sản phẩm |
| GET | `/admin/orders` | Danh sách, tìm kiếm, lọc |
| GET, POST | `/admin/orders/{id}` | Chi tiết và đổi trạng thái |
| GET | `/admin/media` | Thư viện |
| POST | `/admin/media` | Upload, trả JSON cho editor |
| POST | `/admin/media/{id}/delete` | Xóa khi không còn nơi dùng |
| GET, POST | `/admin/settings` | Cài đặt site |

### Bảo vệ thao tác ghi

- Cookie phiên: HttpOnly, SameSite=Lax, Path=/, Secure khi production.
- Form ghi dữ liệu gửi kèm CSRF của phiên. Server đối chiếu Origin với host của site.
- Validate lại trên server. Lỗi người dùng trả mã 4xx và nói rõ trường nào sai. Lỗi kỹ thuật không trả stack, SQL hay secret.
- Bài viết chỉ thành HTML qua schema Tiptap. Liên kết chỉ `http` và `https`. Ảnh chỉ đường dẫn `/media/` của site.
- Upload: jpeg, png, webp. Chặn svg và mọi loại khác. Kiểm tra dung lượng và nội dung file, không tin mỗi phần mở rộng. Key R2 do server sinh.
- Đặt hàng: field ẩn chống bot, giới hạn theo IP, chặn đơn trùng như mục kiến trúc.
- Không log mật khẩu, session, số điện thoại hay địa chỉ.
- Turnstile chỉ xét thêm nếu form local đã có mà vẫn bị spam. Chưa cài sẵn.

## 5. Thư viện

Cài khi tới giai đoạn cần, không cài trước cho đủ bộ.

| Gói | Giai đoạn | Lý do |
|---|---|---|
| astro, typescript | 1 | Nền project, TypeScript strict |
| @astrojs/cloudflare, wrangler | 1 | Workers, D1, R2 |
| tailwindcss, @tailwindcss/vite | 1 | CSS và token |
| drizzle-orm, drizzle-kit | 1 | Schema, query, migration |
| @astrojs/svelte, svelte | 1 | Cài cùng nền vì giai đoạn 1 của yêu cầu gồm Svelte. Chưa tạo đảo mẫu |
| zod | 2 | Validate server cho form admin, dùng lại ở đơn hàng |
| vitest | 2 | Test hàm thuần: mật khẩu, slug, trạng thái |
| @tiptap/core, @tiptap/pm, @tiptap/starter-kit | 2 | Editor |
| @tiptap/extension-link, @tiptap/extension-image | 2 | Liên kết và ảnh |
| @tiptap/extension-table và gói hàng, ô | 2 | Trang bài viết cần bảng |
| @tiptap/static-renderer | 3 | HTML server cho SEO |
| playwright | 5 | Đúng bốn luồng e2e, không mở rộng thành bộ test trình duyệt lớn |

Không cài: bcrypt, sharp, happy-dom, bộ UI, axios, lodash, thư viện animation, icon pack, plugin sitemap tĩnh. Sitemap tự viết vì dữ liệu nằm ở D1. Hash mật khẩu bằng Web Crypto. Ảnh thu nhỏ bằng Canvas.

Script trong `package.json` chỉ những lệnh thật sự có:

- Giai đoạn 1: `dev`, `check`, `build`, `db:migrate:local`, `db:seed:local`.
- Giai đoạn 2 thêm `test`.
- Giai đoạn 5 thêm `test:e2e`.

Chưa thêm ESLint riêng. `astro check` là cổng kiểu bắt buộc. Thêm lint khi có lỗi style lặp lại, không thêm trước.

## 6. Design system

Token nằm trong `src/styles/global.css`, Tailwind 4 đọc từ `@theme`. Component lấy màu, cỡ chữ, khoảng cách, bo góc và đổ bóng từ token.

| Token | Hướng |
|---|---|
| Nền | kem nhạt |
| Bề mặt | trắng |
| Chữ | nâu than, dòng phụ nhạt hơn |
| Viền | be |
| Màu chính | xanh rêu |
| Màu nhấn | đất nung, nút đặt hàng |
| Chữ | Be Vietnam Pro, tự host woff2, có dấu tiếng Việt |
| Bo góc | ba mức nhỏ, vừa, lớn |

Công khai làm mobile trước. Bề ngang bài khoảng 65 ký tự. Nút và ô nhập đủ cao để bấm trên điện thoại. Admin có sidebar, nền sáng, dùng tốt từ 1024px, vẫn có nhãn, focus và dùng được bằng bàn phím.

Form có loading, success, error và lỗi từng trường. Danh sách có trạng thái trống và lỗi. Animation chỉ ở focus và hover ngắn. Chưa tạo `Button` hay `Input` dùng chung cho đến khi có hai chỗ cần cùng một hành vi.

Copy trên trang và trong seed không viết vòng dâu tằm thành thuốc, không hứa giúp trẻ ngủ ngon hay bảo đảm an toàn. Phần kể truyền thống được ghi là tập quán, tách khỏi thông tin chăm sóc em bé.

## 7. Kiểm thử

Theo `AGENTS.md`, không báo đã test nếu lệnh chưa chạy.

- Hàm thuần: Vitest. Gồm so khớp mật khẩu, tạo slug, chuyển trạng thái bài và đơn, validate đơn, rule URL của nội dung bài.
- Repository và đăng nhập: test tích hợp với D1 local khi luồng đó xuất hiện, không trỏ production.
- E2E để giai đoạn 5, đúng bốn việc: đăng nhập, xuất bản bài, xem bài, đặt hàng.
- Dữ liệu test là dữ liệu giả, không dùng số điện thoại hay địa chỉ thật.
- Mỗi giai đoạn chạy những script đã có trong `package.json`. Thiếu môi trường thì ghi rõ lệnh chưa chạy.

## 8. Các giai đoạn

Một giai đoạn xong khi đúng mục dưới đây và đạt định nghĩa hoàn thành trong `AGENTS.md`: đúng phạm vi, đúng thư mục, có validation và phân quyền ở phần đã làm, migration nếu đổi schema, README nếu đổi cách chạy, và lệnh kiểm tra đã chạy thật.

### Giai đoạn 1 — Nền tảng

1. Tạo project Astro, TypeScript strict, Git ignore `.dev.vars`, `.wrangler`, `dist`, `node_modules`.
2. Gắn Tailwind và token. Trang chủ tối giản để nhìn màu và chữ.
3. Gắn Svelte vào cấu hình. Chưa làm component tương tác mẫu.
4. Gắn adapter Cloudflare. `wrangler.jsonc` có D1, R2, `compatibility_date` hiện tại, bật log.
5. Viết schema Drizzle, sinh migration vào `migrations/`.
6. Áp migration local và seed local. Seed không chạy được với `--remote`.
7. `lib/db` và `lib/cloudflare` đọc một dòng cài đặt. Trang chủ hiện tên website lấy từ D1. Đây là trang chủ thật ở mức tối thiểu, không phải trang tạm để xóa sau.
8. README: cài đặt, dev, migrate local, seed local, check, build trên Windows.
9. Thêm script `dev`, `check`, `build`, `db:migrate:local`, `db:seed:local`.

Xong khi:

- `npm run dev` mở được trên Windows và trang chủ hiện tên site từ D1 local.
- Thấy font và màu từ token.
- `npm run db:migrate:local` và `npm run db:seed:local` chạy xong. Seed có admin, bài, sản phẩm, đơn, cài đặt.
- `npm run check` và `npm run build` đã chạy, kết quả được ghi lại.
- Chưa có màn CMS, danh sách bài hay đặt hàng.

### Giai đoạn 2 — CMS

1. `features/auth`: đăng nhập, đăng xuất, hết hạn phiên, khóa sau 5 lần sai. Middleware chặn `/admin`.
2. Layout admin: sidebar, header, vùng nội dung.
3. Dashboard: số bài, số bài đã xuất bản, số sản phẩm, số đơn, số đơn mới, đơn gần đây.
4. Danh mục.
5. `features/media`: upload R2, thư viện, alt text, chặn file lạ. Xóa ảnh chỉ khi hết tham chiếu.
6. Tiptap và bài viết: danh sách, tìm, lọc, tạo, sửa, nháp, xuất bản, gỡ, xóa có xác nhận.
7. Slug tự sinh, sửa được. Đổi slug thì cập nhật bài và ghi redirect trong cùng một batch.
8. Cài đặt website, logo và favicon chọn từ thư viện.
9. Vitest cho mật khẩu, slug và trạng thái bài.

Xong khi:

- Vào `/admin` khi chưa đăng nhập thì về trang login.
- Sai mật khẩu không tạo phiên. Đủ 5 lần thì bị khóa.
- Cookie thấy HttpOnly.
- Tạo bài nháp, xuất bản, sửa, gỡ, xóa đều lưu D1.
- Ảnh nằm trong R2 local và chèn được vào bài. D1 chỉ có metadata.
- File svg và file quá lớn bị từ chối.
- Đăng xuất thì trang admin không mở được.
- `npm test`, `npm run check` và `npm run build` đã chạy.
- Giao diện blog công khai vẫn để giai đoạn 3.

### Giai đoạn 3 — Blog và SEO

1. Header, footer, trang chủ đủ các khối đã yêu cầu.
2. `/kien-thuc`, phân trang, `/kien-thuc/danh-muc/{slug}`.
3. Trang bài: H1, HTML từ JSON, mục lục từ H2 và H3, breadcrumb, ngày đăng và ngày sửa theo giờ Việt Nam, bài liên quan, sản phẩm nổi bật, nút xem sản phẩm.
4. Bài nháp trả 404. Slug cũ trả 301.
5. Title, meta description, canonical, Open Graph, Twitter Card, schema Article và BreadcrumbList. Xử lý SEO tập trung ở `lib/seo`.
6. Sitemap, robots, trang 404.
7. Trang chính sách tĩnh, prerender, cho footer.
8. Test phần render nội dung và rule URL nếu là hàm thuần.

Xong khi:

- Tắt JavaScript vẫn đọc được bài, mục lục và liên kết.
- View source thấy nội dung bài, title riêng, canonical, schema.
- Bài nháp không có trong danh sách, sitemap hay trang chi tiết.
- Đổi slug: địa chỉ cũ trả 301.
- Sửa bài xong, sau không quá 60 giây trang công khai thấy nội dung mới.
- `/robots.txt` chặn `/admin`.
- Trang chủ, danh sách và bài viết xem được trên điện thoại, focus và nhãn form còn rõ.
- Copy không có cam kết y tế.
- Các script kiểm tra đã có đều được chạy.

### Giai đoạn 4 — Bán hàng

1. `features/products`: thêm, sửa, xóa, giá, ảnh bìa, album, cỡ vòng, đang bán hoặc ngừng bán, SEO.
2. Danh sách và chi tiết sản phẩm, schema Product đúng với dữ liệu thật.
3. Form đặt hàng tại trang sản phẩm và `/dat-hang`.
4. Server kiểm tra số lượng, lựa chọn, chống spam, chống đơn trùng, lưu đơn, chuyển sang `/dat-hang/thanh-cong`.
5. Admin xem, tìm, lọc và đổi trạng thái đơn.
6. Test validate đơn và rule chống trùng.

Xong khi:

- Sản phẩm ngừng bán không còn ở trang công khai.
- Đặt một đơn trên local: D1 có bản ghi, admin thấy trạng thái Mới.
- Thiếu số điện thoại hoặc số lượng sai thì bị từ chối, có lỗi từng trường.
- Gửi lại cùng số, cùng sản phẩm và cùng lựa chọn trong 10 phút thì bị chặn.
- Đổi trạng thái chỉ nhận sáu giá trị đã định, và `updated_at` đổi.
- Xóa sản phẩm không xóa đơn cũ. Đơn giữ tên và giá lúc đặt.
- Trang thành công là `noindex` và không có dữ liệu khách trên URL.
- Script kiểm tra đã chạy.

### Giai đoạn 5 — Hoàn thiện và deploy

Chỉ làm production khi có yêu cầu riêng. Phần local vẫn làm được trước đó.

1. Rà mobile, bàn phím, nhãn và focus trên các trang đã có.
2. Ảnh có kích thước, alt và lazy load dưới màn hình. Ảnh đầu trang không lazy.
3. Rà CSRF, XSS, quyền admin, bản nháp, cookie production.
4. Kiểm tra SEO: một H1, heading đúng cấp, sitemap, schema, canonical.
5. E2E bốn luồng: đăng nhập, xuất bản bài, xem bài, đặt hàng.
6. Đi một vòng tay trên local: viết bài, xuất bản, thấy trên web, đặt hàng, xử lý đơn.
7. Khi được yêu cầu deploy: D1 và R2 production, secret, domain, HTTPS. Build `npx astro build`, deploy `npx wrangler deploy`, nối GitHub bằng Cloudflare Workers Builds.
8. README phần vận hành: tạo admin production, backup và phục hồi D1 cùng R2. Thử export D1 local trước. Export remote chỉ khi được yêu cầu.

Xong phần local khi bốn luồng e2e và vòng kiểm tay đều đã chạy. Xong phần production khi domain chạy HTTPS, secret không có trong Git, và đã có hướng dẫn backup.

## 9. Việc chưa làm

Giỏ hàng nhiều sản phẩm, tài khoản khách, thanh toán trực tuyến, vận chuyển, nhiều vai trò quản trị, biểu đồ, bình luận, tìm kiếm toàn site, email hoặc tin nhắn khi có đơn, Turnstile, ESLint, purge cache. Thêm bằng giai đoạn mới nếu cần.

## 10. Bước tiếp theo

Khi kế hoạch này được duyệt, bắt đầu đúng Giai đoạn 1. Dừng lại để kiểm tra trước khi sang Giai đoạn 2.
