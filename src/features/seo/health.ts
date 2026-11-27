import { canonicalUrl, type MetaCorpus } from '../../lib/seo/meta';
import { isMediaSrc } from '../posts/content';
import { headingStructureIssues, type HeadingInfo } from '../posts/heading-audit';
import type { PostLinkIssue } from '../posts/links';
import { countWords } from '../posts/reading-stats';
import {
  HEALTH_CODE_LABELS,
  HEALTH_CODES,
  isHealthCode,
  type HealthCode,
  type HealthPhase,
  type HealthSeverity,
} from './codes';
import {
  isKnowledgePathBlocked,
  knowledgePathIfValid,
  lengthNote,
  metaDuplicateNote,
  MIN_CONTENT_WORDS,
  resolvePostMeta,
  SEO_DESC_RANGE,
  SEO_TITLE_RANGE,
} from './meta-rules';

export {
  HEALTH_CODE_LABELS,
  HEALTH_CODES,
  isHealthCode,
  isHealthPhase,
  type HealthCode,
  type HealthPhase,
  type HealthSeverity,
} from './codes';

export { HEALTH_LOAD_ERROR, HEALTH_RUN_ERROR } from './messages';
import {
  HEADING_ISSUE_DETAIL,
  HEALTH_CONTENT_IMAGE_FALLBACK,
  HEALTH_COVER_LABEL,
  HEALTH_ISSUE,
  HEALTH_LOAD_ERROR,
  HEALTH_SITE_TITLE,
  healthBrokenImagesDetail,
  healthEmptyAltDetail,
  healthInboundDetail,
  healthLinkMissingDetail,
  healthLinkRedirectDetail,
  healthLinkUnpublishedDetail,
  healthNoteDone,
  healthNoteDoneEmpty,
  healthNoteInProgress,
  healthNoteNever,
  healthThinContentDetail,
} from './messages';

export const HEALTH_BATCH = 12;
export const INBOUND_BATCH = 40;
export const HEALTH_PAGE_SIZE = 20;
export const HEALTH_BUDGET_MS = 1200;
export const HEALTH_MAX_STEPS = 6;
const IMAGE_CAP = 30;

export type HealthDraft = {
  postId: number | null;
  postTitle: string;
  severity: HealthSeverity;
  code: HealthCode;
  detail: string;
};

export type HealthCover =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'file'; alt: string; state: 'present' | 'missing' | 'unchecked'; failed: boolean };

export type HealthImage = {
  src: string;
  alt: string;
  known: boolean;
  state: 'present' | 'missing' | 'unchecked';
  failed: boolean;
};

export type HealthPost = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  seoTitle: string | null;
  metaDescription: string | null;
  cover: HealthCover;
  images: HealthImage[];
  imagesTruncated: boolean;
  readable: boolean;
  wordCount: number;
  headings: HeadingInfo[];
  filesReady: boolean;
  linkIssues: PostLinkIssue[];
  linkTruncated: boolean;
  corpus: MetaCorpus;
  origin: string;
  blocked: ReadonlySet<string>;
};

export type HealthFilters = {
  severity: '' | HealthSeverity;
  code: '' | HealthCode;
  postId: number | null;
  page: number;
};

export function readHealthFilters(params: URLSearchParams): HealthFilters {
  const severity = params.get('severity');
  const code = params.get('code');
  const post = params.get('post');
  const page = params.get('page');
  return {
    severity: severity === 'error' || severity === 'warning' ? severity : '',
    code: code && isHealthCode(code) ? code : '',
    postId: post && /^[1-9]\d*$/.test(post) ? Number(post) : null,
    page: page && /^[1-9]\d*$/.test(page) ? Number(page) : 1,
  };
}

export function pageWindow(total: number, page: number, size: number): { page: number; pageCount: number; offset: number; limit: number } {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(page, 1), pageCount);
  return { page: current, pageCount, offset: (current - 1) * size, limit: size };
}

// Một request luôn chạy ít nhất một lô, rồi dừng theo số lô hoặc thời gian.
export function shouldContinue(startedAt: number, now: number, steps: number): boolean {
  if (steps < 1) return true;
  return steps < HEALTH_MAX_STEPS && now - startedAt < HEALTH_BUDGET_MS;
}

