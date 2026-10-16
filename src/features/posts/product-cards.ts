import { mergeAttributes, Node } from '@tiptap/core';
import { escapeHTMLAttribute } from '@tiptap/static-renderer';
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { media, orderItems, orders, products } from '../../lib/db/schema';
import { formatVnd } from '../../lib/money';
import { routes } from '../../lib/routes';

export const PRODUCT_CARDS_NODE = 'productCards';
export const PRODUCT_CARDS_MAX = 3;

export type ProductCardRef = { id: number; name: string; price?: number; path?: string; coverUrl?: string | null };

export type ProductCardEmbed = {
  id: number;
  name: string;
  slug: string;
  price: number;
  coverUrl: string | null;
  coverAlt: string;
  coverWidth: number | null;
  coverHeight: number | null;
};

export function normalizeProductCardIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const id = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN;
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= PRODUCT_CARDS_MAX) break;
  }
  return out;
}

export function normalizeProductCardLabels(value: unknown, count: number): string[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const raw = source[index];
    return typeof raw === 'string' ? raw.trim().slice(0, 180) : '';
  });
}

/** Cover URL song song với ids — chỉ giữ path `/media/...` an toàn; thiếu thì để chuỗi rỗng. */
export function normalizeProductCardCovers(value: unknown, count: number): string[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: count }, (_, index) => {
    const raw = source[index];
    return typeof raw === 'string' && isProductCoverSrc(raw) ? raw : '';
  });
}

function isProductCoverSrc(value: string): boolean {
  return value.startsWith('/media/') && !value.includes('..') && !value.includes('\\') && !value.includes('://');
}

type JsonNode = { type?: string; attrs?: { ids?: unknown }; content?: JsonNode[] };

export function collectProductCardIds(node: JsonNode): number[] {
  const found: number[] = [];
  const seen = new Set<number>();
  walk(node);
  return found;

  function walk(current: JsonNode): void {
    if (current.type === PRODUCT_CARDS_NODE) {
      for (const id of normalizeProductCardIds(current.attrs?.ids)) {
        if (seen.has(id)) continue;
        seen.add(id);
        found.push(id);
      }
    }
    for (const child of current.content ?? []) walk(child);
  }
}

export type ProductCardHit = {
  id: number;
  name: string;
  price: number;
  path: string;
  coverUrl: string | null;
};

function toHits(
  rows: Array<{ id: number; name: string; price: number; slug: string; coverKey: string | null }>,
): ProductCardHit[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    price: row.price,
    path: routes.product(row.slug),
    coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
  }));
}

export async function searchActiveProducts(db: AppDb, query: string): Promise<ProductCardHit[]> {
  const term = query.replace(/[%_]/g, '').trim().slice(0, 80);
  if (term.length < 2) return [];
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      slug: products.slug,
      coverKey: media.r2Key,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(and(eq(products.status, 'active'), like(products.name, `%${term}%`)))
    .orderBy(asc(products.sortOrder), asc(products.name))
    .limit(8);
  return toHits(rows);
}

/** Top sản phẩm đang bán theo tổng số lượng trong đơn (bỏ đơn hủy). Ít đơn thì fallback sortOrder. */
export async function listTopSellingProducts(db: AppDb, limit = 5): Promise<ProductCardHit[]> {
  const sold = sql<number>`coalesce(sum(case when ${orders.status} is not null and ${orders.status} <> 'cancelled' then ${orderItems.quantity} else 0 end), 0)`;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      slug: products.slug,
      coverKey: media.r2Key,
      sold,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .leftJoin(orderItems, eq(orderItems.productId, products.id))
    .leftJoin(orders, eq(orders.id, orderItems.orderId))
    .where(eq(products.status, 'active'))
    .groupBy(products.id)
    .orderBy(desc(sold), asc(products.sortOrder), asc(products.id))
    .limit(Math.max(1, Math.min(limit, 12)));
  return toHits(rows);
}

export async function listActiveProductCardsByIds(db: AppDb, ids: number[]): Promise<Map<number, ProductCardEmbed>> {
  const unique = normalizeProductCardIds(ids);
  const map = new Map<number, ProductCardEmbed>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      coverKey: media.r2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(and(inArray(products.id, unique), eq(products.status, 'active')));
  for (const row of rows) {
    map.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      price: row.price,
      coverUrl: row.coverKey ? routes.media(row.coverKey) : null,
      coverAlt: row.coverAlt ?? '',
      coverWidth: row.coverWidth,
      coverHeight: row.coverHeight,
    });
  }
  return map;
}

export function orderedProductCards(ids: number[], byId: ReadonlyMap<number, ProductCardEmbed>): ProductCardEmbed[] {
  return normalizeProductCardIds(ids).flatMap((id) => {
    const card = byId.get(id);
    return card ? [card] : [];
  });
}

