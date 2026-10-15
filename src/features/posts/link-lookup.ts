import { and, desc, eq, inArray, isNull, like, ne, or } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { posts, redirects } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { classifyPostLinks, collectPostPaths, postPathFromHref, rankLinkSuggestions, type PostLinkIssue } from './links';

export async function inspectPostLinks(db: AppDb, paths: string[], currentPath: string | null): Promise<PostLinkIssue[]> {
  const unique = [...new Set(paths.map(postPathFromHref).filter((path): path is string => Boolean(path)))].slice(0, 20);
  if (unique.length === 0) return [];
  const slugs = unique.map(slugOf);
  const rows = await db
    .select({ slug: posts.slug, status: posts.status })
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
      .select({ slug: posts.slug, status: posts.status })
      .from(posts)
      .where(inArray(posts.slug, targetSlugs));
    rows.push(...targets);
  }
  const published = new Set<string>();
  const unpublished = new Set<string>();
  for (const row of rows) {
    const path = routes.knowledge(row.slug);
    if (row.status === 'published') published.add(path);
    else unpublished.add(path);
  }
  const redirectMap = new Map(redirectRows.map((row) => [row.fromPath, row.toPath]));
  return classifyPostLinks(unique, { currentPath: postPathFromHref(currentPath ?? ''), published, unpublished, redirects: redirectMap });
}

export async function suggestPosts(
  db: AppDb,
  input: { title: string; categoryId: number | null; excludeId: number | null },
): Promise<Array<{ title: string; path: string }>> {
  const excluded = input.excludeId ? ne(posts.id, input.excludeId) : undefined;
  const published = and(eq(posts.status, 'published'), excluded);
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
    .where(and(eq(posts.status, 'published'), input.excludeId ? ne(posts.id, input.excludeId) : undefined, like(posts.contentJson, `%${path}%`)))
    .limit(8);
  return rows.some((row) => collectPostPaths(row.contentJson).paths.includes(path));
}

function slugOf(path: string): string {
  return postPathFromHref(path)?.slice('/kien-thuc/'.length) ?? '';
}
