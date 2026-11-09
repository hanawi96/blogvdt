import { z } from 'zod';
import { fieldErrors, type FieldErrors } from '../../lib/validation/errors';
import { parseRecipe } from '../materials/costing';
import type { ProductInput } from './products';
import { canFeatureProduct, isProductStatus } from './status';

export const CORD_TYPES = ['Dây rút', 'Dây co giãn'] as const;

export const PRODUCT_RATING_MAX = 50;

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
  stockQty: z.string().trim(),
  rating: z.string().trim(),
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
    stockQty: formValue(form, 'stockQty'),
    rating: formValue(form, 'rating'),
    seoTitle: formValue(form, 'seoTitle'),
    metaDescription: formValue(form, 'metaDescription'),
  });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  if (!isProductStatus(parsed.data.status)) return { ok: false, errors: { status: 'Trạng thái không hợp lệ.' } };
  if (parsed.data.cordType && !isCordType(parsed.data.cordType)) return { ok: false, errors: { cordType: 'Kiểu dây không hợp lệ.' } };
  const comparePrice = readComparePrice(parsed.data.comparePrice, Number(parsed.data.price));
  if (!comparePrice.ok) return { ok: false, errors: { comparePrice: comparePrice.error } };
  const stockQty = readStockQty(parsed.data.stockQty);
  if (!stockQty.ok) return { ok: false, errors: { stockQty: stockQty.error } };
  const rating = readRating(parsed.data.rating);
  if (!rating.ok) return { ok: false, errors: { rating: rating.error } };
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
      stockQty: stockQty.value,
      rating: rating.value,
      seoTitle: parsed.data.seoTitle || null,
      metaDescription: parsed.data.metaDescription || null,
    },
  };
}

/** Hiển thị điểm lưu ×10 ra ô form (45 → "4.5", 0 → ""). */
export function ratingFormValue(rating: number): string {
  if (!Number.isInteger(rating) || rating <= 0) return '';
  return (rating / 10).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
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

function readStockQty(value: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = value.trim() || '0';
  if (!/^\d{1,7}$/.test(text)) return { ok: false, error: 'Tồn kho là số nguyên từ 0 trở lên.' };
  return { ok: true, value: Number(text) };
}

function readRating(value: string): { ok: true; value: number } | { ok: false; error: string } {
  const text = value.trim().replace(',', '.');
  if (!text || text === '0' || text === '0.0') return { ok: true, value: 0 };
  if (!/^(?:[0-4](?:\.\d)?|5(?:\.0)?)$/.test(text)) {
    return { ok: false, error: 'Điểm từ 0 đến 5, tối đa 1 số lẻ.' };
  }
  const stored = Math.round(Number(text) * 10);
  if (!Number.isInteger(stored) || stored < 0 || stored > PRODUCT_RATING_MAX) {
    return { ok: false, error: 'Điểm từ 0 đến 5, tối đa 1 số lẻ.' };
  }
  return { ok: true, value: stored };
}

function isCordType(value: string): boolean {
  return (CORD_TYPES as readonly string[]).includes(value);
}

function optionalId(value: string): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}
