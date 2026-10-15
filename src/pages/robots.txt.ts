import type { APIRoute } from 'astro';
import { getSiteOrigin } from '../lib/cloudflare/env';
import { PUBLIC_PAGE_CACHE } from '../lib/seo/cache';
import { robotsTxt } from '../lib/seo/robots';

export const GET: APIRoute = ({ url }) => {
  const body = robotsTxt(getSiteOrigin(url.origin));
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': PUBLIC_PAGE_CACHE,
    },
  });
};
