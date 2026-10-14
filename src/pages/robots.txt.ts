import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ url }) => {
  const body = `User-agent: *\nDisallow: /admin\n\nSitemap: ${url.origin}/sitemap.xml\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=60',
    },
  });
};
