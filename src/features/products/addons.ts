import { and, asc, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productCategories, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { listingMediaKey } from '../media/files';
import { ADDON_CATEGORY_SLUG, shipGroupOf } from '../shipping/customer-fee';
import { sellableProductWhere } from './status';

export type { AddonShipHint } from './addon-hint';
export { addonShipHint, addonShipHintText } from './addon-hint';

export type PublicAddon = {
  id: number;
  slug: string;
  name: string;
  price: number;
  isFeatured: boolean;
  coverUrl: string | null;
  coverAlt: string;
};

/** SP bán kèm đang bán (danh mục san-pham-ban-kem). */
export async function listPublicAddons(db: AppDb): Promise<PublicAddon[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      isFeatured: products.isFeatured,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(and(eq(productCategories.slug, ADDON_CATEGORY_SLUG), sellableProductWhere()))
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map((row) => {
    const listKey = listingMediaKey(row.coverKey, row.cardKey);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      price: row.price,
      isFeatured: row.isFeatured,
      coverUrl: listKey ? routes.media(listKey) : null,
      coverAlt: row.coverAlt ?? '',
    };
  });
}

/** Chuỗi form → slug addon hợp lệ trong danh sách; rỗng/không khớp → null. */
export function resolveAddonSlug(
  raw: string | null | undefined,
  addons: ReadonlyArray<{ slug: string }>,
): string | null {
  const slug = (raw ?? '').trim();
  if (!slug) return null;
  return addons.some((item) => item.slug === slug) ? slug : null;
}

/** Nhiều slug form → danh sách slug hợp lệ, bỏ trùng. */
export function resolveAddonSlugs(
  raws: ReadonlyArray<string | null | undefined>,
  addons: ReadonlyArray<{ slug: string }>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const slug = resolveAddonSlug(raw, addons);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

/** Addon từ catalog đơn hàng (slug + category); null nếu không phải bán kèm đang bán. */
export function findAddonInCatalog<T extends { slug: string; categorySlug?: string }>(
  raw: string | null | undefined,
  catalog: ReadonlyArray<T>,
): T | null {
  const slug = (raw ?? '').trim();
  if (!slug) return null;
  const product = catalog.find((item) => item.slug === slug);
  if (!product || shipGroupOf(product.categorySlug) !== 'addon') return null;
  return product;
}

/** Nhiều slug → các SP bán kèm hợp lệ trong catalog (bỏ trùng). */
export function findAddonsInCatalog<T extends { slug: string; categorySlug?: string }>(
  raws: ReadonlyArray<string | null | undefined>,
  catalog: ReadonlyArray<T>,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const product = findAddonInCatalog(raw, catalog);
    if (!product || seen.has(product.slug)) continue;
    seen.add(product.slug);
    out.push(product);
  }
  return out;
}

/** Đọc mọi giá trị addonSlug từ FormData (checkbox / multi hidden). */
export function readAddonSlugFields(form: FormData, name = 'addonSlug'): string[] {
  return form
    .getAll(name)
    .flatMap((value) => (typeof value === 'string' ? [value.trim()] : []))
    .filter((value) => value.length > 0);
}

/** Nhãn “Nhiều mẹ chọn”: featured trước, không thì giá cao nhất. */
export function recommendedAddonSlug(addons: ReadonlyArray<PublicAddon>): string | null {
  if (addons.length === 0) return null;
  const featured = addons.find((item) => item.isFeatured);
  if (featured) return featured.slug;
  let best = addons[0]!;
  for (const item of addons) {
    if (item.price > best.price || (item.price === best.price && item.id < best.id)) best = item;
  }
  return best.slug;
}

/** Giỏ có vòng → hiện khối bán kèm (vẫn hiện khi đã thêm một số bó). */
export function cartShowsAddonUpsell(
  lines: ReadonlyArray<{ shipGroup: string }>,
): boolean {
  return lines.some((line) => line.shipGroup === 'bracelet');
}
