import { and, count, gte, ne, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { vnTodayStartMs } from '../../lib/datetime';
import { orders } from '../../lib/db/schema';

export type PosTodayStats = {
  orders: number;
  revenue: number;
  /** Lãi ròng trên đơn có đủ giá vốn (không hủy / không gửi bù). */
  profit: number;
};

/** Cùng công thức dashboard: total − giá vốn SP − chi phí đơn − ship nội bộ. */
const profitExpr = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra} - coalesce(${orders.shippingCost}, 0)`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;

/**
 * Đơn tạo hôm nay (lịch VN): số đơn live + doanh thu + lãi (không tính gửi bù / hủy).
 * Một query aggregate — dùng cho header extension.
 */
export async function loadPosTodayStats(db: AppDb, now = Date.now()): Promise<PosTodayStats> {
  const start = vnTodayStartMs(now);
  const liveToday = and(gte(orders.createdAt, start), ne(orders.status, 'cancelled'));
  const rows = await db
    .select({
      orders: count(),
      revenue: sql<number>`coalesce(sum(case when ${orders.compensation} = 0 then ${orders.totalPrice} else 0 end), 0)`.mapWith(Number),
      profit: sql<number>`coalesce(sum(case when ${orders.compensation} = 0 and ${costed} then ${profitExpr} else 0 end), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(liveToday);

  const row = rows[0];
  return {
    orders: Number(row?.orders ?? 0),
    revenue: Number(row?.revenue ?? 0),
    profit: Number(row?.profit ?? 0),
  };
}
