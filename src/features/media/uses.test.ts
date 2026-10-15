import { describe, expect, it } from 'vitest';
import { collectMediaUses } from './uses';

describe('nơi dùng ảnh', () => {
  it('gom bài, sản phẩm và cài đặt, mỗi nơi một lần', () => {
    const uses = collectMediaUses({
      media: [{ id: 4, key: '2026/10/bia.webp' }],
      posts: [
        {
          id: 3,
          title: 'Nên hỏi gì',
          coverMediaId: 4,
          contentJson: '{"type":"doc","content":[{"type":"image","attrs":{"src":"/media/2026/10/bia.webp"}}]}',
        },
      ],
      products: [{ id: 8, name: 'Vòng tròn', coverMediaId: 4 }],
      album: [{ mediaId: 4, productId: 8, productName: 'Vòng tròn' }],
      logoId: '4',
      faviconId: '',
      ogImageId: '',
    });

    expect(uses['4']).toEqual([
      { href: '/admin/posts/3', label: 'Nên hỏi gì' },
      { href: '/admin/products/8', label: 'Vòng tròn' },
      { href: '/admin/settings', label: 'Logo' },
    ]);
  });

  it('ghi ảnh đại diện của tài khoản', () => {
    const uses = collectMediaUses({
      media: [],
      posts: [],
      products: [],
      album: [],
      logoId: '',
      faviconId: '',
      ogImageId: '',
      avatars: [{ mediaId: 5, userId: 2, name: 'An' }],
    });
    expect(uses['5']).toEqual([{ href: '/admin/users/2', label: 'An' }]);
  });

  it('nhận ảnh gắn trong mô tả danh mục', () => {
    const uses = collectMediaUses({
      media: [{ id: 6, key: '2026/10/dm.webp' }],
      posts: [],
      products: [],
      album: [],
      logoId: '',
      faviconId: '',
      ogImageId: '',
      categories: [{ id: 1, name: 'Cách chọn vòng', description: 'Xem /media/2026/10/dm.webp' }],
    });
    expect(uses['6']).toEqual([{ href: '/admin/categories', label: 'Cách chọn vòng' }]);
  });
});