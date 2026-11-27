/** Rule meta/slug thuần — một nguồn cho editor checklist và SEO health. */

import { plainMetaText, type MetaCorpus } from '../../lib/seo/meta';
import { routes } from '../../lib/routes';
import { SLUG_PATTERN } from '../posts/slug';
import { META_DUPLICATE } from './messages';

export const SEO_TITLE_RANGE = { min: 30, max: 60 };
export const SEO_DESC_RANGE = { min: 70, max: 160 };
/** Dưới mức này coi là bài mỏng (editor improve / health warning). */
export const MIN_CONTENT_WORDS = 150;

export function lengthNote(length: number, min: number, max: number): string {
  if (length === 0) return '';
  if (length < min) return `Hơi ngắn. Mức tham khảo khoảng ${min}–${max} ký tự.`;
  if (length > max) return `Hơi dài. Mức tham khảo khoảng ${min}–${max} ký tự.`;
  return '';
}

/** Headline/description thực tế dùng cho meta công khai của bài. */
export function resolvePostMeta(input: {
  title: string;
  seoTitle: string | null | undefined;
  excerpt: string;
  metaDescription: string | null | undefined;
}): { headline: string; description: string } {
  return {
    headline: plainMetaText(input.seoTitle) || plainMetaText(input.title),
    description: plainMetaText(input.metaDescription) || plainMetaText(input.excerpt),
  };
}

export function metaDuplicateNote(headline: string, description: string, corpus?: MetaCorpus): string {
  const title = plainMetaText(headline);
  const desc = plainMetaText(description);
  if (title && desc && title.toLocaleLowerCase('vi') === desc.toLocaleLowerCase('vi')) {
    return META_DUPLICATE.titleEqualsDescription;
  }
  const titleKey = title.toLocaleLowerCase('vi');
  const descKey = desc.toLocaleLowerCase('vi');
  if (titleKey && (corpus?.titles ?? []).some((item) => plainMetaText(item).toLocaleLowerCase('vi') === titleKey)) {
    return META_DUPLICATE.titleTaken;
  }
  if (descKey && (corpus?.descriptions ?? []).some((item) => plainMetaText(item).toLocaleLowerCase('vi') === descKey)) {
    return META_DUPLICATE.descriptionTaken;
  }
  return '';
}

/** Path kiến thức nếu slug hợp lệ; chuỗi rỗng nếu không tạo được URL công khai. */
export function knowledgePathIfValid(slug: string): string {
  return SLUG_PATTERN.test(slug) ? routes.knowledge(slug) : '';
}

export function isKnowledgePathBlocked(path: string, blocked: ReadonlySet<string>): boolean {
  return path.length > 0 && blocked.has(path);
}
