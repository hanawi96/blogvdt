import { describe, expect, it } from 'vitest';
import { sitemapLastmod, sitemapXml } from './sitemap';

describe('sitemap', () => {
  it('ghi loc và lastmod, escape ký tự XML', () => {
    const xml = sitemapXml('https://vongdautam.vn/', [
      { path: '/kien-thuc/bai', lastmod: '2026-10-14T00:00:00.000Z' },
      { path: '/kien-thuc?x=<draft>' },
    ]);
    expect(xml).toContain('<loc>https://vongdautam.vn/kien-thuc/bai</loc>');
    expect(xml).toContain('<lastmod>2026-10-14T00:00:00.000Z</lastmod>');
    expect(xml).toContain('&lt;draft&gt;');
    expect(xml).not.toContain('<draft>');
  });

  it('bỏ lastmod khi mốc thời gian không dùng được', () => {
    expect(sitemapLastmod(0)).toBeUndefined();
    expect(sitemapLastmod(Number.NaN)).toBeUndefined();
    expect(sitemapLastmod(1_700_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
