import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { activityWrite, commitWrites, quotedLabel, type ActivityActor } from '../activity/log';
import { isUniqueViolation } from '../orders/order';
import { slugify } from '../posts/slug';
import { listingMediaKey } from '../media/files';
import { categoryMovePlan } from '../products/categories';
import { toCatalogCard, type CatalogCard } from '../products/catalog';
import { sellableProductWhere } from '../products/status';
import type { AppDb } from '../../lib/db/client';
import { routes } from '../../lib/routes';
import { homeCollections, media, productCategories, products } from '../../lib/db/schema';

export const HOME_COLLECTION_KINDS = ['products', 'pair_discount', 'bracelet_addon'] as const;
export type HomeCollectionKind = (typeof HOME_COLLECTION_KINDS)[number];

export const HOME_COLLECTION_MAX = 3;
export const HOME_COLLECTION_PRODUCT_MAX = 6;
/** Vòng + bán kèm: tối đa 3 combo (mỗi combo = 1 chính + vài phụ để khách chọn). */
export const HOME_COLLECTION_PAIR_MAX = 3;
/** Số lựa chọn bán kèm tối đa trong một combo (vd. 7 cành / 9 cành). */
export const HOME_COLLECTION_BRACELET_ADDON_MAX = 3;
export const HOME_COLLECTION_TITLE_MAX = 80;
export const HOME_COLLECTION_SUBTITLE_MAX = 160;
export {
  COMBO_DISCOUNT_AMOUNT_MAX,
  COMBO_DISCOUNT_PERCENT_MAX,
  COMBO_DISCOUNT_TYPES,
  addonUnitWithBundleOffers,
  catalogUnitWithComboOffers,
  comboSaveTotal,
  comboUnitPrice,
  toPublicComboPricing,
  type AddonBundleOffer,
  type ComboDiscountType,
  type ComboOffer,
  type PublicAddonBundleOffer,
  type PublicComboPricing,
} from './combo-price';
import {
  COMBO_DISCOUNT_AMOUNT_MAX,
  COMBO_DISCOUNT_PERCENT_MAX,
  type AddonBundleOffer,
  type ComboDiscountType,
  type ComboOffer,
  type PublicComboPricing,
} from './combo-price';

export type HomeCollectionRule = {
  /** Số lượng gợi ý khi mua combo (pair_discount). */
  buyQty?: number;
  /** Nhãn badge hiển thị. */
  badge?: string;
  /** Giảm combo thật: % hoặc số tiền trên mỗi chiếc khi mua ≥ buyQty. */
  discountType?: ComboDiscountType;
  discountValue?: number;
};

/** Một combo vòng: 1 SP chính + 1–N SP phụ (khách chọn một khi mua). */
export type BraceletAddonGroup = {
  primary: number;
  addons: number[];
};

export type HomeCollection = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  kind: HomeCollectionKind;
  productIds: number[];
  /** Chỉ có khi kind = bracelet_addon. */
  braceletGroups: BraceletAddonGroup[];
  rule: HomeCollectionRule;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

export type HomeCollectionPublicBraceletGroup = {
  primary: CatalogCard;
  addons: CatalogCard[];
};

export type HomeCollectionPublic = {
  id: number;
  slug: string;
  title: string;
  subtitle: string;
  kind: HomeCollectionKind;
  rule: HomeCollectionRule;
  products: CatalogCard[];
  braceletGroups?: HomeCollectionPublicBraceletGroup[];
};

export type HomeCollectionInput = {
  id?: number;
  title: string;
  slug: string;
  subtitle: string;
  kind: string;
  productIds: number[];
  braceletGroups?: BraceletAddonGroup[];
  badge: string;
  buyQty: string;
  /** '' | percent | amount */
  discountType: string;
  discountValue: string;
  active: boolean;
  sortOrder: string;
};

export function hasRuleDiscount(
  rule: HomeCollectionRule,
): rule is HomeCollectionRule & { discountType: ComboDiscountType; discountValue: number } {
  return (
    rule.discountType != null &&
    typeof rule.discountValue === 'number' &&
    Number.isInteger(rule.discountValue) &&
    rule.discountValue > 0
  );
}

export function hasComboDiscount(rule: HomeCollectionRule): rule is HomeCollectionRule & ComboOffer {
  return hasRuleDiscount(rule) && typeof rule.buyQty === 'number' && rule.buyQty >= 2;
}

