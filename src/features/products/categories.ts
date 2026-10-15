import { and, asc, count, eq, like, max, or } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { media, productCategories, products } from '../../lib/db/schema';
import { SLUG_PATTERN, slugify } from '../posts/slug';

export type CategoryOrderRow = { id: number; sortOrder: number };

export function categoryListQuery(value: string): string {
  return value.replace(/[%_]/g, '').trim().slice(0, 80);
}

export function readProductCategory(input: {
  name: string;
  slug: string;
  description: string;
  coverMediaId: string;
}): { ok: true; value: { name: string; slug: string; description: string; coverMediaId: number | null } } | { ok: false; error: string } {
  const name = input.name.trim();
  const slug = slugify(input.slug || name);
  const description = input.description.trim();
  const cover = readCover(input.coverMediaId);
  if (!name) return { ok: false, error: 'Nhập tên danh mục.' };
  if (name.length > 120) return { ok: false, error: 'Tên danh mục quá dài.' };
  if (!slug || !SLUG_PATTERN.test(slug)) return { ok: false, error: 'Slug không hợp lệ.' };
  if (description.length > 300) return { ok: false, error: 'Mô tả quá dài.' };
  if (!cover.ok) return cover;
  return { ok: true, value: { name, slug, description, coverMediaId: cover.id } };
}

function readCover(value: string): { ok: true; id: number | null } | { ok: false; error: string } {
  const text = value.trim();
  if (!text) return { ok: true, id: null };
  const id = Number(text);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Ảnh danh mục không hợp lệ.' };
  return { ok: true, id };
}

export function productCategoryDeleteWarning(): string {
  return 'Xóa danh mục này?';
}

export function productCategoryInUseError(productCount: number): string | null {
  if (productCount <= 0) return null;
  return 'Danh mục đang có sản phẩm, chưa xóa được.';
}

export function categoryMovePlan(rows: CategoryOrderRow[], id: number, direction: 'up' | 'down'): CategoryOrderRow[] {
  const index = rows.findIndex((row) => row.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= rows.length) return [];
  const next = rows.slice();
  const current = next[index];
  const neighbor = next[target];
  if (!current || !neighbor) return [];
  next[index] = neighbor;
  next[target] = current;
  return next.flatMap((row, position) => (row.sortOrder === position ? [] : [{ id: row.id, sortOrder: position }]));
}

export async function listProductCategories(db: AppDb, query = '') {
  const term = categoryListQuery(query);
  const where = term ? or(like(productCategories.name, `%${term}%`), like(productCategories.slug, `%${term}%`)) : undefined;
  return db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      slug: productCategories.slug,
      description: productCategories.description,
      coverMediaId: productCategories.coverMediaId,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      sortOrder: productCategories.sortOrder,
      productCount: count(products.id),
    })
    .from(productCategories)
    .leftJoin(products, eq(products.categoryId, productCategories.id))
    .leftJoin(media, eq(productCategories.coverMediaId, media.id))
    .where(where)
    .groupBy(
      productCategories.id,
      productCategories.name,
      productCategories.slug,
      productCategories.description,
      productCategories.coverMediaId,
      media.r2Key,
      media.altText,
      productCategories.sortOrder,
    )
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(productCategories.id));
}

export async function listSellableProductCategories(db: AppDb) {
  return db
    .select({
      id: productCategories.id,
      name: productCategories.name,
      slug: productCategories.slug,
      sortOrder: productCategories.sortOrder,
    })
    .from(productCategories)
    .innerJoin(products, and(eq(products.categoryId, productCategories.id), eq(products.status, 'active')))
    .groupBy(productCategories.id, productCategories.name, productCategories.slug, productCategories.sortOrder)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(productCategories.id));
}

