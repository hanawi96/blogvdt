import { and, asc, count, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, productCategories, products } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { CORD_TYPES } from './form';
import { readOptions } from './options';

export const CATALOG_PAGE_SIZE = 12;

export const CATALOG_CORDS = [
  { value: 'rut', label: CORD_TYPES[0] },
  { value: 'co-gian', label: CORD_TYPES[1] },
] as const;

export const CATALOG_SORTS = [
  { value: 'mac-dinh', label: 'Mặc định' },
  { value: 'gia-tang', label: 'Giá tăng' },
  { value: 'gia-giam', label: 'Giá giảm' },
  { value: 'ten', label: 'Tên A–Z' },
] as const;

const CATALOG_PARAMS = ['q', 'danh-muc', 'day', 'tu', 'den', 'sap-xep', 'page'] as const;

export type CatalogSort = (typeof CATALOG_SORTS)[number]['value'];
export type CatalogCord = (typeof CATALOG_CORDS)[number]['value'];

export type CatalogQuery = {
  q: string;
  category: string;
  cord: CatalogCord | '';
  min: number | null;
  max: number | null;
  sort: CatalogSort;
  page: number;
};

export function readCatalogQuery(params: URLSearchParams): CatalogQuery {
  let min = readMoney(params.get('tu'));
  let max = readMoney(params.get('den'));
  if (min != null && max != null && min > max) {
    const swapped = min;
    min = max;
    max = swapped;
  }
  return {
    q: readTerm(params.get('q')),
    category: readSlug(params.get('danh-muc')),
    cord: readCord(params.get('day')),
    min,
    max,
    sort: readSort(params.get('sap-xep')),
    page: readPage(params.get('page')),
  };
}

export function catalogFiltered(query: CatalogQuery): boolean {
  return query.q.length > 0 || query.category.length > 0 || query.cord.length > 0 || query.min != null || query.max != null || query.sort !== 'mac-dinh';
}

export function catalogPath(query: CatalogQuery, page = query.page): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('danh-muc', query.category);
  if (query.cord) params.set('day', query.cord);
  if (query.min != null) params.set('tu', String(query.min));
  if (query.max != null) params.set('den', String(query.max));
  if (query.sort !== 'mac-dinh') params.set('sap-xep', query.sort);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `${routes.catalog}?${text}` : routes.catalog;
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
  description: string;
  cordType: string;
  categoryName: string | null;
  options: string[];
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
  const filters: SQL[] = [eq(products.status, 'active')];
  if (query.q) filters.push(like(products.name, `%${query.q}%`));
  if (query.category) filters.push(eq(productCategories.slug, query.category));
  const cord = CATALOG_CORDS.find((item) => item.value === query.cord);
  if (cord) filters.push(eq(products.cordType, cord.label));
  if (query.min != null) filters.push(gte(products.price, query.min));
  if (query.max != null) filters.push(lte(products.price, query.max));
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
      description: products.description,
      cordType: products.cordType,
      categoryName: productCategories.name,
      optionsJson: products.optionsJson,
      coverKey: media.r2Key,
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

function catalogOrder(sort: CatalogSort) {
  if (sort === 'gia-tang') return [asc(products.price), asc(products.id)] as const;
  if (sort === 'gia-giam') return [desc(products.price), asc(products.id)] as const;
  if (sort === 'ten') return [asc(products.name), asc(products.id)] as const;
  return [asc(products.sortOrder), asc(products.id)] as const;
}

function readTerm(value: string | null): string {
  return (value ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
}

function readSlug(value: string | null): string {
  const text = (value ?? '').trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) ? text : '';
}

function readCord(value: string | null): CatalogCord | '' {
  const found = CATALOG_CORDS.find((item) => item.value === value);
  return found ? found.value : '';
}

function readMoney(value: string | null): number | null {
  if (!value || !/^\d{1,8}$/.test(value)) return null;
  return Number(value);
}

function readSort(value: string | null): CatalogSort {
  const found = CATALOG_SORTS.find((item) => item.value === value);
  return found ? found.value : 'mac-dinh';
}

function readPage(value: string | null): number {
  const page = Number(value ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function toCard(row: {
  id: number;
  name: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  description: string;
  cordType: string;
  categoryName: string | null;
  optionsJson: string;
  coverKey: string | null;
  coverAlt: string | null;
  coverWidth: number | null;
  coverHeight: number | null;
}): CatalogCard {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: row.price,
    comparePrice: visibleComparePrice(row.price, row.comparePrice),
    description: row.description,
    cordType: row.cordType,
    categoryName: row.categoryName,
    options: readOptions(row.optionsJson),
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
    coverAlt: row.coverAlt ?? '',
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
  };
}
