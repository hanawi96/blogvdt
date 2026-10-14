import { z } from 'zod';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { sanitizePostContent } from './content';
import type { PostInput } from './posts';
import { isPostStatus } from './status';

const postFields = z.object({
  title: z.string().trim().min(1, 'Nhập tiêu đề.').max(180, 'Tiêu đề quá dài.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(180, 'Slug quá dài.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch.'),
  categoryId: z.string(),
  coverMediaId: z.string(),
  contentJson: z.string(),
  seoTitle: z.string().trim().max(180, 'SEO title quá dài.'),
  metaDescription: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
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
      excerpt: content.excerpt,
      seoTitle: emptyToNull(parsed.data.seoTitle),
      metaDescription: emptyToNull(parsed.data.metaDescription),
      status: parsed.data.status,
    },
  };
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
