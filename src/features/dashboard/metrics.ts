import { routes } from '../../lib/routes';

export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const DEFAULT_PERIOD: DashboardPeriod = 30;

export const DAY_MS = 24 * 60 * 60 * 1000;
// Đơn mới quá ngưỡng này mà chưa xác nhận thì cảnh báo; bài nháp quá ngưỡng này gọi là "để lâu".
export const AGED_ORDER_MS = DAY_MS;
export const OLD_DRAFT_MS = 30 * DAY_MS;

export function readPeriod(value: string | null): DashboardPeriod {
  const days = Number(value);
  return DASHBOARD_PERIODS.find((period) => period === days) ?? DEFAULT_PERIOD;
}

// Kỳ hiện tại là N*24 giờ gần nhất; kỳ trước là N*24 giờ liền trước đó, cùng độ dài để so sánh công bằng.
export function periodRange(days: DashboardPeriod, now: number): { start: number; previousStart: number } {
  const start = now - days * DAY_MS;
  return { start, previousStart: start - days * DAY_MS };
}

// null khi kỳ trước bằng 0 mà kỳ này có số (không chia được cho 0).
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function averageValue(value: number, orders: number): number {
  return orders > 0 ? Math.round(value / orders) : 0;
}

export function cancelRate(cancelled: number, orders: number): number {
  const total = cancelled + orders;
  return total > 0 ? Math.round((cancelled / total) * 100) : 0;
}

export type DeltaTone = 'good' | 'bad' | 'flat';

// invert = true cho chỉ số "tăng là xấu" (vd tỉ lệ hủy).
export function describeDelta(change: number | null, invert = false): { text: string; tone: DeltaTone } {
  if (change === null) return { text: 'Kỳ trước chưa có', tone: 'flat' };
  if (change === 0) return { text: 'Không đổi so với kỳ trước', tone: 'flat' };
  const up = change > 0;
  const text = `${up ? '+' : '−'}${Math.abs(change)}% so với kỳ trước`;
  return { text, tone: up !== invert ? 'good' : 'bad' };
}

export function timeAgo(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return '';
}

export type ActionItem = {
  key: string;
  label: string;
  count: number | null;
  detail: string;
  href: string;
  tone: 'warn' | 'info';
};

export type ActionInput = {
  admin: boolean;
  newOrders: number;
  agedNewOrders: number;
  processingOrders: number;
  productsNoCover: number;
  productsNoCategory: number;
  drafts: number;
  oldDrafts: number;
  publishedPosts: number;
  seo: { state: 'none' | 'checked'; errors: number };
};

// Chỉ trả những việc thật sự có; rỗng nghĩa là không có gì cần xử lý.
export function buildActionItems(input: ActionInput): ActionItem[] {
  const items: ActionItem[] = [];
  if (input.admin) {
    if (input.newOrders > 0) {
      items.push({
        key: 'new-orders',
        label: 'Đơn mới chờ xác nhận',
        count: input.newOrders,
        detail: input.agedNewOrders > 0 ? `${input.agedNewOrders} đơn đã chờ hơn 24 giờ` : 'Gọi khách để xác nhận đơn',
        href: `${routes.adminOrders}?status=new`,
        tone: input.agedNewOrders > 0 ? 'warn' : 'info',
      });
    }
    if (input.processingOrders > 0) {
      items.push({
        key: 'processing-orders',
        label: 'Đơn đang xử lý',
        count: input.processingOrders,
        detail: 'Đã xác nhận, đang chuẩn bị hoặc đã gửi, chưa hoàn thành',
        href: `${routes.adminOrders}?status=processing`,
        tone: 'info',
      });
    }
    if (input.productsNoCover > 0) {
      items.push({
        key: 'products-no-cover',
        label: 'Sản phẩm đang bán chưa có ảnh',
        count: input.productsNoCover,
        detail: 'Khách khó chọn khi sản phẩm không có ảnh',
        href: `${routes.adminProducts}?status=active`,
        tone: 'warn',
      });
    }
    if (input.productsNoCategory > 0) {
      items.push({
        key: 'products-no-category',
        label: 'Sản phẩm đang bán chưa có danh mục',
        count: input.productsNoCategory,
        detail: 'Cân nặng đang tính theo thang mặc định (bé)',
        href: `${routes.adminProducts}?status=active`,
        tone: 'warn',
      });
    }
  }
  if (input.drafts > 0) {
    items.push({
      key: 'drafts',
      label: 'Bài nháp chưa xuất bản',
      count: input.drafts,
      detail: input.oldDrafts > 0 ? `${input.oldDrafts} bài chưa sửa hơn 30 ngày` : 'Hoàn thiện và xuất bản khi sẵn sàng',
      href: `${routes.adminPosts}?status=draft`,
      tone: 'info',
    });
  }
  if (input.admin) {
    if (input.seo.state === 'checked' && input.seo.errors > 0) {
      items.push({
        key: 'seo-errors',
        label: 'Lỗi SEO nghiêm trọng',
        count: input.seo.errors,
        detail: 'Xem chi tiết trong trang kiểm tra SEO',
        href: routes.adminSeo,
        tone: 'warn',
      });
    } else if (input.seo.state === 'none' && input.publishedPosts > 0) {
      items.push({
        key: 'seo-unchecked',
        label: 'Chưa có kết quả kiểm tra SEO',
        count: null,
        detail: 'Chạy kiểm tra để biết bài nào cần sửa',
        href: routes.adminSeo,
        tone: 'info',
      });
    }
  }
  return items;
}

// Gộp số lượng bán từ đơn một mẫu và đơn nhiều mẫu, lấy top N theo số lượng giảm dần (hòa thì id nhỏ trước).
export function mergeTopProducts(
  parts: ReadonlyArray<ReadonlyArray<{ productId: number | null; sold: number }>>,
  limit: number,
): { productId: number; sold: number }[] {
  const totals = new Map<number, number>();
  for (const part of parts) {
    for (const row of part) {
      if (row.productId === null || row.sold <= 0) continue;
      totals.set(row.productId, (totals.get(row.productId) ?? 0) + row.sold);
    }
  }
  return [...totals.entries()]
    .map(([productId, sold]) => ({ productId, sold }))
    .sort((a, b) => b.sold - a.sold || a.productId - b.productId)
    .slice(0, limit);
}
