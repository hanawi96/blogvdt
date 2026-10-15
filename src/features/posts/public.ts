import { and, asc, count, desc, eq, ne } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { categories, media, posts } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { SLUG_PATTERN } from './slug';

export const POST_PAGE_SIZE = 9;

export function parseListPage(value: string | null): number | null {
  if (value === null) return 1;
  if (!/^[1-9]\d{0,5}$/.test(value)) return null;
  const page = Number(value);
  return page <= 999_999 ? page : null;
}

export type PublicPostCard = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export async function listPublishedPosts(db: AppDb, filters: { page: number; categoryId?: number }) {
  const where = filters.categoryId
    ? and(eq(posts.status, 'published'), eq(posts.categoryId, filters.categoryId))
    : eq(posts.status, 'published');
  const page = Math.max(1, filters.page);
  const totalRows = await db.select({ value: count() }).from(posts).where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      publishedAt: posts.publishedAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(where)
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(POST_PAGE_SIZE)
    .offset((page - 1) * POST_PAGE_SIZE);
  return {
    posts: rows.map(toCard),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / POST_PAGE_SIZE)),
  };
}

export async function listPublicCategories(db: AppDb) {
  return db
    .select({ id: categories.id, name: categories.name, slug: categories.slug })
    .from(categories)
    .orderBy(asc(categories.name));
}

export async function getCategoryBySlug(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      seoTitle: categories.seoTitle,
      metaDescription: categories.metaDescription,
    })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPostBySlug(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      contentJson: posts.contentJson,
      seoTitle: posts.seoTitle,
      metaDescription: posts.metaDescription,
      status: posts.status,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
      categoryId: posts.categoryId,
      categoryName: categories.name,
      categorySlug: categories.slug,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(and(eq(posts.slug, slug), eq(posts.status, 'published')))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
  };
}

export async function hiddenPostSlug(db: AppDb, slug: string): Promise<boolean> {
  const rows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), ne(posts.status, 'published')))
    .limit(1);
  return Boolean(rows[0]);
}

export async function listRelatedPosts(db: AppDb, input: { id: number; categoryId: number | null }) {
  const where = input.categoryId
    ? and(eq(posts.status, 'published'), eq(posts.categoryId, input.categoryId), ne(posts.id, input.id))
    : and(eq(posts.status, 'published'), ne(posts.id, input.id));
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      publishedAt: posts.publishedAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(where)
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(3);
  return rows.map(toCard);
}

export async function listSitemapPosts(db: AppDb) {
  const rows = await db
    .select({ slug: posts.slug, updatedAt: posts.updatedAt })
    .from(posts)
    .where(eq(posts.status, 'published'))
    .orderBy(desc(posts.publishedAt), desc(posts.id));
  return rows.filter((row) => SLUG_PATTERN.test(row.slug));
}

export async function listSitemapCategories(db: AppDb) {
  const rows = await db
    .select({ slug: categories.slug, updatedAt: categories.updatedAt })
    .from(categories)
    .orderBy(asc(categories.name));
  return rows.filter((row) => SLUG_PATTERN.test(row.slug));
}

function toCard(row: {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  publishedAt: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  coverKey: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): PublicPostCard {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    publishedAt: row.publishedAt,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  };
}
