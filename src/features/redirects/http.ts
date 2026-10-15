import { FRESH_PAGE_CACHE } from '../../lib/seo/cache';
import type { PublicRedirect } from './rules';

export function redirectHttpResponse(outcome: PublicRedirect): Response {
  if (outcome.type === 'gone') {
    return new Response('Nội dung này đã được gỡ.', {
      status: 410,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': FRESH_PAGE_CACHE,
        'x-robots-tag': 'noindex',
      },
    });
  }
  return new Response(null, {
    status: outcome.status,
    headers: {
      location: outcome.location,
      'cache-control': FRESH_PAGE_CACHE,
      'x-robots-tag': 'noindex',
    },
  });
}
