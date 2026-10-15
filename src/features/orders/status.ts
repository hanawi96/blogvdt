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

const NEXT_ORDER_STATUS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['shipped', 'cancelled'],
  shipped: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export function nextOrderStatuses(status: OrderStatus): readonly OrderStatus[] {
  return NEXT_ORDER_STATUS[status];
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || NEXT_ORDER_STATUS[from].includes(to);
}

export function orderTransitionError(from: OrderStatus, to: OrderStatus): string {
  const next = NEXT_ORDER_STATUS[from];
  if (next.length === 0) return `Đơn ${ORDER_STATUS_LABELS[from].toLowerCase()} không đổi trạng thái nữa.`;
  const labels = next.map((status) => ORDER_STATUS_LABELS[status]).join(' hoặc ');
  return `Không chuyển sang ${ORDER_STATUS_LABELS[to]}. Chỉ chuyển từ ${ORDER_STATUS_LABELS[from]} sang ${labels}.`;
}

export function isProcessingOrder(status: string): boolean {
  return status === 'confirmed' || status === 'preparing' || status === 'shipped';
}

export function orderCounts(rows: { status: string; value: number }[]) {
  let all = 0;
  let incoming = 0;
  let processing = 0;
  let completed = 0;
  for (const row of rows) {
    all += row.value;
    if (row.status === 'new') incoming += row.value;
    if (isProcessingOrder(row.status)) processing += row.value;
    if (row.status === 'completed') completed += row.value;
  }
  return { all, incoming, processing, completed };
}
