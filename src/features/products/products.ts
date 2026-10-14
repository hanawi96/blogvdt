import { and, asc, count, desc, eq, inArray, like } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { media, productMedia, products, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import type { ProductStatus } from './status';

const PAGE_SIZE = 20;

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

export async function listProducts(db: AppDb, filters: { query: string; status: ProductStatus | ''; page: number }) {
  const term = filters.query.replace(/[%_]/g, '').trim();
  const conditions = [];
  if (filters.status) conditions.push(eq(products.status, filters.status));
  if (term) conditions.push(like(products.name, `%${term}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const totalRows = await db.select({ value: count() }).from(products).where(where);
  const total = totalRows[0]?.value ?? 0;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      status: products.status,
      isFeatured: products.isFeatured,
      updatedAt: products.updatedAt,
    })
    .from(products)
    .where(where)
    .orderBy(asc(products.sortOrder), desc(products.updatedAt), desc(products.id))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
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
    isFeatured: input.isFeatured,
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
