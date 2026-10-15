import { asc, count, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productMedia, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { readOptions } from './options';

export const PRODUCT_PAGE_SIZE = 12;

export type PublicProductCard = {
  id: number;
  name: string;
  slug: string;
  price: number;
  description: string;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export async function listPublicProducts(db: AppDb, page: number) {
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
      description: products.description,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(where)
    .orderBy(asc(products.sortOrder), asc(products.id))
    .limit(PRODUCT_PAGE_SIZE)
    .offset((current - 1) * PRODUCT_PAGE_SIZE);
  return {
    products: rows.map(toCard),
    total,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
  };
}

export async function getPublicProduct(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      description: products.description,
      optionsJson: products.optionsJson,
      status: products.status,
      seoTitle: products.seoTitle,
      metaDescription: products.metaDescription,
      updatedAt: products.updatedAt,
      coverId: products.coverMediaId,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(eq(products.slug, slug))
    .limit(1);
  const product = rows[0];
  if (!product) return null;
  const album = await db
    .select({
      id: media.id,
      key: media.r2Key,
      alt: media.altText,
      width: media.width,
      height: media.height,
    })
    .from(productMedia)
    .innerJoin(media, eq(productMedia.mediaId, media.id))
    .where(eq(productMedia.productId, product.id))
    .orderBy(asc(productMedia.sortOrder), asc(media.id));
  const images = [];
  if (product.coverKey && product.coverId) {
    images.push({
      url: routes.media(product.coverKey),
      alt: product.coverAlt ?? '',
      width: product.coverWidth,
      height: product.coverHeight,
    });
  }
  for (const image of album) {
    if (image.id === product.coverId) continue;
    images.push({
      url: routes.media(image.key),
      alt: image.alt,
      width: image.width,
      height: image.height,
    });
  }
  return { ...product, options: readOptions(product.optionsJson), images };
}

export async function listOrderCatalog(db: AppDb) {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      optionsJson: products.optionsJson,
    })
    .from(products)
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map((row) => ({ ...row, options: readOptions(row.optionsJson) }));
}

export async function listSitemapProducts(db: AppDb) {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
}

function toCard(row: {
  id: number;
  name: string;
  slug: string;
  price: number;
  description: string;
  coverKey: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): PublicProductCard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    description: row.description,
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  };
}
