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

/** Trạng thái giao nhanh trên danh sách đơn — khớp UI «Chưa gửi / Đã gửi / Chờ gửi lại». */
export const FULFILL_STATUSES = ['unshipped', 'shipped', 'reship'] as const;
export type FulfillStatus = (typeof FULFILL_STATUSES)[number];

export const FULFILL_STATUS_LABELS: Record<FulfillStatus, string> = {
  unshipped: 'Chưa gửi hàng',
  shipped: 'Đã gửi hàng',
  reship: 'Chờ gửi lại',
};

/** Bộ lọc giao hàng trên danh sách đơn. */
export const ORDER_LIST_FILTERS = [
  { value: 'unshipped', label: 'Chưa gửi hàng' },
  { value: 'shipped', label: 'Đã gửi hàng' },
  { value: 'later', label: 'Gửi sau' },
  { value: 'reship', label: 'Chờ gửi lại' },
] as const;
export type OrderListFilter = '' | (typeof ORDER_LIST_FILTERS)[number]['value'];

export function isOrderListFilter(value: string): value is Exclude<OrderListFilter, ''> {
  return ORDER_LIST_FILTERS.some((item) => item.value === value);
}

export function isFulfillStatus(value: string): value is FulfillStatus {
  return FULFILL_STATUSES.some((status) => status === value);
}

export function fulfillStatusOf(order: { status: string; fulfillStatus: string | null }): FulfillStatus | null {
  if (order.status === 'completed' || order.status === 'cancelled') return null;
  if (isFulfillStatus(order.fulfillStatus ?? '')) return order.fulfillStatus as FulfillStatus;
  if (order.status === 'shipped') return 'shipped';
  return 'unshipped';
}

/** Nhãn thời gian đã gửi trên list; thiếu mốc thì fallback nhãn trạng thái. */
export function orderShippedAgoLabel(shippedAt: number | null | undefined, now = Date.now()): string {
  if (shippedAt == null) return FULFILL_STATUS_LABELS.shipped;
  const diff = Math.max(0, now - shippedAt);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} tháng trước`;
  const years = Math.floor(months / 12);
  return `${years} năm trước`;
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
