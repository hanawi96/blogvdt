export type SitemapEntry = { path: string; lastmod?: string };

export function sitemapXml(origin: string, entries: SitemapEntry[]): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  const urls = entries.map((entry) => {
    const last = entry.lastmod ? `\n    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${escapeXml(`${base}${entry.path}`)}</loc>${last}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

export function sitemapLastmod(value: number): string | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value).toISOString();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
