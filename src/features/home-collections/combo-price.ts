/** Helper tính giá combo/bán kèm — thuần, dùng được cả server và client. */

export const COMBO_DISCOUNT_PERCENT_MAX = 70;
export const COMBO_DISCOUNT_AMOUNT_MAX = 5_000_000;
export const COMBO_DISCOUNT_TYPES = ['percent', 'amount'] as const;
export type ComboDiscountType = (typeof COMBO_DISCOUNT_TYPES)[number];

export type ComboOffer = {
  buyQty: number;
  discountType: ComboDiscountType;
  discountValue: number;
};

export type AddonBundleOffer = {
  primaryId: number;
  addonIds: readonly number[];
  discountType: ComboDiscountType;
  discountValue: number;
};

/** Bundle theo slug — nhúng JSON cho modal / form client. */
export type PublicAddonBundleOffer = {
  primarySlug: string;
  addonSlugs: readonly string[];
  discountType: ComboDiscountType;
  discountValue: number;
};

export type PublicComboPricing = {
  comboBySlug: Record<string, ComboOffer[]>;
  addonBundles: PublicAddonBundleOffer[];
};

export function comboUnitPrice(
  basePrice: number,
  offer: Pick<ComboOffer, 'discountType' | 'discountValue'>,
): number {
  if (!Number.isInteger(basePrice) || basePrice < 0) return 0;
  if (offer.discountType === 'percent') {
    const pct = Math.min(COMBO_DISCOUNT_PERCENT_MAX, Math.max(0, offer.discountValue));
    return Math.max(0, Math.round(basePrice * (1 - pct / 100)));
  }
  const cut = Math.min(Math.max(0, Math.round(offer.discountValue)), basePrice);
  return Math.max(0, basePrice - cut);
}

export function catalogUnitWithComboOffers(
  basePrice: number,
  productId: number,
  quantity: number,
  offersByProduct?: ReadonlyMap<number, readonly ComboOffer[]>,
): number {
  const offers = offersByProduct?.get(productId);
  return catalogUnitWithOfferList(basePrice, quantity, offers);
}

/** Áp offer theo danh sách (client: lấy từ comboBySlug[slug]). */
export function catalogUnitWithOfferList(
  basePrice: number,
  quantity: number,
  offers?: readonly ComboOffer[],
): number {
  if (!offers?.length || !Number.isInteger(quantity) || quantity < 1) return basePrice;
  let best = basePrice;
  for (const offer of offers) {
    if (quantity < offer.buyQty) continue;
    best = Math.min(best, comboUnitPrice(basePrice, offer));
  }
  return best;
}

export function comboSaveTotal(
  basePrice: number,
  quantity: number,
  offer: Pick<ComboOffer, 'discountType' | 'discountValue' | 'buyQty'>,
): number {
  if (!Number.isInteger(quantity) || quantity < offer.buyQty) return 0;
  const unit = comboUnitPrice(basePrice, offer);
  return Math.max(0, (basePrice - unit) * quantity);
}

export function addonUnitWithBundleOffers(
  addonPrice: number,
  addonId: number,
  orderProductIds: ReadonlySet<number>,
  offers?: readonly AddonBundleOffer[],
): number {
  if (!offers?.length || !Number.isInteger(addonPrice) || addonPrice < 0) return addonPrice;
  let best = addonPrice;
  for (const offer of offers) {
    if (!orderProductIds.has(offer.primaryId)) continue;
    if (!offer.addonIds.includes(addonId)) continue;
    best = Math.min(best, comboUnitPrice(addonPrice, offer));
  }
  return best;
}

export function addonUnitWithSlugBundles(
  addonPrice: number,
  addonSlug: string,
  primarySlug: string,
  bundles?: readonly PublicAddonBundleOffer[],
): number {
  if (!bundles?.length || !addonSlug || !primarySlug) return addonPrice;
  if (!Number.isInteger(addonPrice) || addonPrice < 0) return addonPrice;
  let best = addonPrice;
  for (const offer of bundles) {
    if (offer.primarySlug !== primarySlug) continue;
    if (!offer.addonSlugs.includes(addonSlug)) continue;
    best = Math.min(best, comboUnitPrice(addonPrice, offer));
  }
  return best;
}

/** Đổi offer theo id → theo slug (khi đã có catalog). */
export function toPublicComboPricing(
  comboById: ReadonlyMap<number, readonly ComboOffer[]>,
  bundles: readonly AddonBundleOffer[],
  catalog: readonly { id: number; slug: string }[],
): PublicComboPricing {
  const slugById = new Map(catalog.map((item) => [item.id, item.slug]));
  const comboBySlug: PublicComboPricing['comboBySlug'] = {};
  for (const [productId, offers] of comboById) {
    const slug = slugById.get(productId);
    if (!slug || offers.length < 1) continue;
    comboBySlug[slug] = [...(comboBySlug[slug] ?? []), ...offers];
  }
  const addonBundles: PublicAddonBundleOffer[] = [];
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
