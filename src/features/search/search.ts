import { and, asc, desc, eq, like, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { categories, media, posts, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import type { PublicPostCard } from '../posts/public';
import { livePublished } from '../posts/visibility';
import { normalizeSearchQuery, searchQueryReady } from './query';

export const SEARCH_SUGGEST_LIMIT = 5;
export const SEARCH_PAGE_LIMIT = 12;

export type SearchPostHit = PublicPostCard & { href: string };

export type SearchProductHit = {
  id: number;
  name: string;
  slug: string;
  price: number;
  description: string;
  href: string;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export type PublicSearchResult = {
  q: string;
  posts: SearchPostHit[];
  products: SearchProductHit[];
};

export async function searchPublic(
  db: AppDb,
  raw: string | null | undefined,
  limits: { posts: number; products: number } = { posts: SEARCH_PAGE_LIMIT, products: SEARCH_PAGE_LIMIT },
): Promise<PublicSearchResult> {
  const q = normalizeSearchQuery(raw);
  if (!searchQueryReady(q)) return { q, posts: [], products: [] };
  const pattern = `%${q}%`;
  const [postRows, productRows] = await Promise.all([
    db
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
      .where(and(livePublished(), or(like(posts.title, pattern), like(posts.excerpt, pattern))))
      .orderBy(desc(posts.publishedAt), desc(posts.id))
      .limit(limits.posts),
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        price: products.price,
        description: products.description,
        coverKey: media.r2Key,
        coverAlt: media.altText,
        coverWidth: media.width,
        coverHeight: media.height,
      })
      .from(products)
      .leftJoin(media, eq(products.coverMediaId, media.id))
      .where(and(eq(products.status, 'active'), or(like(products.name, pattern), like(products.description, pattern))))
      .orderBy(desc(products.isFeatured), asc(products.sortOrder), asc(products.name))
      .limit(limits.products),
  ]);
  return {
    q,
    posts: postRows.map((row) => ({
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      publishedAt: row.publishedAt,
      categoryName: row.categoryName,
      categorySlug: row.categorySlug,
      href: routes.knowledge(row.slug),
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt ?? '',
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
    })),
    products: productRows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      description: row.description,
      href: routes.product(row.slug),
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt ?? '',
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
    })),
  };
}

export async function suggestPublic(db: AppDb, raw: string | null | undefined): Promise<PublicSearchResult> {
  return searchPublic(db, raw, { posts: SEARCH_SUGGEST_LIMIT, products: SEARCH_SUGGEST_LIMIT });
}
