import { asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { runBatch } from '../../lib/db/batch';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { categories, posts } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { slugify } from './slug';

export async function listCategories(db: AppDb) {
  return db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      seoTitle: categories.seoTitle,
      metaDescription: categories.metaDescription,
      postCount: count(posts.id),
    })
    .from(categories)
    .leftJoin(posts, eq(posts.categoryId, categories.id))
    .groupBy(categories.id, categories.name, categories.slug, categories.description, categories.seoTitle, categories.metaDescription)
    .orderBy(asc(categories.name));
}

export async function saveCategory(
  db: AppDb,
  input: { id?: number; name: string; slug: string; description: string; seoTitle: string; metaDescription: string },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = input.name.trim();
  const slug = slugify(input.slug || name);
  const description = input.description.trim();
  const seoTitle = input.seoTitle.trim();
  const metaDescription = input.metaDescription.trim();
  if (!name) return { ok: false, error: 'Nhập tên danh mục.' };
  if (name.length > 120) return { ok: false, error: 'Tên danh mục quá dài.' };
  if (!slug) return { ok: false, error: 'Slug không hợp lệ.' };
  if (description.length > 300) return { ok: false, error: 'Mô tả quá dài.' };
  if (seoTitle.length > 180) return { ok: false, error: 'SEO title quá dài.' };
  if (metaDescription.length > 300) return { ok: false, error: 'Mô tả SEO quá dài.' };
  const taken = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug)).limit(1);
  if (taken[0] && taken[0].id !== input.id) return { ok: false, error: 'Slug đã được dùng.' };
  const values = {
    name,
    slug,
    description: description || null,
    seoTitle: seoTitle || null,
    metaDescription: metaDescription || null,
    updatedAt: now,
  };
  if (input.id) {
    const current = await db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, input.id)).limit(1);
    if (!current[0]) return { ok: false, error: 'Không tìm thấy danh mục.' };
    const redirect = categoryRedirect(current[0].slug, slug);
    await runBatch(db, [
      db.update(categories).set(values).where(eq(categories.id, input.id)),
      ...(redirect ? slugRedirectQueries(db, redirect.from, redirect.to, now) : []),
    ]);
    return { ok: true };
  }
  await db.insert(categories).values({ ...values, createdAt: now });
  return { ok: true };
}

// Bài viết không bị xóa. category_id về null, đúng khóa ngoại của bảng posts.
export async function deleteCategory(db: AppDb, id: number): Promise<void> {
  await runBatch(db, [
    db.update(posts).set({ categoryId: null }).where(eq(posts.categoryId, id)),
    db.delete(categories).where(eq(categories.id, id)),
  ]);
}

export function categoryRedirect(oldSlug: string, newSlug: string): { from: string; to: string } | null {
  if (!oldSlug || oldSlug === newSlug) return null;
  return { from: routes.knowledgeCategory(oldSlug), to: routes.knowledgeCategory(newSlug) };
}

export function categoryDeleteWarning(postCount: number): string {
  if (postCount <= 0) return 'Xóa danh mục này?';
  const label = postCount === 1 ? '1 bài viết' : `${postCount} bài viết`;
  return `Danh mục này có ${label}. Bài viết được giữ lại và chỉ bỏ khỏi danh mục. Xóa danh mục?`;
}

export function categoryPageMeta(
  category: { name: string; description: string | null; seoTitle: string | null; metaDescription: string | null },
  siteName: string,
  fallbackDescription: string,
): { title: string; description: string } {
  const headline = category.seoTitle?.trim() || category.name;
  return {
    title: `${headline} | ${siteName}`,
    description: category.metaDescription?.trim() || category.description?.trim() || fallbackDescription,
  };
}
