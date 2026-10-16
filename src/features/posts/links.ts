import { isHttpUrl } from '../../lib/http';
import { routes } from '../../lib/routes';

const INTERNAL_SLUG_PATH = /^\/(?:kien-thuc|san-pham)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INTERNAL_FIXED_PATHS = new Set([routes.catalog]);

/** Chuẩn hóa path nội bộ (bỏ query/hash, slash cuối). */
export function normalizeSitePath(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      return '';
    }
  } else if (!raw.startsWith('/')) {
    return '';
  }
  return (pathname.split(/[?#]/, 1)[0] ?? '').replace(/\/+$/, '') || '/';
}

/** Path nội bộ được gắn link: bài, sản phẩm, trang mẫu vòng. */
export function isInternalPostPath(value: string): boolean {
  const path = normalizeSitePath(value);
  return INTERNAL_SLUG_PATH.test(path) || INTERNAL_FIXED_PATHS.has(path);
}

export function isInternalHref(value: string, host = ''): boolean {
  if (isInternalPostPath(value)) return true;
  if (!host || !isHttpUrl(value)) return false;
  try {
    const url = new URL(value);
    return url.hostname === host && isInternalPostPath(url.pathname);
  } catch {
    return false;
  }
}

export function isPostHref(value: string): boolean {
  return isHttpUrl(value) || isInternalPostPath(value);
}

/** Link ra ngoài: URL http(s) tuyệt đối không trỏ về path nội bộ. Link nội bộ lưu dạng path `/...`. */
export function isExternalHref(value: string): boolean {
  const raw = value.trim();
  if (!raw.includes('://')) return false;
  if (!isHttpUrl(raw)) return false;
  return !isInternalPostPath(raw);
}

export type InternalLinkKind = 'post' | 'product' | 'catalog';

export type InternalLinkHit = { title: string; path: string; kind: InternalLinkKind };

/** Catalog hiện khi từ khóa gần với tên trang mẫu vòng. */
export function catalogLinkMatch(query: string): InternalLinkHit | null {
  const term = query.replace(/[%_]/g, '').trim().toLowerCase();
  if (term.length < 2) return null;
  const haystacks = ['mau vong dau tam', 'mẫu vòng dâu tằm', 'mau-vong-dau-tam', 'catalog', 'mau vong', 'mẫu vòng'];
  const folded = term.normalize('NFD').replace(/\p{M}/gu, '');
  const ok = haystacks.some((label) => {
    const flat = label.normalize('NFD').replace(/\p{M}/gu, '');
    return flat.includes(folded) || folded.includes(flat);
  });
  return ok ? { title: 'Mẫu vòng dâu tằm', path: routes.catalog, kind: 'catalog' } : null;
}

const POST_PATH = /^\/kien-thuc\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export function postPathFromHref(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > 300) return null;
  let pathname = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      if (url.username || url.password) return null;
      pathname = url.pathname;
    } catch {
      return null;
    }
  } else if (!raw.startsWith('/')) {
    return null;
  }
  pathname = (pathname.split(/[?#]/, 1)[0] ?? '').replace(/\/+$/, '');
  const match = pathname.match(POST_PATH);
  return match ? `/kien-thuc/${match[1]}` : null;
}

type LinkNode = {
  type?: unknown;
  marks?: { type?: unknown; attrs?: { href?: unknown } }[];
  content?: LinkNode[];
};

export function collectPostPaths(raw: string, limit = 20): { paths: string[]; truncated: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { paths: [], truncated: false };
  }
  const found: string[] = [];
  const seen = new Set<string>();
  let truncated = false;
  walk(parsed);
  return { paths: found, truncated };

  function walk(node: unknown): void {
    if (truncated || !node || typeof node !== 'object') return;
    const current = node as LinkNode;
    if (current.type === 'text') {
      for (const mark of current.marks ?? []) {
        if (mark.type !== 'link' || typeof mark.attrs?.href !== 'string') continue;
        const path = postPathFromHref(mark.attrs.href);
        if (!path || seen.has(path)) continue;
        if (found.length >= limit) {
          truncated = true;
          return;
        }
        seen.add(path);
        found.push(path);
      }
    }
    for (const child of current.content ?? []) walk(child);
  }
}

const COUNT_LIMIT = 500;

export type PostLinkCount = { inbound: number; outbound: number };

// Link ra: số bài khác mà nội dung bài này trỏ tới. Link vào: số bài nguồn khác trỏ tới bài này.
export function postLinkCounts(
  page: ReadonlyArray<{ id: number; slug: string; contentJson: string }>,
  sources: ReadonlyArray<{ id: number; contentJson: string }>,
): Map<number, PostLinkCount> {
  const byPath = new Map(page.map((row) => [`/kien-thuc/${row.slug}`, row.id]));
  const counts = new Map<number, PostLinkCount>();
  for (const row of page) {
    const own = `/kien-thuc/${row.slug}`;
    const outbound = collectPostPaths(row.contentJson, COUNT_LIMIT).paths.filter((path) => path !== own).length;
    counts.set(row.id, { inbound: 0, outbound });
  }
  for (const source of sources) {
    for (const path of collectPostPaths(source.contentJson, COUNT_LIMIT).paths) {
      const target = byPath.get(path);
      const count = target === undefined || target === source.id ? undefined : counts.get(target);
      if (count) count.inbound += 1;
    }
  }
  return counts;
}

export type PostLinkIssue = {
  path: string;
  kind: 'missing' | 'unpublished' | 'redirect' | 'self';
  official?: string;
};

export function classifyPostLinks(
  paths: string[],
  input: {
    currentPath: string | null;
    published: ReadonlySet<string>;
    unpublished: ReadonlySet<string>;
    redirects: ReadonlyMap<string, string>;
  },
): PostLinkIssue[] {
  const issues: PostLinkIssue[] = [];
  for (const path of paths) {
    if (input.published.has(path)) {
      if (path === input.currentPath) issues.push({ path, kind: 'self' });
      continue;
    }
    if (input.unpublished.has(path)) {
      issues.push({ path, kind: 'unpublished' });
      continue;
    }
    const target = input.redirects.get(path);
    if (target && target !== path && input.published.has(target)) {
      issues.push({ path, kind: 'redirect', official: target });
      continue;
    }
    if (target && input.unpublished.has(target)) {
      issues.push({ path, kind: 'unpublished' });
      continue;
    }
    issues.push({ path, kind: 'missing' });
  }
  return issues;
}

export function rankLinkSuggestions(
  posts: Array<{ title: string; path: string; sameCategory: boolean }>,
  title: string,
  limit = 4,
): Array<{ title: string; path: string }> {
  const wanted = titleTokens(title);
  return posts
    .map((post, index) => ({
      post,
      index,
      score: (post.sameCategory ? 3 : 0) + sharedTokens(wanted, titleTokens(post.title)),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((item) => ({ title: item.post.title, path: item.post.path }));
}

function titleTokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase('vi')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
}

function sharedTokens(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const word of left) if (right.has(word)) count += 1;
  return count;
}
