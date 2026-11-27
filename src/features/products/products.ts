import { and, asc, count, desc, eq, inArray, like, ne, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { media, productCategories, productCategoryLinks, productMedia, products, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { listingMediaKey } from '../media/files';
import { mediaMapByIds } from '../media/media';
import { PRODUCT_MARGIN_HIGH, PRODUCT_MARGIN_LOW, type RecipeLine } from '../materials/costing';
import { insertRecipe, recipeWrites, validateRecipe } from '../materials/recipes';
import { normalizeCordType, type CordType } from './cord';
import {
  listProductCategoryIds,
  listProductCategoryIdsByProductIds,
  primaryCategoryId,
  replaceProductCategoryWrites,
  resolveProductCategoryIds,
} from './product-category-links';
import { isProductStatus, type ProductStatus } from './status';

/** Số sản phẩm mỗi trang danh sách admin. */
export const PRODUCT_PAGE_SIZE = 20;
/** Giới hạn chọn hàng loạt (khớp một trang; tránh payload quá lớn). */
export const PRODUCT_BULK_MAX = PRODUCT_PAGE_SIZE;
export const DEFAULT_PRODUCT_LIST_SORT = 'sold-desc' as const;
const PRODUCT_SORTS = [
  'sold-desc',
  'sold-asc',
  'newest',
  'oldest',
  'name',
  'price-asc',
  'price-desc',
  'stock-asc',
  'stock-desc',
] as const;
const PRODUCT_LIST_MARGINS = ['none', 'loss', 'low', 'mid', 'high'] as const;

export type ProductListSort = (typeof PRODUCT_SORTS)[number];
export type ProductListCord = CordType | '';
export type ProductListView = 'list' | 'cards';
export type ProductListMargin = (typeof PRODUCT_LIST_MARGINS)[number] | '';

export function productListSort(value: string | null | undefined): ProductListSort {
  return PRODUCT_SORTS.find((sort) => sort === value) ?? DEFAULT_PRODUCT_LIST_SORT;
}

export function productListCord(value: string | null | undefined): ProductListCord {
  return normalizeCordType(value);
}

export function productListView(value: string | null | undefined): ProductListView {
  return value === 'list' ? 'list' : 'cards';
}

export function productListMargin(value: string | null | undefined): ProductListMargin {
  return PRODUCT_LIST_MARGINS.find((margin) => margin === value) ?? '';
}

export function productAdminQuery(input: {
  query?: string;
  status?: string;
  category?: number | null;
  cord?: string;
  sort?: string;
  view?: string;
  margin?: string;
  page?: number;
  notice?: 'deleted';
  bulk?: { action: ProductBulkAction; count: number } | 'error';
}): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 160);
  const status = isProductStatus(input.status ?? '') ? input.status : '';
  const category = input.category && Number.isInteger(input.category) && input.category > 0 ? input.category : 0;
  const cord = productListCord(input.cord);
  const sort = productListSort(input.sort);
  const view = productListView(input.view);
  const margin = productListMargin(input.margin);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (category) params.set('category', String(category));
  if (cord) params.set('cord', cord);
  if (sort !== DEFAULT_PRODUCT_LIST_SORT) params.set('sort', sort);
  if (view === 'list') params.set('view', 'list');
  if (margin) params.set('margin', margin);
  if (page) params.set('page', String(page));
  if (input.notice === 'deleted') params.set('deleted', '1');
  if (input.bulk === 'error') params.set('error', 'bulk');
  else if (input.bulk) {
    params.set('bulk', input.bulk.action);
    params.set('n', String(input.bulk.count));
  }
  const text = params.toString();
  return text ? `${routes.adminProducts}?${text}` : routes.adminProducts;
}