export function collectContentImages(raw: string): {
  images: { src: string; alt: string }[];
  truncated: boolean;
  readable: boolean;
  wordCount: number;
  headings: HeadingInfo[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { images: [], truncated: false, readable: false, wordCount: 0, headings: [] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { images: [], truncated: false, readable: false, wordCount: 0, headings: [] };
  }
  const images: { src: string; alt: string }[] = [];
  const headings: HeadingInfo[] = [];
  let text = '';
  let truncated = false;
  walk(parsed);
  return { images, truncated, readable: true, wordCount: countWords(text), headings };

  function walk(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    const current = node as {
      type?: unknown;
      text?: unknown;
      attrs?: { src?: unknown; alt?: unknown; level?: unknown };
      content?: unknown[];
    };
    if (current.type === 'heading') {
      headings.push({ level: current.attrs?.level === 3 ? 3 : 2, text: headingText(current) });
    }
    if (current.type === 'text' && typeof current.text === 'string') text += current.text;
    if (current.type === 'image' && typeof current.attrs?.src === 'string') {
      if (images.length >= IMAGE_CAP) truncated = true;
      else images.push({ src: current.attrs.src, alt: typeof current.attrs.alt === 'string' ? current.attrs.alt : '' });
    }
    for (const child of current.content ?? []) walk(child);
  }
}

function headingText(node: { text?: unknown; content?: unknown[] }): string {
  const own = typeof node.text === 'string' ? node.text : '';
  const children = (node.content ?? []).map((child) => (child && typeof child === 'object' ? headingText(child as { text?: unknown; content?: unknown[] }) : '')).join('');
  return `${own}${children}`.replace(/\s+/g, ' ').trim();
}

export function sitemapDecision(input: { status: string; slug: string; origin: string; blocked: ReadonlySet<string> }): { included: boolean } {
  if (input.status !== 'published') return { included: false };
  const path = knowledgePathIfValid(input.slug);
  if (!path || isKnowledgePathBlocked(path, input.blocked)) return { included: false };
  return { included: canonicalUrl(input.origin, path).length > 0 };
}

export function siteHealthIssues(input: { origin: string; filesReady: boolean }): HealthDraft[] {
  const issues: HealthDraft[] = [];
  if (!input.origin) {
    issues.push(site('error', 'canonical', HEALTH_ISSUE.siteOriginMissing));
  }
  if (!input.filesReady) {
    issues.push(site('warning', 'image', HEALTH_ISSUE.siteFilesOffline));
  }
  return issues;
}

export function assessPost(input: HealthPost): HealthDraft[] {
  const issues: HealthDraft[] = [];
  const { headline, description } = resolvePostMeta(input);
  if (!headline) issues.push(row(input, 'error', 'title', HEALTH_ISSUE.titleEmpty));
  else {
    const titleLength = lengthNote(headline.length, SEO_TITLE_RANGE.min, SEO_TITLE_RANGE.max);
    if (titleLength) issues.push(row(input, 'warning', 'title', titleLength));
  }
  if (!description) issues.push(row(input, 'warning', 'description', HEALTH_ISSUE.descriptionEmpty));
  else {
    const descriptionLength = lengthNote(description.length, SEO_DESC_RANGE.min, SEO_DESC_RANGE.max);
    if (descriptionLength) issues.push(row(input, 'warning', 'description', descriptionLength));
  }
  const duplicate = metaDuplicateNote(headline, description, input.corpus);
  if (duplicate) issues.push(row(input, 'warning', 'duplicate', duplicate));

  const path = knowledgePathIfValid(input.slug);
  if (!path) issues.push(row(input, 'error', 'slug', HEALTH_ISSUE.slugInvalid));
  else if (isKnowledgePathBlocked(path, input.blocked)) issues.push(row(input, 'error', 'slug', HEALTH_ISSUE.slugBlocked));
  const listed = sitemapDecision({ status: 'published', slug: input.slug, origin: input.origin, blocked: input.blocked });
  if (input.origin && !listed.included) issues.push(row(input, 'error', 'sitemap', HEALTH_ISSUE.sitemapMissing));
  if (input.origin && path && !isKnowledgePathBlocked(path, input.blocked) && !canonicalUrl(input.origin, path)) {
    issues.push(row(input, 'error', 'canonical', HEALTH_ISSUE.canonicalMissing));
  }

  if (!input.readable) {
    issues.push(row(input, 'error', 'image', HEALTH_ISSUE.contentUnreadable));
    return issues;
  }

  if (input.wordCount === 0) issues.push(row(input, 'error', 'content', HEALTH_ISSUE.contentEmpty));
  else if (input.wordCount < MIN_CONTENT_WORDS) {
    issues.push(row(input, 'warning', 'content', healthThinContentDetail(input.wordCount)));
  }

  if (input.wordCount > 0) {
    for (const code of headingStructureIssues(input.headings, input.wordCount)) {
      issues.push(row(input, 'warning', 'heading', HEADING_ISSUE_DETAIL[code]));
    }
  }

  if (input.cover.kind === 'none') {
    issues.push(row(input, 'warning', 'cover', HEALTH_ISSUE.coverMissing));
  }

  const broken: string[] = [];
  const emptyAlt: string[] = [];
  let unchecked = false;
  let failed = false;
  if (input.cover.kind === 'missing') broken.push(HEALTH_COVER_LABEL);
  if (input.cover.kind === 'file') {
    noteFile(input.cover.state, input.cover.failed, input.cover.alt, HEALTH_COVER_LABEL);
  }
  for (const image of input.images) {
    if (!isMediaSrc(image.src) || !image.known) {
      broken.push(image.src || HEALTH_CONTENT_IMAGE_FALLBACK);
      continue;
    }
    noteFile(image.state, image.failed, image.alt, image.src);
  }
  if (broken.length > 0) issues.push(row(input, 'error', 'image', healthBrokenImagesDetail(broken)));
  if (input.filesReady && failed) issues.push(row(input, 'warning', 'image', HEALTH_ISSUE.imageHeadFailed));
  else if (input.filesReady && unchecked) issues.push(row(input, 'warning', 'image', HEALTH_ISSUE.imageUnchecked));
  if (emptyAlt.length > 0) {
    issues.push(row(input, 'warning', 'alt', healthEmptyAltDetail(emptyAlt)));
  }
  if (input.imagesTruncated) issues.push(row(input, 'warning', 'image', HEALTH_ISSUE.imageTruncated));

  const groups: Record<PostLinkIssue['kind'], PostLinkIssue[]> = { missing: [], unpublished: [], redirect: [], self: [] };
  for (const issue of input.linkIssues) groups[issue.kind].push(issue);
  if (groups.missing.length > 0) issues.push(row(input, 'error', 'link', healthLinkMissingDetail(paths(groups.missing))));
  if (groups.unpublished.length > 0) {
    issues.push(row(input, 'error', 'link', healthLinkUnpublishedDetail(paths(groups.unpublished))));
  }
  if (groups.redirect.length > 0) {
    const text = groups.redirect
      .slice(0, 3)
      .map((issue) => (issue.official ? `${issue.path} → ${issue.official}` : issue.path))
      .join(', ');
    issues.push(row(input, 'warning', 'link', healthLinkRedirectDetail(text)));
  }
  if (groups.self.length > 0) issues.push(row(input, 'warning', 'link', HEALTH_ISSUE.linkSelf));
  if (input.linkTruncated) issues.push(row(input, 'warning', 'link', HEALTH_ISSUE.linkTruncated));
  return issues;

  function noteFile(state: 'present' | 'missing' | 'unchecked', fileFailed: boolean, alt: string, label: string): void {
    if (state === 'missing') broken.push(label);
    if (state === 'unchecked') {
      unchecked = true;
      if (fileFailed) failed = true;
    }
    if (state !== 'missing' && alt.trim().length === 0) emptyAlt.push(label);
  }
}

export function inboundDetail(truncated: boolean): string {
  return healthInboundDetail(truncated);
}

export function inboundIssues(posts: { id: number; title: string; slug: string }[], linked: ReadonlySet<string>, truncated: boolean): HealthDraft[] {
  const detail = inboundDetail(truncated);
  const issues: HealthDraft[] = [];
  for (const post of posts) {
    const path = knowledgePathIfValid(post.slug);
    if (!path || linked.has(path)) continue;
    issues.push({ postId: post.id, postTitle: post.title, severity: 'warning', code: 'inbound', detail });
  }
  return issues;
}

export function healthFigures(input: {
  failed: boolean;
  hasRun: boolean;
  errors: number;
  warnings: number;
  verified: number;
  pending: number;
}): { errors: string; warnings: string; verified: string; pending: string } {
  if (input.failed) return { errors: '—', warnings: '—', verified: '—', pending: '—' };
  if (!input.hasRun) return { errors: '—', warnings: '—', verified: '0', pending: String(input.pending) };
  return {
    errors: String(input.errors),
    warnings: String(input.warnings),
    verified: String(input.verified),
    pending: String(input.pending),
  };
}

export type HealthCodeStat = { code: HealthCode; label: string; errors: number; warnings: number; total: number };

// Gom lỗi theo loại để xem nhanh "site đang hỏng ở đâu". Chỉ giữ loại có ít nhất một lỗi, đẩy loại nhiều lỗi nghiêm trọng lên trên.
export function healthCodeBreakdown(rows: ReadonlyArray<{ code: string; severity: string; value: number }>): HealthCodeStat[] {
  const byCode = new Map<HealthCode, { errors: number; warnings: number }>();
  for (const row of rows) {
    if (!isHealthCode(row.code)) continue;
    const entry = byCode.get(row.code) ?? { errors: 0, warnings: 0 };
    if (row.severity === 'error') entry.errors += row.value;
    else if (row.severity === 'warning') entry.warnings += row.value;
    byCode.set(row.code, entry);
  }
  return HEALTH_CODES.flatMap((code) => {
    const entry = byCode.get(code);
    if (!entry || entry.errors + entry.warnings === 0) return [];
    return [{ code, label: HEALTH_CODE_LABELS[code], errors: entry.errors, warnings: entry.warnings, total: entry.errors + entry.warnings }];
  }).sort((a, b) => b.errors - a.errors || b.total - a.total);
}

export type HealthScore = { score: number; cleanPosts: number; denominator: number; ready: boolean };

// Điểm sức khỏe = tỉ lệ bài đã xác minh mà không dính lỗi/cảnh báo, trên tổng bài xuất bản chốt lúc bắt đầu run.
// publishedTotal là mẫu số ổn định; run cũ chưa có cột này (=0) thì lùi về số published hiện tại.
export function healthScore(input: { phase: HealthPhase | null; publishedTotal: number; published: number; cleanPosts: number }): HealthScore {
  const denominator = input.publishedTotal > 0 ? input.publishedTotal : input.published;
  const cleanPosts = Math.max(0, Math.min(input.cleanPosts, denominator));
  const ready = input.phase === 'done';
  if (denominator === 0) return { score: 100, cleanPosts: 0, denominator: 0, ready };
  return { score: Math.round((cleanPosts / denominator) * 100), cleanPosts, denominator, ready };
}

export function healthNote(input: {
  failed: boolean;
  phase: HealthPhase | null;
  whenLabel: string;
  published: number;
  verified: number;
  unchecked: number;
  stale: number;
}): string {
  if (input.failed) return HEALTH_LOAD_ERROR;
  if (!input.phase) return healthNoteNever();
  if (input.phase !== 'done') {
    return healthNoteInProgress(input.whenLabel, input.verified, input.unchecked);
  }
  if (input.published === 0) return healthNoteDoneEmpty(input.whenLabel);
  return healthNoteDone({
    whenLabel: input.whenLabel,
    verified: input.verified,
    unchecked: input.unchecked,
    stale: input.stale,
  });
}

function site(severity: HealthSeverity, code: HealthCode, detail: string): HealthDraft {
  return { postId: null, postTitle: HEALTH_SITE_TITLE, severity, code, detail };
}

function row(input: HealthPost, severity: HealthSeverity, code: HealthCode, detail: string): HealthDraft {
  return { postId: input.id, postTitle: input.title, severity, code, detail };
}

function paths(issues: PostLinkIssue[]): string {
  return issues
    .slice(0, 3)
    .map((issue) => issue.path)
    .join(', ');
}
