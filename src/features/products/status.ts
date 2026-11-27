import { and, eq, gt, isNull, or, type SQL } from 'drizzle-orm';
import { productCategories, products } from '../../lib/db/schema';

export const PRODUCT_STATUSES = ['active', 'inactive'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  active: 'Đang bán',
  inactive: 'Ngừng bán',
};

export const PRODUCT_CATEGORY_STATUS_LABELS: Record<ProductStatus, string> = {
  active: 'Đang hoạt động',
  inactive: 'Tạm tắt',
};

export function isProductStatus(value: string): value is ProductStatus {
  return PRODUCT_STATUSES.some((status) => status === value);
}

/** Nhãn trạng thái trên danh sách admin: active + hết tồn → Hết hàng. */
export function productAdminStatusLabel(status: string, stockQty: number): string {
  if (status === 'active' && stockQty <= 0) return 'Hết hàng';
  return isProductStatus(status) ? PRODUCT_STATUS_LABELS[status] : status;
}

/** Tone badge admin: oos khi đang bán nhưng tồn ≤ 0. */
export function productAdminStatusTone(status: string, stockQty: number): 'active' | 'inactive' | 'oos' {
  if (status === 'active' && stockQty <= 0) return 'oos';
  return status === 'active' ? 'active' : 'inactive';
}

/**
 * SP đang bật + danh mục (nếu có) đang bật — không lọc tồn.
 * Query phải leftJoin productCategories. Dùng nội bộ admin/sửa đơn khi vẫn cần SP hết hàng.
 */
export function activeProductWhere(): SQL {
  return and(
    eq(products.status, 'active'),
    or(isNull(products.categoryId), eq(productCategories.status, 'active')),
  )!;
}

/** SP công khai còn bán: active + danh mục bật + còn tồn. Query phải leftJoin productCategories. */
export function sellableProductWhere(): SQL {
  return and(activeProductWhere(), gt(products.stockQty, 0))!;
}

/** Kiểm tra sau khi đã load SP + status danh mục (null = không có danh mục) + tồn nếu có. */
export function isPubliclySellable(product: {
  status: string;
  categoryStatus?: string | null;
  stockQty?: number | null;
}): boolean {
  if (product.status !== 'active') return false;
  if (product.categoryStatus != null && product.categoryStatus !== 'active') return false;
  if (product.stockQty != null && product.stockQty <= 0) return false;
  return true;
}
