import { z } from 'zod';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { sanitizePostContent } from './content';
import type { PostInput } from './posts';
import { SLUG_PATTERN } from './slug';
import { isPostStatus } from './status';

const postFields = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề.').max(180, 'Tiêu đề quá dài.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(180, 'Slug quá dài.')
    .regex(SLUG_PATTERN, 'Slug chỉ gồm chữ thường, số và dấu gạch.'),
  categoryId: z.string(),
  coverMediaId: z.string(),
  contentJson: z.string(),
  seoTitle: z.string().trim().max(180, 'SEO title quá dài.'),
  metaDescription: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
  excerpt: z.string().trim().max(300, 'Tóm tắt quá dài.'),
  status: z.string(),
});

export function parsePostForm(form: FormData): { ok: true; input: PostInput } | { ok: false; errors: FieldErrors } {
  const parsed = postFields.safeParse({
    title: formValue(form, 'title'),
    slug: formValue(form, 'slug'),
    categoryId: formValue(form, 'categoryId'),
    coverMediaId: formValue(form, 'coverMediaId'),
    contentJson: formValue(form, 'contentJson'),
    seoTitle: formValue(form, 'seoTitle'),
    metaDescription: formValue(form, 'metaDescription'),
    excerpt: formValue(form, 'excerpt'),
    status: formValue(form, 'status'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!isPostStatus(parsed.data.status)) return { ok: false, errors: { status: 'Trạng thái không hợp lệ.' } };
  const categoryId = optionalId(parsed.data.categoryId);
  if (parsed.data.categoryId && categoryId === null) return { ok: false, errors: { categoryId: 'Danh mục không hợp lệ.' } };
  const coverMediaId = optionalId(parsed.data.coverMediaId);
  if (parsed.data.coverMediaId && coverMediaId === null) return { ok: false, errors: { coverMediaId: 'Ảnh đại diện không hợp lệ.' } };
  const content = sanitizePostContent(parsed.data.contentJson || '{"type":"doc","content":[]}');
  if (!content.ok) return { ok: false, errors: { contentJson: content.error } };
  if (parsed.data.status === 'published' && content.excerpt.length === 0) {
    return { ok: false, errors: { contentJson: 'Bài xuất bản cần có nội dung.' } };
  }
  return {
    ok: true,
    input: {
      title: parsed.data.title,
      slug: parsed.data.slug,
      categoryId,
      coverMediaId,
      contentJson: content.json,
      excerpt: parsed.data.excerpt || content.excerpt,
      seoTitle: emptyToNull(parsed.data.seoTitle),
      metaDescription: emptyToNull(parsed.data.metaDescription),
      status: parsed.data.status,
    },
  };
}

export function excerptFieldValue(stored: string, contentJson: string): string {
  const cleaned = sanitizePostContent(contentJson);
  if (!cleaned.ok) return stored;
  return stored === cleaned.excerpt ? '' : stored;
}

export const REVISION_CONFLICT = 'Bài đã được lưu ở phiên khác. Tải lại trang trước khi ghi tiếp.';

export function isAutosave(form: FormData): boolean {
  return form.get('autosave') === '1';
}

export function expectedRevision(form: FormData): number | null {
  const raw = form.get('updatedAt');
  if (typeof raw !== 'string' || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function staleRevision(currentUpdatedAt: number, expected: number | null): boolean {
  return expected !== null && currentUpdatedAt !== expected;
}

export function autosaveResponse(
  body:
    | { ok: true; id: number; skipped: boolean; updatedAt: number }
    | { ok: false; error: string; conflict?: boolean },
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function firstFieldError(errors: FieldErrors): string {
  return Object.values(errors)[0] ?? 'Không lưu được.';
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function optionalId(value: string): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}
