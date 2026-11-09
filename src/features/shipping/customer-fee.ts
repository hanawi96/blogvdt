import { isShippingOrderCost, type OrderCostKind } from '../costs/order-costs';

/** Nhóm tính phí ship khách trả (admin + đặt hàng công khai). */
export type ShipGroup = 'bracelet' | 'silver' | 'addon' | 'other';

export const FREE_SHIP_BRACELET_MIN = 100_000;

const SILVER_SLUG = 'bi-charm-bac';
const ADDON_SLUG = 'san-pham-ban-kem';

export type ShipFeeLine = { group: ShipGroup; lineTotal: number };

export function foldShipSlug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Bi/charm bạc và bán kèm theo slug; mọi danh mục còn lại (vòng) thuộc bracelet. */
export function shipGroupOf(categorySlug: string | null | undefined): ShipGroup {
  const slug = foldShipSlug(categorySlug ?? '');
  if (!slug) return 'other';
  if (slug === SILVER_SLUG) return 'silver';
  if (slug === ADDON_SLUG) return 'addon';
  return 'bracelet';
}

/**
 * Miễn ship khi:
 * - có vòng ≥ 100.000 đ (không có bi/charm bạc), hoặc
 * - có vòng < 100.000 đ kèm ít nhất một sản phẩm bán kèm.
 * Có bi/charm bạc thì luôn tính ship.
 */
export function qualifiesFreeShip(lines: ReadonlyArray<ShipFeeLine>): boolean {
  if (lines.length === 0) return false;
  if (lines.some((line) => line.group === 'silver')) return false;
  const braceletTotal = lines.filter((line) => line.group === 'bracelet').reduce((sum, line) => sum + line.lineTotal, 0);
  if (braceletTotal >= FREE_SHIP_BRACELET_MIN) return true;
  const hasAddon = lines.some((line) => line.group === 'addon');
  return braceletTotal > 0 && braceletTotal < FREE_SHIP_BRACELET_MIN && hasAddon;
}

/** Phí ship khách trả mặc định = tổng khoản ship cố định đang bật trong chi phí đơn. */
export function baseCustomerShippingFee(
  costs: ReadonlyArray<{ name: string; kind: OrderCostKind; value: number; active?: boolean }>,
): number {
  return costs
    .filter((cost) => cost.active !== false && cost.kind === 'fixed' && isShippingOrderCost(cost.name))
    .reduce((sum, cost) => sum + cost.value, 0);
}

export function resolveCustomerShippingFee(input: {
  lines: ReadonlyArray<ShipFeeLine>;
  baseFee: number;
}): { free: boolean; fee: number } {
  const free = qualifiesFreeShip(input.lines);
  const base = Number.isSafeInteger(input.baseFee) && input.baseFee > 0 ? input.baseFee : 0;
  return { free, fee: free ? 0 : base };
}
