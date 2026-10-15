import { and, asc, desc, eq, isNull, like, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { dropPathQueries, goneQueries, listRedirectEdges, redirectHopQueries } from '../../lib/db/redirects';
import { categories, posts, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { publicPathExists } from './lookup';
import {
  collapseTarget,
  isSystemPath,
  normalizeInternalPath,
  type UrlRetirement,
} from './rules';

const RETIRE_REQUIRED = 'Chọn cách xử lý URL cũ: chuyển hướng tới nội dung thay thế, trả 404 hoặc trả 410.';

export async function listManagedRedirects(db: AppDb, query: string) {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 180);
  const where = term ? or(like(redirects.fromPath, `%${term}%`), like(redirects.toPath, `%${term}%`)) : undefined;
  return db
    .select({
      id: redirects.id,
      fromPath: redirects.fromPath,
      toPath: redirects.toPath,
      statusCode: redirects.statusCode,
      enabled: redirects.enabled,
      updatedAt: redirects.updatedAt,
    })
    .from(redirects)
    .where(where)
    .orderBy(desc(redirects.updatedAt), desc(redirects.id))
    .limit(100);
}

export async function getManagedRedirect(db: AppDb, id: number) {
  const rows = await db
    .select({
      id: redirects.id,
      fromPath: redirects.fromPath,
      toPath: redirects.toPath,
      statusCode: redirects.statusCode,
      enabled: redirects.enabled,
    })
    .from(redirects)
    .where(eq(redirects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

const PICKER_LIMIT = 30;

function publishedTargets(db: AppDb) {
  return db
    .select({ title: posts.title, slug: posts.slug, category: categories.name })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id));
}

function toTargets(rows: { title: string; slug: string; category: string | null }[], excludeSlug?: string) {
  return rows
    .filter((row) => row.slug !== excludeSlug)
    .map((row) => ({ title: row.title, path: routes.knowledge(row.slug), category: row.category ?? '' }));
}

export async function listRedirectPostTargets(db: AppDb, excludeSlug?: string) {
  const rows = await publishedTargets(db)
    .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
    .orderBy(asc(posts.title), asc(posts.id))
    .limit(200);
  return toTargets(rows, excludeSlug);
}

export async function listPickerPosts(db: AppDb) {
  const rows = await publishedTargets(db)
    .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt)))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(PICKER_LIMIT);
  return toTargets(rows);
}

export async function listPickerCategories(db: AppDb) {
  return db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
}

export async function publishedRedirectTarget(db: AppDb, path: string) {
  const slug = path.startsWith('/kien-thuc/') ? path.slice('/kien-thuc/'.length) : '';
  if (!slug || slug.includes('/')) return null;
  const rows = await publishedTargets(db)
    .where(and(eq(posts.status, 'published'), isNull(posts.deletedAt), eq(posts.slug, slug)))
    .limit(1);
  return toTargets(rows)[0] ?? null;
}

export async function searchPickerPosts(db: AppDb, query: string, categoryId: number | null) {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 80).replace(/^\/kien-thuc\//, '');
  if (term.length < 2 && categoryId === null) return listPickerPosts(db);
  const filters = [eq(posts.status, 'published'), isNull(posts.deletedAt)];
  if (term.length >= 2 || (categoryId !== null && term.length >= 1)) {
    const match = or(like(posts.title, `%${term}%`), like(posts.slug, `%${term}%`));
    if (match) filters.push(match);
  }
  if (categoryId === 0) filters.push(isNull(posts.categoryId));
  else if (categoryId !== null && categoryId > 0) filters.push(eq(posts.categoryId, categoryId));
  const where = and(...filters);
  const rows = await publishedTargets(db).where(where).orderBy(desc(posts.publishedAt), desc(posts.id)).limit(PICKER_LIMIT);
  return toTargets(rows);
}

