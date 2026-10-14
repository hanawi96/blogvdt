import { asc, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { categories } from '../../lib/db/schema';
import { slugify } from './slug';

export async function listCategories(db: AppDb) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
    })
    .from(categories)
    .orderBy(asc(categories.name));
}

export async function saveCategory(
  db: AppDb,
  input: { id?: number; name: string; slug: string; description: string },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  const slug = slugify(input.slug || name);
  if (!name) return { ok: false, error: 'Nhập tên danh mục.' };
  if (!slug) return { ok: false, error: 'Slug không hợp lệ.' };
  const taken = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
  if (taken[0] && taken[0].id !== input.id) return { ok: false, error: 'Slug đã được dùng.' };
  const description = input.description.trim();
  if (input.id) {
    await db
      .update(categories)
      .set({ name, slug, description: description || null, updatedAt: now })
      .where(eq(categories.id, input.id));
    return { ok: true };
  }
  await db.insert(categories).values({ name, slug, description: description || null, createdAt: now, updatedAt: now });
  return { ok: true };
}

export async function deleteCategory(db: AppDb, id: number): Promise<void> {
  await db.delete(categories).where(eq(categories.id, id));
}
