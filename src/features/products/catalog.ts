import { and, asc, count, desc, eq, like, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productCategories, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { listingMediaKey, MEDIA_CARD_SIZE } from '../media/files';
import { ratingFormValue } from './form';
import { productShipBadge, type ProductShipBadge } from '../shipping/customer-fee';
import { sellableProductWhere } from './status';
import { readWeightScale, type WeightScale } from './weight';

export const CATALOG_PAGE_SIZE = 12;

export const CATALOG_SORTS = [
  { value: 'mac-dinh', label: 'Giá thấp đến cao' },
  { value: 'ban-chay', label: 'Bán chạy' },
  { value: 'giam-gia', label: 'Giảm giá nhiều' },
] as const;

const CATALOG_PARAMS = ['q', 'danh-muc', 'sap-xep', 'page'] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number]['value'];

export type CatalogQuery = {
  q: string;
  category: string;
  sort: CatalogSort;
  page: number;
};

export function readCatalogQuery(params: URLSearchParams): CatalogQuery {
  return {
    q: readTerm(params.get('q')),
    category: readSlug(params.get('danh-muc')),
    sort: readSort(params.get('sap-xep')),
    page: readPage(params.get('page')),
  };
}

export function catalogFiltered(query: CatalogQuery): boolean {
  return query.q.length > 0 || query.category.length > 0 || query.sort !== 'mac-dinh';
}

export function catalogPath(query: CatalogQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('danh-muc', query.category);
  if (query.sort !== 'mac-dinh') params.set('sap-xep', query.sort);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.catalog}?${text}` : routes.catalog;
}

/** JSON API path — dùng cho Xem tiếp / đổi filter trên trang chủ, không reload HTML. */
export function catalogApiPath(query: CatalogQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('danh-muc', query.category);
  if (query.sort !== 'mac-dinh') params.set('sap-xep', query.sort);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.catalogApi}?${text}` : routes.catalogApi;
}

/** Deep-link filter trang chủ (SSR trang 1); không gắn page — “Xem tiếp” dùng API. */
export function homeShopPath(query: Pick<CatalogQuery, 'category' | 'sort'>, hash = 'san-pham'): string {
  const params = new URLSearchParams();
  if (query.category) params.set('danh-muc', query.category);
  if (query.sort !== 'mac-dinh') params.set('sap-xep', query.sort);
  const text = params.toString();
  return text ? `${routes.home}?${text}#${hash}` : `${routes.home}#${hash}`;
}

export function discountPercent(price: number, comparePrice: number | null): number | null {
  if (comparePrice == null || comparePrice <= price) return null;
  return Math.max(1, Math.round((1 - price / comparePrice) * 100));
}

export function catalogNeedsRedirect(url: URL, query: CatalogQuery): boolean {
  const expected = new URL(catalogPath(query), url.origin);
  if (url.pathname !== expected.pathname) return true;
  for (const key of CATALOG_PARAMS) {
    if ((url.searchParams.get(key) ?? '') !== (expected.searchParams.get(key) ?? '')) return true;
  }
  for (const key of url.searchParams.keys()) {
    if (!CATALOG_PARAMS.includes(key as (typeof CATALOG_PARAMS)[number])) return true;
  }
  return false;
}

export type CatalogCard = {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  weightScale: WeightScale;
  shipBadge: ProductShipBadge;
  /** Điểm hiển thị (vd 5.0); null nếu chưa có rating. */
  ratingLabel: string | null;
  sold: number;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export function visibleComparePrice(price: number, comparePrice: number | null): number | null {
  if (comparePrice == null || comparePrice <= price) return null;
  return comparePrice;
}

export async function listCatalogProducts(db: AppDb, query: CatalogQuery) {
  const filters: SQL[] = [sellableProductWhere()];
  if (query.q) filters.push(like(products.name, `%${query.q}%`));
  if (query.category) filters.push(eq(productCategories.slug, query.category));
  const where = and(...filters);
  const current = Math.max(1, query.page);
  const totalRows = await db
    .select({ value: count() })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      comparePrice: products.comparePrice,
      rating: products.rating,
      sold: soldCount,
      weightScale: productCategories.weightScale,
      categorySlug: productCategories.slug,
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
    .orderBy(...catalogOrder(query.sort))
    .limit(CATALOG_PAGE_SIZE)
    .offset((current - 1) * CATALOG_PAGE_SIZE);
  return {
    products: rows.map(toCard),
    total,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE)),
  };
}

