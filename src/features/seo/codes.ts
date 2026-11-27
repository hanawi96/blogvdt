/** Catalog mã kiểm tra SEO health — một nguồn cho label, filter và type. */

export const HEALTH_CODES = [
  'title',
  'description',
  'duplicate',
  'content',
  'heading',
  'cover',
  'slug',
  'canonical',
  'image',
  'alt',
  'link',
  'inbound',
  'sitemap',
] as const;

export type HealthCode = (typeof HEALTH_CODES)[number];
export type HealthSeverity = 'error' | 'warning';
export type HealthPhase = 'posts' | 'links' | 'inbound' | 'done';

export const HEALTH_CODE_LABELS: Record<HealthCode, string> = {
  title: 'SEO title',
  description: 'Mô tả',
  duplicate: 'Trùng lặp',
  content: 'Nội dung',
  heading: 'Tiêu đề trong bài',
  cover: 'Ảnh đại diện',
  slug: 'Slug',
  canonical: 'Canonical',
  image: 'Ảnh',
  alt: 'ALT',
  link: 'Liên kết nội bộ',
  inbound: 'Bài trỏ tới',
  sitemap: 'Sitemap',
};

export function isHealthCode(value: string | null): value is HealthCode {
  return HEALTH_CODES.some((code) => code === value);
}

export function isHealthPhase(value: string): value is HealthPhase {
  return value === 'posts' || value === 'links' || value === 'inbound' || value === 'done';
}