export function readProductListContext(form: FormData) {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const page = Number(read('page'));
  const category = Number(read('category'));
  return {
    query: read('q'),
    status: read('status'),
    category: Number.isInteger(category) && category > 0 ? category : null,
    cord: productListCord(read('cord')),
    sort: read('sort'),
    view: productListView(read('view')),
    margin: productListMargin(read('margin')),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export type ProductInput = {
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  categoryIds: number[];
  cordType: string;
  audience: string;
  description: string;
  coverMediaId: number | null;
  albumIds: number[];
  recipe: RecipeLine[];
  status: ProductStatus;
  sortOrder: number;
  stockQty: number;
  rating: number;
  seoTitle: string | null;
  metaDescription: string | null;
  robots: 'index' | 'noindex';
};

// Giá vốn công thức — cùng nguồn với loadProductCosts.
const productCostSql = sql`(
  select sum(pm.quantity * m.unit_cost)
  from product_materials pm
  join materials m on m.id = pm.material_id
  where pm.product_id = ${products.id}
)`;

const productMarginSql = sql`(
  case
    when ${products.price} <= 0 then null
    when ${productCostSql} is null then null
    else round((${products.price} - ${productCostSql}) * 100.0 / ${products.price})
  end
)`;

export async function listProducts(
  db: AppDb,
  filters: {
    query: string;
    status: ProductStatus | '';
    categoryId?: number | null;
    cord?: ProductListCord;
    margin?: ProductListMargin;
    page: number;
    sort?: ProductListSort;
  },
) {
  const term = filters.query.replace(/[%_]/g, '').trim().slice(0, 160);
  const cord = productListCord(filters.cord);
  const margin = productListMargin(filters.margin);
  const shared = [];
  if (filters.status) shared.push(eq(products.status, filters.status));
  if (term) shared.push(like(products.name, `%${term}%`));
  if (cord) shared.push(eq(products.cordType, cord));
  if (margin === 'none') shared.push(sql`${productCostSql} is null`);
  else if (margin === 'loss') shared.push(sql`${productMarginSql} < 0`);
  else if (margin === 'low') {
    shared.push(sql`${productMarginSql} >= 0 and ${productMarginSql} < ${PRODUCT_MARGIN_LOW}`);
  } else if (margin === 'mid') {
    shared.push(
      sql`${productMarginSql} >= ${PRODUCT_MARGIN_LOW} and ${productMarginSql} <= ${PRODUCT_MARGIN_HIGH}`,
    );
  }   else if (margin === 'high') shared.push(sql`${productMarginSql} > ${PRODUCT_MARGIN_HIGH}`);
  const inCategory = filters.categoryId
    ? inArray(
        products.id,
        db
          .select({ productId: productCategoryLinks.productId })
          .from(productCategoryLinks)
          .where(eq(productCategoryLinks.categoryId, filters.categoryId)),
      )
    : undefined;
  const conditions = inCategory ? [...shared, inCategory] : shared;
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const sort = productListSort(filters.sort);
  const filtered = Boolean(term || filters.status || filters.categoryId || cord || margin);
  const [totalRows, libraryRows, sharedRows, categoryRows, rows] = await Promise.all([
    db.select({ value: count() }).from(products).where(where),
    filtered ? db.select({ value: count() }).from(products) : Promise.resolve([]),
    filters.categoryId ? db.select({ value: count() }).from(products).where(and(...shared)) : Promise.resolve([]),
    // Đếm qua bảng liên kết; giữ danh mục trống với số 0.
    db
      .select({ id: productCategories.id, name: productCategories.name, count: count(products.id) })
      .from(productCategories)
      .leftJoin(productCategoryLinks, eq(productCategoryLinks.categoryId, productCategories.id))
      .leftJoin(products, and(eq(products.id, productCategoryLinks.productId), ...shared))
      .groupBy(productCategories.id)
      .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(productCategories.id)),
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        price: products.price,
        comparePrice: products.comparePrice,
        stockQty: products.stockQty,
        rating: products.rating,
        sold: soldQty,
        categoryId: products.categoryId,
        categoryName: productCategories.name,
        cordType: products.cordType,
        status: products.status,
        updatedAt: products.updatedAt,
        coverKey: media.r2Key,
        cardKey: media.cardR2Key,
        coverAlt: media.altText,
        coverWidth: media.width,
        coverHeight: media.height,
      })
      .from(products)
      .leftJoin(media, eq(products.coverMediaId, media.id))
      .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
      .where(where)
      .orderBy(...productOrder(sort))
      .limit(PRODUCT_PAGE_SIZE)
      .offset((page - 1) * PRODUCT_PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const categoryIdsByProduct = await listProductCategoryIdsByProductIds(
    db,
    rows.map((row) => row.id),
  );
  // Thứ tự tên theo sortOrder danh mục (categoryRows đã sort).
  const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));
  const categoryRank = new Map(categoryRows.map((category, index) => [category.id, index]));
  return {
    rows: rows.map((row) => {
      const listKey = listingMediaKey(row.coverKey, row.cardKey);
      const categoryIds = categoryIdsByProduct.get(row.id) ?? (row.categoryId ? [row.categoryId] : []);
      const categoryNames = [...categoryIds]
        .sort((left, right) => (categoryRank.get(left) ?? 0) - (categoryRank.get(right) ?? 0))
        .map((id) => categoryNameById.get(id))
        .filter((name): name is string => Boolean(name));
      const categoryName = categoryNames.join(' · ') || row.categoryName || '';
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        price: row.price,
        comparePrice: row.comparePrice,
        stockQty: row.stockQty,
        rating: row.rating,
        sold: Math.max(0, Number(row.sold) || 0),
        categoryId: row.categoryId,
        categoryIds,
        categoryNames,
        categoryName,
        cordType: row.cordType,
        status: row.status,
        updatedAt: row.updatedAt,
        coverUrl: listKey ? routes.media(listKey) : null,
        // URL gốc (không card/thumb) — dùng lightbox xem kích thước thật.
        coverOriginalUrl: row.coverKey ? routes.media(row.coverKey) : null,
        coverWidth: row.coverWidth,
        coverHeight: row.coverHeight,
        coverAlt: row.coverAlt ?? '',
      };
    }),
    total,
    page,
    pageSize: PRODUCT_PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PRODUCT_PAGE_SIZE)),
    sort,
    libraryTotal: filtered ? (libraryRows[0]?.value ?? 0) : total,
    categories: categoryRows,
    allCount: filters.categoryId ? (sharedRows[0]?.value ?? 0) : total,
  };
}

