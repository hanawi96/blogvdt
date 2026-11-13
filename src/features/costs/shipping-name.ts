// Nhận diện khoản chi phí là phí ship theo tên (hàm thuần, dùng chung cho cả client lẫn server).
// Tách khỏi order-costs.ts để không kéo theo drizzle/DB vào bundle client.
export function isShippingOrderCost(name: string): boolean {
  const folded = name.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  return folded === 'phi van chuyen' || folded === 'phi ship' || folded === 'ship';
}
