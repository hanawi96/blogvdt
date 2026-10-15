import { asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';

export const CATALOG_PAGE_SIZE = 12;

export type CatalogCard = {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export function visibleComparePrice(price: number, comparePrice: number | null): number | null {
  if (comparePrice == null || comparePrice <= price) return null;
  return comparePrice;
}

export async function listCatalogProducts(db: AppDb, page: number) {
  const where = eq(products.status, 'active');
  const current = Math.max(1, page);
  const totalRows = await db.select({ value: count() }).from(products).where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      comparePrice: products.comparePrice,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.id))
    .limit(CATALOG_PAGE_SIZE)
    .offset((current - 1) * CATALOG_PAGE_SIZE);
  return {
    products: rows.map(toCard),
    total,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)),
  };
}

function toCard(row: {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  coverKey: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): CatalogCard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    comparePrice: visibleComparePrice(row.price, row.comparePrice),
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  };
}
