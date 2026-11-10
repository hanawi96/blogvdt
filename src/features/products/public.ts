import { and, asc, eq, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, orderItems, orders, productCategories, productMedia, products } from '../../lib/db/schema';
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
      categorySlug: productCategories.slug,
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
  return {
    ...product,
    categorySlug: product.categorySlug ?? '',
    weightScale: readWeightScale(product.weightScale),
    images,
  };
}

export async function listOrderCatalog(db: AppDb) {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      price: products.price,
      weightScale: productCategories.weightScale,
      categorySlug: productCategories.slug,
      coverKey: media.r2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map(({ weightScale, coverKey, coverAlt, categorySlug, ...row }) => ({
    ...row,
    weightScale: readWeightScale(weightScale),
    categorySlug: categorySlug ?? '',
    coverUrl: coverKey ? routes.media(coverKey) : null,
    coverAlt: coverAlt ?? '',
  }));
}

// Sản phẩm cho form đơn của nhân viên: mẫu đang bán, cộng thêm mẫu đã có trên đơn dù đã ngừng bán.
export async function listStaffProductChoices(db: AppDb, extraIds: number[]) {
  const extras = [...new Set(extraIds.filter((id) => Number.isInteger(id) && id > 0))];
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      status: products.status,
      weightScale: productCategories.weightScale,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(extras.length > 0 ? or(eq(products.status, 'active'), inArray(products.id, extras)) : eq(products.status, 'active'))
    .orderBy(asc(products.status), asc(products.sortOrder), asc(products.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    weightScale: readWeightScale(row.weightScale),
    active: row.status === 'active',
  }));
}

/** Cover URL theo product id — dùng trang chi tiết đơn. */
export async function productCoversByIds(
  db: AppDb,
  ids: number[],
): Promise<Map<number, { url: string; alt: string }>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const out = new Map<number, { url: string; alt: string }>();
  if (unique.length === 0) return out;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      coverKey: media.r2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(inArray(products.id, unique));
  for (const row of rows) {
    if (!row.coverKey) continue;
    out.set(row.id, { url: routes.media(row.coverKey), alt: row.coverAlt || row.name });
  }
  return out;
}

export type StaffPickerProduct = {
  id: number;
  name: string;
  price: number;
  weightScale: ReturnType<typeof readWeightScale>;
  active: true;
  categoryId: number | null;
  categoryName: string;
  categorySlug: string;
  sold: number;
  coverUrl: string | null;
  coverAlt: string;
};

export type StaffPickerCategory = { id: number; name: string };

// Danh sách mẫu cho trang tạo đơn: đang bán, kèm danh mục và số chiếc đã bán (trừ đơn hủy).
export async function listStaffPickerProducts(db: AppDb): Promise<{ products: StaffPickerProduct[]; categories: StaffPickerCategory[] }> {
  const [rows, itemSold, singleSold] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        weightScale: productCategories.weightScale,
        categoryId: productCategories.id,
        categoryName: productCategories.name,
        categorySlug: productCategories.slug,
        categorySort: productCategories.sortOrder,
        coverKey: media.r2Key,
        coverAlt: media.altText,
      })
      .from(products)
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(media, eq(products.coverMediaId, media.id))
      .where(eq(products.status, 'active')),
    db
      .select({
        productId: orderItems.productId,
        sold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(isNotNull(orderItems.productId), ne(orders.status, 'cancelled')))
      .groupBy(orderItems.productId),
    db
      .select({
        productId: orders.productId,
        sold: sql<number>`coalesce(sum(${orders.quantity}), 0)`,
      })
      .from(orders)
      .where(
        and(
          isNotNull(orders.productId),
          ne(orders.status, 'cancelled'),
          notExists(db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, orders.id))),
        ),
      )
      .groupBy(orders.productId),
  ]);
  const soldByProduct = new Map<number, number>();
  for (const row of [...itemSold, ...singleSold]) {
    if (row.productId == null) continue;
    soldByProduct.set(row.productId, (soldByProduct.get(row.productId) ?? 0) + Number(row.sold));
  }
  const listed: StaffPickerProduct[] = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      weightScale: readWeightScale(row.weightScale),
      active: true as const,
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? '',
      categorySlug: row.categorySlug ?? '',
      sold: soldByProduct.get(row.id) ?? 0,
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt ?? '',
    }))
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'vi'));
  const seen = new Map<number, { name: string; sort: number }>();
  for (const row of rows) {
    if (row.categoryId == null || seen.has(row.categoryId)) continue;
    seen.set(row.categoryId, { name: row.categoryName ?? '', sort: row.categorySort ?? 0 });
  }
  const categories = [...seen.entries()]
    .sort((a, b) => a[1].sort - b[1].sort || a[1].name.localeCompare(b[1].name, 'vi'))
    .map(([id, category]) => ({ id, name: category.name }));
  return { products: listed, categories };
}

export async function listSitemapProducts(db: AppDb) {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .where(eq(products.status, 'active'))
    .orderBy(asc(products.sortOrder), asc(products.id));
}
