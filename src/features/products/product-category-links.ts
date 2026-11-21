import { asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from '../../lib/db/client';
import { productCategories, productCategoryLinks } from '../../lib/db/schema';

export function primaryCategoryId(ids: number[]): number | null {
  if (ids.length === 0) return null;
  return Math.min(...ids);
}

export function sameCategoryIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, index) => id === right[index]);
}

export function parseCategoryIds(form: FormData): { ok: true; ids: number[] } | { ok: false; error: string } {
  const raw = form.getAll('categoryIds');
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || value === '') continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Danh mục không hợp lệ.' };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { ok: true, ids };
}

export async function listProductCategoryIds(db: AppDb, productId: number): Promise<number[]> {
  const rows = await db
    .select({ categoryId: productCategoryLinks.categoryId })
    .from(productCategoryLinks)
    .where(eq(productCategoryLinks.productId, productId))
    .orderBy(asc(productCategoryLinks.categoryId));
  return rows.map((row) => row.categoryId);
}

/** D1 giới hạn ~100 biến SQL — chia lô giống loadProductCosts. */
const PRODUCT_LINK_CHUNK = 90;

export async function listProductCategoryIdsByProductIds(
  db: AppDb,
  productIds: number[],
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (productIds.length === 0) return out;
  for (let i = 0; i < productIds.length; i += PRODUCT_LINK_CHUNK) {
    const chunk = productIds.slice(i, i + PRODUCT_LINK_CHUNK);
    const rows = await db
      .select({
        productId: productCategoryLinks.productId,
        categoryId: productCategoryLinks.categoryId,
      })
      .from(productCategoryLinks)
      .where(inArray(productCategoryLinks.productId, chunk))
      .orderBy(asc(productCategoryLinks.categoryId));
    for (const row of rows) {
      const list = out.get(row.productId);
      if (list) list.push(row.categoryId);
      else out.set(row.productId, [row.categoryId]);
    }
  }
  return out;
}

export async function resolveProductCategoryIds(
  db: AppDb,
  ids: number[],
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, ids: [] };
  const rows = await db.select({ id: productCategories.id }).from(productCategories).where(inArray(productCategories.id, ids));
  if (rows.length !== ids.length) return { ok: false, error: 'Danh mục không còn tồn tại.' };
  const allowed = new Set(rows.map((row) => row.id));
  return { ok: true, ids: ids.filter((id) => allowed.has(id)) };
}

export function replaceProductCategoryWrites(db: AppDb, productId: number, categoryIds: number[]): BatchItem<'sqlite'>[] {
  const writes: BatchItem<'sqlite'>[] = [db.delete(productCategoryLinks).where(eq(productCategoryLinks.productId, productId))];
  if (categoryIds.length > 0) {
    writes.push(
      db.insert(productCategoryLinks).values(categoryIds.map((categoryId) => ({ productId, categoryId }))),
    );
  }
  return writes;
}
