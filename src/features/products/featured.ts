import { and, asc, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';

export async function listFeaturedProducts(db: AppDb, limit = 4) {
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
    .where(and(eq(products.status, 'active'), eq(products.isFeatured, true)))
    .orderBy(asc(products.sortOrder), asc(products.id))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    description: row.description,
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt || row.name,
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  }));
}
