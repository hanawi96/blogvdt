import { and, count, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { calendarRange, vnTodayRange } from '../../lib/datetime';
import { orders } from '../../lib/db/schema';
import { sourceLabel } from './staff';
import { orderCountedInStats } from './stats-scope';

export type TodaySourceStat = {
  /** `zalo` | `facebook` | `tiktok` | `web` | `other` */
  key: string;
  label: string;
  orders: number;
  revenue: number;
};

export type PosTodayStats = {
  /** Số đơn tính thống kê (không hủy, không gửi bù). */
  orders: number;
  revenue: number;
  /** Alias số đơn tính doanh thu — trùng `orders` sau khi loại gửi bù. */
  revenueOrders: number;
  /** Lãi ròng trên đơn có đủ giá vốn (đã loại hủy + gửi bù). */
  profit: number;
  /** Số đơn trong kỳ đã có đủ costGoods + costExtra (nền tảng của profit / TB lãi). */
  costedOrders: number;
  sources: TodaySourceStat[];
};

/** Cửa sổ created_at: start inclusive, end exclusive (cùng quy ước bộ lọc đơn / calendarRange). */
export type OrderStatsWindow = {
  start: number | null;
  end: number | null;
};

export type ResolveOrderSummaryWindow =
  | { ok: true; window: OrderStatsWindow; usesDateFilter: boolean }
  | { ok: false; reason: 'invalid_range' };

/** Cùng công thức dashboard: total − giá vốn SP − chi phí đơn − ship nội bộ. */
const profitExpr = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra} - coalesce(${orders.shippingCost}, 0)`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;

/**
 * Mặc định «hôm nay» VN = [00:00 hôm nay, 00:00 ngày mai) — trùng nút chọn nhanh «Hôm nay».
 */
export function defaultTodayStatsWindow(now = Date.now()): OrderStatsWindow {
  const day = vnTodayRange(now);
  const range = calendarRange(day.from, day.to);
  return { start: range.start, end: range.end };
}

/**
 * Map `from`/`to` trên URL → cửa sổ summary.
 * - Không chọn ngày → hôm nay VN (đóng hai đầu như bộ lọc).
 * - Có from/to hợp lệ → đúng `calendarRange` (cùng list đơn).
 * - Khoảng invalid → không query (tránh cộng cả lịch sử).
 */
export function resolveOrderSummaryWindow(from: string, to: string, now = Date.now()): ResolveOrderSummaryWindow {
  const range = calendarRange(from, to);
  if (range.invalid) return { ok: false, reason: 'invalid_range' };
  if (from || to) {
    return {
      ok: true,
      window: { start: range.start, end: range.end },
      usesDateFilter: true,
    };
  }
  return { ok: true, window: defaultTodayStatsWindow(now), usesDateFilter: false };
}

function statsInWindow(window: OrderStatsWindow): SQL {
  const parts: SQL[] = [];
  if (window.start !== null) parts.push(gte(orders.createdAt, window.start));
  if (window.end !== null) parts.push(lt(orders.createdAt, window.end));
  return orderCountedInStats(...parts);
}

/**
 * Thống kê đơn trong cửa sổ thời gian: số đơn + doanh thu + lãi + nguồn khách.
 * Chỉ theo `created_at`; loại hủy và gửi bù. Không phụ thuộc status/source/payment của list.
 */
export async function loadOrderPeriodStats(db: AppDb, window: OrderStatsWindow): Promise<PosTodayStats> {
  const where = statsInWindow(window);

  const [totals, sourceRows] = await Promise.all([
    db
      .select({
        orders: count(),
        revenue: sql<number>`coalesce(sum(${orders.totalPrice}), 0)`.mapWith(Number),
        profit: sql<number>`coalesce(sum(case when ${costed} then ${profitExpr} else 0 end), 0)`.mapWith(Number),
        costedOrders: sql<number>`coalesce(sum(case when ${costed} then 1 else 0 end), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(where),
    db
      .select({
        source: orders.source,
        orders: count(),
        revenue: sql<number>`coalesce(sum(${orders.totalPrice}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(where)
      .groupBy(orders.source)
      .orderBy(sql`count(*) desc`),
  ]);

  const row = totals[0];
  const sources: TodaySourceStat[] = sourceRows
    .filter((item) => Number(item.orders) > 0)
    .map((item) => {
      const key = item.source ?? 'other';
      return {
        key,
        label: sourceLabel(item.source) || 'Khác',
        orders: Number(item.orders),
        revenue: Number(item.revenue ?? 0),
      };
    });

  const orderTotal = Number(row?.orders ?? 0);
  return {
    orders: orderTotal,
    revenue: Number(row?.revenue ?? 0),
    revenueOrders: orderTotal,
    profit: Number(row?.profit ?? 0),
    costedOrders: Number(row?.costedOrders ?? 0),
    sources,
  };
}

/** Trung bình làm tròn VND; mẫu số 0 → 0. */
export function averagePerOrder(total: number, orderCount: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(orderCount) || orderCount <= 0) return 0;
  return Math.round(total / orderCount);
}

/** Đơn tạo hôm nay (lịch VN) — alias cho POS / API cũ. */
export async function loadPosTodayStats(db: AppDb, now = Date.now()): Promise<PosTodayStats> {
  return loadOrderPeriodStats(db, defaultTodayStatsWindow(now));
}
