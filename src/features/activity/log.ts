import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { calendarRange } from '../../lib/datetime';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { activityLogs, adminUsers } from '../../lib/db/schema';

export const ACTIVITY_PAGE_SIZE = 20;
export const AUTOSAVE_LOG_WINDOW_MS = 10 * 60 * 1000;

export const ACTIVITY_ACTIONS = [
  'auth.login',
  'post.create',
  'post.update',
  'post.publish',
  'post.unpublish',
  'post.trash',
  'post.restore',
  'post.delete',
  'category.create',
  'category.update',
  'category.delete',
  'tag.create',
  'tag.update',
  'tag.delete',
  'product_category.create',
  'product_category.update',
  'product_category.delete',
  'user.create',
  'user.update',
  'user.disable',
  'session.revoke',
  'password.change',
  'settings.update',
  'media.delete',
  'redirect.create',
  'redirect.update',
  'redirect.delete',
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export const ACTIVITY_LABELS: Record<ActivityAction, string> = {
  'auth.login': 'Đăng nhập',
  'post.create': 'Tạo bài',
  'post.update': 'Sửa bài',
  'post.publish': 'Xuất bản',
  'post.unpublish': 'Gỡ bài',
  'post.trash': 'Thùng rác',
  'post.restore': 'Khôi phục bài',
  'post.delete': 'Xóa bài',
  'category.create': 'Tạo danh mục',
  'category.update': 'Sửa danh mục',
  'category.delete': 'Xóa danh mục',
  'tag.create': 'Tạo thẻ',
  'tag.update': 'Sửa thẻ',
  'tag.delete': 'Xóa thẻ',
  'product_category.create': 'Tạo danh mục sản phẩm',
  'product_category.update': 'Sửa danh mục sản phẩm',
  'product_category.delete': 'Xóa danh mục sản phẩm',
  'user.create': 'Tạo tài khoản',
  'user.update': 'Sửa tài khoản',
  'user.disable': 'Khóa tài khoản',
  'session.revoke': 'Thu hồi phiên',
  'password.change': 'Đổi mật khẩu',
  'settings.update': 'Cập nhật cài đặt',
  'media.delete': 'Xóa ảnh',
  'redirect.create': 'Tạo chuyển hướng',
  'redirect.update': 'Sửa chuyển hướng',
  'redirect.delete': 'Xóa chuyển hướng',
};

export type ActivityObject = 'post' | 'category' | 'tag' | 'product_category' | 'user' | 'media' | 'settings' | 'redirect';

export type ActivityActor = { id: number; name: string };

export type ActivityEntry = {
  actorId: number;
  actorName: string;
  action: ActivityAction;
  objectType: ActivityObject;
  objectId: string | null;
  summary: string;
  createdAt: number;
  useLastInsertId?: boolean;
};

export type PostComparable = {
  title: string;
  slug: string;
  categoryIds: number[];
  tagIds: number[];
  coverMediaId: number | null;
  contentJson: string;
  excerpt: string;
  seoTitle: string | null;
  metaDescription: string | null;
  status: string;
};

export function isActivityAction(value: string): value is ActivityAction {
  return (ACTIVITY_ACTIONS as readonly string[]).includes(value);
}

export function activityText(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

export function actorLabel(displayName: string, userId: number): string {
  const name = activityText(displayName, 80);
  return name || `Tài khoản #${userId}`;
}

export function quotedLabel(value: string, fallback: string): string {
  return activityText(value, 80) || fallback;
}

export function postChanged(current: PostComparable, next: PostComparable): boolean {
  return (
    current.title !== next.title ||
    current.slug !== next.slug ||
    !sameIds(current.categoryIds, next.categoryIds) ||
    !sameIds(current.tagIds, next.tagIds) ||
    current.coverMediaId !== next.coverMediaId ||
    current.contentJson !== next.contentJson ||
    current.excerpt !== next.excerpt ||
    (current.seoTitle ?? '') !== (next.seoTitle ?? '') ||
    (current.metaDescription ?? '') !== (next.metaDescription ?? '') ||
    current.status !== next.status
  );
}

function sameIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, index) => id === right[index]);
}

export function postLogAction(previousStatus: string, nextStatus: string, changed: boolean): ActivityAction | null {
  if (!changed) return null;
  if (previousStatus !== 'published' && nextStatus === 'published') return 'post.publish';
  if (previousStatus === 'published' && nextStatus !== 'published') return 'post.unpublish';
  return 'post.update';
}

export function postSummary(action: ActivityAction, title: string): string {
  const name = quotedLabel(title, 'Không tiêu đề');
  if (action === 'post.publish') return `Đã xuất bản “${name}”.`;
  if (action === 'post.unpublish') return `Đã gỡ bài “${name}”.`;
  if (action === 'post.trash') return `Đã chuyển “${name}” vào thùng rác.`;
  if (action === 'post.restore') return `Đã khôi phục “${name}” thành bản nháp.`;
  if (action === 'post.delete') return `Đã xóa vĩnh viễn “${name}”.`;
  if (action === 'post.create') return `Đã tạo bài “${name}”.`;
  return `Đã cập nhật bài “${name}”.`;
}

