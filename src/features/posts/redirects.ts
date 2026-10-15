import { isSafeRedirect } from '../../lib/http';
import { SLUG_PATTERN } from './slug';

const KNOWLEDGE_PREFIX = '/kien-thuc/';
const CATEGORY_PREFIX = '/kien-thuc/danh-muc/';

export function shouldStorePostRedirect(
  current: { status: string; publishedAt: number | null; slug: string },
  nextSlug: string,
): boolean {
  if (current.slug === nextSlug) return false;
  // Chỉ bài đang xuất bản mới có URL công khai cần 301. Gỡ bài chọn 301, 404 hoặc 410 riêng.
  return current.status === 'published';
}

export function knowledgeSlug(path: string): string | null {
  if (!path.startsWith(KNOWLEDGE_PREFIX) || path.startsWith(CATEGORY_PREFIX)) return null;
  const slug = path.slice(KNOWLEDGE_PREFIX.length);
  return SLUG_PATTERN.test(slug) ? slug : null;
}

export function categorySlug(path: string): string | null {
  if (!path.startsWith(CATEGORY_PREFIX)) return null;
  const slug = path.slice(CATEGORY_PREFIX.length);
  return SLUG_PATTERN.test(slug) ? slug : null;
}

// Slug mới được lấy lại khi redirect đang trỏ về chính bài này. Redirect của bài khác thì chặn.
export function redirectOccupiesSlug(currentPath: string | null, occupiedTarget: string | null): boolean {
  if (!occupiedTarget) return false;
  return occupiedTarget !== currentPath;
}

// Chỉ 301 khi đích đang xuất bản. Bản nháp và vòng lặp về chính URL này thì 404.
export function publicRedirectTarget(target: string | null, currentPath: string, destinationPublished: boolean): string | null {
  if (!target || !destinationPublished || target === currentPath || !isSafeRedirect(target)) return null;
  return target;
}
