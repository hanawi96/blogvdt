import { and, asc, count, eq, like, ne, or, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { postTags, tags } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { slugify } from './slug';

export const TAG_ROBOTS = ['index', 'noindex'] as const;
export type TagRobots = (typeof TAG_ROBOTS)[number];

export type TagInput = {
  id?: number;
  name: string;
  slug: string;
  description: string;
  seoTitle: string;
  metaDescription: string;
  robots: string;
};

export function isTagRobots(value: string): value is TagRobots {
  return value === 'index' || value === 'noindex';
}

/** Chỉ id + tên — dùng trong form bài, tránh đếm bài. */
export async function listTagOptions(db: AppDb) {
  return db.select({ id: tags.id, name: tags.name }).from(tags).orderBy(asc(tags.name));
}

export async function listTags(db: AppDb, filters: { query?: string } = {}) {
  const term = (filters.query ?? '').replace(/[%_]/g, '').trim().slice(0, 80);
  const where = term ? or(like(tags.name, `%${term}%`), like(tags.slug, `%${term}%`)) : undefined;
  return db
    .select({
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
      description: tags.description,
      seoTitle: tags.seoTitle,
      metaDescription: tags.metaDescription,
      robots: tags.robots,
      postCount: count(postTags.postId),
      createdAt: tags.createdAt,
      updatedAt: tags.updatedAt,
    })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .where(where)
    .groupBy(
      tags.id,
      tags.name,
      tags.slug,
      tags.description,
      tags.seoTitle,
      tags.metaDescription,
      tags.robots,
      tags.createdAt,
      tags.updatedAt,
    )
    .orderBy(asc(tags.name));
}

export async function getTagById(db: AppDb, id: number) {
  const rows = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getTagBySlug(db: AppDb, slug: string) {
  const rows = await db.select().from(tags).where(eq(tags.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function saveTag(
  db: AppDb,
  input: TagInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const name = input.name.trim();
  const slug = slugify(input.slug || name);
  const description = input.description.trim();
  const seoTitle = input.seoTitle.trim();
  const metaDescription = input.metaDescription.trim();
  const robots = input.robots.trim() || 'noindex';

  if (!name) return { ok: false, error: 'Nhập tên thẻ.' };
  if (name.length > 80) return { ok: false, error: 'Tên thẻ quá dài.' };
  if (!slug) return { ok: false, error: 'Slug không hợp lệ.' };
  if (description.length > 300) return { ok: false, error: 'Mô tả quá dài.' };
  if (seoTitle.length > 180) return { ok: false, error: 'SEO title quá dài.' };
  if (metaDescription.length > 300) return { ok: false, error: 'Mô tả SEO quá dài.' };
  if (!isTagRobots(robots)) return { ok: false, error: 'Trạng thái SEO không hợp lệ.' };

  const [slugTaken, nameTaken] = await Promise.all([
    db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1),
    db
      .select({ id: tags.id, name: tags.name })
      .from(tags)
      .where(and(sql`lower(${tags.name}) = ${name.toLowerCase()}`, input.id ? ne(tags.id, input.id) : undefined))
      .limit(1),
  ]);
  if (slugTaken[0] && slugTaken[0].id !== input.id) return { ok: false, error: 'Slug đã được dùng.' };
  if (nameTaken[0]) return { ok: false, error: 'Tên thẻ đã được dùng.' };

  const values = {
    name,
    slug,
    description: description || null,
    seoTitle: seoTitle || null,
    metaDescription: metaDescription || null,
    robots,
    updatedAt: now,
  };

  if (input.id) {
    const current = await db
      .select({
        name: tags.name,
        slug: tags.slug,
        description: tags.description,
        seoTitle: tags.seoTitle,
        metaDescription: tags.metaDescription,
        robots: tags.robots,
      })
      .from(tags)
      .where(eq(tags.id, input.id))
      .limit(1);
    const row = current[0];
    if (!row) return { ok: false, error: 'Không tìm thấy thẻ.' };
    if (
      row.name === name &&
      row.slug === slug &&
      (row.description ?? '') === description &&
      (row.seoTitle ?? '') === seoTitle &&
      (row.metaDescription ?? '') === metaDescription &&
      row.robots === robots
    ) {
      return { ok: true, id: input.id };
    }
    const redirect = tagRedirect(row.slug, slug);
    await commitWrites(db, [
      db.update(tags).set(values).where(eq(tags.id, input.id)),
      ...(actor ? [tagLog(db, actor, 'tag.update', input.id, name, now)] : []),
      ...(redirect ? slugRedirectQueries(db, redirect.from, redirect.to, now) : []),
    ]);
    return { ok: true, id: input.id };
  }

  await commitWrites(db, [
    db.insert(tags).values({ ...values, createdAt: now }),
    ...(actor ? [tagLog(db, actor, 'tag.create', null, name, now, true)] : []),
  ]);
  const inserted = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được thẻ.' };
  return { ok: true, id };
}

/** Chỉ xóa thẻ và liên kết post_tags (cascade). Không xóa bài viết. */
export async function deleteTag(db: AppDb, id: number, actor?: ActivityActor, now = Date.now()): Promise<void> {
  const current = await db.select({ name: tags.name }).from(tags).where(eq(tags.id, id)).limit(1);
  const row = current[0];
  if (!row) return;
  await commitWrites(db, [
    db.delete(tags).where(eq(tags.id, id)),
    ...(actor ? [tagLog(db, actor, 'tag.delete', id, row.name, now)] : []),
  ]);
}

export function tagRedirect(oldSlug: string, newSlug: string): { from: string; to: string } | null {
  if (!oldSlug || oldSlug === newSlug) return null;
  return { from: routes.tag(oldSlug), to: routes.tag(newSlug) };
}

export function tagDeleteWarning(postCount: number): string {
  if (postCount <= 0) return 'Xóa thẻ này?';
  const label = postCount === 1 ? '1 bài viết' : `${postCount} bài viết`;
  return `Thẻ này đang gắn với ${label}. Bài viết được giữ lại và chỉ bỏ liên kết thẻ. Xóa thẻ?`;
}

function tagLog(
  db: AppDb,
  actor: ActivityActor,
  action: 'tag.create' | 'tag.update' | 'tag.delete',
  id: number | null,
  name: string,
  now: number,
  useLastInsertId = false,
) {
  const verb = action === 'tag.create' ? 'Đã tạo thẻ' : action === 'tag.delete' ? 'Đã xóa thẻ' : 'Đã cập nhật thẻ';
  return activityWrite(
    db,
    {
      actorId: actor.id,
      actorName: actor.name,
      action,
      objectType: 'tag',
      objectId: useLastInsertId ? null : id === null ? null : String(id),
      summary: `${verb} ${quotedLabel(name, 'Không tên')}.`,
      createdAt: now,
      useLastInsertId,
    },
    true,
  );
}