export async function saveProductCategory(
  db: AppDb,
  input: { id?: number; name: string; slug: string; description: string; coverMediaId: string },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = readProductCategory(input);
  if (!parsed.ok) return parsed;
  const { name, slug, description, coverMediaId } = parsed.value;
  const taken = await db.select({ id: productCategories.id }).from(productCategories).where(eq(productCategories.slug, slug)).limit(1);
  if (taken[0] && taken[0].id !== input.id) return { ok: false, error: 'Slug đã được dùng.' };
  const missingCover = await coverAvailable(db, coverMediaId);
  if (missingCover) return { ok: false, error: missingCover };
  if (input.id) {
    const current = await db
      .select({
        name: productCategories.name,
        slug: productCategories.slug,
        description: productCategories.description,
        coverMediaId: productCategories.coverMediaId,
      })
      .from(productCategories)
      .where(eq(productCategories.id, input.id))
      .limit(1);
    const row = current[0];
    if (!row) return { ok: false, error: 'Không tìm thấy danh mục.' };
    if (row.name === name && row.slug === slug && row.description === description && row.coverMediaId === coverMediaId) return { ok: true };
    await commitWrites(db, [
      db
        .update(productCategories)
        .set({ name, slug, description, coverMediaId, updatedAt: now })
        .where(eq(productCategories.id, input.id)),
      ...(actor ? [categoryLog(db, actor, 'product_category.update', input.id, name, now)] : []),
    ]);
    return { ok: true };
  }
  const highest = await db.select({ value: max(productCategories.sortOrder) }).from(productCategories);
  const sortOrder = (highest[0]?.value ?? -1) + 1;
  await commitWrites(db, [
    db.insert(productCategories).values({ name, slug, description, coverMediaId, sortOrder, createdAt: now, updatedAt: now }),
    ...(actor ? [categoryLog(db, actor, 'product_category.create', null, name, now, true)] : []),
  ]);
  return { ok: true };
}

async function coverAvailable(db: AppDb, coverMediaId: number | null): Promise<string | null> {
  if (!coverMediaId) return null;
  const rows = await db.select({ id: media.id }).from(media).where(eq(media.id, coverMediaId)).limit(1);
  return rows[0] ? null : 'Ảnh đã chọn không còn trong thư viện.';
}

export async function moveProductCategory(
  db: AppDb,
  id: number,
  direction: 'up' | 'down',
): Promise<{ ok: true; moved: boolean }> {
  const rows = await db
    .select({ id: productCategories.id, sortOrder: productCategories.sortOrder })
    .from(productCategories)
    .orderBy(asc(productCategories.sortOrder), asc(productCategories.name), asc(productCategories.id));
  const plan = categoryMovePlan(rows, id, direction);
  if (plan.length === 0) return { ok: true, moved: false };
  await commitWrites(
    db,
    plan.map((item) => db.update(productCategories).set({ sortOrder: item.sortOrder }).where(eq(productCategories.id, item.id))),
  );
  return { ok: true, moved: true };
}

export async function deleteProductCategory(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await db.select({ name: productCategories.name }).from(productCategories).where(eq(productCategories.id, id)).limit(1);
  const row = current[0];
  if (!row) return { ok: false, error: 'Không tìm thấy danh mục.' };
  const used = await db.select({ value: count() }).from(products).where(eq(products.categoryId, id));
  const blocked = productCategoryInUseError(used[0]?.value ?? 0);
  if (blocked) return { ok: false, error: blocked };
  await commitWrites(db, [
    db.delete(productCategories).where(eq(productCategories.id, id)),
    ...(actor ? [categoryLog(db, actor, 'product_category.delete', id, row.name, now)] : []),
  ]);
  return { ok: true };
}

function categoryLog(
  db: AppDb,
  actor: ActivityActor,
  action: 'product_category.create' | 'product_category.update' | 'product_category.delete',
  id: number | null,
  name: string,
  now: number,
  useLastInsertId = false,
) {
  const verb =
    action === 'product_category.create'
      ? 'Đã tạo danh mục sản phẩm'
      : action === 'product_category.delete'
        ? 'Đã xóa danh mục sản phẩm'
        : 'Đã cập nhật danh mục sản phẩm';
  return activityWrite(
    db,
    {
      actorId: actor.id,
      actorName: actor.name,
      action,
      objectType: 'product_category',
      objectId: useLastInsertId ? null : id === null ? null : String(id),
      summary: `${verb} “${quotedLabel(name, 'Không tên')}”.`,
      createdAt: now,
      useLastInsertId,
    },
    true,
  );
}
