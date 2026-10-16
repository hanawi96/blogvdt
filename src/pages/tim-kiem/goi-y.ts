import type { APIRoute } from 'astro';
import { suggestPublic } from '../../features/search/search';
import { normalizeSearchQuery, searchQueryReady } from '../../features/search/query';
import { createDb } from '../../lib/db/client';
import { getDbBinding } from '../../lib/cloudflare/env';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = normalizeSearchQuery(url.searchParams.get('q'));
  if (!searchQueryReady(q)) {
    return json({ q, posts: [], products: [] });
  }
  try {
    const result = await suggestPublic(createDb(getDbBinding()), q);
    return json({
      q: result.q,
      posts: result.posts.map((post) => ({ title: post.title, href: post.href, excerpt: post.excerpt.slice(0, 120) })),
      products: result.products.map((product) => ({ name: product.name, href: product.href, price: product.price })),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'search_suggest_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ q, posts: [], products: [] }, 503);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=15',
      'x-robots-tag': 'noindex',
    },
  });
}
