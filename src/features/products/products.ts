import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { media, productMedia, products, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { canFeatureProduct, isProductStatus, type ProductStatus } from './status';

const PAGE_SIZE = 20;
const PRODUCT_SORTS = ['newest', 'oldest', 'name', 'price-asc', 'price-desc'] as const;

export type ProductListSort = (typeof PRODUCT_SORTS)[number];

export function productListSort(value: string | null | undefined): ProductListSort {
  return PRODUCT_SORTS.find((sort) => sort === value) ?? 'newest';
}

export function productAdminQuery(input: {
  query?: string;
  status?: string;
  sort?: string;
  page?: number;
  notice?: 'deleted' | 'featured-on' | 'featured-off' | 'feature-error';
}): string {
  const params = new URLSearchParams();
  const query = (input.query ?? '').replace(/[%_]/g, '').trim().slice(0, 160);
  const status = isProductStatus(input.status ?? '') ? input.status : '';
  const sort = productListSort(input.sort);
  const page = input.page && Number.isInteger(input.page) && input.page > 1 ? input.page : 0;
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  if (sort !== 'newest') params.set('sort', sort);
  if (page) params.set('page', String(page));
  if (input.notice === 'deleted') params.set('deleted', '1');
  if (input.notice === 'featured-on') params.set('featured', '1');
  if (input.notice === 'featured-off') params.set('featured', '0');
  if (input.notice === 'feature-error') params.set('error', 'feature');
  const text = params.toString();
  return text ? `${routes.adminProducts}?${text}` : routes.adminProducts;
}

export function readProductListContext(form: FormData) {
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const page = Number(read('page'));
  return {
    query: read('q'),
    status: read('status'),
    sort: read('sort'),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export type ProductInput = {
  name: string;
  slug: string;
  price: number;
  description: string;
  coverMediaId: number | null;
  albumIds: number[];
  options: string[];
  status: ProductStatus;
  isFeatured: boolean;
  sortOrder: number;
  seoTitle: string | null;
  metaDescription: string | null;
};

export async function listProducts(
  db: AppDb,
  filters: { query: string; status: ProductStatus | ''; page: number; sort?: ProductListSort },
) {
  const term = filters.query.replace(/[%_]/g, '').trim().slice(0, 160);
  const conditions = [];
  if (filters.status) conditions.push(eq(products.status, filters.status));
  if (term) conditions.push(like(products.name, `%${term}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const sort = productListSort(filters.sort);
  const filtered = Boolean(term || filters.status);
  const [totalRows, libraryRows, rows] = await Promise.all([
    db.select({ value: count() }).from(products).where(where),
    filtered ? db.select({ value: count() }).from(products) : Promise.resolve([]),
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        price: products.price,
        status: products.status,
        isFeatured: products.isFeatured,
        updatedAt: products.updatedAt,
        coverKey: media.r2Key,
        coverAlt: media.altText,
      })
      .from(products)
      .leftJoin(media, eq(products.coverMediaId, media.id))
      .where(where)
      .orderBy(...productOrder(sort))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  return {
    rows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      status: row.status,
      isFeatured: canFeatureProduct(row.status, row.isFeatured),
      updatedAt: row.updatedAt,
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt || row.name,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    sort,
    libraryTotal: filtered ? (libraryRows[0]?.value ?? 0) : total,
  };
}

function productOrder(sort: ProductListSort) {
  if (sort === 'oldest') return [asc(products.updatedAt), asc(products.id)] as const;
  if (sort === 'name') return [asc(products.name), desc(products.id)] as const;
  if (sort === 'price-asc') return [asc(products.price), desc(products.id)] as const;
  if (sort === 'price-desc') return [desc(products.price), desc(products.id)] as const;
  return [desc(products.updatedAt), desc(products.id)] as const;
}

export async function getProduct(db: AppDb, id: number) {
  const rows = await db.select().from(products).where(eq(products.id, id)).limit(1);
  const product = rows[0];
  if (!product) return null;
  const album = await db
    .select({ mediaId: productMedia.mediaId })
    .from(productMedia)
    .where(eq(productMedia.productId, id))
    .orderBy(asc(productMedia.sortOrder), asc(productMedia.mediaId));
  return { ...product, albumIds: album.map((item) => item.mediaId) };
}

export async function createProduct(
  db: AppDb,
  input: ProductInput,
  now = Date.now(),
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const slugError = await slugAvailable(db, input.slug, null);
  if (slugError) return { ok: false, error: slugError };
  const mediaError = await mediaAvailable(db, input);
  if (mediaError) return { ok: false, error: mediaError };
  const inserted = await db
    .insert(products)
    .values({ ...productValues(input, now), createdAt: now })
    .returning({ id: products.id });
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được sản phẩm.' };
  if (input.albumIds.length > 0) {
    try {
      await albumInsert(db, id, input.albumIds);
    } catch (error) {
      await db.delete(products).where(eq(products.id, id));
      console.error(JSON.stringify({ event: 'product_album_failed', name: error instanceof Error ? error.name : 'unknown' }));
      return { ok: false, error: 'Không lưu được album.' };
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
  const slugError = await slugAvailable(db, input.slug, id);
  if (slugError) return { ok: false, error: slugError };
  const mediaError = await mediaAvailable(db, input);
  if (mediaError) return { ok: false, error: mediaError };
  const queries: BatchItem<'sqlite'>[] = [
    db.update(products).set(productValues(input, now)).where(eq(products.id, id)),
    db.delete(productMedia).where(eq(productMedia.productId, id)),
  ];
  if (input.albumIds.length > 0) queries.push(albumInsert(db, id, input.albumIds));
  if (current.slug !== input.slug) {
    queries.push(...slugRedirectQueries(db, routes.product(current.slug), routes.product(input.slug), now));
  }
  await runBatch(db, queries);
  return { ok: true };
}

export async function setProductFeatured(
  db: AppDb,
  id: number,
  featured: boolean,
  now = Date.now(),
): Promise<{ ok: true; featured: boolean } | { ok: false; error: string }> {
  const rows = await db
    .select({ status: products.status, isFeatured: products.isFeatured })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  const product = rows[0];
  if (!product) return { ok: false, error: 'Không tìm thấy sản phẩm.' };
  const next = canFeatureProduct(product.status, featured);
  if (featured && !next) return { ok: false, error: 'Sản phẩm ngừng bán không được đánh dấu nổi bật.' };
  if (product.isFeatured !== next) {
    await db.update(products).set({ isFeatured: next, updatedAt: now }).where(eq(products.id, id));
  }
  return { ok: true, featured: next };
}

export async function deleteProduct(db: AppDb, id: number): Promise<void> {
  const current = await getProduct(db, id);
  if (!current) return;
  const path = routes.product(current.slug);
  await runBatch(db, [
    db.delete(redirects).where(eq(redirects.fromPath, path)),
    db.delete(redirects).where(eq(redirects.toPath, path)),
    db.delete(products).where(eq(products.id, id)),
  ]);
}

function productValues(input: ProductInput, now: number) {
  return {
    name: input.name,
    slug: input.slug,
    price: input.price,
    description: input.description,
    coverMediaId: input.coverMediaId,
    optionsJson: JSON.stringify(input.options),
    status: input.status,
    isFeatured: canFeatureProduct(input.status, input.isFeatured),
    sortOrder: input.sortOrder,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
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
