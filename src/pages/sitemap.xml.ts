import type { APIRoute } from 'astro';
import { POLICIES } from '../features/content/policies';
import { listPublicCategories, listSitemapPosts } from '../features/posts/public';
import { listSitemapProducts } from '../features/products/public';
import { createDb } from '../lib/db/client';
import { getDbBinding } from '../lib/cloudflare/env';
import { routes } from '../lib/routes';

export const GET: APIRoute = async ({ url }) => {
  const origin = url.origin;
  try {
    const db = createDb(getDbBinding());
    const [posts, categories, productPages] = await Promise.all([
      listSitemapPosts(db),
      listPublicCategories(db),
      listSitemapProducts(db),
    ]);
    const urls = [
      loc(origin, routes.home),
      loc(origin, routes.knowledgeList),
      loc(origin, routes.products),
      ...categories.map((category) => loc(origin, routes.knowledgeCategory(category.slug))),
      ...posts.map((post) => loc(origin, routes.knowledge(post.slug), new Date(post.updatedAt).toISOString())),
      ...productPages.map((product) => loc(origin, routes.product(product.slug), new Date(product.updatedAt).toISOString())),
      ...POLICIES.map((policy) => loc(origin, routes.policy(policy.slug))),
    ];
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
    return new Response(body, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'sitemap_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return new Response('Chưa tạo được sitemap.', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
};

function loc(origin: string, path: string, lastmod?: string): string {
  const last = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return `  <url>\n    <loc>${escapeXml(`${origin}${path}`)}</loc>${last}\n  </url>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
