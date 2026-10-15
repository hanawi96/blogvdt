import { POLICIES } from '../content/policies';
import { isSafeRedirect } from '../../lib/http';
import { routes } from '../../lib/routes';
import { SLUG_PATTERN } from '../posts/slug';

const PATH_PATTERN = /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/;
const SYSTEM_EXACT = new Set(['/sitemap.xml', '/robots.txt', '/favicon.svg', '/favicon.ico', routes.checkoutSuccess]);
const SYSTEM_PREFIXES = ['/admin', '/media', '/_astro'] as const;

export const STATIC_PUBLIC_PATHS = new Set([
  routes.home,
  routes.knowledgeList,
  '/san-pham',
  routes.catalog,
  routes.cart,
  routes.checkout,
  ...POLICIES.map((policy) => routes.policy(policy.slug)),
]);

export type RedirectEdge = {
  fromPath: string;
  toPath: string;
  statusCode: number;
  enabled: number;
};

export type PublicRedirect = { type: 'redirect'; location: string; status: 301 | 302 } | { type: 'gone' };

export type UrlRetirement = { action: '404' } | { action: '410' } | { action: 'redirect'; toPath: string };

export function normalizeInternalPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 300) return null;
  if (/[\s?#\\]/.test(trimmed) || trimmed.includes('://') || trimmed.startsWith('//')) return null;
  let path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('://') || decoded.includes('%')) return null;
    path = decoded;
  } catch {
    return null;
  }
  path = path.replace(/\/{2,}/g, '/');
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  path = path.toLowerCase();
  if (!isSafeRedirect(path) || !PATH_PATTERN.test(path)) return null;
  return path;
}

export function isSystemPath(path: string): boolean {
  if (SYSTEM_EXACT.has(path)) return true;
  return SYSTEM_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function isStaticPublicPath(path: string): boolean {
  return STATIC_PUBLIC_PATHS.has(path);
}

export function productSlug(path: string): string | null {
  const prefix = '/san-pham/';
  if (!path.startsWith(prefix)) return null;
  const slug = path.slice(prefix.length);
  return SLUG_PATTERN.test(slug) ? slug : null;
}

// Ảnh, CSS, JS và file tĩnh không cần hỏi bảng redirects.
export function skipsRedirectLookup(pathname: string): boolean {
  if (pathname.startsWith('/_astro/') || pathname.startsWith('/media/') || pathname === '/favicon.svg' || pathname === '/favicon.ico') return true;
  const leaf = pathname.slice(pathname.lastIndexOf('/') + 1);
  return leaf.includes('.');
}

export function collapseTarget(
  fromPath: string,
  toPath: string,
  edges: readonly RedirectEdge[],
): { ok: true; toPath: string } | { ok: false; error: string } {
  if (fromPath === toPath) return { ok: false, error: 'URL nguồn và URL đích trùng nhau.' };
  const next = new Map<string, string>();
  for (const edge of edges) {
    if (edge.enabled !== 1 || edge.statusCode === 410 || !edge.toPath || edge.fromPath === fromPath) continue;
    next.set(edge.fromPath, edge.toPath);
  }
  let current = toPath;
  const seen = new Set<string>([fromPath]);
  for (let hop = 0; hop < 8; hop += 1) {
    if (seen.has(current)) return { ok: false, error: 'Đường dẫn này tạo vòng lặp chuyển hướng.' };
    const follow = next.get(current);
    if (!follow) return { ok: true, toPath: current };
    seen.add(current);
    current = follow;
  }
  return { ok: false, error: 'Chuỗi chuyển hướng quá dài.' };
}

export function redirectOutcome(
  hit: { toPath: string; statusCode: number; enabled: number } | null,
  currentPath: string,
  destinationPublic: boolean,
): PublicRedirect | null {
  if (!hit || hit.enabled !== 1) return null;
  if (hit.statusCode === 410) return { type: 'gone' };
  if (hit.statusCode !== 301 && hit.statusCode !== 302) return null;
  if (!destinationPublic || hit.toPath === currentPath || !isSafeRedirect(hit.toPath)) return null;
  return { type: 'redirect', location: hit.toPath, status: hit.statusCode };
}

export function readRetirement(form: FormData): UrlRetirement | null {
  const action = String(form.get('urlAction') ?? '');
  if (action === '404' || action === '410') return { action };
  if (action === 'redirect') return { action, toPath: String(form.get('urlTarget') ?? '') };
  return null;
}

export function omitRedirectedPaths(paths: readonly string[], blocked: readonly string[]): string[] {
  const skip = new Set(blocked);
  return paths.filter((path) => !skip.has(path));
}
