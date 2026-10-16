import type { APIRoute } from 'astro';
import { POLICIES } from '../features/content/policies';
import { listSitemapCategories, listSitemapPosts, listSitemapTags } from '../features/posts/public';
import { listSitemapProducts } from '../features/products/public';
import { createDb } from '../lib/db/client';
import { listRedirectPaths } from '../lib/db/redirects';
import { getDbBinding, getSiteOrigin } from '../lib/cloudflare/env';
import { routes } from '../lib/routes';
import { FRESH_PAGE_CACHE, PRIVATE_PAGE_CACHE } from '../lib/seo/cache';
import { sitemapLastmod, sitemapXml, type SitemapEntry } from '../lib/seo/sitemap';

export const GET: APIRoute = async ({ url }) => {
  try {
    const db = createDb(getDbBinding());
    const [posts, categories, tagPages, productPages, redirectPaths] = await Promise.all([
      listSitemapPosts(db),
      listSitemapCategories(db),
      listSitemapTags(db),
      listSitemapProducts(db),
      listRedirectPaths(db),
    ]);
    const blocked = new Set(redirectPaths);
    const contentLastmod = sitemapLastmod(posts.reduce((latest, post) => Math.max(latest, post.updatedAt), 0));
    const entries: SitemapEntry[] = [
      { path: routes.home, lastmod: contentLastmod },
      { path: routes.knowledgeList, lastmod: contentLastmod },
      { path: routes.catalog },
      ...categories.map((category) => ({ path: routes.knowledgeCategory(category.slug), lastmod: sitemapLastmod(category.updatedAt) })),
      ...tagPages.map((tag) => ({ path: routes.tag(tag.slug), lastmod: sitemapLastmod(tag.updatedAt) })),
      ...posts.map((post) => ({ path: routes.knowledge(post.slug), lastmod: sitemapLastmod(post.updatedAt) })),
      ...productPages.map((product) => ({ path: routes.product(product.slug), lastmod: sitemapLastmod(product.updatedAt) })),
      ...POLICIES.map((policy) => ({ path: routes.policy(policy.slug) })),
    ].filter((entry) => !blocked.has(entry.path));
    const xml = sitemapXml(getSiteOrigin(url.origin), entries);
    if (!xml) {
      return new Response('Chưa tạo được sitemap.', {
        status: 503,
        headers: { 'cache-control': PRIVATE_PAGE_CACHE, 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return new Response(xml, {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': FRESH_PAGE_CACHE,
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
