export const PUBLIC_PAGE_CACHE = 'public, max-age=60';
export const PRIVATE_PAGE_CACHE = 'no-store';

export function blogReadStatus(input: { hasSite: boolean; failed?: boolean; notFound?: boolean }): 200 | 404 | 503 {
  if (input.failed || !input.hasSite) return 503;
  if (input.notFound) return 404;
  return 200;
}
