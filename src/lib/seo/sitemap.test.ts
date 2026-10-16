import { describe, expect, it } from 'vitest';
import { canonicalUrl } from './meta';
import { sitemapLastmod, sitemapXml } from './sitemap';

describe('sitemap', () => {
  it('ghi loc trùng canonical và bỏ đường dẫn không hợp lệ', () => {
    const xml = sitemapXml('https://vongdautam.vn/', [
      { path: '/kien-thuc/bai', lastmod: '2026-10-14T00:00:00.000Z' },
      { path: '/tag/vong-dau-tam', lastmod: '2026-10-15T00:00:00.000Z' },
      { path: '/kien-thuc/ky-tu', lastmod: 'a<b>&"c\'' },
      { path: '/kien-thuc?utm_source=zalo' },
      { path: '/kien-thuc/../admin' },
    ]);
    expect(xml).toContain(`<loc>${canonicalUrl('https://vongdautam.vn', '/kien-thuc/bai')}</loc>`);
    expect(xml).toContain(`<loc>${canonicalUrl('https://vongdautam.vn', '/tag/vong-dau-tam')}</loc>`);
    expect(xml).toContain('<loc>https://vongdautam.vn/kien-thuc</loc>');
    expect(xml).toContain('<lastmod>2026-10-14T00:00:00.000Z</lastmod>');
    expect(xml).toContain('<lastmod>a&lt;b&gt;&amp;&quot;c&apos;</lastmod>');
    expect(xml).not.toContain('a<b>');
    expect(xml).not.toContain('utm_source');
    expect(xml).not.toContain('/admin');
  });

  it('không trả urlset rỗng khi không có origin', () => {
    expect(sitemapXml('', [{ path: '/kien-thuc/bai' }])).toBeNull();
  });

  it('bỏ lastmod khi mốc thời gian không dùng được', () => {
    expect(sitemapLastmod(0)).toBeUndefined();
    expect(sitemapLastmod(Number.NaN)).toBeUndefined();
    expect(sitemapLastmod(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
