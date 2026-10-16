# Vòng dâu tằm

Website blog và bán vòng dâu tằm thủ công. Bản local có blog, trang sản phẩm, form đặt hàng, CMS và bốn luồng kiểm tra đầu cuối. Chưa deploy.

## Yêu cầu

- Windows
- Node.js 22.12 trở lên
- npm

## Cài đặt

```powershell
npm install
```

## Chạy local

Migration và seed chỉ đụng D1 local. Không dùng `--remote`.

```powershell
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

Mở http://localhost:4321 . Trang chủ hiện tên **Vòng Dâu Tằm** lấy từ D1. Bài đã xuất bản nằm ở http://localhost:4321/kien-thuc . Sản phẩm đang bán nằm ở http://localhost:4321/san-pham . Đặt hàng tại http://localhost:4321/dat-hang . Bài nháp và sản phẩm ngừng bán không có trên trang công khai.

Thẻ bài viết: quản trị tại `/admin/tags` (sau `npm run db:migrate:local`). Trang công khai `/tag/{slug}` chỉ hiện khi thẻ còn ≥1 bài đã xuất bản; mặc định `noindex`, bật index trong CMS khi cần đưa vào sitemap.

Chạy lại `npm run db:seed:local` sẽ xóa dữ liệu demo local rồi chèn lại. Lệnh seed từ chối `--remote`.

## Kiểm tra

```powershell
npm test
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run test:e2e` dùng D1 local và server dev. Lần chạy tạo một bài và một đơn giả, rồi xóa. Không gọi production.

Sau khi đổi binding trong `wrangler.jsonc`, chạy `npm run generate-types`.

## Tài khoản demo local

Đăng nhập tại http://localhost:4321/admin/login

- Tên đăng nhập: `admin`
- Mật khẩu: `DevLocal-VongDau-2026`

Mật khẩu này chỉ dành cho máy dev. Không dùng cho production và không chạy seed trên database thật.

## Dữ liệu demo

Seed local gồm một admin, ba danh mục, bốn bài viết (một bài nháp), bốn sản phẩm (một sản phẩm ngừng bán), ba đơn hàng giả và các dòng cài đặt. Tên khách và số điện thoại đều là dữ liệu giả.

## Backup local

Chỉ đụng database local. Không thêm `--remote` nếu chưa được yêu cầu.

```powershell
npx wrangler d1 export vong-dau-tam --local --output .\backup-local.sql
```

File export có dữ liệu đơn hàng. Không commit file này.

Phục hồi trên một D1 local trống: áp migration, rồi chạy file SQL.

```powershell
npm run db:migrate:local
npx wrangler d1 execute vong-dau-tam --local --file .\backup-local.sql
```

Ảnh nằm ở R2 local, không nằm trong file SQL. Key lấy từ cột `r2_key` của bảng `media`. Wrangler 4.151 không có lệnh liệt kê object.

```powershell
npx wrangler r2 object get vong-dau-tam-media/<r2_key> --local --file .\anh-backup
npx wrangler r2 object put vong-dau-tam-media/<r2_key> --local --file .\anh-backup
```

Bucket production chỉ đụng khi được yêu cầu deploy.

## Admin production

Không chạy seed trên database thật. Khi được yêu cầu tạo admin production, sinh hash trên máy này rồi mới ghi vào D1 production bằng lệnh riêng.

```powershell
$env:ADMIN_PASSWORD = "mat-khau-dai-it-nhat-16-ky-tu"
npm run hash:admin
Remove-Item Env:ADMIN_PASSWORD
```

Hash in ra có dạng `pbkdf2-sha256$100000$...`. Không ghi mật khẩu vào Git, `.dev.vars` hay README. Cookie phiên trên HTTPS có cờ `Secure`.
