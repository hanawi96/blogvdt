export const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Mới',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị',
  shipped: 'Đã gửi',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUSES.some((status) => status === value);
}

export function orderStatusLabel(status: string): string {
  const match = ORDER_STATUSES.find((item) => item === status);
  return match ? ORDER_STATUS_LABELS[match] : status;
}
