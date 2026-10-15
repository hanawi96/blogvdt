import { siteOrigin } from './meta';

const PRIVATE_ENVIRONMENTS = new Set(['development', 'staging', 'preview']);

export function robotsTxt(origin: string): string {
  const base = siteOrigin(origin);
  const sitemap = base ? `\nSitemap: ${base}/sitemap.xml\n` : '\n';
  return `User-agent: *\nAllow: /${sitemap}`;
}

export function indexingAllowed(input: { requestOrigin: string; siteUrl?: string | null; environment?: string | null }): boolean {
  const environment = (input.environment ?? '').trim().toLowerCase();
  if (PRIVATE_ENVIRONMENTS.has(environment)) return false;
  const request = siteOrigin(input.requestOrigin);
  if (!request) return false;
  const hostname = new URL(request).hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.workers.dev') || hostname.endsWith('.pages.dev')) return false;
  const configured = siteOrigin(input.siteUrl ?? '');
  if (!configured) return true;
  return configured === request;
}
