import { and, asc, eq, inArray, isNotNull, ne, notExists, or, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, orderItems, orders, productCategories, productMedia, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { loadProductCosts } from '../materials/recipes';
import { listingMediaKey } from '../media/files';
import { listProductCategoryIdsByProductIds } from './product-category-links';
import { qtyBounds } from './qty';
import { activeProductWhere, isPubliclySellable, sellableProductWhere } from './status';
import { readWeightScale } from './weight';

export async function getPublicProduct(db: AppDb, slug: string) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      description: products.description,
      weightScale: productCategories.weightScale,
      qtyMin: productCategories.qtyMin,
      qtyMax: productCategories.qtyMax,
      status: products.status,
      stockQty: products.stockQty,
      seoTitle: products.seoTitle,
      metaDescription: products.metaDescription,
      robots: products.robots,
      updatedAt: products.updatedAt,
      categorySlug: productCategories.slug,
      categoryStatus: productCategories.status,
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
  const bounds = qtyBounds({ qtyMin: product.qtyMin, qtyMax: product.qtyMax });
  return {
    ...product,
    categorySlug: product.categorySlug ?? '',
    categoryStatus: product.categoryStatus ?? null,
    weightScale: readWeightScale(product.weightScale),
    qtyMin: bounds.min,
    qtyMax: bounds.max,
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
      comparePrice: products.comparePrice,
      weightScale: productCategories.weightScale,
      qtyMin: productCategories.qtyMin,
      qtyMax: productCategories.qtyMax,
      categorySlug: productCategories.slug,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(sellableProductWhere())
    .orderBy(asc(products.sortOrder), asc(products.id));
  return rows.map(({ weightScale, qtyMin, qtyMax, coverKey, cardKey, coverAlt, categorySlug, comparePrice, ...row }) => {
    const listKey = listingMediaKey(coverKey, cardKey);
    const bounds = qtyBounds({ qtyMin, qtyMax });
    return {
      ...row,
      comparePrice: comparePrice != null && comparePrice > row.price ? comparePrice : null,
      weightScale: readWeightScale(weightScale),
      qtyMin: bounds.min,
      qtyMax: bounds.max,
      categorySlug: categorySlug ?? '',
      coverUrl: listKey ? routes.media(listKey) : null,
      coverAlt: coverAlt ?? '',
    };
  });
}

// Sản phẩm cho form đơn của nhân viên: mẫu đang bật (kể cả hết hàng), cộng thêm mẫu đã có trên đơn dù đã ngừng bán.
export async function listStaffProductChoices(db: AppDb, extraIds: number[]) {
  const extras = [...new Set(extraIds.filter((id) => Number.isInteger(id) && id > 0))];
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      status: products.status,
      stockQty: products.stockQty,
      categoryStatus: productCategories.status,
      weightScale: productCategories.weightScale,
    })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(extras.length > 0 ? or(activeProductWhere(), inArray(products.id, extras)) : activeProductWhere())
    .orderBy(asc(products.status), asc(products.sortOrder), asc(products.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    weightScale: readWeightScale(row.weightScale),
    active: isPubliclySellable({ status: row.status, categoryStatus: row.categoryStatus, stockQty: row.stockQty }),
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
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(inArray(products.id, unique));
  for (const row of rows) {
    const listKey = listingMediaKey(row.coverKey, row.cardKey);
    if (!listKey) continue;
    out.set(row.id, { url: routes.media(listKey), alt: row.coverAlt || row.name });
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
  categoryIds: number[];
  categoryName: string;
  categorySlug: string;
  sold: number;
  coverUrl: string | null;
  coverAlt: string;
  /** Giá vốn công thức; null nếu chưa có — dùng prefill modal SP tùy chỉnh. */
  unitCost: number | null;
};

export type StaffPickerCategory = { id: number; name: string };

/**
 * Danh sách mẫu tạo đơn.
 * `inStockOnly`: UI picker — chỉ SP còn tồn; bỏ cờ khi định giá/sửa đơn (vẫn cần SP tồn 0).
 */
export async function listStaffPickerProducts(
  db: AppDb,
  options?: { inStockOnly?: boolean },
): Promise<{ products: StaffPickerProduct[]; categories: StaffPickerCategory[] }> {
  const inStockOnly = options?.inStockOnly === true;
  const [rows, itemSold, singleSold] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        price: products.price,
        soldBase: products.soldBase,
        weightScale: productCategories.weightScale,
        categoryId: productCategories.id,
        categoryName: productCategories.name,
        categorySlug: productCategories.slug,
        categorySort: productCategories.sortOrder,
        coverKey: media.r2Key,
        cardKey: media.cardR2Key,
        coverAlt: media.altText,
      })
      .from(products)
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .leftJoin(media, eq(products.coverMediaId, media.id))
      .where(inStockOnly ? sellableProductWhere() : activeProductWhere()),
    db
      .select({
        productId: orderItems.productId,
        sold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(isNotNull(orderItems.productId), ne(orders.status, 'cancelled'), eq(orders.compensation, 0)))
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
          eq(orders.compensation, 0),
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
  const productIds = rows.map((row) => row.id);
  const [costs, categoryIdsByProduct, activeCategories] = await Promise.all([
    loadProductCosts(db, productIds),
    listProductCategoryIdsByProductIds(db, productIds),
    db
      .select({
        id: productCategories.id,
        name: productCategories.name,
        sortOrder: productCategories.sortOrder,
      })
      .from(productCategories)
      .where(eq(productCategories.status, 'active'))
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(productCategories.id)),
  ]);
  const activeCategoryIds = new Set(activeCategories.map((category) => category.id));
  const linkedCategoryIds = new Set<number>();
  const listed: StaffPickerProduct[] = rows
    .map((row) => {
      const listKey = listingMediaKey(row.coverKey, row.cardKey);
      const unitCost = costs.get(row.id);
      const rawIds = categoryIdsByProduct.get(row.id) ?? (row.categoryId ? [row.categoryId] : []);
      const categoryIds = rawIds.filter((categoryId) => activeCategoryIds.has(categoryId));
      for (const categoryId of categoryIds) linkedCategoryIds.add(categoryId);
      return {
        id: row.id,
        name: row.name,
        price: row.price,
        weightScale: readWeightScale(row.weightScale),
        active: true as const,
        categoryId: row.categoryId && activeCategoryIds.has(row.categoryId) ? row.categoryId : null,
        categoryIds,
        categoryName: row.categoryName ?? '',
        categorySlug: row.categorySlug ?? '',
        sold: (soldByProduct.get(row.id) ?? 0) + Math.max(0, row.soldBase || 0),
        coverUrl: listKey ? routes.media(listKey) : null,
        coverAlt: row.coverAlt ?? '',
        unitCost: unitCost === undefined ? null : unitCost,
      };
    })
    .sort((a, b) => b.sold - a.sold || a.name.localeCompare(b.name, 'vi'));
  // Chỉ DM đang bật và còn ít nhất một SP còn tồn trong picker.
  const categories = activeCategories
    .filter((category) => linkedCategoryIds.has(category.id))
    .map((category) => ({ id: category.id, name: category.name }));
  return { products: listed, categories };
}

/** Chỉ SP bán được và robots=index — khớp PDP cho Google index. */
export async function listSitemapProducts(db: AppDb) {
  return db
    .select({ slug: products.slug, updatedAt: products.updatedAt })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(sellableProductWhere(), eq(products.robots, 'index')))
    .orderBy(asc(products.sortOrder), asc(products.id));
}
