import { and, asc, count, desc, eq, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { alias } from 'drizzle-orm/sqlite-core';
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
import { categories, adminUsers, posts } from '../../lib/db/schema';
import { collectMetaCorpus, type MetaCorpus } from '../../lib/seo/meta';
import { routes } from '../../lib/routes';
import { prepareRetirement, retirementRequired } from '../redirects/manage';
import type { UrlRetirement } from '../redirects/rules';
import { REVISION_CONFLICT, staleRevision } from './form';
import {
  listPostCategoryIds,
  primaryCategoryId,
  replacePostCategoryWrites,
  resolveCategoryIds,
} from './post-categories';
import { redirectOccupiesSlug, shouldStorePostRedirect } from './redirects';
import { slugify } from './slug';
import type { PostStatus } from './status';
import { notTrashed } from './visibility';

export type PostListFilter = PostStatus | 'trash' | '';

const PAGE_SIZE = 20;

export type PostListSort = 'newest' | 'oldest';

export function statusTotals(rows: { status: string; trashed: number; value: number }[]) {
  let draft = 0;
  let published = 0;
  let trash = 0;
  for (const row of rows) {
    if (row.trashed) trash += row.value;
    else if (row.status === 'draft') draft += row.value;
    else if (row.status === 'published') published += row.value;
  }
  return { all: draft + published, draft, published, trash };
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
    .from(posts)
    .where(notTrashed());
  return collectMetaCorpus(rows.filter((row) => excludeId === null || row.id !== excludeId));
}

export function copyTitle(title: string): string {
  const suffix = ' (bản sao)';
  return `${title.trim().slice(0, 180 - suffix.length)}${suffix}`;
}

export type PostInput = {
  title: string;
  slug: string;
  categoryIds: number[];
  coverMediaId: number | null;
  contentJson: string;
  excerpt: string;
  seoTitle: string | null;
  metaDescription: string | null;
  status: PostStatus;
};

export async function listPosts(
  db: AppDb,
  filters: { query: string; status: PostListFilter; page: number; sort?: PostListSort },
) {
  const term = filters.query.replace(/[%_]/g, '').trim().slice(0, 180);
  const trashedFlag = sql<number>`case when ${posts.deletedAt} is null then 0 else 1 end`;
  const author = alias(adminUsers, 'post_author');
  const conditions = [filters.status === 'trash' ? isNotNull(posts.deletedAt) : notTrashed()];
  if (filters.status && filters.status !== 'trash') conditions.push(eq(posts.status, filters.status));
  if (term) conditions.push(like(posts.title, `%${term}%`));
  const where = and(...conditions);
  const page = Math.max(1, filters.page);
  const sort: PostListSort = filters.sort === 'oldest' ? 'oldest' : 'newest';
  const [totalRows, countRows, libraryRows, rows] = await Promise.all([
    db.select({ value: count() }).from(posts).where(where),
    db
      .select({ status: posts.status, trashed: trashedFlag, value: count() })
      .from(posts)
      .where(term ? like(posts.title, `%${term}%`) : undefined)
      .groupBy(posts.status, trashedFlag),
    term ? db.select({ value: count() }).from(posts).where(and(like(posts.title, `%${term}%`), notTrashed())) : Promise.resolve([]),
    db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        status: posts.status,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
        deletedAt: posts.deletedAt,
        deletedByName: adminUsers.displayName,
        authorName: author.displayName,
        authorUsername: author.username,
        categoryId: posts.categoryId,
        categoryName: categories.name,
      })
      .from(posts)
      .leftJoin(categories, eq(posts.categoryId, categories.id))
      .leftJoin(adminUsers, eq(posts.deletedBy, adminUsers.id))
      .leftJoin(author, eq(posts.authorId, author.id))
      .where(where)
      .orderBy(
        ...(filters.status === 'trash'
          ? [desc(posts.deletedAt), desc(posts.id)]
          : [sort === 'oldest' ? asc(posts.updatedAt) : desc(posts.updatedAt), desc(posts.id)]),
      )
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
    .select({ id: posts.id, title: posts.title, slug: posts.slug })
    .from(posts)
    .where(
      and(
        eq(posts.status, 'published'),
        isNull(posts.deletedAt),
        excludeId ? ne(posts.id, excludeId) : undefined,
        or(like(posts.title, `%${term}%`), like(posts.slug, `%${term}%`)),
      ),
    )
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(8);
  return rows.map((row) => ({ id: row.id, title: row.title, path: routes.knowledge(row.slug) }));
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
  const categoriesOk = await resolveCategoryIds(db, input.categoryIds);
  if (!categoriesOk.ok) return categoriesOk;
  const payload = { ...input, categoryIds: categoriesOk.ids };
  const slugError = await slugAvailable(db, payload.slug, null, null);
  if (slugError) return { ok: false, error: slugError };
  const action = payload.status === 'published' ? 'post.publish' : 'post.create';
  await commitWrites(db, [
    db.insert(posts).values({ ...postValues(payload, now), authorId: actor?.id ?? null, createdAt: now }),
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
              summary: postSummary(action, payload.title),
              createdAt: now,
              useLastInsertId: true,
            },
            true,
          ),
        ]
      : []),
  ]);
  const inserted = await db.select({ id: posts.id }).from(posts).where(eq(posts.slug, payload.slug)).limit(1);
  const id = inserted[0]?.id;
  if (!id) return { ok: false, error: 'Không lưu được bài viết.' };
  if (payload.categoryIds.length > 0) {
    await commitWrites(db, replacePostCategoryWrites(db, id, payload.categoryIds));
  }
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
  if (current.deletedAt != null) return { ok: false, error: 'Bài đang ở thùng rác. Hãy khôi phục trước khi sửa.' };
  const categoriesOk = await resolveCategoryIds(db, input.categoryIds);
  if (!categoriesOk.ok) return categoriesOk;
  const payload = { ...input, categoryIds: categoriesOk.ids };
  const currentCats = await listPostCategoryIds(db, id);
  const action = postLogAction(
    current.status,
    payload.status,
    postChanged({ ...current, categoryIds: currentCats }, payload),
  );
  if (!action) return { ok: true, updatedAt: current.updatedAt };
  if (staleRevision(current.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
  const slugError = await slugAvailable(db, payload.slug, id, current.slug);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(payload, now, current.publishedAt);
  const pathWrites = await postPathWrites(db, current, payload, now, actor, retirement);
  if (!pathWrites.ok) return pathWrites;
  const match = and(eq(posts.id, id), isNull(posts.deletedAt), expectedUpdatedAt === null ? undefined : eq(posts.updatedAt, expectedUpdatedAt));
  const results = await commitWrites(db, [
    db.update(posts).set(values).where(match).returning({ id: posts.id }),
    ...replacePostCategoryWrites(db, id, payload.categoryIds),
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
              summary: postSummary(action, payload.title),
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
  if (current.deletedAt != null) return { ok: false, error: 'Bài đang ở thùng rác. Hãy khôi phục trước khi sửa.' };
  if (current.status !== 'draft') return { ok: true, skipped: true, updatedAt: current.updatedAt };
  const categoriesOk = await resolveCategoryIds(db, input.categoryIds);
  if (!categoriesOk.ok) return categoriesOk;
  const draft = { ...input, categoryIds: categoriesOk.ids, status: 'draft' as const };
  const currentCats = await listPostCategoryIds(db, id);
  if (!postChanged({ ...current, categoryIds: currentCats }, draft)) {
    return { ok: true, skipped: false, updatedAt: current.updatedAt };
  }
  if (staleRevision(current.updatedAt, expectedUpdatedAt)) return { ok: false, error: REVISION_CONFLICT, conflict: true };
  const slugError = await slugAvailable(db, draft.slug, id, current.slug);
  if (slugError) return { ok: false, error: slugError };
  const values = postValues(draft, now, current.publishedAt);
  const entry = {
    actorId: actor?.id ?? 0,
    actorName: actor?.name ?? '',
    action: 'post.update' as const,
    objectType: 'post' as const,
    objectId: String(id),
    summary: postSummary('post.update', draft.title),
    createdAt: now,
  };
  const autosaveLog = actor ? await autosaveLogWrite(db, entry, id) : null;
  const match = and(
    eq(posts.id, id),
    eq(posts.status, 'draft'),
    isNull(posts.deletedAt),
    expectedUpdatedAt === null ? undefined : eq(posts.updatedAt, expectedUpdatedAt),
  );
  const results = await commitWrites(db, [
    db.update(posts).set(values).where(match).returning({ id: posts.id }),
    ...replacePostCategoryWrites(db, id, draft.categoryIds),
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
  if (current.deletedAt != null) return { ok: false, error: 'Bài đang ở thùng rác. Hãy khôi phục trước khi sao chép.' };
  const slug = await unusedCopySlug(db, current.slug);
  if (!slug) return { ok: false, error: 'Không tạo được đường dẫn cho bản sao.' };
  const categoryIds = await listPostCategoryIds(db, id);
  return createPost(
    db,
    {
      title: copyTitle(current.title),
      slug,
      categoryIds,
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

export async function setPostCategory(
  db: AppDb,
  id: number,
  categoryId: number | null,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true; categoryName: string | null } | { ok: false; status: 404 | 409 | 422; error: string }> {
  const categoryIds = categoryId === null ? [] : [categoryId];
  const [postRows, resolved, currentCats] = await Promise.all([
    db.select({ title: posts.title, deletedAt: posts.deletedAt }).from(posts).where(eq(posts.id, id)).limit(1),
    resolveCategoryIds(db, categoryIds),
    listPostCategoryIds(db, id),
  ]);
  const post = postRows[0];
  if (!post) return { ok: false, status: 404, error: 'Không tìm thấy bài viết.' };
  if (post.deletedAt != null) return { ok: false, status: 409, error: 'Bài đang ở thùng rác.' };
  if (!resolved.ok) return { ok: false, status: 422, error: resolved.error };
  const nextIds = resolved.ids;
  const categoryName =
    nextIds.length === 0
      ? null
      : ((await db.select({ name: categories.name }).from(categories).where(eq(categories.id, nextIds[0]!)).limit(1))[0]?.name ?? null);
  if (sameSorted(currentCats, nextIds) && primaryCategoryId(currentCats) === primaryCategoryId(nextIds)) {
    return { ok: true, categoryName };
  }
  const results = await commitWrites(db, [
    db
      .update(posts)
      .set({ categoryId: primaryCategoryId(nextIds), updatedAt: now })
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .returning({ id: posts.id }),
    ...replacePostCategoryWrites(db, id, nextIds),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'post.update',
              objectType: 'post',
              objectId: String(id),
              summary: postSummary('post.update', post.title),
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  if (!changedRows(results[0])) return { ok: false, status: 409, error: 'Không đổi được danh mục.' };
  return { ok: true, categoryName };
}

function sameSorted(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((id, index) => id === right[index]);
}

export async function trashPost(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  retirement: UrlRetirement | null = null,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  if (current.deletedAt != null) return { ok: true };
  const wasPublic = current.status === 'published' || current.publishedAt !== null;
  if (wasPublic && !retirement) return { ok: false, error: retirementRequired };
  const prepared = wasPublic && retirement ? await prepareRetirement(db, routes.knowledge(current.slug), retirement, now, actor) : { ok: true as const, queries: [] as BatchItem<'sqlite'>[] };
  if (!prepared.ok) return prepared;
  const results = await commitWrites(db, [
    db
      .update(posts)
      .set({ deletedAt: now, deletedBy: actor?.id ?? null, updatedAt: now })
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .returning({ id: posts.id }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'post.trash',
              objectType: 'post',
              objectId: String(id),
              summary: postSummary('post.trash', current.title),
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
    ...prepared.queries,
  ]);
  if (!changedRows(results[0])) {
    const again = await getPost(db, id);
    if (again?.deletedAt != null) return { ok: true };
    return { ok: false, error: 'Không chuyển được bài vào thùng rác.' };
  }
  return { ok: true };
}

export async function restorePost(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  if (current.deletedAt == null) return { ok: false, error: 'Bài không ở trong thùng rác.' };
  const redirect = await findRedirect(db, routes.knowledge(current.slug));
  if (redirect?.enabled === 1) {
    return { ok: false, error: 'Đường dẫn này đang có chuyển hướng. Hãy xóa chuyển hướng trước khi khôi phục.' };
  }
  const results = await commitWrites(db, [
    db
      .update(posts)
      .set({ status: 'draft', deletedAt: null, deletedBy: null, updatedAt: now })
      .where(and(eq(posts.id, id), isNotNull(posts.deletedAt)))
      .returning({ id: posts.id }),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'post.restore',
              objectType: 'post',
              objectId: String(id),
              summary: postSummary('post.restore', current.title),
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  if (!changedRows(results[0])) return { ok: false, error: 'Không khôi phục được bài viết.' };
  return { ok: true };
}

export async function purgePost(
  db: AppDb,
  id: number,
  actor: ActivityActor | undefined,
  role: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (role !== 'admin') return { ok: false, error: 'Chỉ quản trị mới được xóa vĩnh viễn.' };
  const current = await getPost(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy bài viết.' };
  if (current.deletedAt == null) return { ok: false, error: 'Chỉ xóa vĩnh viễn bài đang ở thùng rác.' };
  const results = await commitWrites(db, [
    db.delete(posts).where(and(eq(posts.id, id), isNotNull(posts.deletedAt))).returning({ id: posts.id }),
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
  ]);
  if (!changedRows(results[0])) return { ok: false, error: 'Không xóa được bài viết.' };
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
    categoryId: primaryCategoryId(input.categoryIds),
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