export function renderProductCardsHtml(cards: ProductCardEmbed[]): string {
  if (cards.length === 0) return '';
  const items = cards
    .map((card) => {
      const href = `${routes.checkout}?san-pham=${encodeURIComponent(card.slug)}`;
      const thumb = card.coverUrl
        ? `<span class="product-cards-thumb"><img src="${escapeHTMLAttribute(card.coverUrl)}" alt="${escapeHTMLAttribute(card.coverAlt)}"${dimensionAttrs(card)} loading="lazy" decoding="async" /></span>`
        : `<span class="product-cards-thumb product-cards-thumb-empty" aria-hidden="true"></span>`;
      const price = escapeHTMLAttribute(formatVnd(card.price));
      return `<li><a class="product-cards-item" href="${escapeHTMLAttribute(href)}">${thumb}<span class="product-cards-copy"><span class="product-cards-title">${escapeHTMLAttribute(card.name)}</span><span class="product-cards-price">${price}</span></span></a></li>`;
    })
    .join('');
  return `<aside class="product-cards" data-count="${cards.length}" aria-label="Sản phẩm gợi ý"><p class="product-cards-label">Đề xuất cho bé</p><ul class="product-cards-list">${items}</ul></aside>`;
}

function dimensionAttrs(card: ProductCardEmbed): string {
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
    productCards: {
      insertProductCards: (items: ProductCardRef[]) => ReturnType;
      updateProductCards: (items: ProductCardRef[]) => ReturnType;
    };
  }
}

export const ProductCards = Node.create({
  name: PRODUCT_CARDS_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      ids: {
        default: [] as number[],
        parseHTML: (element) => readJsonAttr(element, 'data-ids'),
        renderHTML: (attributes) => ({ 'data-ids': JSON.stringify(normalizeProductCardIds(attributes.ids)) }),
      },
      labels: {
        default: [] as string[],
        parseHTML: (element) => readJsonAttr(element, 'data-labels'),
        renderHTML: (attributes) => {
          const ids = normalizeProductCardIds(attributes.ids);
          return { 'data-labels': JSON.stringify(normalizeProductCardLabels(attributes.labels, ids.length)) };
        },
      },
      covers: {
        default: [] as string[],
        parseHTML: (element) => readJsonAttr(element, 'data-covers'),
        renderHTML: (attributes) => {
          const ids = normalizeProductCardIds(attributes.ids);
          return { 'data-covers': JSON.stringify(normalizeProductCardCovers(attributes.covers, ids.length)) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="product-cards"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'product-cards', class: 'editor-product-cards' }, HTMLAttributes)];
  },

  addCommands() {
    return {
      insertProductCards:
        (items) =>
        ({ commands }) => {
          const payload = toAttrs(items);
          if (payload.ids.length === 0) return false;
          return commands.insertContent([{ type: this.name, attrs: payload }, { type: 'paragraph' }]);
        },
      updateProductCards:
        (items) =>
        ({ commands, state }) => {
          const payload = toAttrs(items);
          if (payload.ids.length === 0) return false;
          if (state.selection.empty) return false;
          return commands.updateAttributes(this.name, payload);
        },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const root = document.createElement('div');
      root.className = 'editor-product-cards';
      root.dataset.type = 'product-cards';
      root.contentEditable = 'false';

      const paint = () => {
        const ids = normalizeProductCardIds(node.attrs.ids);
        const labels = normalizeProductCardLabels(node.attrs.labels, ids.length);
        const covers = normalizeProductCardCovers(node.attrs.covers, ids.length);
        root.dataset.count = String(ids.length);
        const rows =
          ids.length === 0
            ? `<p class="editor-product-cards-empty">Chưa chọn sản phẩm.</p>`
            : `<ul class="editor-product-cards-list">${ids
                .map((id, index) => {
                  const name = labels[index] || `Sản phẩm #${id}`;
                  const cover = covers[index] ?? '';
                  const thumb = cover
                    ? `<span class="editor-product-cards-thumb"><img src="${escapeHTMLAttribute(cover)}" alt="" loading="lazy" decoding="async" /></span>`
                    : `<span class="editor-product-cards-thumb is-empty" aria-hidden="true"></span>`;
                  return `<li>${thumb}<span class="editor-product-cards-title">${escapeText(name)}</span></li>`;
                })
                .join('')}</ul>`;
        root.innerHTML = `<div class="editor-product-cards-head"><p class="editor-product-cards-label">Đề xuất cho bé</p><div class="editor-product-cards-actions"><button type="button" data-edit>Sửa</button><button type="button" data-remove>Xóa</button></div></div>${rows}`;
        root.querySelector('[data-edit]')?.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const pos = typeof getPos === 'function' ? getPos() : null;
          if (typeof pos === 'number') editor.chain().focus().setNodeSelection(pos).run();
          root.dispatchEvent(new CustomEvent('product-cards-edit', { bubbles: true }));
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
          if (updated.type.name !== PRODUCT_CARDS_NODE) return false;
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

function toAttrs(items: ProductCardRef[]): { ids: number[]; labels: string[]; covers: string[] } {
  const ids: number[] = [];
  const labels: string[] = [];
  const covers: string[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!Number.isInteger(item.id) || item.id < 1 || seen.has(item.id)) continue;
    seen.add(item.id);
    ids.push(item.id);
    labels.push(item.name.trim().slice(0, 180));
    const cover = typeof item.coverUrl === 'string' && isProductCoverSrc(item.coverUrl) ? item.coverUrl : '';
    covers.push(cover);
    if (ids.length >= PRODUCT_CARDS_MAX) break;
  }
  return { ids, labels, covers };
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