// Số lượng đã bán = sold_base + đơn một mẫu (không có order_items) + dòng order_items; bỏ hủy + gửi bù.
const soldQty = sql<number>`(
  coalesce(${products.soldBase}, 0)
  + coalesce((
    select sum(o.quantity) from orders o
    where o.product_id = ${products.id} and o.status <> 'cancelled' and o.compensation = 0
      and not exists (select 1 from order_items i where i.order_id = o.id)
  ), 0)
  + coalesce((
    select sum(i.quantity) from order_items i
    join orders o2 on o2.id = i.order_id
    where i.product_id = ${products.id} and o2.status <> 'cancelled' and o2.compensation = 0
  ), 0)
)`;

function productOrder(sort: ProductListSort) {
  if (sort === 'sold-desc') return [desc(soldQty), desc(products.updatedAt), desc(products.id)] as const;
  if (sort === 'sold-asc') return [asc(soldQty), desc(products.updatedAt), desc(products.id)] as const;
  if (sort === 'oldest') return [asc(products.updatedAt), asc(products.id)] as const;
  if (sort === 'name') return [asc(products.name), desc(products.id)] as const;
  if (sort === 'price-asc') return [asc(products.price), desc(products.id)] as const;
  if (sort === 'price-desc') return [desc(products.price), desc(products.id)] as const;
  if (sort === 'stock-asc') return [asc(products.stockQty), desc(products.id)] as const;
  if (sort === 'stock-desc') return [desc(products.stockQty), desc(products.id)] as const;
  return [desc(products.updatedAt), desc(products.id)] as const;
}

export type ProductPhoto = { id: string; url: string };

