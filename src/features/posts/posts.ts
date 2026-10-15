import { and, asc, count, desc, eq, like } from 'drizzle-orm';
import {
  activityWrite,
  autosaveLogWrite,
  changedRows,
  commitWrites,
  postChanged,
  postLogAction,
  postSummary,
  type ActivityActor,
} from '../activity/log';
import type { AppDb } from '../../lib/db/client';
import { slugRedirectQueries } from '../../lib/db/redirects';
import { categories, posts } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { shouldStorePostRedirect } from './redirects';
import { slugify } from './slug';
import type { PostStatus } from './status';

const PAGE_SIZE = 20;

export type PostListSort = 'newest' | 'oldest';

export function statusTotals(rows: { status: string; value: number }[]) {
  let draft = 0;
  let published = 0;
  for (const row of rows) {
    if (row.status === 'draft') draft = row.value;
    if (row.status === 'published') published = row.value;
  }
  return { all: draft + published, draft, published };
}

export function copyTitle(title: string): string {
  const suffix = ' (bản sao)';
  return `${title.trim().slice(0, 180 - suffix.length)}${suffix}`;
}

export type PostInput = {
  title: string;
  slug: string;
  categoryId: number | null;
  coverMediaId: number | null;
  contentJson: string;
  excerpt: string;
  seoTitle: string | null;
  metaDescription: string | null;
  status: PostStatus;
};

export async function listPosts(
  db: AppDb,
  filters: { query: string; status: PostStatus | ''; page: number; sort?: PostListSort },
) {
  const term = filters.query.replace(/[%_]/g, '').trim().slice(0, 180);
  const conditions = [];
  if (filters.status) conditions.push(eq(posts.status, filters.status));
  if (term) conditions.push(like(posts.title, `%${term}%`));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const page = Math.max(1, filters.page);
  const sort: PostListSort = filters.sort === 'oldest' ? 'oldest' : 'newest';
  const [totalRows, countRows, libraryRows, rows] = await Promise.all([
    db.select({ value: count() }).from(posts).where(where),
    db
      .select({ status: posts.status, value: count() })
      .from(posts)
      .where(term ? like(posts.title, `%${term}%`) : undefined)
      .groupBy(posts.status),
    term ? db.select({ value: count() }).from(posts) : Promise.resolve([]),
    db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        status: posts.status,
        updatedAt: posts.updatedAt,
        categoryName: categories.name,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))
      .where(where)
      .orderBy(sort === 'oldest' ? asc(posts.updatedAt) : desc(posts.updatedAt), desc(posts.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const total = totalRows[0]?.value ?? 0;
  const counts = statusTotals(countRows);
  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    sort,
    counts,
    libraryTotal: term ? (libraryRows[0]?.value ?? 0) : counts.all,
  };
}

export async function searchPublishedPosts(db: AppDb, query: string) {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const rows = await db
    .select({ title: posts.title, slug: posts.slug })
    .from(posts)
    .where(and(eq(posts.status, 'published'), like(posts.title, `%${term}%`)))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(8);
  return rows.map((row) => ({ title: row.title, path: routes.knowledge(row.slug) }));
}

export async function slugIsTaken(db: AppDb, slug: string, currentId: number | null): Promise<boolean> {
  return (await slugAvailable(db, slug, currentId)) !== null;
}

export async function getPost(db: AppDb, id: number) {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createPost(
  db: AppDb,
  input: PostInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const slugError = await slugAvailable(db, input.slug, null);
  if (slugError) return { ok: false, error: slugError };
  const action = input.status === 'published' ? 'post.publish' : 'post.create';
  await commitWrites(db, [
    db.insert(posts).values({ ...postValues(input, now), createdAt: now }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action,
              objectType: 'post',
              objectId: null,
              summary: postSummary(action, input.title),
              createdAt: now,
              useLastInsertId: true,
            },
            true,
          ),
        ]
      : []),
  ]);
  const inserted = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, input.slug)).limit(1);
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được bài viết.' };
  return { ok: true, id };
}

