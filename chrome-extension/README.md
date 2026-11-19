# Chrome extension — Tạo đơn nhanh

Sidebar **nổi bên phải** trên Pancake / Zalo. UI là `panel.html` (HTML/CSS/JS riêng), gọi API admin qua `background.js` — **không** nhúng trang `/admin/orders/pos`.

## Cài đặt

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `chrome-extension` (hoặc **Reload** nếu đã cài)
4. F5 trang chat

## Dùng

1. Đăng nhập admin **một lần** trên tab thường (`/admin`)
2. Mở đúng `https://pancake.vn/vongdautambyvui` hoặc `https://chat.zalo.me/` → sidebar hiện form tạo đơn
3. Nếu chưa có phiên: nút **Mở đăng nhập** trong panel

## Kiến trúc (v1.9)

- `content.js` + `overlay.css`: shell Thu / Tải lại / kéo rộng + iframe `panel.html`
- `panel.html` + `panel.css` + `panel.js`: form tạo đơn
- `sidepanel.html`: Chrome side panel → cùng `panel.html`
- `background.js`: cookie admin + `pos-bootstrap` / `pos-create` / lookup / địa chỉ cũ
- Server: `GET /admin/orders/pos-bootstrap`, `POST /admin/orders/pos-create`
- Trang Astro `/admin/orders/pos` vẫn dùng khi mở POS trên trình duyệt admin (không qua extension)

## Kiểm tra nhanh sau reload

1. Network trên chat: **không** còn request document tới `/admin/orders/pos` từ iframe extension
2. Panel load catalog qua `pos-bootstrap`; tạo đơn chỉ `pos-create` (JSON), không reload trang
3. Side panel Chrome (nếu bật) cũng hiện cùng form `panel.html`
