import { mergeAttributes, Node } from '@tiptap/core';
import { escapeHTMLAttribute } from '@tiptap/static-renderer';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { categories, media, posts } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { livePublished } from './visibility';

export const POST_CARDS_NODE = 'postCards';
export const POST_CARDS_MAX = 3;

export type PostCardRef = { id: number; title: string; path?: string };

export type PostCardEmbed = {
  id: number;
  title: string;
  slug: string;
  excerpt: string;
  categoryName: string | null;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export function normalizePostCardIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const id = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN;
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= POST_CARDS_MAX) break;
  }
  return out;
}

export function normalizePostCardLabels(value: unknown, count: number): string[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const raw = source[index];
    return typeof raw === 'string' ? raw.trim().slice(0, 180) : '';
  });
}

type JsonNode = { type?: string; attrs?: { ids?: unknown }; content?: JsonNode[] };

export function collectPostCardIds(node: JsonNode): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  walk(node);
  return found;

  function walk(current: JsonNode): void {
    if (current.type === POST_CARDS_NODE) {
      for (const id of normalizePostCardIds(current.attrs?.ids)) {
        if (seen.has(id)) continue;
        seen.add(id);
        found.push(id);
      }
    }
    for (const child of current.content ?? []) walk(child);
  }
}

export async function listPublishedPostCardsByIds(db: AppDb, ids: number[]): Promise<Map<number, PostCardEmbed>> {
  const unique = normalizePostCardIds(ids);
  const map = new Map<number, PostCardEmbed>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({
      id: posts.id,
      title: posts.title,
      slug: posts.slug,
      excerpt: posts.excerpt,
      categoryName: categories.name,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(posts)
    .leftJoin(categories, eq(posts.categoryId, categories.id))
    .leftJoin(media, eq(posts.coverMediaId, media.id))
    .where(and(inArray(posts.id, unique), livePublished()));
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      categoryName: row.categoryName,
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt ?? '',
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
    });
  }
  return map;
}

export function orderedPostCards(ids: number[], byId: ReadonlyMap<number, PostCardEmbed>): PostCardEmbed[] {
  return normalizePostCardIds(ids).flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

export function renderPostCardsHtml(cards: PostCardEmbed[]): string {
  if (cards.length === 0) return '';
  const items = cards
    .map((card) => {
      const href = routes.knowledge(card.slug);
      const thumb = card.coverUrl
        ? `<span class="post-cards-thumb"><img src="${escapeHTMLAttribute(card.coverUrl)}" alt="${escapeHTMLAttribute(card.coverAlt)}"${dimensionAttrs(card)} loading="lazy" decoding="async" /></span>`
        : `<span class="post-cards-thumb post-cards-thumb-empty" aria-hidden="true"></span>`;
      const meta = escapeHTMLAttribute(card.categoryName?.trim() || 'Kiến thức');
      return `<li><a class="post-cards-item" href="${escapeHTMLAttribute(href)}">${thumb}<span class="post-cards-copy"><span class="post-cards-title">${escapeHTMLAttribute(card.title)}</span><span class="post-cards-meta">${meta}</span></span></a></li>`;
    })
    .join('');
  return `<aside class="post-cards" data-count="${cards.length}" aria-label="Bài viết liên quan"><p class="post-cards-label">Đọc tiếp cho mẹ</p><ul class="post-cards-list">${items}</ul></aside>`;
}

function dimensionAttrs(card: PostCardEmbed): string {
  if (
    card.coverWidth == null ||
    card.coverHeight == null ||
    !Number.isInteger(card.coverWidth) ||
    !Number.isInteger(card.coverHeight) ||
    card.coverWidth < 1 ||
    card.coverHeight < 1
  ) {
    return '';
  }
  return ` width="${card.coverWidth}" height="${card.coverHeight}"`;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    postCards: {
      insertPostCards: (items: PostCardRef[]) => ReturnType;
      updatePostCards: (items: PostCardRef[]) => ReturnType;
    };
  }
}

export const PostCards = Node.create({
  name: POST_CARDS_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ids: {
        default: [] as number[],
        parseHTML: (element) => readJsonAttr(element, 'data-ids'),
        renderHTML: (attributes) => ({ 'data-ids': JSON.stringify(normalizePostCardIds(attributes.ids)) }),
      },
      labels: {
        default: [] as string[],
        parseHTML: (element) => readJsonAttr(element, 'data-labels'),
        renderHTML: (attributes) => {
          const ids = normalizePostCardIds(attributes.ids);
          return { 'data-labels': JSON.stringify(normalizePostCardLabels(attributes.labels, ids.length)) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="post-cards"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'post-cards', class: 'editor-post-cards' }, HTMLAttributes)];
  },

  addCommands() {
    return {
      insertPostCards:
        (items) =>
        ({ commands }) => {
          const payload = toAttrs(items);
          if (payload.ids.length === 0) return false;
          return commands.insertContent([{ type: this.name, attrs: payload }, { type: 'paragraph' }]);
        },
      updatePostCards:
        (items) =>
        ({ commands, state }) => {
          const payload = toAttrs(items);
          if (payload.ids.length === 0) return false;
          const { selection } = state;
          if (selection.empty) return false;
          return commands.updateAttributes(this.name, payload);
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const root = document.createElement('div');
      root.className = 'editor-post-cards';
      root.dataset.type = 'post-cards';
      root.contentEditable = 'false';

      const paint = () => {
        const ids = normalizePostCardIds(node.attrs.ids);
        const labels = normalizePostCardLabels(node.attrs.labels, ids.length);
        const rows =
          ids.length === 0
            ? `<p class="editor-post-cards-empty">Chưa chọn bài viết.</p>`
            : `<ul class="editor-post-cards-list">${ids
                .map((id, index) => {
                  const title = labels[index] || `Bài #${id}`;
                  return `<li><span class="editor-post-cards-title">${escapeText(title)}</span></li>`;
                })
                .join('')}</ul>`;
        root.innerHTML = `<div class="editor-post-cards-head"><p class="editor-post-cards-label">Đọc tiếp cho mẹ</p><div class="editor-post-cards-actions"><button type="button" data-edit>Sửa</button><button type="button" data-remove>Xóa</button></div></div>${rows}`;
        root.querySelector('[data-edit]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (typeof pos === 'number') {
            editor.chain().focus().setNodeSelection(pos).run();
          }
          root.dispatchEvent(new CustomEvent('post-cards-edit', { bubbles: true }));
        });
        root.querySelector('[data-remove]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (typeof pos !== 'number') return;
          editor.chain().focus().setNodeSelection(pos).deleteSelection().run();
        });
      };

      paint();
      return {
        dom: root,
        update: (updated) => {
          if (updated.type.name !== POST_CARDS_NODE) return false;
          node = updated;
          paint();
          return true;
        },
        selectNode: () => root.classList.add('is-selected'),
        deselectNode: () => root.classList.remove('is-selected'),
        ignoreMutation: () => true,
      };
    };
  },
});

function toAttrs(items: PostCardRef[]): { ids: number[]; labels: string[] } {
  const ids: number[] = [];
  const labels: string[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.id) || item.id < 1 || seen.has(item.id)) continue;
    seen.add(item.id);
    ids.push(item.id);
    labels.push(item.title.trim().slice(0, 180));
    if (ids.length >= POST_CARDS_MAX) break;
  }
  return { ids, labels };
}

function readJsonAttr(element: HTMLElement, name: string): unknown {
  try {
    return JSON.parse(element.getAttribute(name) || '[]');
  } catch {
    return [];
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