/** Top N mẫu bán chạy nhất (còn bán) — dùng cho sidebar blog. */
export async function listBestSellers(db: AppDb, limit = 5): Promise<CatalogCard[]> {
  const take = Math.min(Math.max(1, Math.floor(limit)), 12);
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      comparePrice: products.comparePrice,
      rating: products.rating,
      sold: soldCount,
      weightScale: productCategories.weightScale,
      categorySlug: productCategories.slug,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(sellableProductWhere())
    .orderBy(...catalogOrder('ban-chay'))
    .limit(take);
  return rows.map(toCard);
}

// Lượt bán = tổng số lượng ở đơn một mẫu (orders) và đơn nhiều mẫu (order_items), bỏ đơn đã hủy.
const soldCount = sql<number>`(
  coalesce((select sum(o.quantity) from orders o where o.product_id = ${products.id} and o.status <> 'cancelled'), 0)
  + coalesce((select sum(i.quantity) from order_items i join orders o2 on o2.id = i.order_id where i.product_id = ${products.id} and o2.status <> 'cancelled'), 0)
)`;

// % giảm = (giá gốc − giá bán) / giá gốc; mẫu không giảm xếp cuối.
const discountRatio = sql<number>`(
  case
    when ${products.comparePrice} is not null and ${products.comparePrice} > ${products.price}
    then (${products.comparePrice} - ${products.price}) * 1.0 / ${products.comparePrice}
    else 0
  end
)`;

function catalogOrder(sort: CatalogSort) {
  if (sort === 'ban-chay') return [desc(soldCount), asc(products.sortOrder), asc(products.id)] as const;
  if (sort === 'giam-gia') return [desc(discountRatio), asc(products.sortOrder), asc(products.id)] as const;
  // Mặc định: giá thấp → cao
  return [asc(products.price), asc(products.sortOrder), asc(products.id)] as const;
}

function readTerm(value: string | null): string {
  return (value ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
}

function readSlug(value: string | null): string {
  const text = (value ?? '').trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) ? text : '';
}

function readSort(value: string | null): CatalogSort {
  const found = CATALOG_SORTS.find((item) => item.value === value);
  return found ? found.value : 'mac-dinh';
}

function readPage(value: string | null): number {
  const page = Number(value ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** Lượt bán gộp đơn 1 mẫu + dòng đơn nhiều mẫu (bỏ đơn hủy). Dùng chung catalog / tìm kiếm. */
export const productSoldCount = soldCount;

export function toCatalogCard(row: {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  rating: number;
  sold: number;
  weightScale: string | null;
  categorySlug: string | null;
  coverKey: string | null;
  cardKey: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): CatalogCard {
  const ratingLabel = ratingFormValue(row.rating);
  const listKey = listingMediaKey(row.coverKey, row.cardKey);
  const usingCard = Boolean(row.cardKey);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    comparePrice: visibleComparePrice(row.price, row.comparePrice),
    weightScale: readWeightScale(row.weightScale),
    shipBadge: productShipBadge(row.price, row.categorySlug),
    ratingLabel: ratingLabel || null,
    sold: Math.max(0, Number(row.sold) || 0),
    coverUrl: listKey ? routes.media(listKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: usingCard ? MEDIA_CARD_SIZE : row.coverWidth,
    coverHeight: usingCard ? MEDIA_CARD_SIZE : row.coverHeight,
  };
}

function toCard(row: Parameters<typeof toCatalogCard>[0]): CatalogCard {
  return toCatalogCard(row);
}
