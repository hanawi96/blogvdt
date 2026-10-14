import { isSafeRedirect } from '../../lib/http';
import { SLUG_PATTERN } from './slug';

const KNOWLEDGE_PREFIX = '/kien-thuc/';

export function shouldStorePostRedirect(
  current: { status: string; publishedAt: number | null; slug: string },
  nextSlug: string,
): boolean {
  if (current.slug === nextSlug) return false;
  return current.status === 'published' || current.publishedAt !== null;
}

export function knowledgeSlug(path: string): string | null {
  if (!path.startsWith(KNOWLEDGE_PREFIX)) return null;
  const slug = path.slice(KNOWLEDGE_PREFIX.length);
  return SLUG_PATTERN.test(slug) ? slug : null;
}

// Chỉ 301 khi đích đang xuất bản. Bản nháp và vòng lặp về chính URL này thì 404.
export function publicRedirectTarget(target: string | null, currentPath: string, destinationPublished: boolean): string | null {
  if (!target || !destinationPublished || target === currentPath || !isSafeRedirect(target)) return null;
  return target;
}
