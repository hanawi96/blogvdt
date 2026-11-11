import { and, asc, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { listingMediaKey, MEDIA_CARD_SIZE } from '../media/files';

export async function listFeaturedProducts(db: AppDb, limit = 4) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      description: products.description,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(and(eq(products.status, 'active'), eq(products.isFeatured, true)))
    .orderBy(asc(products.sortOrder), asc(products.id))
    .limit(limit);
  return rows.map((row) => {
    const listKey = listingMediaKey(row.coverKey, row.cardKey);
    const usingCard = Boolean(row.cardKey);
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      description: row.description,
      coverUrl: listKey ? routes.media(listKey) : null,
      coverAlt: row.coverAlt ?? '',
      coverWidth: usingCard ? MEDIA_CARD_SIZE : row.coverWidth,
      coverHeight: usingCard ? MEDIA_CARD_SIZE : row.coverHeight,
    };
  });
}
