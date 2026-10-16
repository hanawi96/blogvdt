import { isPostHref } from './links';
import { normalizePostCardIds, normalizePostCardLabels, POST_CARDS_NODE } from './post-cards';

export const NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'hardBreak',
  'image',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  POST_CARDS_NODE,
]);

export const MARK_TYPES = new Set(['bold', 'italic', 'link']);

type Mark = { type: string; attrs?: Record<string, string> };
type Node = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Node[]; marks?: Mark[] };

export type ContentResult = { ok: true; json: string; excerpt: string } | { ok: false; error: string };

export function sanitizePostContent(raw: string): ContentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Nội dung bài viết không hợp lệ.' };
  }
  const cleaned = cleanNode(parsed);
  if (!cleaned || cleaned.type !== 'doc') return { ok: false, error: 'Nội dung bài viết không hợp lệ.' };
  return { ok: true, json: JSON.stringify(cleaned), excerpt: excerptFromNode(cleaned) };
}

function cleanNode(value: unknown): Node | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || !NODE_TYPES.has(record.type)) return null;
  const node: Node = { type: record.type };

  if (record.type === 'text') {
    node.text = typeof record.text === 'string' ? record.text : '';
    const marks = cleanMarks(record.marks);
    if (marks.length > 0) node.marks = marks;
    return node;
  }

  if (record.type === 'heading') {
    const level = (record.attrs as { level?: unknown } | undefined)?.level;
    node.attrs = { level: level === 3 ? 3 : 2 };
  }

  if (record.type === 'image') {
    const attrs = record.attrs as { src?: unknown; alt?: unknown; caption?: unknown } | undefined;
    const src = typeof attrs?.src === 'string' ? attrs.src : '';
    if (!isMediaSrc(src)) return null;
    const caption = typeof attrs?.caption === 'string' ? attrs.caption.trim().slice(0, 200) : '';
    node.attrs = { src, alt: typeof attrs?.alt === 'string' ? attrs.alt.slice(0, 200) : '' };
    if (caption) node.attrs.caption = caption;
  }

  if (record.type === POST_CARDS_NODE) {
    const attrs = record.attrs as { ids?: unknown; labels?: unknown } | undefined;
    const ids = normalizePostCardIds(attrs?.ids);
    if (ids.length === 0) return null;
    node.attrs = { ids, labels: normalizePostCardLabels(attrs?.labels, ids.length) };
    return node;
  }

  if (Array.isArray(record.content)) {
    node.content = record.content.map(cleanNode).filter((child): child is Node => child !== null);
  }
  return node;
}

function cleanMarks(value: unknown): Mark[] {
  if (!Array.isArray(value)) return [];
  const marks: Mark[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const mark = item as { type?: unknown; attrs?: { href?: unknown } };
    if (typeof mark.type !== 'string' || !MARK_TYPES.has(mark.type)) continue;
    if (mark.type === 'link') {
      const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
      if (!isPostHref(href)) continue;
      marks.push({ type: 'link', attrs: { href } });
      continue;
    }
    marks.push({ type: mark.type });
  }
  return marks;
}

export function isMediaSrc(value: string): boolean {
  return value.startsWith('/media/') && !value.includes('..') && !value.includes('\\') && !value.includes('://');
}

type MediaNode = { type?: string; attrs?: { src?: unknown }; content?: MediaNode[] };

export function collectMediaSrcs(node: MediaNode): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  walk(node);
  return found;

  function walk(current: MediaNode): void {
    const src = current.attrs?.src;
    if (current.type === 'image' && typeof src === 'string' && isMediaSrc(src) && !seen.has(src)) {
      seen.add(src);
      found.push(src);
    }
    for (const child of current.content ?? []) walk(child);
  }
}

function excerptFromNode(node: Node): string {
  const text = collectText(node).replace(/\s+/g, ' ').trim();
  if (text.length <= 180) return text;
  return `${text.slice(0, 177).trimEnd()}...`;
}

function collectText(node: Node): string {
  const own = node.text ?? '';
  const children = node.content?.map(collectText).join(' ') ?? '';
  return `${own} ${children}`.trim();
}
