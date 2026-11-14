import { and, asc, count, desc, eq, like, or, type SQL } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { categories, media, posts, productCategories, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { productSoldCount, toCatalogCard, type CatalogCard } from '../products/catalog';
import { sellableProductWhere } from '../products/status';
import type { PublicPostCard } from '../posts/public';
import { livePublished } from '../posts/visibility';
import { normalizeSearchQuery, searchQueryReady, type SearchKind } from './query';

export const SEARCH_SUGGEST_LIMIT = 5;
/** Số mục mỗi nhóm trên trang tổng kết quả. */
export const SEARCH_OVERVIEW_LIMIT = 6;
/** Số mục mỗi trang khi xem thêm theo loại. */
export const SEARCH_PAGE_SIZE = 12;

export type SearchPostHit = PublicPostCard & { href: string };

/** Cùng shape card trang chủ / catalog để render HomeProductCard. */
export type SearchProductHit = CatalogCard & { href: string };

export type PublicSearchResult = {
  q: string;
  posts: SearchPostHit[];
  products: SearchProductHit[];
};

export type SearchOverviewResult = PublicSearchResult & {
  postTotal: number;
  productTotal: number;
};

export type SearchKindPageResult = {
  q: string;
  kind: SearchKind;
  page: number;
  pageCount: number;
  total: number;
  posts: SearchPostHit[];
  products: SearchProductHit[];
};

export async function searchPublic(
  db: AppDb,
  raw: string | null | undefined,
  limits: { posts: number; products: number } = { posts: SEARCH_PAGE_SIZE, products: SEARCH_PAGE_SIZE },
): Promise<PublicSearchResult> {
  const q = normalizeSearchQuery(raw);
  if (!searchQueryReady(q)) return { q, posts: [], products: [] };
  const pattern = `%${q}%`;
  const [postRows, productRows] = await Promise.all([
    selectPosts(db, pattern, limits.posts, 0),
    selectProducts(db, pattern, limits.products, 0),
  ]);
  return { q, posts: mapPosts(postRows), products: mapProducts(productRows) };
}

/** Trang tổng: vài mục mỗi nhóm + tổng số khớp thật. */
export async function searchOverview(db: AppDb, raw: string | null | undefined): Promise<SearchOverviewResult> {
  const q = normalizeSearchQuery(raw);
  if (!searchQueryReady(q)) return { q, posts: [], products: [], postTotal: 0, productTotal: 0 };
  const pattern = `%${q}%`;
  const [postRows, productRows, postTotal, productTotal] = await Promise.all([
    selectPosts(db, pattern, SEARCH_OVERVIEW_LIMIT, 0),
    selectProducts(db, pattern, SEARCH_OVERVIEW_LIMIT, 0),
    countPosts(db, pattern),
    countProducts(db, pattern),
  ]);
  return {
    q,
    posts: mapPosts(postRows),
    products: mapProducts(productRows),
    postTotal,
    productTotal,
  };
}

/** Xem thêm một loại (sản phẩm hoặc bài) có phân trang. */
export async function searchByKind(
  db: AppDb,
  raw: string | null | undefined,
  kind: SearchKind,
  page: number,
): Promise<SearchKindPageResult> {
  const q = normalizeSearchQuery(raw);
  const safePage = Math.max(1, Math.floor(page) || 1);
  if (!searchQueryReady(q)) {
    return { q, kind, page: 1, pageCount: 1, total: 0, posts: [], products: [] };
  }
  const pattern = `%${q}%`;
  if (kind === 'san-pham') {
    const total = await countProducts(db, pattern);
    const pageCount = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
    const current = Math.min(safePage, pageCount);
    const rows = await selectProducts(db, pattern, SEARCH_PAGE_SIZE, (current - 1) * SEARCH_PAGE_SIZE);
    return { q, kind, page: current, pageCount, total, posts: [], products: mapProducts(rows) };
  }
  const total = await countPosts(db, pattern);
  const pageCount = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const current = Math.min(safePage, pageCount);
  const rows = await selectPosts(db, pattern, SEARCH_PAGE_SIZE, (current - 1) * SEARCH_PAGE_SIZE);
  return { q, kind, page: current, pageCount, total, posts: mapPosts(rows), products: [] };
}

export async function suggestPublic(db: AppDb, raw: string | null | undefined): Promise<PublicSearchResult> {
  return searchPublic(db, raw, { posts: SEARCH_SUGGEST_LIMIT, products: SEARCH_SUGGEST_LIMIT });
}

function postWhere(pattern: string): SQL {
  return and(livePublished(), or(like(posts.title, pattern), like(posts.excerpt, pattern)))!;
}

function productWhere(pattern: string): SQL {
  return and(sellableProductWhere(), or(like(products.name, pattern), like(products.description, pattern)))!;
}

async function countPosts(db: AppDb, pattern: string): Promise<number> {
  const rows = await db.select({ value: count() }).from(posts).where(postWhere(pattern));
  return rows[0]?.value ?? 0;
}

async function countProducts(db: AppDb, pattern: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(productWhere(pattern));
  return rows[0]?.value ?? 0;
}

async function selectPosts(db: AppDb, pattern: string, limit: number, offset: number) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      publishedAt: posts.publishedAt,
      categoryName: categories.name,
      categorySlug: categories.slug,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(postWhere(pattern))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(limit)
    .offset(offset);
}

async function selectProducts(db: AppDb, pattern: string, limit: number, offset: number) {
  return db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      comparePrice: products.comparePrice,
      rating: products.rating,
      sold: productSoldCount,
      weightScale: productCategories.weightScale,
      categorySlug: productCategories.slug,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(productWhere(pattern))
    .orderBy(desc(products.isFeatured), asc(products.sortOrder), asc(products.name))
    .limit(limit)
    .offset(offset);
}

function mapPosts(
  rows: Awaited<ReturnType<typeof selectPosts>>,
): SearchPostHit[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    publishedAt: row.publishedAt,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    href: routes.knowledge(row.slug),
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    cardUrl: row.cardKey ? routes.media(row.cardKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  }));
}

function mapProducts(rows: Awaited<ReturnType<typeof selectProducts>>): SearchProductHit[] {
  return rows.map((row) => {
    const card = toCatalogCard(row);
    return { ...card, href: routes.product(card.slug) };
  });
}