// Chỉ lấy ảnh đang gắn với sản phẩm, không tải cả thư viện.
export async function productPhotoViews(
  db: AppDb,
  coverId: number | null,
  albumIds: readonly number[],
): Promise<{ cover: ProductPhoto | null; album: ProductPhoto[] }> {
  const map = await mediaMapByIds(db, [coverId ?? 0, ...albumIds]);
  const coverRef = coverId ? map.get(coverId) : undefined;
  return {
    cover: coverRef && coverId ? { id: String(coverId), url: coverRef.url } : null,
    album: albumIds.flatMap((id) => {
      if (id === coverId) return [];
      const item = map.get(id);
      return item ? [{ id: String(id), url: item.url }] : [];
    }),
  };
}

export async function getProduct(db: AppDb, id: number) {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const product = rows[0];
  if (!product) return null;
  const [album, categoryIds] = await Promise.all([
    db
      .select({ mediaId: productMedia.mediaId })
      .from(productMedia)
      .where(eq(productMedia.productId, id))
      .orderBy(asc(productMedia.sortOrder), asc(productMedia.mediaId)),
    listProductCategoryIds(db, id),
  ]);
  return {
    ...product,
    albumIds: album.map((item) => item.mediaId),
    categoryIds: categoryIds.length > 0 ? categoryIds : product.categoryId ? [product.categoryId] : [],
  };
}

export async function createProduct(
  db: AppDb,
  input: ProductInput,
  now = Date.now(),
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const links = await resolveProductCategoryIds(db, input.categoryIds);
  if (!links.ok) return { ok: false, error: links.error };
  const payload = { ...input, categoryIds: links.ids };
  const slugError = await slugAvailable(db, payload.slug, null);
  if (slugError) return { ok: false, error: slugError };
  const mediaError = await mediaAvailable(db, payload);
  if (mediaError) return { ok: false, error: mediaError };
  const recipeError = await validateRecipe(db, payload.recipe, null);
  if (recipeError) return { ok: false, error: recipeError };
  const inserted = await db
    .insert(products)
    .values({ ...productValues(payload, now), createdAt: now })
    .returning({ id: products.id });
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được sản phẩm.' };
  if (payload.categoryIds.length > 0) {
    try {
      await runBatch(db, replaceProductCategoryWrites(db, id, payload.categoryIds));
    } catch (error) {
      await db.delete(products).where(eq(products.id, id));
      console.error(JSON.stringify({ event: 'product_categories_failed', name: error instanceof Error ? error.name : 'unknown' }));
      return { ok: false, error: 'Không lưu được danh mục.' };
    }
  }
  if (payload.albumIds.length > 0) {
    try {
      await albumInsert(db, id, payload.albumIds);
    } catch (error) {
      await db.delete(products).where(eq(products.id, id));
      console.error(JSON.stringify({ event: 'product_album_failed', name: error instanceof Error ? error.name : 'unknown' }));
      return { ok: false, error: 'Không lưu được album.' };
    }
  }
  if (payload.recipe.length > 0) {
    try {
      await insertRecipe(db, id, payload.recipe);
    } catch (error) {
      await db.delete(products).where(eq(products.id, id));
      console.error(JSON.stringify({ event: 'product_recipe_failed', name: error instanceof Error ? error.name : 'unknown' }));
      return { ok: false, error: 'Không lưu được công thức nguyên liệu.' };
    }
  }
  return { ok: true, id };
}

