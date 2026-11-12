import { describe, expect, it } from 'vitest';
import {
  catalogLinkMatch,
  classifyPostLinks,
  collectPostPaths,
  isExternalHref,
  isInternalPostPath,
  isPostHref,
  postLinkCounts,
  postPathFromHref,
  rankLinkSuggestions,
} from './links';

describe('liên kết nội bộ', () => {
  it('cho phép path bài (root), sản phẩm và catalog', () => {
    expect(isInternalPostPath('/bai-moi')).toBe(true);
    expect(isInternalPostPath('/san-pham/vong-tron')).toBe(true);
    expect(isInternalPostPath('/mau-vong-dau-tam')).toBe(true);
    expect(isInternalPostPath('/mau-vong-dau-tam/')).toBe(true);
    // Path hệ thống không phải bài.
    expect(isInternalPostPath('/kien-thuc')).toBe(false);
    expect(isInternalPostPath('/gio-hang')).toBe(false);
    expect(isPostHref('/san-pham/vong-tron')).toBe(true);
    expect(isPostHref('/gio-hang')).toBe(false);
    expect(catalogLinkMatch('mẫu vòng')).toEqual({
      title: 'Mẫu vòng dâu tằm',
      path: '/mau-vong-dau-tam',
      kind: 'catalog',
    });
    expect(catalogLinkMatch('xyz')).toBeNull();
  });

  it('nhận diện link ra ngoài so với link nội bộ', () => {
    expect(isExternalHref('https://example.com/bai')).toBe(true);
    expect(isExternalHref('http://vi.wikipedia.org/wiki/To_tam')).toBe(true);
    expect(isExternalHref('/bai-moi')).toBe(false);
    expect(isExternalHref('/mau-vong-dau-tam')).toBe(false);
    // URL tuyệt đối (kể cả cùng domain) coi là link ngoài; link nội bộ luôn lưu dạng path tương đối.
    expect(isExternalHref('https://vongdautam.vn/bai-moi')).toBe(true);
    expect(isExternalHref('javascript:alert(1)')).toBe(false);
  });

  it('lấy đường dẫn chính thức từ href tương đối hoặc tuyệt đối', () => {
    expect(postPathFromHref('/bai-moi')).toBe('/bai-moi');
    expect(postPathFromHref('https://vongdautam.vn/bai-moi?utm=1')).toBe('/bai-moi');
    expect(postPathFromHref('/san-pham/vong-tron')).toBeNull();
    expect(postPathFromHref('/kien-thuc')).toBeNull();
    expect(postPathFromHref('javascript:alert(1)')).toBeNull();
  });

  it('phân loại bài xuất bản, bài nháp, slug cũ và link hỏng', () => {
    const issues = classifyPostLinks(
      ['/dang-xuat-ban', '/ban-nhap', '/slug-cu', '/khong-co', '/chinh-bai'],
      {
        currentPath: '/chinh-bai',
        published: new Set(['/dang-xuat-ban', '/chinh-bai', '/slug-moi']),
        unpublished: new Set(['/ban-nhap']),
        redirects: new Map([['/slug-cu', '/slug-moi']]),
      },
    );
    expect(issues).toEqual([
      { path: '/ban-nhap', kind: 'unpublished' },
      { path: '/slug-cu', kind: 'redirect', official: '/slug-moi' },
      { path: '/khong-co', kind: 'missing' },
      { path: '/chinh-bai', kind: 'self' },
    ]);
  });

  it('gợi ý theo danh mục và từ trong tiêu đề, không đổi URL', () => {
    const ranked = rankLinkSuggestions(
      [
        { title: 'Cách gói hàng', path: '/goi-hang', sameCategory: false },
        { title: 'Chọn vòng cho bé', path: '/chon-vong', sameCategory: true },
        { title: 'Màu chỉ trang trí', path: '/mau-chi', sameCategory: false },
      ],
      'Nhìn một vòng cho bé',
    );
    expect(ranked[0]?.path).toBe('/chon-vong');
    expect(ranked.map((item) => item.path)).not.toContain('/nhin-mot-vong');
  });

  it('chỉ gom liên kết bài viết và dừng ở 20 liên kết', () => {
    const content = Array.from({ length: 22 }, (_, index) => ({
      type: 'text',
      text: 'xem',
      marks: [{ type: 'link', attrs: { href: `/bai-${index}` } }],
    }));
    const collected = collectPostPaths(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content }] }));
    expect(collected.paths).toHaveLength(20);
    expect(collected.truncated).toBe(true);
    expect(collected.paths[0]).toBe('/bai-0');
  });

  it('đếm link vào và link ra, bỏ link tự trỏ và link trùng', () => {
    const doc = (...hrefs: string[]) =>
      JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: hrefs.map((href) => ({ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] })) }],
      });
    const page = [
      { id: 1, slug: 'bai-a', contentJson: doc('/bai-b', '/bai-b?x=1', '/bai-a', '/bai-c') },
      { id: 2, slug: 'bai-b', contentJson: doc() },
    ];
    const sources = [
      { id: 1, contentJson: page[0].contentJson },
      { id: 3, contentJson: doc('https://vongdautam.vn/bai-b', '/bai-b-cu') },
      { id: 2, contentJson: doc('/bai-b') },
    ];
    const counts = postLinkCounts(page, sources);
    expect(counts.get(1)).toEqual({ inbound: 0, outbound: 2 });
    expect(counts.get(2)).toEqual({ inbound: 2, outbound: 0 });
  });
});
