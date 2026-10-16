import { canonicalUrl, plainMetaText, type MetaCorpus } from '../../lib/seo/meta';
import { routes } from '../../lib/routes';
import { isMediaSrc } from '../posts/content';
import type { PostLinkIssue } from '../posts/links';
import { metaDuplicateNote } from '../posts/seo-check';
import { SLUG_PATTERN } from '../posts/slug';

export const HEALTH_CODES = ['title', 'description', 'duplicate', 'slug', 'canonical', 'image', 'alt', 'link', 'inbound', 'sitemap'] as const;
export type HealthCode = (typeof HEALTH_CODES)[number];
export type HealthSeverity = 'error' | 'warning';
export type HealthPhase = 'posts' | 'links' | 'inbound' | 'done';

export const HEALTH_CODE_LABELS: Record<HealthCode, string> = {
  title: 'SEO title',
  description: 'Mô tả',
  duplicate: 'Trùng lặp',
  slug: 'Slug',
  canonical: 'Canonical',
  image: 'Ảnh',
  alt: 'ALT',
  link: 'Liên kết nội bộ',
  inbound: 'Bài trỏ tới',
  sitemap: 'Sitemap',
};

export const HEALTH_BATCH = 12;
export const INBOUND_BATCH = 40;
export const HEALTH_PAGE_SIZE = 20;
export const HEALTH_BUDGET_MS = 1200;
export const HEALTH_MAX_STEPS = 6;
const IMAGE_CAP = 30;

export const HEALTH_LOAD_ERROR = 'Không tải được kết quả kiểm tra.';
export const HEALTH_RUN_ERROR = 'Mất kết nối khi kiểm tra. Kết quả đã lưu vẫn giữ nguyên.';

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

export function isHealthCode(value: string | null): value is HealthCode {
  return HEALTH_CODES.some((code) => code === value);
}

export function isHealthPhase(value: string): value is HealthPhase {
  return value === 'posts' || value === 'links' || value === 'inbound' || value === 'done';
}

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

export function collectContentImages(raw: string): { images: { src: string; alt: string }[]; truncated: boolean; readable: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { images: [], truncated: false, readable: false };
  }
  if (!parsed || typeof parsed !== 'object') return { images: [], truncated: false, readable: false };
  const images: { src: string; alt: string }[] = [];
  let truncated = false;
  walk(parsed);
  return { images, truncated, readable: true };

  function walk(node: unknown): void {
    if (truncated || !node || typeof node !== 'object') return;
    const current = node as { type?: unknown; attrs?: { src?: unknown; alt?: unknown }; content?: unknown[] };
    if (current.type === 'image' && typeof current.attrs?.src === 'string') {
      if (images.length >= IMAGE_CAP) {
        truncated = true;
        return;
      }
      images.push({ src: current.attrs.src, alt: typeof current.attrs.alt === 'string' ? current.attrs.alt : '' });
    }
    for (const child of current.content ?? []) walk(child);
  }
}

export function sitemapDecision(input: { status: string; slug: string; origin: string; blocked: ReadonlySet<string> }): { included: boolean } {
  if (input.status !== 'published' || !SLUG_PATTERN.test(input.slug)) return { included: false };
  const path = routes.knowledge(input.slug);
  if (input.blocked.has(path)) return { included: false };
  return { included: canonicalUrl(input.origin, path).length > 0 };
}

export function siteHealthIssues(input: { origin: string; filesReady: boolean }): HealthDraft[] {
  const issues: HealthDraft[] = [];
  if (!input.origin) {
    issues.push(site('error', 'canonical', 'Chưa có địa chỉ website hợp lệ nên canonical và sitemap không tạo được.'));
  }
  if (!input.filesReady) {
    issues.push(site('warning', 'image', 'Chưa kết nối được kho ảnh. File trên kho chưa được xác minh.'));
  }
  return issues;
}

