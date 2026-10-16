import { and, asc, count, desc, eq, gt, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { runBatch } from '../../lib/db/batch';
import type { AppDb } from '../../lib/db/client';
import { listRedirectPaths } from '../../lib/db/redirects';
import { categories, media, posts, seoHealthIssues, seoHealthLinks, seoHealthPosts, seoHealthRuns, tags } from '../../lib/db/schema';
import { collectMetaCorpus, mergeMetaCorpus, siteListCorpus, type MetaCorpus } from '../../lib/seo/meta';
import { routes } from '../../lib/routes';
import { mediaKeyFromPublicUrl } from '../media/files';
import { collectPostPaths } from '../posts/links';
import { livePublished } from '../posts/visibility';
import { inspectPostLinks } from '../posts/link-lookup';
import { SLUG_PATTERN } from '../posts/slug';
import {
  INBOUND_BATCH,
  HEALTH_BATCH,
  HEALTH_PAGE_SIZE,
  assessPost,
  collectContentImages,
  healthFigures,
  inboundIssues,
  isHealthPhase,
  pageWindow,
  shouldContinue,
  siteHealthIssues,
  type HealthCover,
  type HealthDraft,
  type HealthFilters,
  type HealthImage,
  type HealthPhase,
  type HealthSeverity,
} from './health';

type HealthBucket = { head(key: string): Promise<unknown> };

type HealthRun = {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  phase: HealthPhase;
  cursor: number;
  linksTruncated: boolean;
};

type MetaRow = {
  id: number;
  title: string;
  seoTitle: string | null;
  excerpt: string;
  metaDescription: string | null;
};

type ScanContext = {
  metaRows: MetaRow[];
  categoryCorpus: MetaCorpus;
  blocked: Set<string>;
};

type RunPatch = {
  phase?: HealthPhase;
  cursor?: number;
  finishedAt?: number | null;
  linksTruncated?: number;
};

export type HealthSnapshot = {
  run: { id: number; phase: HealthPhase; startedAt: number; finishedAt: number | null } | null;
  published: number;
  verified: number;
  unchecked: number;
  stale: number;
  uncheckedPosts: { id: number; title: string }[];
  stalePosts: { id: number; title: string }[];
  errors: number;
  warnings: number;
  issues: { id: number; postId: number | null; postTitle: string; severity: HealthSeverity; code: string; detail: string }[];
  total: number;
  page: number;
  pageCount: number;
  postOptions: { id: number; title: string }[];
  figures: ReturnType<typeof healthFigures>;
};

const HEAD_CAP = 16;

export async function advanceHealthRun(
  db: AppDb,
  input: { mode: 'start' | 'continue'; origin: string; now: number; bucket: HealthBucket | null },
): Promise<{ finished: boolean; steps: number }> {
  let createdId: number | null = null;
  let current: HealthRun | null = null;
  if (input.mode === 'start') {
    const previous = await latestRun(db);
    const inserted = await db
      .insert(seoHealthRuns)
      .values({ startedAt: input.now, finishedAt: null, phase: 'posts', cursor: 0, linksTruncated: 0 })
      .returning({ id: seoHealthRuns.id });
    const id = inserted[0]?.id;
    if (!id) throw new Error('seo_health_run_missing');
    createdId = id;
    if (previous && previous.phase !== 'done') await deleteRun(db, previous.id);
    current = { id, startedAt: input.now, finishedAt: null, phase: 'posts', cursor: 0, linksTruncated: false };
  } else {
    current = await latestRun(db);
    if (!current) return { finished: false, steps: 0 };
    if (current.phase === 'done') return { finished: true, steps: 0 };
  }

  let context: ScanContext | null = null;
  const started = Date.now();
  let steps = 0;
  try {
    while (current.phase !== 'done' && shouldContinue(started, Date.now(), steps)) {
      const mark = `${current.phase}:${current.cursor}`;
      const next = await runStep(db, current, {
        origin: input.origin,
        now: input.now,
        bucket: input.bucket,
        context: async () => {
          if (!context) context = await loadScanContext(db);
          return context;
        },
      });
      current = next;
      steps += 1;
      if (`${current.phase}:${current.cursor}` === mark && current.phase !== 'done') throw new Error('seo_health_stall');
      if (current.phase === 'done') {
        await deleteOtherRuns(db, current.id);
        break;
      }
    }
  } catch (error) {
    if (steps === 0 && createdId !== null) {
      try {
        await deleteRun(db, createdId);
      } catch (cleanup) {
        console.error(JSON.stringify({ event: 'seo_health_cleanup_failed', name: cleanup instanceof Error ? cleanup.name : 'unknown' }));
      }
    }
    throw error;
  }
  return { finished: current.phase === 'done', steps };
}

export async function loadHealth(db: AppDb, filters: HealthFilters): Promise<HealthSnapshot> {
  const run = await latestRun(db);
  const published = await countPosts(db, livePublished());
  if (!run) {
    const uncheckedPosts = await db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(livePublished())
      .orderBy(asc(posts.id))
      .limit(8);
    return emptySnapshot(published, uncheckedPosts);
  }

  const visible = and(
    eq(seoHealthIssues.runId, run.id),
    sql`(${seoHealthIssues.postId} is null or exists (select 1 from posts where posts.id = ${seoHealthIssues.postId} and posts.status = 'published' and posts.deleted_at is null))`,
  );
  const listWhere = and(
    visible,
    filters.severity ? eq(seoHealthIssues.severity, filters.severity) : undefined,
    filters.code ? eq(seoHealthIssues.code, filters.code) : undefined,
    filters.postId ? eq(seoHealthIssues.postId, filters.postId) : undefined,
  );
  const [totals, totalRows, unchecked, stale, verified] = await Promise.all([
    db.select({ severity: seoHealthIssues.severity, value: count() }).from(seoHealthIssues).where(visible).groupBy(seoHealthIssues.severity),
    db.select({ value: count() }).from(seoHealthIssues).where(listWhere),
    countPosts(db, and(livePublished(), missingRun(run.id))),
    countPosts(db, and(livePublished(), gt(posts.updatedAt, run.startedAt), inThisRun(run.id))),
    countPosts(db, and(livePublished(), lte(posts.updatedAt, run.startedAt), inThisRun(run.id))),
  ]);
  const errors = totals.find((item) => item.severity === 'error')?.value ?? 0;
  const warnings = totals.find((item) => item.severity === 'warning')?.value ?? 0;
  const total = totalRows[0]?.value ?? 0;
  const window = pageWindow(total, filters.page, HEALTH_PAGE_SIZE);
  const [issueRows, uncheckedPosts, stalePosts, optionRows] = await Promise.all([
    db
      .select({
        id: seoHealthIssues.id,
        postId: seoHealthIssues.postId,
        postTitle: seoHealthIssues.postTitle,
        severity: seoHealthIssues.severity,
        code: seoHealthIssues.code,
        detail: seoHealthIssues.detail,
      })
      .from(seoHealthIssues)
      .where(listWhere)
      .orderBy(sql`case ${seoHealthIssues.severity} when 'error' then 0 else 1 end`, asc(seoHealthIssues.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(and(livePublished(), missingRun(run.id)))
      .orderBy(asc(posts.id))
      .limit(8),
    db
      .select({ id: posts.id, title: posts.title })
      .from(posts)
      .where(and(livePublished(), gt(posts.updatedAt, run.startedAt), inThisRun(run.id)))
      .orderBy(asc(posts.id))
      .limit(8),
    db
      .select({ id: seoHealthIssues.postId, title: seoHealthIssues.postTitle })
      .from(seoHealthIssues)
      .where(and(visible, sql`${seoHealthIssues.postId} is not null`))
      .groupBy(seoHealthIssues.postId, seoHealthIssues.postTitle)
      .orderBy(asc(seoHealthIssues.postTitle))
      .limit(100),
  ]);

  return {
    run: { id: run.id, phase: run.phase, startedAt: run.startedAt, finishedAt: run.finishedAt },
    published,
    verified,
    unchecked,
    stale,
    uncheckedPosts,
    stalePosts,
    errors,
    warnings,
    issues: issueRows.map((issue) => ({
      id: issue.id,
      postId: issue.postId,
      postTitle: issue.postTitle,
      severity: issue.severity === 'error' ? 'error' : 'warning',
      code: issue.code,
      detail: issue.detail,
    })),
    total,
    page: window.page,
    pageCount: window.pageCount,
    postOptions: optionRows.flatMap((option) => (option.id === null ? [] : [{ id: option.id, title: option.title }])),
    figures: healthFigures({ failed: false, hasRun: true, errors, warnings, verified, pending: unchecked + stale }),
  };
}

async function runStep(
  db: AppDb,
  run: HealthRun,
  input: { origin: string; now: number; bucket: HealthBucket | null; context: () => Promise<ScanContext> },
): Promise<HealthRun> {
  if (run.phase === 'posts') return scanPosts(db, run, input);
  if (run.phase === 'links') return scanLinks(db, run);
  return scanInbound(db, run, input.now);
}

async function scanPosts(
  db: AppDb,
  run: HealthRun,
  input: { origin: string; now: number; bucket: HealthBucket | null; context: () => Promise<ScanContext> },
): Promise<HealthRun> {
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      seoTitle: posts.seoTitle,
      metaDescription: posts.metaDescription,
      contentJson: posts.contentJson,
      coverMediaId: posts.coverMediaId,
      coverKey: media.r2Key,
      coverAlt: media.altText,
    })
    .from(posts)
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(and(livePublished(), gt(posts.id, run.cursor)))
    .orderBy(asc(posts.id))
    .limit(HEALTH_BATCH);
  if (rows.length === 0) {
    const issues = run.cursor === 0 ? siteHealthIssues({ origin: input.origin, filesReady: Boolean(input.bucket) }) : [];
    const patch = { phase: 'links' as const, cursor: 0 };
    await commit(db, run.id, { issues, patch });
    return apply(run, patch);
  }

  const context = await input.context();
  const prepared = rows.map((row) => ({ row, content: collectContentImages(row.contentJson) }));
  const keys = new Set<string>();
  for (const item of prepared) {
    for (const image of item.content.images) {
      const key = mediaKeyFromPublicUrl(image.src);
      if (key) keys.add(key);
    }
  }
  const known = new Set<string>();
  if (keys.size > 0) {
    const found = await db.select({ key: media.r2Key }).from(media).where(inArray(media.r2Key, [...keys]));
    for (const item of found) known.add(item.key);
  }
  const fileState = headCache(input.bucket);
  const issues: HealthDraft[] = [];
  if (run.cursor === 0) issues.push(...siteHealthIssues({ origin: input.origin, filesReady: Boolean(input.bucket) }));
  for (const item of prepared) {
    const row = item.row;
    const currentPath = SLUG_PATTERN.test(row.slug) ? routes.knowledge(row.slug) : null;
    const collected = item.content.readable ? collectPostPaths(row.contentJson) : { paths: [], truncated: false };
    const linkIssues = collected.paths.length > 0 ? await inspectPostLinks(db, collected.paths, currentPath) : [];
    const images: HealthImage[] = [];
    for (const image of item.content.images) {
      const key = mediaKeyFromPublicUrl(image.src);
      const isKnown = Boolean(key && known.has(key));
      const headed = isKnown && key && input.bucket ? await fileState(key) : { state: 'unchecked' as const, failed: false };
      images.push({ src: image.src, alt: image.alt, known: isKnown, state: headed.state, failed: headed.failed });
    }
    let cover: HealthCover;
    if (row.coverMediaId && !row.coverKey) cover = { kind: 'missing' };
    else if (row.coverKey) {
      const headed = input.bucket ? await fileState(row.coverKey) : { state: 'unchecked' as const, failed: false };
      cover = { kind: 'file', alt: row.coverAlt ?? '', state: headed.state, failed: headed.failed };
    } else cover = { kind: 'none' };
    issues.push(
      ...assessPost({
        id: row.id,
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt,
        seoTitle: row.seoTitle,
        metaDescription: row.metaDescription,
        cover,
        images,
        imagesTruncated: item.content.truncated,
        readable: item.content.readable,
        filesReady: Boolean(input.bucket),
        linkIssues,
        linkTruncated: collected.truncated,
        corpus: mergeMetaCorpus(collectMetaCorpus(context.metaRows.filter((meta) => meta.id !== row.id)), context.categoryCorpus, siteListCorpus()),
        origin: input.origin,
        blocked: context.blocked,
      }),
    );
  }
  const last = rows[rows.length - 1]?.id ?? run.cursor;
  const patch = { cursor: last };
  await commit(db, run.id, { issues, posts: rows.map((row) => row.id), patch });
  return apply(run, patch);
}

async function scanLinks(db: AppDb, run: HealthRun): Promise<HealthRun> {
  const rows = await db
    .select({ id: posts.id, slug: posts.slug, contentJson: posts.contentJson })
    .from(posts)
    .where(and(livePublished(), gt(posts.id, run.cursor)))
    .orderBy(asc(posts.id))
    .limit(HEALTH_BATCH);
  if (rows.length === 0) {
    const patch = { phase: 'inbound' as const, cursor: 0 };
    await commit(db, run.id, { patch });
    return apply(run, patch);
  }
  const paths = new Set<string>();
  let truncated = run.linksTruncated;
  for (const row of rows) {
    const collected = collectPostPaths(row.contentJson);
    if (collected.truncated) truncated = true;
    const own = SLUG_PATTERN.test(row.slug) ? routes.knowledge(row.slug) : null;
    for (const path of collected.paths) {
      if (path !== own) paths.add(path);
    }
  }
  const last = rows[rows.length - 1]?.id ?? run.cursor;
  const patch = { cursor: last, linksTruncated: truncated ? 1 : 0 };
  await commit(db, run.id, { links: [...paths], patch });
  return apply(run, patch);
}

async function scanInbound(db: AppDb, run: HealthRun, now: number): Promise<HealthRun> {
  const rows = await db
    .select({ id: posts.id, title: posts.title, slug: posts.slug })
    .from(seoHealthPosts)
    .innerJoin(posts, eq(posts.id, seoHealthPosts.postId))
    .where(and(eq(seoHealthPosts.runId, run.id), livePublished(), gt(posts.id, run.cursor)))
    .orderBy(asc(posts.id))
    .limit(INBOUND_BATCH);
  if (rows.length === 0) {
    const patch = { phase: 'done' as const, finishedAt: now };
    await commit(db, run.id, { patch });
    return apply(run, patch);
  }
  const linkRows = await db.select({ path: seoHealthLinks.path }).from(seoHealthLinks).where(eq(seoHealthLinks.runId, run.id));
  const linked = new Set(linkRows.map((row) => row.path));
  const issues = inboundIssues(rows, linked, run.linksTruncated);
  const last = rows[rows.length - 1]?.id ?? run.cursor;
  const patch = { cursor: last };
  await commit(db, run.id, { issues, patch });
  return apply(run, patch);
}

function headCache(bucket: HealthBucket | null): (key: string) => Promise<{ state: 'present' | 'missing' | 'unchecked'; failed: boolean }> {
  const cache = new Map<string, { state: 'present' | 'missing' | 'unchecked'; failed: boolean }>();
  let heads = 0;
  let dead = false;
  return async (key) => {
    const saved = cache.get(key);
    if (saved) return saved;
    if (!bucket || dead || heads >= HEAD_CAP) {
      const state = { state: 'unchecked' as const, failed: dead };
      cache.set(key, state);
      return state;
    }
    heads += 1;
    try {
      const found = await bucket.head(key);
      const state = { state: found ? ('present' as const) : ('missing' as const), failed: false };
      cache.set(key, state);
      return state;
    } catch {
      dead = true;
      const state = { state: 'unchecked' as const, failed: true };
      cache.set(key, state);
      return state;
    }
  };
}

async function loadScanContext(db: AppDb): Promise<ScanContext> {
  const [metaRows, categoryRows, tagRows, redirectPaths] = await Promise.all([
    db
      .select({
        id: posts.id,
        title: posts.title,
        seoTitle: posts.seoTitle,
        excerpt: posts.excerpt,
        metaDescription: posts.metaDescription,
      })
      .from(posts),
    db
      .select({
        name: categories.name,
        seoTitle: categories.seoTitle,
        metaDescription: categories.metaDescription,
        description: categories.description,
      })
      .from(categories),
    db
      .select({
        name: tags.name,
        seoTitle: tags.seoTitle,
        metaDescription: tags.metaDescription,
        description: tags.description,
      })
      .from(tags)
      .where(eq(tags.robots, 'index')),
    listRedirectPaths(db),
  ]);
  return {
    metaRows,
    categoryCorpus: mergeMetaCorpus(collectMetaCorpus(categoryRows), collectMetaCorpus(tagRows)),
    blocked: new Set(redirectPaths),
  };
}

async function commit(db: AppDb, runId: number, work: { issues?: HealthDraft[]; posts?: number[]; links?: string[]; patch: RunPatch }): Promise<void> {
  const queries: BatchItem<'sqlite'>[] = [];
  if (work.issues && work.issues.length > 0) {
    queries.push(
      db.insert(seoHealthIssues).values(
        work.issues.map((issue) => ({
          runId,
          postId: issue.postId,
          postTitle: clip(issue.postTitle, 180),
          severity: issue.severity,
          code: issue.code,
          detail: clip(issue.detail, 500),
        })),
      ),
    );
  }
  if (work.posts && work.posts.length > 0) {
    queries.push(db.insert(seoHealthPosts).values(work.posts.map((postId) => ({ runId, postId }))));
  }
  if (work.links && work.links.length > 0) {
    queries.push(
      db
        .insert(seoHealthLinks)
        .values(work.links.map((path) => ({ runId, path: clip(path, 300) })))
        .onConflictDoNothing(),
    );
  }
  queries.push(db.update(seoHealthRuns).set(work.patch).where(eq(seoHealthRuns.id, runId)));
  await runBatch(db, queries);
}

function apply(run: HealthRun, patch: RunPatch): HealthRun {
  return {
    ...run,
    phase: patch.phase ?? run.phase,
    cursor: patch.cursor ?? run.cursor,
    finishedAt: patch.finishedAt === undefined ? run.finishedAt : patch.finishedAt,
    linksTruncated: patch.linksTruncated === undefined ? run.linksTruncated : patch.linksTruncated === 1,
  };
}

async function latestRun(db: AppDb): Promise<HealthRun | null> {
  const rows = await db.select().from(seoHealthRuns).orderBy(desc(seoHealthRuns.id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (!isHealthPhase(row.phase)) throw new Error('seo_health_phase');
  return {
    id: row.id,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    phase: row.phase,
    cursor: row.cursor,
    linksTruncated: row.linksTruncated === 1,
  };
}

async function deleteRun(db: AppDb, runId: number): Promise<void> {
  await runBatch(db, [
    db.delete(seoHealthIssues).where(eq(seoHealthIssues.runId, runId)),
    db.delete(seoHealthPosts).where(eq(seoHealthPosts.runId, runId)),
    db.delete(seoHealthLinks).where(eq(seoHealthLinks.runId, runId)),
    db.delete(seoHealthRuns).where(eq(seoHealthRuns.id, runId)),
  ]);
}

async function deleteOtherRuns(db: AppDb, keepId: number): Promise<void> {
  const rows = await db.select({ id: seoHealthRuns.id }).from(seoHealthRuns).where(ne(seoHealthRuns.id, keepId));
  for (const row of rows) await deleteRun(db, row.id);
}

function emptySnapshot(published: number, uncheckedPosts: { id: number; title: string }[]): HealthSnapshot {
  return {
    run: null,
    published,
    verified: 0,
    unchecked: published,
    stale: 0,
    uncheckedPosts,
    stalePosts: [],
    errors: 0,
    warnings: 0,
    issues: [],
    total: 0,
    page: 1,
    pageCount: 1,
    postOptions: [],
    figures: healthFigures({ failed: false, hasRun: false, errors: 0, warnings: 0, verified: 0, pending: published }),
  };
}

function missingRun(runId: number): SQL {
  return sql`not exists (select 1 from seo_health_posts where seo_health_posts.run_id = ${runId} and seo_health_posts.post_id = ${posts.id})`;
}

function inThisRun(runId: number): SQL {
  return sql`exists (select 1 from seo_health_posts where seo_health_posts.run_id = ${runId} and seo_health_posts.post_id = ${posts.id})`;
}

async function countPosts(db: AppDb, where: SQL | undefined): Promise<number> {
  const rows = await db.select({ value: count() }).from(posts).where(where);
  return rows[0]?.value ?? 0;
}

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : text.slice(0, max);
}