function isKind(value: string): value is HomeCollectionKind {
  return (HOME_COLLECTION_KINDS as readonly string[]).includes(value);
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Chấp nhận number hoặc chuỗi số từ FormData/JSON lỏng. */
function toPositiveId(value: unknown): number | null {
  if (isPositiveId(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function flattenBraceletGroups(groups: readonly BraceletAddonGroup[]): number[] {
  const ids: number[] = [];
  for (const group of groups) {
    if (!ids.includes(group.primary)) ids.push(group.primary);
    for (const addon of group.addons) {
      if (!ids.includes(addon)) ids.push(addon);
    }
  }
  return ids;
}

/** Chuẩn hóa nhóm vòng+kèm; hỗ trợ JSON mới + mảng phẳng legacy [chính, phụ, ...]. */
export function parseBraceletGroups(raw: string): BraceletAddonGroup[] {
  try {
    const text = raw.trim();
    if (!text) return [];
    // Cho phép client gửi encodeURIComponent để tránh lỗi quote trong form.
    const decoded = text.includes('%') ? (() => {
      try {
        return decodeURIComponent(text);
      } catch {
        return text;
      }
    })() : text;
    const parsed: unknown = JSON.parse(decoded);
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    // Format mới: [{ primary, addons: number[] }, ...]
    if (parsed.some((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      const groups: BraceletAddonGroup[] = [];
      for (const item of parsed) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const row = item as { primary?: unknown; addons?: unknown };
        const primary = toPositiveId(row.primary);
        if (primary == null) continue;
        const addons: number[] = [];
        if (Array.isArray(row.addons)) {
          for (const addonRaw of row.addons) {
            const addon = toPositiveId(addonRaw);
            if (addon == null || addon === primary || addons.includes(addon)) continue;
            addons.push(addon);
            if (addons.length >= HOME_COLLECTION_BRACELET_ADDON_MAX) break;
          }
        }
        if (addons.length === 0) continue;
        groups.push({ primary, addons });
        if (groups.length >= HOME_COLLECTION_PAIR_MAX) break;
      }
      return groups;
    }

    // Legacy: [primary, addon, primary, addon, ...]
    const flat: number[] = [];
    for (const item of parsed) {
      const id = toPositiveId(item);
      if (id == null || flat.includes(id)) continue;
      flat.push(id);
    }
    const groups: BraceletAddonGroup[] = [];
    for (let i = 0; i + 1 < flat.length && groups.length < HOME_COLLECTION_PAIR_MAX; i += 2) {
      const primary = flat[i]!;
      const addon = flat[i + 1]!;
      if (primary === addon) continue;
      groups.push({ primary, addons: [addon] });
    }
    return groups;
  } catch {
    return [];
  }
}

function parseIds(raw: string, kind?: HomeCollectionKind): number[] {
  if (kind === 'bracelet_addon') return flattenBraceletGroups(parseBraceletGroups(raw));
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: number[] = [];
    for (const item of parsed) {
      if (!isPositiveId(item) || ids.includes(item)) continue;
      ids.push(item);
      if (ids.length >= HOME_COLLECTION_PRODUCT_MAX) break;
    }
    return ids;
  } catch {
    return [];
  }
}

export function encodeBraceletGroups(groups: readonly BraceletAddonGroup[]): string {
  return JSON.stringify(
    groups.map((group) => ({
      primary: group.primary,
      addons: group.addons,
    })),
  );
}

function parseRule(raw: string | null): HomeCollectionRule {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const row = parsed as {
      buyQty?: unknown;
      badge?: unknown;
      discountType?: unknown;
      discountValue?: unknown;
    };
    const rule: HomeCollectionRule = {};
    if (typeof row.buyQty === 'number' && Number.isInteger(row.buyQty) && row.buyQty >= 2 && row.buyQty <= 10) {
      rule.buyQty = row.buyQty;
    }
    if (typeof row.badge === 'string') {
      const badge = row.badge.replace(/\s+/g, ' ').trim().slice(0, 40);
      if (badge) rule.badge = badge;
    }
    if (row.discountType === 'percent' || row.discountType === 'amount') {
      const value = typeof row.discountValue === 'number' ? row.discountValue : Number(row.discountValue);
      if (Number.isInteger(value) && value > 0) {
        if (row.discountType === 'percent' && value <= COMBO_DISCOUNT_PERCENT_MAX) {
          rule.discountType = 'percent';
          rule.discountValue = value;
        } else if (row.discountType === 'amount' && value <= COMBO_DISCOUNT_AMOUNT_MAX) {
          rule.discountType = 'amount';
          rule.discountValue = value;
        }
      }
    }
    return rule;
  } catch {
    return {};
  }
}

function encodeRule(rule: HomeCollectionRule): string | null {
  if (rule.buyQty == null && !rule.badge && rule.discountType == null) return null;
  return JSON.stringify(rule);
}

export function parseComboDiscountInput(
  typeRaw: string,
  valueRaw: string,
): { ok: true; discountType?: ComboDiscountType; discountValue?: number } | { ok: false; error: string } {
  const type = typeRaw.trim();
  const valueText = valueRaw.replace(/\s+/g, '').trim();
  if (!type) {
    if (valueText) return { ok: false, error: 'Chọn kiểu giảm giá combo (% hoặc số tiền).' };
    return { ok: true };
  }
  if (type !== 'percent' && type !== 'amount') return { ok: false, error: 'Kiểu giảm giá không hợp lệ.' };
  const value = Number(valueText);
  if (!Number.isInteger(value) || value < 1) {
    return { ok: false, error: type === 'percent' ? 'Nhập % giảm từ 1 đến 70.' : 'Nhập số tiền giảm là số nguyên dương.' };
  }
  if (type === 'percent' && value > COMBO_DISCOUNT_PERCENT_MAX) {
    return { ok: false, error: `Giảm tối đa ${COMBO_DISCOUNT_PERCENT_MAX}%.` };
  }
  if (type === 'amount' && value > COMBO_DISCOUNT_AMOUNT_MAX) {
    return { ok: false, error: 'Số tiền giảm quá lớn.' };
  }
  return { ok: true, discountType: type, discountValue: value };
}

type Row = {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  kind: string;
  productIdsJson: string;
  ruleJson: string | null;
  active: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

function toCollection(row: Row): HomeCollection | null {
  if (!isKind(row.kind)) return null;
  const braceletGroups = row.kind === 'bracelet_addon' ? parseBraceletGroups(row.productIdsJson) : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle ?? '',
    kind: row.kind,
    productIds: parseIds(row.productIdsJson, row.kind),
    braceletGroups,
    rule: parseRule(row.ruleJson),
    active: row.active === 1,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const columns = {
  id: homeCollections.id,
  slug: homeCollections.slug,
  title: homeCollections.title,
  subtitle: homeCollections.subtitle,
  kind: homeCollections.kind,
  productIdsJson: homeCollections.productIdsJson,
  ruleJson: homeCollections.ruleJson,
  active: homeCollections.active,
  sortOrder: homeCollections.sortOrder,
  createdAt: homeCollections.createdAt,
  updatedAt: homeCollections.updatedAt,
};

const soldCount = sql<number>`(
  coalesce(${products.soldBase}, 0)
  + coalesce((select sum(o.quantity) from orders o where o.product_id = ${products.id} and o.status <> 'cancelled' and o.compensation = 0), 0)
  + coalesce((select sum(i.quantity) from order_items i join orders o2 on o2.id = i.order_id where i.product_id = ${products.id} and o2.status <> 'cancelled' and o2.compensation = 0), 0)
)`;

export async function listHomeCollections(db: AppDb): Promise<HomeCollection[]> {
  const rows = await db
    .select(columns)
    .from(homeCollections)
    .orderBy(asc(homeCollections.sortOrder), asc(homeCollections.id))
    .limit(HOME_COLLECTION_MAX + 5);
  return rows.flatMap((row) => {
    const item = toCollection(row);
    return item ? [item] : [];
  });
}

export async function getHomeCollection(db: AppDb, id: number): Promise<HomeCollection | null> {
  const rows = await db.select(columns).from(homeCollections).where(eq(homeCollections.id, id)).limit(1);
  const row = rows[0];
  return row ? toCollection(row) : null;
}

export function collectionFormValue(row: HomeCollection): HomeCollectionInput {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    subtitle: row.subtitle,
    kind: row.kind,
    productIds: row.productIds,
    braceletGroups: row.braceletGroups,
    badge: row.rule.badge ?? '',
    buyQty: String(row.rule.buyQty ?? 2),
    discountType: row.rule.discountType ?? '',
    discountValue: row.rule.discountValue != null ? String(row.rule.discountValue) : '',
    active: row.active,
    sortOrder: String(row.sortOrder),
  };
}

/** Offer giảm combo đang bật theo productId — dùng khi tính giá giỏ/đơn. */
export async function listActiveComboOffersByProductId(
  db: AppDb,
): Promise<Map<number, ComboOffer[]>> {
  const rows = await db
    .select(columns)
    .from(homeCollections)
    .where(and(eq(homeCollections.active, 1), eq(homeCollections.kind, 'pair_discount')))
    .orderBy(asc(homeCollections.sortOrder), asc(homeCollections.id))
    .limit(HOME_COLLECTION_MAX);
  const map = new Map<number, ComboOffer[]>();
  for (const row of rows) {
    const item = toCollection(row);
    if (!item || !hasComboDiscount(item.rule)) continue;
    const offer: ComboOffer = {
      buyQty: item.rule.buyQty,
      discountType: item.rule.discountType,
      discountValue: item.rule.discountValue,
    };
    for (const productId of item.productIds) {
      const list = map.get(productId) ?? [];
      list.push(offer);
      map.set(productId, list);
    }
  }
  return map;
}

/** Offer giảm bán kèm đang bật — dùng khi tính giá giỏ/đơn có vòng + bán kèm. */
export async function listActiveAddonBundleOffers(db: AppDb): Promise<AddonBundleOffer[]> {
  const rows = await db
    .select(columns)
    .from(homeCollections)
    .where(and(eq(homeCollections.active, 1), eq(homeCollections.kind, 'bracelet_addon')))
    .orderBy(asc(homeCollections.sortOrder), asc(homeCollections.id))
    .limit(HOME_COLLECTION_MAX);
  const out: AddonBundleOffer[] = [];
  for (const row of rows) {
    const item = toCollection(row);
    if (!item || !hasRuleDiscount(item.rule)) continue;
    for (const group of item.braceletGroups) {
      if (!isPositiveId(group.primary) || group.addons.length < 1) continue;
      out.push({
        primaryId: group.primary,
        addonIds: group.addons,
        discountType: item.rule.discountType,
        discountValue: item.rule.discountValue,
      });
    }
  }
  return out;
}

/** Offer theo slug — nhúng JSON cho modal Mua ngay / form đặt hàng (client tính tạm). */
export async function listPublicComboPricing(db: AppDb): Promise<PublicComboPricing> {
  const [comboById, bundles] = await Promise.all([
    listActiveComboOffersByProductId(db),
    listActiveAddonBundleOffers(db),
  ]);
  const ids = [
    ...comboById.keys(),
    ...bundles.flatMap((offer) => [offer.primaryId, ...offer.addonIds]),
  ];
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const slugById = new Map<number, string>();
  if (unique.length > 0) {
    const rows = await db
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(inArray(products.id, unique));
    for (const row of rows) slugById.set(row.id, row.slug);
  }
  const comboBySlug: PublicComboPricing['comboBySlug'] = {};
  for (const [productId, offers] of comboById) {
    const slug = slugById.get(productId);
    if (!slug || offers.length < 1) continue;
    comboBySlug[slug] = [...(comboBySlug[slug] ?? []), ...offers];
  }
  const addonBundles: PublicComboPricing['addonBundles'] = [];
  for (const offer of bundles) {
    const primarySlug = slugById.get(offer.primaryId);
    if (!primarySlug) continue;
    const addonSlugs = offer.addonIds
      .map((id) => slugById.get(id))
      .filter((slug): slug is string => Boolean(slug));
    if (addonSlugs.length < 1) continue;
    addonBundles.push({
      primarySlug,
      addonSlugs,
      discountType: offer.discountType,
      discountValue: offer.discountValue,
    });
  }
  return { comboBySlug, addonBundles };
}

async function loadCardsByIds(db: AppDb, ids: readonly number[]): Promise<Map<number, CatalogCard>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      slug: products.slug,
      price: products.price,
      comparePrice: products.comparePrice,
      rating: products.rating,
      sold: soldCount,
      cordType: products.cordType,
      audience: products.audience,
      weightScale: productCategories.weightScale,
      qtyMin: productCategories.qtyMin,
      qtyMax: productCategories.qtyMax,
      categorySlug: productCategories.slug,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      coverAlt: media.altText,
      coverWidth: media.width,
      coverHeight: media.height,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(inArray(products.id, unique), sellableProductWhere()));
  return new Map(rows.map((row) => [row.id, toCatalogCard(row)]));
}

/** Khối đang bật có ít nhất 1 SP còn bán — dùng cho trang chủ. */
export async function listPublicHomeCollections(db: AppDb): Promise<HomeCollectionPublic[]> {
  const rows = await db
    .select(columns)
    .from(homeCollections)
    .where(eq(homeCollections.active, 1))
    .orderBy(asc(homeCollections.sortOrder), asc(homeCollections.id))
    .limit(HOME_COLLECTION_MAX);
  const collections = rows.flatMap((row) => {
    const item = toCollection(row);
    return item ? [item] : [];
  });
  if (collections.length === 0) return [];
  const allIds = collections.flatMap((item) => item.productIds);
  const cards = await loadCardsByIds(db, allIds);
  const publicRows: HomeCollectionPublic[] = [];
  for (const item of collections) {
    if (item.kind === 'bracelet_addon') {
      const braceletGroups: HomeCollectionPublicBraceletGroup[] = [];
      for (const group of item.braceletGroups) {
        const primary = cards.get(group.primary);
        if (!primary) continue;
        const addons = group.addons.flatMap((id) => {
          const card = cards.get(id);
          return card ? [card] : [];
        });
        if (addons.length === 0) continue;
        braceletGroups.push({ primary, addons });
      }
      if (braceletGroups.length === 0) continue;
      publicRows.push({
        id: item.id,
        slug: item.slug,
        title: item.title,
        subtitle: item.subtitle,
        kind: item.kind,
        rule: item.rule,
        products: braceletGroups.flatMap((group) => [group.primary, ...group.addons]),
        braceletGroups,
      });
      continue;
    }

    const products = item.productIds.flatMap((id) => {
      const card = cards.get(id);
      return card ? [card] : [];
    });
    if (products.length === 0) continue;
    publicRows.push({
      id: item.id,
      slug: item.slug,
      title: item.title,
      subtitle: item.subtitle,
      kind: item.kind,
      rule: item.rule,
      products,
    });
  }
  return publicRows;
}

export const HOME_COLLECTION_PICK_PAGE_SIZE = 20;

export type HomeCollectionPick = {
  id: number;
  name: string;
  slug: string;
  categorySlug: string;
  coverUrl: string | null;
};

export type HomeCollectionPicksPage = {
  items: HomeCollectionPick[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function mapPickRow(row: {
  id: number;
  name: string;
  slug: string;
  categorySlug: string | null;
  coverKey: string | null;
  cardKey: string | null;
}): HomeCollectionPick {
  const key = listingMediaKey(row.coverKey, row.cardKey);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    categorySlug: row.categorySlug ?? '',
    coverUrl: key ? routes.media(key) : null,
  };
}

const pickColumns = {
  id: products.id,
  name: products.name,
  slug: products.slug,
  categorySlug: productCategories.slug,
  coverKey: media.r2Key,
  cardKey: media.cardR2Key,
};

/** SP đang bán theo trang — mặc định tất cả, sold cao → thấp, 20/trang. */
export async function listHomeCollectionProductPicksPaged(
  db: AppDb,
  options: { categoryId?: number; page?: number; pageSize?: number } = {},
): Promise<HomeCollectionPicksPage> {
  const pageSize =
    Number.isInteger(options.pageSize) && (options.pageSize ?? 0) > 0
      ? Math.min(options.pageSize!, 50)
      : HOME_COLLECTION_PICK_PAGE_SIZE;
  const requestedPage = Number.isInteger(options.page) && (options.page ?? 0) > 0 ? options.page! : 1;
  const categoryId =
    Number.isInteger(options.categoryId) && (options.categoryId ?? 0) > 0 ? options.categoryId : undefined;
  const where = categoryId
    ? and(sellableProductWhere(), eq(products.categoryId, categoryId))
    : sellableProductWhere();

  const countRows = await db
    .select({ total: count() })
    .from(products)
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(where);
  const total = Number(countRows[0]?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const offset = (page - 1) * pageSize;

  const rows =
    total === 0
      ? []
      : await db
          .select(pickColumns)
          .from(products)
          .leftJoin(media, eq(products.coverMediaId, media.id))
          .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
          .where(where)
          .orderBy(desc(soldCount), desc(products.id))
          .limit(pageSize)
          .offset(offset);

  return {
    items: rows.map(mapPickRow),
    total,
    page,
    pageSize,
    pageCount,
  };
}

/** Chi tiết SP đã chọn (có thể nằm ngoài trang hiện tại). */
export async function listHomeCollectionPicksByIds(db: AppDb, ids: readonly number[]): Promise<HomeCollectionPick[]> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return [];
  const rows = await db
    .select(pickColumns)
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .leftJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(and(inArray(products.id, unique), sellableProductWhere()));
  const byId = new Map(rows.map((row) => [row.id, mapPickRow(row)]));
  return unique.flatMap((id) => {
    const pick = byId.get(id);
    return pick ? [pick] : [];
  });
}

/** Validate ID đang bán theo DB — không phụ thuộc trang picker. */
export async function assertSellableProductIds(
  db: AppDb,
  ids: readonly number[],
): Promise<Map<number, HomeCollectionPick>> {
  const picks = await listHomeCollectionPicksByIds(db, ids);
  return new Map(picks.map((row) => [row.id, row]));
}

function validateProductIds(
  _kind: HomeCollectionKind,
  ids: number[],
  picks: ReadonlyMap<number, HomeCollectionPick>,
): { ok: true; ids: number[] } | { ok: false; error: string } {
  if (ids.length === 0) return { ok: false, error: 'Chọn ít nhất một sản phẩm đang bán.' };
  if (ids.length > HOME_COLLECTION_PRODUCT_MAX) {
    return { ok: false, error: `Mỗi khối tối đa ${HOME_COLLECTION_PRODUCT_MAX} sản phẩm.` };
  }
  for (const id of ids) {
    if (!picks.has(id)) return { ok: false, error: 'Có sản phẩm không còn bán hoặc không hợp lệ.' };
  }
  return { ok: true, ids };
}

export function validateBraceletGroups(
  groups: readonly BraceletAddonGroup[],
  picks: ReadonlyMap<number, HomeCollectionPick>,
): { ok: true; groups: BraceletAddonGroup[] } | { ok: false; error: string } {
  if (groups.length === 0) return { ok: false, error: 'Thêm ít nhất một combo (chính + bán kèm).' };
  if (groups.length > HOME_COLLECTION_PAIR_MAX) {
    return { ok: false, error: `Tối đa ${HOME_COLLECTION_PAIR_MAX} combo vòng + bán kèm.` };
  }
  // Primary phải khác nhau giữa các combo; bán kèm (7/9 cành…) được dùng chung nhiều combo.
  const primaries = new Set<number>();
  const normalized: BraceletAddonGroup[] = [];
  for (const group of groups) {
    if (!isPositiveId(group.primary)) return { ok: false, error: 'Mỗi combo cần sản phẩm chính.' };
    if (!picks.has(group.primary)) return { ok: false, error: 'Có sản phẩm không còn bán hoặc không hợp lệ.' };
    if (primaries.has(group.primary)) {
      return { ok: false, error: 'Không dùng lại cùng một vòng chính ở nhiều combo.' };
    }
    primaries.add(group.primary);
  }
  for (const group of groups) {
    const addons: number[] = [];
    for (const addon of group.addons) {
      if (!isPositiveId(addon)) continue;
      if (addon === group.primary) return { ok: false, error: 'Sản phẩm phụ phải khác sản phẩm chính.' };
      if (primaries.has(addon)) {
        return { ok: false, error: 'Không dùng vòng chính của combo này làm bán kèm ở combo khác.' };
      }
      if (!picks.has(addon)) return { ok: false, error: 'Có sản phẩm không còn bán hoặc không hợp lệ.' };
      if (addons.includes(addon)) return { ok: false, error: 'Mỗi combo không chọn trùng một bán kèm.' };
      addons.push(addon);
      if (addons.length > HOME_COLLECTION_BRACELET_ADDON_MAX) {
        return { ok: false, error: `Mỗi combo tối đa ${HOME_COLLECTION_BRACELET_ADDON_MAX} lựa chọn bán kèm.` };
      }
    }
    if (addons.length === 0) return { ok: false, error: 'Mỗi combo cần ít nhất một sản phẩm bán kèm.' };
    normalized.push({ primary: group.primary, addons });
  }
  return { ok: true, groups: normalized };
}

export async function saveHomeCollection(
  db: AppDb,
  input: HomeCollectionInput,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, error: 'Nhập tiêu đề khối.' };
  if (title.length > HOME_COLLECTION_TITLE_MAX) return { ok: false, error: 'Tiêu đề quá dài.' };
  const subtitle = input.subtitle.replace(/\s+/g, ' ').trim();
  if (subtitle.length > HOME_COLLECTION_SUBTITLE_MAX) return { ok: false, error: 'Mô tả ngắn quá dài.' };

  const current = input.id ? await getHomeCollection(db, input.id) : null;
  if (input.id && !current) return { ok: false, error: 'Không tìm thấy khối.' };
  const kind = isKind(input.kind) ? input.kind : current?.kind;
  if (!kind || !isKind(kind)) return { ok: false, error: 'Chọn loại khối.' };

  // Slug nội bộ — tự tạo từ tiêu đề khi thêm mới; khi sửa giữ nguyên (không hiện trên form).
  const slug = current?.slug || slugify(title);
  if (!slug) return { ok: false, error: 'Tiêu đề không tạo được mã khối hợp lệ.' };

  const sortOrder = Number(input.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99) {
    return { ok: false, error: 'Thứ tự là số từ 0 đến 99.' };
  }

  const buyQty = Number(input.buyQty || '2');
  if (kind === 'pair_discount' && (!Number.isInteger(buyQty) || buyQty < 2 || buyQty > 10)) {
    return { ok: false, error: 'Số lượng combo từ 2 đến 10.' };
  }
  const badge = input.badge.replace(/\s+/g, ' ').trim().slice(0, 40);
  const rule: HomeCollectionRule = {};
  // Rule chỉ theo loại khối đang lưu — badge trống = xóa badge đã có.
  if (kind === 'pair_discount') {
    rule.buyQty = buyQty;
    if (badge) rule.badge = badge;
    const discount = parseComboDiscountInput(input.discountType ?? '', input.discountValue ?? '');
    if (!discount.ok) return discount;
    if (discount.discountType && discount.discountValue != null) {
      rule.discountType = discount.discountType;
      rule.discountValue = discount.discountValue;
    }
  } else if (kind === 'bracelet_addon') {
    if (badge) rule.badge = badge;
    const discount = parseComboDiscountInput(input.discountType ?? '', input.discountValue ?? '');
    if (!discount.ok) return discount;
    if (discount.discountType && discount.discountValue != null) {
      rule.discountType = discount.discountType;
      rule.discountValue = discount.discountValue;
    }
  }

  let productIds = input.productIds;
  let braceletGroups: BraceletAddonGroup[] = [];
  let productIdsJson = '[]';

  if (kind === 'bracelet_addon') {
    const incoming = (input.braceletGroups ?? []).filter(
      (group) => isPositiveId(group.primary) || group.addons.some((id) => isPositiveId(id)),
    );
    if (input.active || incoming.length > 0) {
      const flatIds = flattenBraceletGroups(
        incoming.map((group) => ({
          primary: group.primary,
          addons: group.addons.filter(isPositiveId),
        })),
      );
      const picks = await assertSellableProductIds(db, flatIds);
      const checked = validateBraceletGroups(
        incoming.map((group) => ({
          primary: group.primary,
          addons: group.addons.filter(isPositiveId),
        })),
        picks,
      );
      if (!checked.ok) return checked;
      braceletGroups = checked.groups;
      productIds = flattenBraceletGroups(braceletGroups);
      productIdsJson = encodeBraceletGroups(braceletGroups);
    }
  } else if (input.active || productIds.length > 0) {
    const picks = await assertSellableProductIds(db, productIds);
    const checked = validateProductIds(kind, productIds, picks);
    if (!checked.ok) return checked;
    productIds = checked.ids;
    productIdsJson = JSON.stringify(productIds);
  } else {
    productIds = [];
  }

  if (input.active && productIds.length === 0) {
    return { ok: false, error: 'Bật khối thì cần gắn ít nhất một sản phẩm đang bán.' };
  }

  const active = input.active ? 1 : 0;
  const ruleJson = encodeRule(rule);

  try {
    if (input.id && current) {
      await commitWrites(db, [
        db
          .update(homeCollections)
          .set({
            slug,
            title,
            subtitle: subtitle || null,
            kind,
            productIdsJson,
            ruleJson,
            active,
            sortOrder,
            updatedAt: now,
          })
          .where(eq(homeCollections.id, input.id)),
        ...(actor
          ? [
              activityWrite(
                db,
                {
                  actorId: actor.id,
                  actorName: actor.name,
                  action: 'home_collection.update',
                  objectType: 'home_collection',
                  objectId: String(input.id),
                  summary: `Đã cập nhật khối trang chủ “${quotedLabel(title, 'Không tên')}”.`,
                  createdAt: now,
                },
                true,
              ),
            ]
          : []),
      ]);
      return { ok: true, id: input.id };
    }

    const existing = await listHomeCollections(db);
    if (existing.length >= HOME_COLLECTION_MAX) {
      return { ok: false, error: `Tối đa ${HOME_COLLECTION_MAX} khối trên trang chủ.` };
    }

    const inserted = await db
      .insert(homeCollections)
      .values({
        slug,
        title,
        subtitle: subtitle || null,
        kind,
        productIdsJson,
        ruleJson,
        active,
        sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: homeCollections.id });
    const id = inserted[0]?.id;
    if (!id) return { ok: false, error: 'Chưa lưu được khối.' };
    if (actor) {
      await activityWrite(
        db,
        {
          actorId: actor.id,
          actorName: actor.name,
          action: 'home_collection.create',
          objectType: 'home_collection',
          objectId: String(id),
          summary: `Đã tạo khối trang chủ “${quotedLabel(title, 'Không tên')}”.`,
          createdAt: now,
        },
        false,
      );
    }
    return { ok: true, id };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Slug khối đã tồn tại.' };
    throw error;
  }
}

export async function deleteHomeCollection(
  db: AppDb,
  id: number,
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getHomeCollection(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy khối.' };
  const now = Date.now();
  await commitWrites(db, [
    db.delete(homeCollections).where(eq(homeCollections.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'home_collection.delete',
              objectType: 'home_collection',
              objectId: String(id),
              summary: `Đã xóa khối trang chủ “${quotedLabel(current.title, 'Không tên')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function setHomeCollectionActive(
  db: AppDb,
  id: number,
  active: boolean,
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = await getHomeCollection(db, id);
  if (!current) return { ok: false, error: 'Không tìm thấy khối.' };
  if (active && current.productIds.length === 0) {
    return { ok: false, error: 'Gắn sản phẩm trước khi bật khối.' };
  }
  await commitWrites(db, [
    db.update(homeCollections).set({ active: active ? 1 : 0, updatedAt: now }).where(eq(homeCollections.id, id)),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: active ? 'home_collection.enable' : 'home_collection.disable',
              objectType: 'home_collection',
              objectId: String(id),
              summary: `${active ? 'Đã bật' : 'Đã tắt'} khối trang chủ “${quotedLabel(current.title, 'Không tên')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true };
}

export async function moveHomeCollection(
  db: AppDb,
  id: number,
  direction: 'up' | 'down',
  now = Date.now(),
  actor?: ActivityActor,
): Promise<{ ok: true; moved: boolean } | { ok: false; error: string }> {
  const rows = await db
    .select({ id: homeCollections.id, sortOrder: homeCollections.sortOrder, title: homeCollections.title })
    .from(homeCollections)
    .orderBy(asc(homeCollections.sortOrder), asc(homeCollections.id));
  const current = rows.find((row) => row.id === id);
  if (!current) return { ok: false, error: 'Không tìm thấy khối.' };
  const plan = categoryMovePlan(
    rows.map((row) => ({ id: row.id, sortOrder: row.sortOrder })),
    id,
    direction,
  );
  if (plan.length === 0) return { ok: true, moved: false };
  await commitWrites(db, [
    ...plan.map((item) =>
      db.update(homeCollections).set({ sortOrder: item.sortOrder, updatedAt: now }).where(eq(homeCollections.id, item.id)),
    ),
    ...(actor
      ? [
          activityWrite(
            db,
            {
              actorId: actor.id,
              actorName: actor.name,
              action: 'home_collection.move',
              objectType: 'home_collection',
              objectId: String(id),
              summary: `Đã đổi thứ tự khối trang chủ “${quotedLabel(current.title, 'Không tên')}”.`,
              createdAt: now,
            },
            true,
          ),
        ]
      : []),
  ]);
  return { ok: true, moved: true };
}