export function assessPost(input: HealthPost): HealthDraft[] {
  const issues: HealthDraft[] = [];
  const headline = plainMetaText(input.seoTitle) || plainMetaText(input.title);
  const description = plainMetaText(input.metaDescription) || plainMetaText(input.excerpt);
  if (!headline) issues.push(row(input, 'error', 'title', 'SEO title và tiêu đề bài đều trống.'));
  if (!description) issues.push(row(input, 'warning', 'description', 'Mô tả SEO và tóm tắt đều trống. Trang đang dùng câu dự phòng.'));
  const duplicate = metaDuplicateNote(headline, description, input.corpus);
  if (duplicate) issues.push(row(input, 'warning', 'duplicate', duplicate));

  const path = SLUG_PATTERN.test(input.slug) ? routes.knowledge(input.slug) : '';
  if (!path) issues.push(row(input, 'error', 'slug', 'Slug không đúng định dạng nên không có URL công khai.'));
  else if (input.blocked.has(path)) issues.push(row(input, 'error', 'slug', 'Slug đang trùng một redirect đã lưu.'));
  const listed = sitemapDecision({ status: 'published', slug: input.slug, origin: input.origin, blocked: input.blocked });
  if (input.origin && !listed.included) issues.push(row(input, 'error', 'sitemap', 'Bài đã xuất bản nhưng sitemap không có URL này.'));
  if (input.origin && path && !input.blocked.has(path) && !canonicalUrl(input.origin, path)) {
    issues.push(row(input, 'error', 'canonical', 'Canonical không tạo được từ URL công khai.'));
  }

  if (!input.readable) {
    issues.push(row(input, 'error', 'image', 'Nội dung bài không đọc được nên ảnh và liên kết trong bài chưa được kiểm tra.'));
    return issues;
  }

  const broken: string[] = [];
  const emptyAlt: string[] = [];
  let unchecked = false;
  let failed = false;
  if (input.cover.kind === 'missing') broken.push('ảnh đại diện');
  if (input.cover.kind === 'file') {
    noteFile(input.cover.state, input.cover.failed, input.cover.alt, 'ảnh đại diện');
  }
  for (const image of input.images) {
    if (!isMediaSrc(image.src) || !image.known) {
      broken.push(image.src || 'ảnh trong bài');
      continue;
    }
    noteFile(image.state, image.failed, image.alt, image.src);
  }
  if (broken.length > 0) issues.push(row(input, 'error', 'image', `Ảnh không còn dùng được: ${broken.slice(0, 3).join(', ')}.`));
  if (input.filesReady && failed) issues.push(row(input, 'warning', 'image', 'Không kết nối được kho ảnh để xác minh file.'));
  else if (input.filesReady && unchecked) issues.push(row(input, 'warning', 'image', 'Còn file ảnh chưa xác minh trong lượt này.'));
  if (emptyAlt.length > 0) {
    issues.push(row(input, 'warning', 'alt', `${emptyAlt.slice(0, 3).join(', ')} đang trống ALT. Ảnh trang trí được phép; ảnh chứa thông tin cần mô tả đúng nội dung.`));
  }
  if (input.imagesTruncated) issues.push(row(input, 'warning', 'image', 'Chỉ kiểm tra 30 ảnh đầu trong bài.'));

  const groups: Record<PostLinkIssue['kind'], PostLinkIssue[]> = { missing: [], unpublished: [], redirect: [], self: [] };
  for (const issue of input.linkIssues) groups[issue.kind].push(issue);
  if (groups.missing.length > 0) issues.push(row(input, 'error', 'link', `Liên kết không có bài: ${paths(groups.missing)}.`));
  if (groups.unpublished.length > 0) issues.push(row(input, 'error', 'link', `Liên kết trỏ tới bài chưa xuất bản: ${paths(groups.unpublished)}.`));
  if (groups.redirect.length > 0) {
    const text = groups.redirect
      .slice(0, 3)
      .map((issue) => (issue.official ? `${issue.path} → ${issue.official}` : issue.path))
      .join(', ');
    issues.push(row(input, 'warning', 'link', `Liên kết đang đi qua đường dẫn cũ: ${text}.`));
  }
  if (groups.self.length > 0) issues.push(row(input, 'warning', 'link', 'Liên kết trỏ về chính bài này.'));
  if (input.linkTruncated) issues.push(row(input, 'warning', 'link', 'Chỉ kiểm tra 20 liên kết đầu.'));
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
  const base = 'Chưa thấy bài viết đã xuất bản nào trỏ tới. Không cần thêm liên kết nếu chưa có bài phù hợp.';
  return truncated ? `${base} Một số bài có hơn 20 liên kết nên kết quả có thể thiếu.` : base;
}

export function inboundIssues(posts: { id: number; title: string; slug: string }[], linked: ReadonlySet<string>, truncated: boolean): HealthDraft[] {
  const detail = inboundDetail(truncated);
  const issues: HealthDraft[] = [];
  for (const post of posts) {
    if (!SLUG_PATTERN.test(post.slug)) continue;
    if (linked.has(routes.knowledge(post.slug))) continue;
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
  if (!input.phase) return 'Chưa kiểm tra lần nào. Các bài xuất bản đang chưa được xác minh.';
  if (input.phase !== 'done') {
    return `Đang kiểm tra từ ${input.whenLabel}. Đã xác minh ${input.verified} bài. Còn ${input.unchecked} bài chưa kiểm tra. Số liệu bên dưới là phần đã xác minh.`;
  }
  if (input.published === 0) return `Kiểm tra xong lúc ${input.whenLabel}. Không có bài xuất bản để kiểm tra.`;
  const parts = [`Kiểm tra xong lúc ${input.whenLabel}. Đã xác minh ${input.verified} bài.`];
  if (input.unchecked > 0) parts.push(`Còn ${input.unchecked} bài chưa nằm trong lần này.`);
  if (input.stale > 0) parts.push(`${input.stale} bài đã sửa sau thời điểm kiểm tra nên cần xác minh lại.`);
  if (input.unchecked === 0 && input.stale === 0) parts.push('Toàn bộ bài xuất bản tại thời điểm đó đã được xác minh.');
  return parts.join(' ');
}

function site(severity: HealthSeverity, code: HealthCode, detail: string): HealthDraft {
  return { postId: null, postTitle: 'Toàn site', severity, code, detail };
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
