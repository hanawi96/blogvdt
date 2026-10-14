import { z } from 'zod';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { parseOptionsText } from './options';
import type { ProductInput } from './products';
import { isProductStatus } from './status';

const productFields = z.object({
  name: z.string().trim().min(1, 'Nhập tên sản phẩm.').max(160, 'Tên quá dài.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(180, 'Slug quá dài.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch.'),
  price: z.string().regex(/^\d{1,8}$/, 'Giá là số nguyên VND.'),
  description: z.string().trim().min(1, 'Nhập mô tả.').max(2000, 'Mô tả quá dài.'),
  coverMediaId: z.string(),
  options: z.string(),
  status: z.string(),
  sortOrder: z.string().regex(/^-?\d{1,4}$/, 'Thứ tự là số nguyên.'),
  seoTitle: z.string().trim().max(180, 'SEO title quá dài.'),
  metaDescription: z.string().trim().max(300, 'Mô tả SEO quá dài.'),
});

export function parseProductForm(form: FormData): { ok: true; input: ProductInput } | { ok: false; errors: FieldErrors } {
  const parsed = productFields.safeParse({
    name: formValue(form, 'name'),
    slug: formValue(form, 'slug'),
    price: formValue(form, 'price'),
    description: formValue(form, 'description'),
    coverMediaId: formValue(form, 'coverMediaId'),
    options: formValue(form, 'options'),
    status: formValue(form, 'status'),
    sortOrder: formValue(form, 'sortOrder') || '0',
    seoTitle: formValue(form, 'seoTitle'),
    metaDescription: formValue(form, 'metaDescription'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!isProductStatus(parsed.data.status)) return { ok: false, errors: { status: 'Trạng thái không hợp lệ.' } };
  const options = parseOptionsText(parsed.data.options);
  if (!options.ok) return { ok: false, errors: { options: options.error } };
  const coverMediaId = optionalId(parsed.data.coverMediaId);
  if (parsed.data.coverMediaId && coverMediaId === null) return { ok: false, errors: { coverMediaId: 'Ảnh đại diện không hợp lệ.' } };
  const albumIds = albumFrom(form, coverMediaId);
  if (albumIds === null) return { ok: false, errors: { album: 'Album có ảnh không hợp lệ hoặc quá 8 ảnh.' } };
  return {
    ok: true,
    input: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      price: Number(parsed.data.price),
      description: parsed.data.description,
      coverMediaId,
      albumIds,
      options: options.options,
      status: parsed.data.status,
      isFeatured: form.get('featured') === '1',
      sortOrder: Number(parsed.data.sortOrder),
      seoTitle: parsed.data.seoTitle || null,
      metaDescription: parsed.data.metaDescription || null,
    },
  };
}

function albumFrom(form: FormData, coverMediaId: number | null): number[] | null {
  const ids: number[] = [];
  for (const value of form.getAll('album')) {
    if (typeof value !== 'string' || !value) continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) return null;
    if (id === coverMediaId) continue;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length <= 8 ? ids : null;
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
