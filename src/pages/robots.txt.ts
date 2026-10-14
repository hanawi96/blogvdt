import type { APIRoute } from 'astro';
import { PUBLIC_PAGE_CACHE } from '../lib/seo/cache';

export const GET: APIRoute = ({ url }) => {
  const body = `User-agent: *\nDisallow: /admin\nDisallow: /dat-hang/thanh-cong\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': PUBLIC_PAGE_CACHE,
    },
  });
};
