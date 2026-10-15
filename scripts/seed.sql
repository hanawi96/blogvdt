-- Dữ liệu demo cho D1 local. Chạy bằng npm run db:seed:local.
-- Lệnh đó luôn gắn --local và từ chối --remote.

DELETE FROM product_media;
DELETE FROM orders;
DELETE FROM posts;
DELETE FROM sessions;
DELETE FROM login_attempts;
DELETE FROM products;
DELETE FROM redirects;
DELETE FROM media;
DELETE FROM categories;
DELETE FROM admin_users;
DELETE FROM site_settings;

INSERT INTO admin_users (id, username, password_hash, created_at, updated_at)
VALUES (
  1,
  'admin',
  'pbkdf2-sha256$100000$bV4U+6I5zgQ0Z95uBC1llg==$JNy/7hDTmyXqaJERM88FsZm9O0a+7563KY8nRp5obh0=',
  1790812800000,
  1790812800000
);

INSERT INTO categories (id, name, slug, description, created_at, updated_at)
VALUES
  (1, 'Cách chọn vòng', 'cach-chon-vong', 'Gợi ý nhìn chất tơ, màu chỉ và kích thước trước khi đặt.', 1790812800000, 1790812800000),
  (2, 'Quy trình làm thủ công', 'quy-trinh-lam-thu-cong', 'Các bước làm vòng từ tơ tằm tại xưởng nhỏ.', 1790812800000, 1790812800000),
  (3, 'Góc chia sẻ', 'goc-chia-se', 'Bài đang viết, chưa đưa ra trang công khai.', 1790812800000, 1790812800000);

INSERT INTO posts (
  id, category_id, title, slug, excerpt, cover_media_id, content_json,
  seo_title, meta_description, status, published_at, author_id, created_at, updated_at
)
VALUES
  (
    1,
    1,
    'Nhìn một vòng dâu tằm thủ công',
    'nhin-mot-vong-dau-tam-thu-cong',
    'Vài điểm dễ thấy khi xem một vòng tơ tằm làm tay, trước khi quyết định đặt.',
    NULL,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Vòng dâu tằm thủ công là món quà theo tập quán, làm từ tơ tằm. Bài này chỉ nói cách nhìn sản phẩm, không nói về công dụng sức khỏe."}]}]}',
    'Nhìn một vòng dâu tằm thủ công',
    'Cách xem tơ, màu chỉ và kích thước của một vòng làm tay.',
    'published',
    1790812800000,
    1,
    1790812800000,
    1790812800000
  ),
  (
    2,
    2,
    'Các bước làm vòng từ tơ tằm',
    'cac-buoc-lam-vong-tu-to-tam',
    'Từ búi tơ đến vòng hoàn chỉnh, làm theo từng bước ở xưởng nhỏ.',
    NULL,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Tơ được xe sợi, lên khuôn, rồi buộc chỉ. Mỗi vòng làm riêng, nên thời gian hoàn thành phụ thuộc số lượng đang có."}]}]}',
    'Các bước làm vòng từ tơ tằm',
    'Quy trình xe sợi, lên khuôn và buộc chỉ của vòng tơ tằm thủ công.',
    'published',
    1791417600000,
    1,
    1790812800000,
    1791417600000
  ),
  (
    3,
    1,
    'Nên hỏi gì khi đặt vòng cho bé',
    'nen-hoi-gi-khi-dat-vong-cho-be',
    'Những thông tin xưởng cần để làm đúng cỡ và màu chỉ.',
    NULL,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Khi đặt, nên nói cỡ vòng, màu chỉ và ngày cần nhận. Đây là thông tin sản xuất, không phải lời khuyên y tế."}]}]}',
    'Nên hỏi gì khi đặt vòng cho bé',
    'Cỡ vòng, màu chỉ và thời gian nhận hàng khi đặt vòng tơ tằm.',
    'published',
    1791763200000,
    1,
    1791417600000,
    1791763200000
  ),
  (
    4,
    3,
    'Ghi chú nội bộ chưa xuất bản',
    'ghi-chu-noi-bo-chua-xuat-ban',
    'Bản nháp để kiểm tra trạng thái, không hiện trên trang công khai.',
    NULL,
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Nội dung nháp. Trang công khai không được đọc bài này."}]}]}',
    NULL,
    NULL,
    'draft',
    NULL,
    1,
    1791763200000,
    1791763200000
  );

