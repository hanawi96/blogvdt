/** Khoảng số lượng mua theo danh mục. Trần tuyệt đối khớp cart/order. */
export const QTY_HARD_MAX = 500;
export const QTY_DEFAULT_MIN = 1;
export const QTY_DEFAULT_MAX = 20;

export type QtyBounds = { min: number; max: number };

export function readQtyBound(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, QTY_HARD_MAX);
}

/** Chuẩn hóa min/max; đảm bảo 1 ≤ min ≤ max ≤ hard max. */
export function qtyBounds(input?: { qtyMin?: unknown; qtyMax?: unknown } | null): QtyBounds {
  let min = readQtyBound(input?.qtyMin, QTY_DEFAULT_MIN);
  let max = readQtyBound(input?.qtyMax, QTY_DEFAULT_MAX);
  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }
  return { min, max };
}

export function isValidQty(bounds: QtyBounds, quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= bounds.min && quantity <= bounds.max;
}

/** Cần mở modal chọn SL trước khi thêm giỏ (vd hạt tối thiểu 10). */
export function needsQtyPicker(bounds: QtyBounds): boolean {
  return bounds.min > 1;
}

export function qtyHint(bounds: QtyBounds): string | null {
  if (!needsQtyPicker(bounds)) return null;
  return `Tối thiểu ${bounds.min} hạt, tối đa ${bounds.max} hạt`;
}

export function qtyRequiredMessage(bounds: QtyBounds): string {
  return `Số lượng từ ${bounds.min} đến ${bounds.max}.`;
}
