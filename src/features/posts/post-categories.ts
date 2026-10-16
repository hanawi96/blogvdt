import { asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from '../../lib/db/client';
import { categories, postCategories } from '../../lib/db/schema';

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

export async function listPostCategoryIds(db: AppDb, postId: number): Promise<number[]> {
  const rows = await db
    .select({ categoryId: postCategories.categoryId })
    .from(postCategories)
    .where(eq(postCategories.postId, postId))
    .orderBy(asc(postCategories.categoryId));
  return rows.map((row) => row.categoryId);
}

export async function listPostCategories(
  db: AppDb,
  postId: number,
): Promise<Array<{ id: number; name: string; slug: string }>> {
  return db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(postCategories)
    .innerJoin(categories, eq(postCategories.categoryId, categories.id))
    .where(eq(postCategories.postId, postId))
    .orderBy(asc(categories.name));
}

export async function resolveCategoryIds(
  db: AppDb,
  ids: number[],
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, ids: [] };
  const rows = await db.select({ id: categories.id }).from(categories).where(inArray(categories.id, ids));
  if (rows.length !== ids.length) return { ok: false, error: 'Danh mục không còn tồn tại.' };
  const allowed = new Set(rows.map((row) => row.id));
  return { ok: true, ids: ids.filter((id) => allowed.has(id)) };
}

export function replacePostCategoryWrites(db: AppDb, postId: number, categoryIds: number[]): BatchItem<'sqlite'>[] {
  const writes: BatchItem<'sqlite'>[] = [db.delete(postCategories).where(eq(postCategories.postId, postId))];
  if (categoryIds.length > 0) {
    writes.push(
      db.insert(postCategories).values(categoryIds.map((categoryId) => ({ postId, categoryId }))),
    );
  }
  return writes;
}
