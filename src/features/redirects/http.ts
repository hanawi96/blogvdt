import { FRESH_PAGE_CACHE } from '../../lib/seo/cache';
import type { PublicRedirect } from './rules';

export function redirectHttpResponse(outcome: Extract<PublicRedirect, { type: 'redirect' }>): Response {
  return new Response(null, {
    status: outcome.status,
    headers: {
      location: outcome.location,
      'cache-control': FRESH_PAGE_CACHE,
      'x-robots-tag': 'noindex',
    },
  });
}
