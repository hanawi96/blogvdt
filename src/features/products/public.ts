import { asc, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productMedia, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { readOptions } from './options';

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
