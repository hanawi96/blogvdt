import type { APIRoute } from 'astro';
import { POLICIES } from '../features/content/policies';
import { listPublicCategories, listSitemapPosts } from '../features/posts/public';
import { listSitemapProducts } from '../features/products/public';
import { createDb } from '../lib/db/client';
import { getDbBinding } from '../lib/cloudflare/env';
import { routes } from '../lib/routes';
import { PRIVATE_PAGE_CACHE, PUBLIC_PAGE_CACHE } from '../lib/seo/cache';
import { sitemapLastmod, sitemapXml, type SitemapEntry } from '../lib/seo/sitemap';

export const GET: APIRoute = async ({ url }) => {
  try {
    const db = createDb(getDbBinding());
    const [posts, categories, productPages] = await Promise.all([
      listSitemapPosts(db),
      listPublicCategories(db),
      listSitemapProducts(db),
    ]);
    const entries: SitemapEntry[] = [
      { path: routes.home },
      { path: routes.knowledgeList },
      { path: routes.products },
      ...categories.map((category) => ({ path: routes.knowledgeCategory(category.slug) })),
      ...posts.map((post) => ({ path: routes.knowledge(post.slug), lastmod: sitemapLastmod(post.updatedAt) })),
      ...productPages.map((product) => ({ path: routes.product(product.slug), lastmod: sitemapLastmod(product.updatedAt) })),
      ...POLICIES.map((policy) => ({ path: routes.policy(policy.slug) })),
    ];
    return new Response(sitemapXml(url.origin, entries), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': PUBLIC_PAGE_CACHE,
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'sitemap_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return new Response('Chưa tạo được sitemap.', {
      status: 503,
      headers: { 'cache-control': PRIVATE_PAGE_CACHE, 'content-type': 'text/plain; charset=utf-8' },
    });
  }
};
