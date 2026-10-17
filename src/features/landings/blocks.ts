// Mô hình khối của Landing Page. Đây là nguồn định nghĩa duy nhất dùng chung cho editor, render và lưu trữ.
// Khối được lưu dưới dạng JSON trong landings.blocks_json và luôn đi qua parseBlocks() để làm sạch.

export const LANDING_BLOCK_TYPES = ['hero', 'text', 'image', 'benefits', 'products', 'cta'] as const;
export type LandingBlockType = (typeof LANDING_BLOCK_TYPES)[number];

// Mỏ neo cuộn hợp lệ: chỉ trỏ tới khối sản phẩm hoặc form đặt hàng trên chính trang.
export const LANDING_ANCHORS = ['#san-pham', '#dat-hang'] as const;
export type LandingAnchor = (typeof LANDING_ANCHORS)[number];

export const LANDING_MAX_BLOCKS = 20;
export const LANDING_MAX_BENEFITS = 12;
export const LANDING_MAX_PRODUCTS = 24;

const TITLE_MAX = 160;
const TEXT_MAX = 2000;
const SHORT_MAX = 300;
const LABEL_MAX = 80;

export type HeroBlock = {
  type: 'hero';
  eyebrow: string;
  title: string;
  subtitle: string;
  imageMediaId: number | null;
  ctaText: string;
  ctaAnchor: LandingAnchor;
};

export type TextBlock = {
  type: 'text';
  title: string;
  body: string;
};

export type ImageBlock = {
  type: 'image';
  imageMediaId: number | null;
  caption: string;
};

export type BenefitItem = { title: string; desc: string };
export type BenefitsBlock = {
  type: 'benefits';
  title: string;
  items: BenefitItem[];
};

export type ProductsBlock = {
  type: 'products';
  title: string;
  // Danh sách id sản phẩm muốn hiện; rỗng = dùng toàn bộ sản phẩm đang bán (giải quyết lúc render).
  productIds: number[];
};

export type CtaBlock = {
  type: 'cta';
  title: string;
  subtitle: string;
  buttonText: string;
  anchor: LandingAnchor;
};

export type LandingBlock = HeroBlock | TextBlock | ImageBlock | BenefitsBlock | ProductsBlock | CtaBlock;

function isType(value: string): value is LandingBlockType {
  return (LANDING_BLOCK_TYPES as readonly string[]).includes(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function anchor(value: unknown): LandingAnchor {
  return value === '#san-pham' || value === '#dat-hang' ? value : '#dat-hang';
}

function mediaId(value: unknown): number | null {
  const id = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function productIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const id = typeof item === 'number' ? item : Number(item);
    if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
      if (ids.length >= LANDING_MAX_PRODUCTS) break;
    }
  }
  return ids;
}

function cleanBlock(value: unknown): LandingBlock | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.type !== 'string' || !isType(record.type)) return null;

  if (record.type === 'hero') {
    const title = text(record.title, TITLE_MAX);
    if (!title) return null;
    return {
      type: 'hero',
      eyebrow: text(record.eyebrow, LABEL_MAX),
      title,
      subtitle: text(record.subtitle, SHORT_MAX),
      imageMediaId: mediaId(record.imageMediaId),
      ctaText: text(record.ctaText, LABEL_MAX),
      ctaAnchor: anchor(record.ctaAnchor),
    };
  }

  if (record.type === 'text') {
    const title = text(record.title, TITLE_MAX);
    const body = text(record.body, TEXT_MAX);
    if (!title && !body) return null;
    return { type: 'text', title, body };
  }

  if (record.type === 'image') {
    const image = mediaId(record.imageMediaId);
    if (!image) return null;
    return { type: 'image', imageMediaId: image, caption: text(record.caption, SHORT_MAX) };
  }

  if (record.type === 'benefits') {
    const rawItems = Array.isArray(record.items) ? record.items : [];
    const items: BenefitItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const itemTitle = text(item.title, LABEL_MAX);
      const desc = text(item.desc, SHORT_MAX);
      if (!itemTitle && !desc) continue;
      items.push({ title: itemTitle, desc });
      if (items.length >= LANDING_MAX_BENEFITS) break;
    }
    if (items.length === 0) return null;
    return { type: 'benefits', title: text(record.title, TITLE_MAX), items };
  }

  if (record.type === 'products') {
    return { type: 'products', title: text(record.title, TITLE_MAX), productIds: productIds(record.productIds) };
  }

  // cta
  const buttonText = text(record.buttonText, LABEL_MAX);
  return {
    type: 'cta',
    title: text(record.title, TITLE_MAX),
    subtitle: text(record.subtitle, SHORT_MAX),
    buttonText: buttonText || 'Đặt hàng ngay',
    anchor: anchor(record.anchor),
  };
}

/** Làm sạch danh sách khối từ JSON (form hoặc DB). Bỏ khối lỗi, cắt độ dài, giới hạn số lượng. */
export function parseBlocks(raw: unknown): LandingBlock[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const blocks: LandingBlock[] = [];
  for (const item of value) {
    const block = cleanBlock(item);
    if (block) blocks.push(block);
    if (blocks.length >= LANDING_MAX_BLOCKS) break;
  }
  return blocks;
}

export function serializeBlocks(blocks: LandingBlock[]): string {
  return JSON.stringify(blocks);
}

/** Gom mọi id sản phẩm được tham chiếu trong các khối products để render resolve một lần. */
export function referencedProductIds(blocks: LandingBlock[]): number[] {
  const ids = new Set<number>();
  for (const block of blocks) {
    if (block.type === 'products') for (const id of block.productIds) ids.add(id);
  }
  return [...ids];
}

export function hasProductsBlock(blocks: LandingBlock[]): boolean {
  return blocks.some((block) => block.type === 'products');
}

/** Gom mọi id ảnh được tham chiếu trong các khối (hero, image) để render resolve một lần. */
export function referencedMediaIds(blocks: LandingBlock[]): number[] {
  const ids = new Set<number>();
  for (const block of blocks) {
    if ((block.type === 'hero' || block.type === 'image') && block.imageMediaId) ids.add(block.imageMediaId);
  }
  return [...ids];
}