export function withinLogWindow(previousAt: number, now: number, windowMs = AUTOSAVE_LOG_WINDOW_MS): boolean {
  return now >= previousAt && now - previousAt < windowMs;
}

export function pageWindow(total: number, page: number, size = ACTIVITY_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { current, pageCount, offset: (current - 1) * size };
}

export type ActivityFilters = {
  actorId: number | null;
  action: ActivityAction | '';
  from: string;
  to: string;
  page: number;
};

export function readActivityFilters(params: URLSearchParams): ActivityFilters {
  const actorRaw = Number(params.get('user') ?? '');
  const actionRaw = params.get('action') ?? '';
  return {
    actorId: Number.isInteger(actorRaw) && actorRaw > 0 ? actorRaw : null,
    action: isActivityAction(actionRaw) ? actionRaw : '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    page: Number(params.get('page') ?? '1'),
  };
}

export async function activityActor(db: AppDb, userId: number): Promise<ActivityActor> {
  const rows = await db
    .select({ displayName: adminUsers.displayName })
    .from(adminUsers)
    .where(eq(adminUsers.id, userId))
    .limit(1);
  return { id: userId, name: actorLabel(rows[0]?.displayName ?? '', userId) };
}

export async function listActivityActors(db: AppDb) {
  const rows = await db
    .select({ id: adminUsers.id, displayName: adminUsers.displayName })
    .from(adminUsers)
    .orderBy(adminUsers.displayName, adminUsers.id);
  return rows.map((row) => ({ id: row.id, name: actorLabel(row.displayName, row.id) }));
}

export async function listActivity(db: AppDb, filters: ActivityFilters) {
  const range = calendarRange(filters.from, filters.to);
  if (range.invalid) return { rows: [], total: 0, page: 1, pageCount: 1, invalid: true };
  const conditions = [];
  if (filters.actorId) conditions.push(eq(activityLogs.actorId, filters.actorId));
  if (filters.action) conditions.push(eq(activityLogs.action, filters.action));
  if (range.start !== null) conditions.push(gte(activityLogs.createdAt, range.start));
  if (range.end !== null) conditions.push(lt(activityLogs.createdAt, range.end));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const totalRows = await db.select({ value: count() }).from(activityLogs).where(where);
  const total = totalRows[0]?.value ?? 0;
  const window = pageWindow(total, filters.page);
  const rows = await db
    .select({
      id: activityLogs.id,
      actorName: activityLogs.actorName,
      action: activityLogs.action,
      summary: activityLogs.summary,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .where(where)
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(ACTIVITY_PAGE_SIZE)
    .offset(window.offset);
  return { rows, total, page: window.current, pageCount: window.pageCount, invalid: false };
}

// Cột trong SELECT phải đúng thứ tự cột của bảng, kể cả id, vì Drizzle liệt kê mọi cột.
function gatedInsert(db: AppDb, entry: ActivityEntry) {
  const objectId = entry.useLastInsertId ? sql`CAST(last_insert_rowid() AS TEXT)` : entry.objectId;
  return db.insert(activityLogs).select(sql`
    select null, ${entry.actorId}, ${activityText(entry.actorName, 80)}, ${entry.action}, ${entry.objectType}, ${objectId}, ${activityText(entry.summary, 180)}, ${entry.createdAt}
    where changes() > 0
  `);
}

function plainInsert(db: AppDb, entry: ActivityEntry) {
  return db.insert(activityLogs).values({
    actorId: entry.actorId,
    actorName: activityText(entry.actorName, 80),
    action: entry.action,
    objectType: entry.objectType,
    objectId: entry.objectId,
    summary: activityText(entry.summary, 180),
    createdAt: entry.createdAt,
  });
}

export async function commitWrites(db: AppDb, writes: BatchItem<'sqlite'>[]): Promise<unknown[]> {
  if (writes.length === 0) return [];
  if (writes.length === 1) return [await (writes[0] as unknown as PromiseLike<unknown>)];
  return runBatch(db, writes);
}

export function activityWrite(db: AppDb, entry: ActivityEntry, gate: boolean) {
  return gate ? gatedInsert(db, entry) : plainInsert(db, entry);
}

export async function autosaveLogWrite(db: AppDb, entry: ActivityEntry, postId: number): Promise<{ query: BatchItem<'sqlite'> }> {
  const recent = await db
    .select({ id: activityLogs.id, createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .where(
      and(
        eq(activityLogs.actorId, entry.actorId),
        eq(activityLogs.action, 'post.update'),
        eq(activityLogs.objectType, 'post'),
        eq(activityLogs.objectId, String(postId)),
      ),
    )
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(1);
  const current = recent[0];
  const query =
    current && withinLogWindow(current.createdAt, entry.createdAt)
      ? db
          .update(activityLogs)
          .set({
            actorName: activityText(entry.actorName, 80),
            summary: activityText(entry.summary, 180),
            createdAt: entry.createdAt,
          })
          .where(and(eq(activityLogs.id, current.id), sql`changes() > 0`))
      : gatedInsert(db, entry);
  return { query };
}

export function changedRows(result: unknown): boolean {
  return Array.isArray(result) && result.length > 0;
}
