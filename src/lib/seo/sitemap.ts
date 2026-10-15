import { canonicalUrl, siteOrigin } from './meta';

export type SitemapEntry = { path: string; lastmod?: string };

export function sitemapXml(origin: string, entries: SitemapEntry[]): string | null {
  if (!siteOrigin(origin)) return null;
  const urls: string[] = [];
  for (const entry of entries) {
    const loc = canonicalUrl(origin, entry.path);
    if (!loc) continue;
    const last = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
    urls.push(`  <url>\n    <loc>${escapeXml(loc)}</loc>${last}\n  </url>`);
  }
  if (urls.length === 0) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function sitemapLastmod(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value).toISOString();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