export async function updateProduct(
  db: AppDb,
  id: number,
  input: ProductInput,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getProduct(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy sản phẩm.' };
  const links = await resolveProductCategoryIds(db, input.categoryIds);
  if (!links.ok) return { ok: false, error: links.error };
  const payload = { ...input, categoryIds: links.ids };
  const slugError = await slugAvailable(db, payload.slug, id);
  if (slugError) return { ok: false, error: slugError };
  const mediaError = await mediaAvailable(db, payload);
  if (mediaError) return { ok: false, error: mediaError };
  const recipeError = await validateRecipe(db, payload.recipe, id);
  if (recipeError) return { ok: false, error: recipeError };
  const queries: BatchItem<'sqlite'>[] = [
    db.update(products).set(productValues(payload, now)).where(eq(products.id, id)),
    ...replaceProductCategoryWrites(db, id, payload.categoryIds),
    db.delete(productMedia).where(eq(productMedia.productId, id)),
  ];
  if (payload.albumIds.length > 0) queries.push(albumInsert(db, id, payload.albumIds));
  queries.push(...recipeWrites(db, id, payload.recipe));
  if (current.slug !== payload.slug) {
    queries.push(...slugRedirectQueries(db, routes.product(current.slug), routes.product(payload.slug), now));
  }
  await runBatch(db, queries);
  return { ok: true };
}

export const PRODUCT_BULK_ACTIONS = ['active', 'inactive', 'delete'] as const;
export type ProductBulkAction = (typeof PRODUCT_BULK_ACTIONS)[number];

export function readProductBulk(form: FormData): { action: ProductBulkAction; ids: number[] } | null {
  const action = PRODUCT_BULK_ACTIONS.find((item) => item === form.get('bulk'));
  const ids = [...new Set(form.getAll('ids').map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (!action || ids.length === 0 || ids.length > PRODUCT_BULK_MAX) return null;
  return { action, ids };
}

export async function setProductsStatus(db: AppDb, ids: number[], status: ProductStatus, now = Date.now()): Promise<number> {
  const values = { status, updatedAt: now };
  const results = await runBatch(
    db,
    idChunks(ids).map((chunk) =>
      db
        .update(products)
        .set(values)
        .where(and(inArray(products.id, chunk), ne(products.status, status)))
        .returning({ id: products.id }),
    ),
  );
  return results.reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0);
}

export async function deleteProducts(db: AppDb, ids: number[]): Promise<number> {
  const chunks = idChunks(ids);
  const found = await runBatch(
    db,
    chunks.map((chunk) => db.select({ slug: products.slug }).from(products).where(inArray(products.id, chunk))),
  );
  const paths = found.flatMap((rows) => (Array.isArray(rows) ? rows.map((row: { slug: string }) => routes.product(row.slug)) : []));
  if (paths.length === 0) return 0;
  await runBatch(db, [
    ...idChunks(paths).flatMap((chunk) => [
      db.delete(redirects).where(inArray(redirects.fromPath, chunk)),
      db.delete(redirects).where(inArray(redirects.toPath, chunk)),
    ]),
    ...chunks.map((chunk) => db.delete(products).where(inArray(products.id, chunk))),
  ]);
  return paths.length;
}

// D1 giới hạn 100 tham số mỗi câu lệnh; chia nhỏ rồi gửi chung một batch để vẫn một lượt và nguyên tử.
function idChunks<T>(values: T[], size = 50): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function productValues(input: ProductInput, now: number) {
  return {
    name: input.name,
    slug: input.slug,
    price: input.price,
    comparePrice: input.comparePrice,
    categoryId: primaryCategoryId(input.categoryIds),
    cordType: input.cordType,
    audience: input.audience,
    description: input.description,
    coverMediaId: input.coverMediaId,
    status: input.status,
    sortOrder: input.sortOrder,
    stockQty: input.stockQty,
    rating: input.rating,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    robots: input.robots,
    updatedAt: now,
  };
}

function albumInsert(db: AppDb, productId: number, albumIds: number[]) {
  return db.insert(productMedia).values(albumIds.map((mediaId, index) => ({ productId, mediaId, sortOrder: index })));
}

async function slugAvailable(db: AppDb, slug: string, currentId: number | null): Promise<string | null> {
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
  if (rows[0] && rows[0].id !== currentId) return 'Slug đã được dùng.';
  return null;
}

async function mediaAvailable(db: AppDb, input: ProductInput): Promise<string | null> {
  const ids = [...input.albumIds];
  if (input.coverMediaId) ids.push(input.coverMediaId);
  if (ids.length === 0) return null;
  const rows = await db.select({ id: media.id }).from(media).where(inArray(media.id, ids));
  return rows.length === new Set(ids).size ? null : 'Ảnh đã chọn không còn trong thư viện.';
}
