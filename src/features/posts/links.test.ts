import { describe, expect, it } from 'vitest';
import { classifyPostLinks, collectPostPaths, postPathFromHref, rankLinkSuggestions } from './links';

describe('liên kết nội bộ', () => {
  it('lấy đường dẫn chính thức từ href tương đối hoặc tuyệt đối', () => {
    expect(postPathFromHref('/kien-thuc/bai-moi')).toBe('/kien-thuc/bai-moi');
    expect(postPathFromHref('https://vongdautam.vn/kien-thuc/bai-moi?utm=1')).toBe('/kien-thuc/bai-moi');
    expect(postPathFromHref('/san-pham/vong-tron')).toBeNull();
    expect(postPathFromHref('javascript:alert(1)')).toBeNull();
  });

  it('phân loại bài xuất bản, bài nháp, slug cũ và link hỏng', () => {
    const issues = classifyPostLinks(
      ['/kien-thuc/dang-xuat-ban', '/kien-thuc/ban-nhap', '/kien-thuc/slug-cu', '/kien-thuc/khong-co', '/kien-thuc/chinh-bai'],
      {
        currentPath: '/kien-thuc/chinh-bai',
        published: new Set(['/kien-thuc/dang-xuat-ban', '/kien-thuc/chinh-bai', '/kien-thuc/slug-moi']),
        unpublished: new Set(['/kien-thuc/ban-nhap']),
        redirects: new Map([['/kien-thuc/slug-cu', '/kien-thuc/slug-moi']]),
      },
    );
    expect(issues).toEqual([
      { path: '/kien-thuc/ban-nhap', kind: 'unpublished' },
      { path: '/kien-thuc/slug-cu', kind: 'redirect', official: '/kien-thuc/slug-moi' },
      { path: '/kien-thuc/khong-co', kind: 'missing' },
      { path: '/kien-thuc/chinh-bai', kind: 'self' },
    ]);
  });

  it('gợi ý theo danh mục và từ trong tiêu đề, không đổi URL', () => {
    const ranked = rankLinkSuggestions(
      [
        { title: 'Cách gói hàng', path: '/kien-thuc/goi-hang', sameCategory: false },
        { title: 'Chọn vòng cho bé', path: '/kien-thuc/chon-vong', sameCategory: true },
        { title: 'Màu chỉ trang trí', path: '/kien-thuc/mau-chi', sameCategory: false },
      ],
      'Nhìn một vòng cho bé',
    );
    expect(ranked[0]?.path).toBe('/kien-thuc/chon-vong');
    expect(ranked.map((item) => item.path)).not.toContain('/kien-thuc/nhin-mot-vong');
  });

  it('chỉ gom liên kết bài viết và dừng ở 20 liên kết', () => {
    const content = Array.from({ length: 22 }, (_, index) => ({
      type: 'text',
      text: 'xem',
      marks: [{ type: 'link', attrs: { href: `/kien-thuc/bai-${index}` } }],
    }));
    const collected = collectPostPaths(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content }] }));
    expect(collected.paths).toHaveLength(20);
    expect(collected.truncated).toBe(true);
    expect(collected.paths[0]).toBe('/kien-thuc/bai-0');
  });
});
