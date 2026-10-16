import { and, desc, eq, inArray, isNull, like, ne, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { posts, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import {
  catalogLinkMatch,
  classifyPostLinks,
  collectPostPaths,
  postLinkCounts,
  postPathFromHref,
  rankLinkSuggestions,
  type InternalLinkHit,
  type PostLinkCount,
  type PostLinkIssue,
} from './links';
import { searchActiveProducts } from './product-cards';
import { searchPublishedPosts } from './posts';
import { livePublished } from './visibility';

export async function inspectPostLinks(db: AppDb, paths: string[], currentPath: string | null): Promise<PostLinkIssue[]> {
  const unique = [...new Set(paths.map(postPathFromHref).filter((path): path is string => Boolean(path)))].slice(0, 20);
  if (unique.length === 0) return [];
  const slugs = unique.map(slugOf);
  const rows = await db
    .select({ slug: posts.slug, status: posts.status, deletedAt: posts.deletedAt })
    .from(posts)
    .where(inArray(posts.slug, slugs));
  const redirectRows = await db
    .select({ fromPath: redirects.fromPath, toPath: redirects.toPath })
    .from(redirects)
    .where(and(inArray(redirects.fromPath, unique), eq(redirects.enabled, 1), inArray(redirects.statusCode, [301, 302])));
  const known = new Set(slugs);
  const targetSlugs = redirectRows.map((row) => slugOf(row.toPath)).filter((slug) => slug.length > 0 && !known.has(slug));
  if (targetSlugs.length > 0) {
    const targets = await db
      .select({ slug: posts.slug, status: posts.status, deletedAt: posts.deletedAt })
      .from(posts)
      .where(inArray(posts.slug, targetSlugs));
    rows.push(...targets);
  }
  const published = new Set<string>();
  const unpublished = new Set<string>();
  for (const row of rows) {
    const path = routes.knowledge(row.slug);
    if (row.status === 'published' && row.deletedAt == null) published.add(path);
    else unpublished.add(path);
  }
  const redirectMap = new Map(redirectRows.map((row) => [row.fromPath, row.toPath]));
  return classifyPostLinks(unique, { currentPath: postPathFromHref(currentPath ?? ''), published, unpublished, redirects: redirectMap });
}

/** Tìm URL nội bộ để chèn link: bài đã XB + SP đang bán + trang catalog. */
export async function searchInternalLinks(
  db: AppDb,
  query: string,
  excludePostId: number | null = null,
): Promise<InternalLinkHit[]> {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const [postsFound, productsFound] = await Promise.all([
    searchPublishedPosts(db, term, excludePostId),
    searchActiveProducts(db, term),
  ]);
  const out: InternalLinkHit[] = [];
  const catalog = catalogLinkMatch(term);
  if (catalog) out.push(catalog);
  for (const row of postsFound) out.push({ title: row.title, path: row.path, kind: 'post' });
  for (const row of productsFound) out.push({ title: row.name, path: row.path, kind: 'product' });
  return out.slice(0, 12);
}

export async function suggestPosts(
  db: AppDb,
  input: { title: string; categoryId: number | null; excludeId: number | null },
): Promise<Array<{ title: string; path: string }>> {
  const excluded = input.excludeId ? ne(posts.id, input.excludeId) : undefined;
  const published = and(livePublished(), excluded);
  const columns = { title: posts.title, slug: posts.slug };
  const order = [desc(posts.publishedAt), desc(posts.id)] as const;
  const [same, others] = await Promise.all([
    input.categoryId
      ? db
          .select(columns)
          .from(posts)
          .where(and(published, eq(posts.categoryId, input.categoryId)))
          .orderBy(...order)
          .limit(8)
      : Promise.resolve([]),
    db
      .select(columns)
      .from(posts)
      .where(input.categoryId ? and(published, or(ne(posts.categoryId, input.categoryId), isNull(posts.categoryId))) : published)
      .orderBy(...order)
      .limit(8),
  ]);
  return rankLinkSuggestions(
    [
      ...same.map((row) => ({ title: row.title, path: routes.knowledge(row.slug), sameCategory: true })),
      ...others.map((row) => ({ title: row.title, path: routes.knowledge(row.slug), sameCategory: false })),
    ],
    input.title,
  );
}

export async function hasInboundPostLink(db: AppDb, input: { path: string; excludeId: number | null }): Promise<boolean> {
  const path = postPathFromHref(input.path);
  if (!path) return false;
  const rows = await db
    .select({ contentJson: posts.contentJson })
    .from(posts)
    .where(and(livePublished(), input.excludeId ? ne(posts.id, input.excludeId) : undefined, like(posts.contentJson, `%${path}%`)))
    .limit(8);
  return rows.some((row) => collectPostPaths(row.contentJson).paths.includes(path));
}

// Chỉ đọc bài của trang đang xem và bài xuất bản có chứa đường dẫn của chúng. LIKE lọc thô, parse JSON xác nhận.
export async function listPostLinkCounts(db: AppDb, rows: ReadonlyArray<{ id: number; slug: string }>): Promise<Map<number, PostLinkCount>> {
  if (rows.length === 0) return new Map();
  const mentions = rows.map((row) => like(posts.contentJson, `%${routes.knowledge(row.slug)}%`));
  const [page, sources] = await Promise.all([
    db
      .select({ id: posts.id, slug: posts.slug, contentJson: posts.contentJson })
      .from(posts)
      .where(inArray(posts.id, rows.map((row) => row.id))),
    db
      .select({ id: posts.id, contentJson: posts.contentJson })
      .from(posts)
      .where(and(livePublished(), or(...mentions))),
  ]);
  return postLinkCounts(page, sources);
}

function slugOf(path: string): string {
  return postPathFromHref(path)?.slice('/kien-thuc/'.length) ?? '';
}
