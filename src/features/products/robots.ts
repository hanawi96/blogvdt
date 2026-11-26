/** SEO trang chi tiết sản phẩm — khớp tags.robots. */
export const PRODUCT_ROBOTS = ['noindex', 'index'] as const;
export type ProductRobots = (typeof PRODUCT_ROBOTS)[number];

export function isProductRobots(value: string): value is ProductRobots {
  return value === 'index' || value === 'noindex';
}

export function readProductRobots(value: string | null | undefined): ProductRobots {
  return value === 'index' ? 'index' : 'noindex';
}