export async function updatePost(
  db: AppDb,
  id: number,
  input: PostInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  const action = postLogAction(current.status, input.status, postChanged(current, input));
  if (!action) return { ok: true };
  const slugError = await slugAvailable(db, input.slug, id);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(input, now, current.publishedAt);
  const redirect = shouldStorePostRedirect(current, input.slug)
    ? slugRedirectQueries(db, routes.knowledge(current.slug), routes.knowledge(input.slug), now)
    : [];
  await commitWrites(db, [
    db.update(posts).set(values).where(eq(posts.id, id)).returning({ id: posts.id }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action,
              objectType: 'post',
              objectId: String(id),
              summary: postSummary(action, input.title),
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
    ...redirect,
  ]);
  return { ok: true };
}

// Chỉ ghi khi dòng vẫn là nháp. Lệnh tự lưu đến muộn không được kéo bài đã xuất bản về nháp.
export async function saveDraftPost(
  db: AppDb,
  id: number,
  input: PostInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; skipped: boolean } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  if (current.status !== 'draft') return { ok: true, skipped: true };
  const draft = { ...input, status: 'draft' as const };
  if (!postChanged(current, draft)) return { ok: true, skipped: false };
  const slugError = await slugAvailable(db, input.slug, id);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(draft, now, current.publishedAt);
  const redirect = shouldStorePostRedirect(current, input.slug)
    ? slugRedirectQueries(db, routes.knowledge(current.slug), routes.knowledge(input.slug), now)
    : [];
  const entry = {
    actorId: actor?.id ?? 0,
    actorName: actor?.name ?? '',
    action: 'post.update' as const,
    objectType: 'post' as const,
    objectId: String(id),
    summary: postSummary('post.update', input.title),
    createdAt: now,
  };
  const autosaveLog = actor ? await autosaveLogWrite(db, entry, id) : null;
  const results = await commitWrites(db, [
    db.update(posts).set(values).where(and(eq(posts.id, id), eq(posts.status, 'draft'))).returning({ id: posts.id }),
    ...(autosaveLog ? [autosaveLog.query] : []),
    ...redirect,
  ]);
  if (!changedRows(results[0])) return { ok: true, skipped: true };
  return { ok: true, skipped: false };
}

export async function duplicatePost(
  db: AppDb,
  id: number,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  const slug = await unusedCopySlug(db, current.slug);
  if (!slug) return { ok: false, error: 'Không tạo được đường dẫn cho bản sao.' };
  return createPost(
    db,
    {
      title: copyTitle(current.title),
      slug,
      categoryId: current.categoryId,
      coverMediaId: current.coverMediaId,
      contentJson: current.contentJson,
      excerpt: current.excerpt,
      seoTitle: current.seoTitle,
      metaDescription: current.metaDescription,
      status: 'draft',
    },
    now,
    actor,
  );
}

async function unusedCopySlug(db: AppDb, base: string): Promise<string | null> {
  const stem = slugify(`${base}-ban-sao`) || 'ban-sao';
  for (let n = 1; n <= 20; n += 1) {
    const slug = n === 1 ? stem : slugify(`${stem}-${n}`);
    if (slug && !(await slugIsTaken(db, slug, null))) return slug;
  }
  return null;
}

export async function deletePost(db: AppDb, id: number, actor?: ActivityActor): Promise<void> {
  const current = await getPost(db, id);
  if (!current) return;
  await commitWrites(db, [
    db.delete(posts).where(eq(posts.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'post.delete',
              objectType: 'post',
              objectId: String(id),
              summary: postSummary('post.delete', current.title),
              createdAt: Date.now(),
            },
            true,
          ),
        ]
      : []),
  ]);
}

function postValues(input: PostInput, now: number, previousPublishedAt: number | null = null) {
  const publishedAt = input.status === 'published' ? (previousPublishedAt ?? now) : previousPublishedAt;
  return {
    title: input.title,
    slug: input.slug,
    categoryId: input.categoryId,
    coverMediaId: input.coverMediaId,
    contentJson: input.contentJson,
    excerpt: input.excerpt,
    seoTitle: input.seoTitle,
    metaDescription: input.metaDescription,
    status: input.status,
    publishedAt,
    updatedAt: now,
  };
}

async function slugAvailable(db: AppDb, slug: string, currentId: number | null): Promise<string | null> {
  const rows = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).limit(1);
  if (rows[0] && rows[0].id !== currentId) return 'Slug đã được dùng.';
  return null;
}
