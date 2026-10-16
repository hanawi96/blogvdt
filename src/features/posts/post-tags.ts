import { asc, eq, inArray } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { AppDb } from '../../lib/db/client';
import { postTags, tags } from '../../lib/db/schema';
import { MAX_POST_TAGS } from './tag-limits';

export { MAX_POST_TAGS } from './tag-limits';

export function sameTagIds(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, index) => id === right[index]);
}

export function parseTagIds(form: FormData): { ok: true; ids: number[] } | { ok: false; error: string } {
  const raw = form.getAll('tagIds');
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || value === '') continue;
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Thẻ không hợp lệ.' };
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length > MAX_POST_TAGS) return { ok: false, error: `Mỗi bài tối đa ${MAX_POST_TAGS} thẻ.` };
  }
  return { ok: true, ids };
}

/** Một query cho nhiều bài — tránh N+1 khi cần gắn thẻ lên danh sách. */
export async function listTagsByPostIds(
  db: AppDb,
  postIds: number[],
): Promise<Map<number, Array<{ id: number; name: string; slug: string }>>> {
  const map = new Map<number, Array<{ id: number; name: string; slug: string }>>();
  if (postIds.length === 0) return map;
  for (const id of postIds) map.set(id, []);
  const rows = await db
    .select({
      postId: postTags.postId,
      id: tags.id,
      name: tags.name,
      slug: tags.slug,
    })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(inArray(postTags.postId, postIds))
    .orderBy(asc(tags.name));
  for (const row of rows) {
    map.get(row.postId)?.push({ id: row.id, name: row.name, slug: row.slug });
  }
  return map;
}

export async function listPostTagIds(db: AppDb, postId: number): Promise<number[]> {
  const rows = await db
    .select({ tagId: postTags.tagId })
    .from(postTags)
    .where(eq(postTags.postId, postId))
    .orderBy(asc(postTags.tagId));
  return rows.map((row) => row.tagId);
}

export async function listPostTags(
  db: AppDb,
  postId: number,
): Promise<Array<{ id: number; name: string; slug: string }>> {
  return db
    .select({ id: tags.id, name: tags.name, slug: tags.slug })
    .from(postTags)
    .innerJoin(tags, eq(postTags.tagId, tags.id))
    .where(eq(postTags.postId, postId))
    .orderBy(asc(tags.name));
}

export async function resolveTagIds(
  db: AppDb,
  ids: number[],
): Promise<{ ok: true; ids: number[] } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true, ids: [] };
  const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.id, ids));
  if (rows.length !== ids.length) return { ok: false, error: 'Thẻ không còn tồn tại.' };
  const allowed = new Set(rows.map((row) => row.id));
  return { ok: true, ids: ids.filter((id) => allowed.has(id)) };
}

export function replacePostTagWrites(db: AppDb, postId: number, tagIds: number[]): BatchItem<'sqlite'>[] {
  const writes: BatchItem<'sqlite'>[] = [db.delete(postTags).where(eq(postTags.postId, postId))];
  if (tagIds.length > 0) {
    writes.push(db.insert(postTags).values(tagIds.map((tagId) => ({ postId, tagId }))));
  }
  return writes;
}
