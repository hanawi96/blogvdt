import { z } from 'zod';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { parseRecipe } from '../materials/costing';
import type { ProductInput } from './products';
import { canFeatureProduct, isProductStatus } from './status';

export const CORD_TYPES = ['Dây rút', 'Dây co giãn'] as const;

const productFields = z.object({
  name: z.string().trim().min(1, 'Nhập tên sản phẩm.').max(160, 'Tên quá dài.'),
  slug: z
    .string()
    .trim()
    .min(1, 'Nhập slug.')
    .max(180, 'Slug quá dài.')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch.'),
  price: z.string().regex(/^\d{1,8}$/, 'Giá là số nguyên VND.'),
  comparePrice: z.string().trim(),
  categoryId: z.string(),
  cordType: z.string().trim().max(80, 'Kiểu dây quá dài.'),
  description: z.string().trim().min(1, 'Nhập mô tả.').max(2000, 'Mô tả quá dài.'),
  coverMediaId: z.string(),
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
    comparePrice: formValue(form, 'comparePrice'),
    categoryId: formValue(form, 'categoryId'),
    cordType: formValue(form, 'cordType'),
    description: formValue(form, 'description'),
    coverMediaId: formValue(form, 'coverMediaId'),
    status: formValue(form, 'status'),
    sortOrder: formValue(form, 'sortOrder') || '0',
    seoTitle: formValue(form, 'seoTitle'),
    metaDescription: formValue(form, 'metaDescription'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!isProductStatus(parsed.data.status)) return { ok: false, errors: { status: 'Trạng thái không hợp lệ.' } };
  if (parsed.data.cordType && !isCordType(parsed.data.cordType)) return { ok: false, errors: { cordType: 'Kiểu dây không hợp lệ.' } };
  const comparePrice = readComparePrice(parsed.data.comparePrice, Number(parsed.data.price));
  if (!comparePrice.ok) return { ok: false, errors: { comparePrice: comparePrice.error } };
  const coverMediaId = optionalId(parsed.data.coverMediaId);
  if (parsed.data.coverMediaId && coverMediaId === null) return { ok: false, errors: { coverMediaId: 'Ảnh đại diện không hợp lệ.' } };
  const categoryId = optionalId(parsed.data.categoryId);
  if (parsed.data.categoryId && categoryId === null) return { ok: false, errors: { categoryId: 'Danh mục không hợp lệ.' } };
  const albumIds = albumFrom(form, coverMediaId);
  if (albumIds === null) return { ok: false, errors: { album: 'Album có ảnh không hợp lệ hoặc quá 8 ảnh.' } };
  const recipe = parseRecipe(formStrings(form, 'materialId'), formStrings(form, 'materialQty'));
  if (!recipe.ok) return { ok: false, errors: { recipe: recipe.error } };
  return {
    ok: true,
    input: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      price: Number(parsed.data.price),
      comparePrice: comparePrice.value,
      categoryId,
      cordType: parsed.data.cordType,
      description: parsed.data.description,
      coverMediaId,
      albumIds,
      recipe: recipe.lines,
      status: parsed.data.status,
      isFeatured: canFeatureProduct(parsed.data.status, form.get('featured') === '1'),
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

function formStrings(form: FormData, name: string): string[] {
  return form.getAll(name).flatMap((value) => (typeof value === 'string' ? [value] : []));
}

function formValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function readComparePrice(value: string, price: number): { ok: true; value: number | null } | { ok: false; error: string } {
  if (!value) return { ok: true, value: null };
  if (!/^\d{1,8}$/.test(value)) return { ok: false, error: 'Giá gốc là số nguyên VND.' };
  const comparePrice = Number(value);
  if (comparePrice <= price) return { ok: false, error: 'Giá gốc phải lớn hơn giá bán.' };
  return { ok: true, value: comparePrice };
}

function isCordType(value: string): boolean {
  return (CORD_TYPES as readonly string[]).includes(value);
}

function optionalId(value: string): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
