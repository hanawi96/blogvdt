import { and, count, desc, eq, like } from 'drizzle-orm';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { categories, posts } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import type { PostStatus } from './status';

const PAGE_SIZE = 20;

export type PostInput = {
  title: string;
  slug: string;
  categoryId: number | null;
  coverMediaId: number | null;
  contentJson: string;
  excerpt: string;
  seoTitle: string | null;
  metaDescription: string | null;
  status: PostStatus;
};

export async function listPosts(db: AppDb, filters: { query: string; status: PostStatus | ''; page: number }) {
  const term = filters.query.replace(/[%_]/g, '').trim();
  const conditions = [];
  if (filters.status) conditions.push(eq(posts.status, filters.status));
  if (term) conditions.push(like(posts.title, `%${term}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const totalRows = await db.select({ value: count() }).from(posts).where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      status: posts.status,
      updatedAt: posts.updatedAt,
      categoryName: categories.name,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .where(where)
    .orderBy(desc(posts.updatedAt), desc(posts.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { rows, total, page, pageSize: PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getPost(db: AppDb, id: number) {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPost(db: AppDb, input: PostInput, now = Date.now()): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const slugError = await slugAvailable(db, input.slug, null);
  if (slugError) return { ok: false, error: slugError };
  const inserted = await db
    .insert(posts)
    .values({
      ...postValues(input, now),
      createdAt: now,
    })
    .returning({ id: posts.id });
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được bài viết.' };
  return { ok: true, id };
}

export async function updatePost(
  db: AppDb,
  id: number,
  input: PostInput,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  const slugError = await slugAvailable(db, input.slug, id);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(input, now, current.publishedAt);
  if (current.slug === input.slug) {
    await db.update(posts).set(values).where(eq(posts.id, id));
    return { ok: true };
  }
  await runBatch(db, [
    db.update(posts).set(values).where(eq(posts.id, id)),
    ...slugRedirectQueries(db, routes.knowledge(current.slug), routes.knowledge(input.slug), now),
  ]);
  return { ok: true };
}

export async function deletePost(db: AppDb, id: number): Promise<void> {
  await db.delete(posts).where(eq(posts.id, id));
}

function postValues(input: PostInput, now: number, previousPublishedAt: number | null = null) {
  const publishedAt = input.status === 'published' ? (previousPublishedAt ?? now) : previousPublishedAt;
  return {
    title: input.title,
    slug: input.slug,
    categoryId: input.categoryId,
    coverMediaId: input.coverMediaId,
    contentJson: input.contentJson,
    excerpt: input.excerpt,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    status: input.status,
    publishedAt,
    updatedAt: now,
  };
}

async function slugAvailable(db: AppDb, slug: string, currentId: number | null): Promise<string | null> {
  const rows = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
  if (rows[0] && rows[0].id !== currentId) return 'Slug đã được dùng.';
  return null;
}
