import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productCategories, productMedia, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { readWeightScale } from './weight';

export type LandingProduct = {
  id: number;
  slug: string;
  name: string;
  price: number;
  coverUrl: string | null;
  coverAlt: string;
};

// Sản phẩm cho lưới landing: nếu ids rỗng -> toàn bộ sản phẩm đang bán theo thứ tự sắp xếp;
// nếu có ids -> giữ đúng thứ tự người bán đã chọn. Kèm ảnh cover và lựa chọn để đặt hàng ngay.
export async function listLandingProducts(db: AppDb, ids: number[]): Promise<LandingProduct[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      sortOrder: products.sortOrder,
      coverKey: media.r2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(ids.length > 0 ? and(eq(products.status, 'active'), inArray(products.id, ids)) : eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
  const mapped = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
  }));
  if (ids.length === 0) return mapped;
  const byId = new Map(mapped.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export async function getPublicProduct(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      description: products.description,
      weightScale: productCategories.weightScale,
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
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
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
  return { ...product, weightScale: readWeightScale(product.weightScale), images };
}

export async function listOrderCatalog(db: AppDb) {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      weightScale: productCategories.weightScale,
      coverKey: media.r2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map(({ weightScale, coverKey, coverAlt, ...row }) => ({
    ...row,
    weightScale: readWeightScale(weightScale),
    coverUrl: coverKey ? routes.media(coverKey) : null,
    coverAlt: coverAlt ?? '',
  }));
}

export async function listSitemapProducts(db: AppDb) {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
}