INSERT INTO products (
  id, name, slug, price, description, cover_media_id, options_json,
  status, is_featured, sort_order, seo_title, meta_description, created_at, updated_at
)
VALUES
  (
    1,
    'Vòng tơ tằm trơn',
    'vong-to-tam-tron',
    150000,
    'Vòng một màu, làm từ tơ tằm. Chọn size khi đặt.',
    NULL,
    '["Size nhỏ","Size vừa","Size lớn"]',
    'active',
    1,
    1,
    'Vòng tơ tằm trơn',
    'Vòng tơ tằm một màu, làm thủ công.',
    1790812800000,
    1790812800000
  ),
  (
    2,
    'Vòng chỉ đỏ',
    'vong-chi-do',
    180000,
    'Vòng tơ tằm buộc thêm chỉ đỏ. Màu chỉ là lựa chọn trang trí.',
    NULL,
    '["Size nhỏ","Size vừa","Size lớn"]',
    'active',
    1,
    2,
    'Vòng chỉ đỏ',
    'Vòng tơ tằm thủ công có chỉ đỏ.',
    1790812800000,
    1790812800000
  ),
  (
    3,
    'Vòng đôi mẹ và bé',
    'vong-doi-me-va-be',
    320000,
    'Một cặp vòng, một chiếc cho người lớn và một chiếc cho bé.',
    NULL,
    '["Cặp size nhỏ","Cặp size vừa"]',
    'active',
    0,
    3,
    'Vòng đôi mẹ và bé',
    'Cặp vòng tơ tằm cho người lớn và bé.',
    1790812800000,
    1790812800000
  ),
  (
    4,
    'Vòng mẫu cũ',
    'vong-mau-cu',
    120000,
    'Mẫu không còn nhận đặt. Dùng để kiểm tra trạng thái ngừng bán.',
    NULL,
    '[]',
    'inactive',
    0,
    4,
    NULL,
    NULL,
    1790812800000,
    1790812800000
  );

INSERT INTO orders (
  id, code, customer_name, phone, address, note, product_id, product_name,
  unit_price, quantity, option_label, total_price, status, ip_hash, created_at, updated_at
)
VALUES
  (
    1,
    'VD20261001-0001',
    'Lê Minh An',
    '0901000001',
    '12 đường Mẫu, Quận 1, Thành phố Hồ Chí Minh',
    NULL,
    1,
    'Vòng tơ tằm trơn',
    150000,
    1,
    'Size vừa',
    150000,
    'new',
    '1111111111111111111111111111111111111111111111111111111111111111',
    1790812800000,
    1790812800000
  ),
  (
    2,
    'VD20261008-0002',
    'Trần Hà My',
    '0901000002',
    '45 đường Mẫu, Thành phố Huế',
    'Giao giờ hành chính',
    2,
    'Vòng chỉ đỏ',
    180000,
    2,
    'Size nhỏ',
    360000,
    'confirmed',
    '2222222222222222222222222222222222222222222222222222222222222222',
    1791417600000,
    1791504000000
  ),
  (
    3,
    'VD20261012-0003',
    'Phạm Quốc Bình',
    '0901000003',
    '7 đường Mẫu, Thành phố Đà Nẵng',
    NULL,
    3,
    'Vòng đôi mẹ và bé',
    320000,
    1,
    'Cặp size vừa',
    320000,
    'completed',
    '3333333333333333333333333333333333333333333333333333333333333333',
    1791763200000,
    1791849600000
  );

INSERT INTO site_settings (key, value, updated_at)
VALUES
  ('site_name', 'Vòng Dâu Tằm', 1790812800000),
  ('site_description', 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.', 1790812800000),
  ('phone', '0901000000', 1790812800000),
  ('contact_info', 'Xưởng mẫu, Thành phố Hồ Chí Minh', 1790812800000),
  ('facebook_url', 'https://facebook.com', 1790812800000),
  ('zalo_url', 'https://zalo.me', 1790812800000),
  ('logo_media_id', '', 1790812800000),
  ('favicon_media_id', '', 1790812800000),
  ('default_seo_title', 'Vòng Dâu Tằm', 1790812800000),
  ('default_seo_description', 'Vòng tơ tằm làm thủ công, theo tập quán tặng bé và gia đình.', 1790812800000);