export async function saveManagedRedirect(
  db: AppDb,
  input: { id?: number; fromPath: string; toPath: string; statusCode: number; enabled: boolean },
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fromPath = normalizeInternalPath(input.fromPath);
  const requestedTo = normalizeInternalPath(input.toPath);
  if (!fromPath) return { ok: false, error: 'URL nguồn không hợp lệ. Chỉ dùng đường dẫn nội bộ.' };
  if (!requestedTo) return { ok: false, error: 'URL đích không hợp lệ. Chỉ dùng đường dẫn nội bộ.' };
  if (isSystemPath(fromPath) || isSystemPath(requestedTo)) return { ok: false, error: 'Không dùng đường dẫn hệ thống.' };
  const statusCode = input.statusCode === 302 ? 302 : input.statusCode === 301 ? 301 : null;
  if (!statusCode) return { ok: false, error: 'Chỉ hỗ trợ mã 301 hoặc 302.' };
  if (await publicPathExists(db, fromPath)) return { ok: false, error: 'URL nguồn đang là trang hoạt động.' };
  const current = input.id ? await getManagedRedirect(db, input.id) : null;
  if (input.id && !current) return { ok: false, error: 'Không tìm thấy chuyển hướng.' };
  const edges = await listRedirectEdges(db);
  const collapsed = collapseTarget(fromPath, requestedTo, edges);
  if (!collapsed.ok) return collapsed;
  if (!(await publicPathExists(db, collapsed.toPath))) return { ok: false, error: 'URL đích không tồn tại hoặc chưa công khai.' };
  const occupied = await db.select({ id: redirects.id }).from(redirects).where(eq(redirects.fromPath, fromPath)).limit(1);
  if (occupied[0] && occupied[0].id !== input.id) return { ok: false, error: 'URL nguồn đã có chuyển hướng.' };
  const enabled = input.enabled ? 1 : 0;
  const queries = redirectHopQueries(db, fromPath, collapsed.toPath, statusCode, enabled, now, input.id, current?.fromPath);
  if (actor) {
    queries.push(
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: input.id ? 'redirect.update' : 'redirect.create',
          objectType: 'redirect',
          objectId: fromPath,
          summary: input.id
            ? `Đã cập nhật chuyển hướng ${statusCode} từ ${fromPath} sang ${collapsed.toPath}.`
            : `Đã tạo chuyển hướng ${statusCode} từ ${fromPath} sang ${collapsed.toPath}.`,
          createdAt: now,
        },
        true,
      ),
    );
  }
  await commitWrites(db, queries);
  return { ok: true };
}

export async function setRedirectEnabled(
  db: AppDb,
  id: number,
  enabled: boolean,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getManagedRedirect(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy chuyển hướng.' };
  const next = enabled ? 1 : 0;
  if (next === 1 && current.statusCode !== 410) {
    if (!current.toPath || !(await publicPathExists(db, current.toPath))) {
      return { ok: false, error: 'URL đích không còn công khai.' };
    }
  }
  const queries: BatchItem<'sqlite'>[] = [db.update(redirects).set({ enabled: next, updatedAt: now }).where(eq(redirects.id, id))];
  if (actor) {
    queries.push(
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'redirect.update',
          objectType: 'redirect',
          objectId: current.fromPath,
          summary: next === 1 ? `Đã bật chuyển hướng ${current.fromPath}.` : `Đã tắt chuyển hướng ${current.fromPath}.`,
          createdAt: now,
        },
        true,
      ),
    );
  }
  await commitWrites(db, queries);
  return { ok: true };
}

export async function deleteManagedRedirect(
  db: AppDb,
  id: number,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getManagedRedirect(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy chuyển hướng.' };
  const queries: BatchItem<'sqlite'>[] = [db.delete(redirects).where(eq(redirects.id, id))];
  if (actor) {
    queries.push(
      activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'redirect.delete',
          objectType: 'redirect',
          objectId: current.fromPath,
          summary: `Đã xóa chuyển hướng ${current.fromPath}.`,
          createdAt: now,
        },
        false,
      ),
    );
  }
  await commitWrites(db, queries);
  return { ok: true };
}

export async function prepareRetirement(
  db: AppDb,
  fromPath: string,
  choice: UrlRetirement,
  now: number,
  actor?: ActivityActor,
): Promise<{ ok: true; queries: BatchItem<'sqlite'>[] } | { ok: false; error: string }> {
  if (choice.action === '404') return { ok: true, queries: dropPathQueries(db, fromPath) };
  if (choice.action === '410') {
    const queries = goneQueries(db, fromPath, now);
    if (actor) queries.push(redirectLog(db, actor, 'redirect.create', fromPath, `Đã đánh dấu 410 cho ${fromPath}.`, now));
    return { ok: true, queries };
  }
  const requested = normalizeInternalPath(choice.toPath);
  if (!requested) return { ok: false, error: 'Chọn bài đã xuất bản hoặc một đường dẫn nội bộ hợp lệ.' };
  if (requested === fromPath) return { ok: false, error: 'Chọn nội dung thay thế khác bài đang gỡ.' };
  if (isSystemPath(requested)) return { ok: false, error: 'Không chuyển hướng tới đường dẫn hệ thống.' };
  const collapsed = collapseTarget(fromPath, requested, await listRedirectEdges(db));
  if (!collapsed.ok) return collapsed;
  if (!(await publicPathExists(db, collapsed.toPath))) return { ok: false, error: 'Nội dung thay thế không tồn tại hoặc chưa công khai.' };
  const queries = redirectHopQueries(db, fromPath, collapsed.toPath, 301, 1, now);
  if (actor) queries.push(redirectLog(db, actor, 'redirect.create', fromPath, `Đã tạo chuyển hướng 301 từ ${fromPath} sang ${collapsed.toPath}.`, now));
  return { ok: true, queries };
}

export const retirementRequired = RETIRE_REQUIRED;

function redirectLog(db: AppDb, actor: ActivityActor, action: 'redirect.create' | 'redirect.update' | 'redirect.delete', path: string, summary: string, now: number) {
  return activityWrite(
    db,
    {
      actorId: actor.id,
      actorName: actor.name,
      action,
      objectType: 'redirect',
      objectId: path,
      summary,
      createdAt: now,
    },
    true,
  );
}
