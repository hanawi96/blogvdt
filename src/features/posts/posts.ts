import { and, asc, count, desc, eq, like, ne, or } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
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
import { findRedirect, releasePathQuery, slugRedirectQueries } from '../../lib/db/redirects';
import { categories, posts } from '../../lib/db/schema';
import { collectMetaCorpus, type MetaCorpus } from '../../lib/seo/meta';
import { routes } from '../../lib/routes';
import { prepareRetirement, retirementRequired } from '../redirects/manage';
import type { UrlRetirement } from '../redirects/rules';
import { REVISION_CONFLICT, staleRevision } from './form';
import { redirectOccupiesSlug, shouldStorePostRedirect } from './redirects';
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

export async function listMetaCorpus(db: AppDb, excludeId: number | null): Promise<MetaCorpus> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      seoTitle: posts.seoTitle,
      excerpt: posts.excerpt,
      metaDescription: posts.metaDescription,
    })
    .from(posts);
  return collectMetaCorpus(rows.filter((row) => excludeId === null || row.id !== excludeId));
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
        publishedAt: posts.publishedAt,
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

export async function searchPublishedPosts(db: AppDb, query: string, excludeId: number | null = null) {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const rows = await db
    .select({ title: posts.title, slug: posts.slug })
    .from(posts)
    .where(
      and(
        eq(posts.status, 'published'),
        excludeId ? ne(posts.id, excludeId) : undefined,
        or(like(posts.title, `%${term}%`), like(posts.slug, `%${term}%`)),
      ),
    )
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
): Promise<{ ok: true; id: number; updatedAt: number } | { ok: false; error: string }> {
  const slugError = await slugAvailable(db, input.slug, null, null);
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
  return { ok: true, id, updatedAt: now };
}

export async function updatePost(
  db: AppDb,
  id: number,
  input: PostInput,
  now = Date.now(),
  actor?: ActivityActor,
  expectedUpdatedAt: number | null = null,
  retirement: UrlRetirement | null = null,
): Promise<{ ok: true; updatedAt: number } | { ok: false; error: string; conflict?: boolean }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  const action = postLogAction(current.status, input.status, postChanged(current, input));
  if (!action) return { ok: true, updatedAt: current.updatedAt };
  if (staleRevision(current.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
  const slugError = await slugAvailable(db, input.slug, id, current.slug);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(input, now, current.publishedAt);
  const pathWrites = await postPathWrites(db, current, input, now, actor, retirement);
  if (!pathWrites.ok) return pathWrites;
  const match = expectedUpdatedAt === null ? eq(posts.id, id) : and(eq(posts.id, id), eq(posts.updatedAt, expectedUpdatedAt));
  const results = await commitWrites(db, [
    db.update(posts).set(values).where(match).returning({ id: posts.id }),
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
    ...pathWrites.queries,
  ]);
  if (!changedRows(results[0])) {
    const again = await getPost(db, id);
    if (again && staleRevision(again.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
    return { ok: false, error: 'Không lưu được bài viết.' };
  }
  return { ok: true, updatedAt: now };
}

// Chỉ ghi khi dòng vẫn là nháp. Lệnh tự lưu đến muộn không được kéo bài đã xuất bản về nháp.
export async function saveDraftPost(
  db: AppDb,
  id: number,
  input: PostInput,
  now = Date.now(),
  actor?: ActivityActor,
  expectedUpdatedAt: number | null = null,
): Promise<{ ok: true; skipped: boolean; updatedAt: number } | { ok: false; error: string; conflict?: boolean }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  if (current.status !== 'draft') return { ok: true, skipped: true, updatedAt: current.updatedAt };
  const draft = { ...input, status: 'draft' as const };
  if (!postChanged(current, draft)) return { ok: true, skipped: false, updatedAt: current.updatedAt };
  if (staleRevision(current.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
  const slugError = await slugAvailable(db, input.slug, id, current.slug);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(draft, now, current.publishedAt);
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
  const match =
    expectedUpdatedAt === null
      ? and(eq(posts.id, id), eq(posts.status, 'draft'))
      : and(eq(posts.id, id), eq(posts.status, 'draft'), eq(posts.updatedAt, expectedUpdatedAt));
  const results = await commitWrites(db, [
    db.update(posts).set(values).where(match).returning({ id: posts.id }),
    ...(autosaveLog ? [autosaveLog.query] : []),
  ]);
  if (!changedRows(results[0])) {
    const again = await getPost(db, id);
    if (!again || again.status !== 'draft') return { ok: true, skipped: true, updatedAt: again?.updatedAt ?? current.updatedAt };
    if (staleRevision(again.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
    return { ok: true, skipped: true, updatedAt: again.updatedAt };
  }
  return { ok: true, skipped: false, updatedAt: now };
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

export async function deletePost(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  retirement: UrlRetirement | null = null,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: true };
  const wasPublic = current.status === 'published' || current.publishedAt !== null;
  if (wasPublic && !retirement) return { ok: false, error: retirementRequired };
  const prepared = wasPublic && retirement ? await prepareRetirement(db, routes.knowledge(current.slug), retirement, now, actor) : { ok: true as const, queries: [] as BatchItem<'sqlite'>[] };
  if (!prepared.ok) return prepared;
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
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
    ...prepared.queries,
  ]);
  return { ok: true };
}

async function postPathWrites(
  db: AppDb,
  current: { status: string; publishedAt: number | null; slug: string },
  input: PostInput,
  now: number,
  actor: ActivityActor | undefined,
  retirement: UrlRetirement | null,
): Promise<{ ok: true; queries: BatchItem<'sqlite'>[] } | { ok: false; error: string }> {
  if (current.status === 'published' && input.status !== 'published') {
    if (!retirement) return { ok: false, error: retirementRequired };
    return prepareRetirement(db, routes.knowledge(current.slug), retirement, now, actor);
  }
  if (input.status !== 'published') return { ok: true, queries: [] };
  if (shouldStorePostRedirect(current, input.slug)) {
    return { ok: true, queries: slugRedirectQueries(db, routes.knowledge(current.slug), routes.knowledge(input.slug), now) };
  }
  return { ok: true, queries: [releasePathQuery(db, routes.knowledge(input.slug))] };
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

async function slugAvailable(db: AppDb, slug: string, currentId: number | null, currentSlug: string | null = null): Promise<string | null> {
  const rows = await db.select({ id: posts.id, slug: posts.slug }).from(posts).where(eq(posts.slug, slug)).limit(1);
  if (rows[0] && rows[0].id !== currentId) return 'Slug đã được dùng.';
  let ownSlug = currentSlug;
  if (ownSlug === null && rows[0]?.id === currentId) ownSlug = rows[0].slug;
  if (ownSlug === null && currentId !== null) {
    const own = await db.select({ slug: posts.slug }).from(posts).where(eq(posts.id, currentId)).limit(1);
    ownSlug = own[0]?.slug ?? null;
  }
  if (ownSlug === slug) return null;
  const row = await findRedirect(db, routes.knowledge(slug));
  const occupied = !row || row.enabled !== 1 ? null : row.statusCode === 410 ? routes.knowledge(slug) : row.toPath || null;
  if (redirectOccupiesSlug(ownSlug ? routes.knowledge(ownSlug) : null, occupied)) return 'Slug đã được dùng cho một đường dẫn cũ.';
  return null;
}
