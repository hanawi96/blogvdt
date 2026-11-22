# Chrome extension — Tạo đơn nhanh

Sidebar **nổi bên phải** trên Pancake / Zalo. UI là `panel.html` (HTML/CSS/JS riêng), gọi API admin qua `background.js`.

POS production: `https://vongdautambyanh.com/admin`

## Cài đặt / cập nhật sau đổi domain

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `chrome-extension` (hoặc **Reload** nếu đã cài)
4. Xác nhận version **1.10.19** (hoặc mới hơn)
5. Đăng nhập admin trên tab thường: `https://vongdautambyanh.com/admin/login`  
   (phiên cũ trên `*.workers.dev` không còn dùng được)
6. F5 trang chat Pancake / Zalo

Extension tự migrate `posUrl` từ host staging cũ sang domain mới khi Reload.

## Dùng

1. Đăng nhập admin **một lần** trên tab thường (`https://vongdautambyanh.com/admin`)
2. Mở đúng `https://pancake.vn/vongdautambyvui` hoặc `https://chat.zalo.me/` → sidebar hiện form tạo đơn
3. Nếu chưa có phiên: nút **Mở đăng nhập** trong panel (phải mở đúng domain production)

## Kiến trúc

- `content.js` + `overlay.css`: shell Thu / Tải lại / kéo rộng + iframe `panel.html`
- `panel.html` + `panel.css` + `panel.js`: form tạo đơn
- `sidepanel.html`: Chrome side panel → cùng `panel.html`
- `background.js`: cookie admin + `pos-bootstrap` / `pos-create` / lookup / địa chỉ cũ
- Server: `GET /admin/orders/pos-bootstrap`, `POST /admin/orders/pos-create`

## Kiểm tra nhanh sau reload

1. Panel load catalog qua `pos-bootstrap`; tạo đơn chỉ `pos-create` (JSON)
2. Side panel Chrome (nếu bật) cũng hiện cùng form `panel.html`
3. Nút đăng nhập trỏ `https://vongdautambyanh.com/admin/login` (không còn `workers.dev`)
