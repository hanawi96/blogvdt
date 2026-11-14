# Chrome extension — Tạo đơn nhanh

Trên Pancake / Zalo, sidebar **nổi bên phải** tự hiện khi tải trang (iframe form POS `/admin/orders/pos`).

## Cài đặt

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. **Load unpacked** → chọn thư mục `chrome-extension`
4. Vào trang chat → sidebar phải tự hiện. Nếu đã cài trước đó: bấm **Reload** trên thẻ extension rồi F5 trang Pancake

## Dùng

1. Đăng nhập admin **một lần** trên tab thường (workers.dev `/admin`)
2. Mở Pancake/Zalo → extension tự copy session vào iframe (không đăng nhập lại trong sidebar)
3. Nếu chưa có phiên: banner vàng → **Mở đăng nhập** / **Đã đăng nhập — tải lại**

## Ghi chú

- Cookie first-party được đồng bộ sang partition của Pancake/Zalo qua `chrome.cookies`.
- Tra đơn dùng fetch từ background (kèm cookie admin), không phụ thuộc iframe đã login.
