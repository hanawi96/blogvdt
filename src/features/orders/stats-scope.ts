import { and, eq, ne, type SQL } from 'drizzle-orm';
import { orders } from '../../lib/db/schema';

/**
 * Đơn được tính thống kê / doanh thu / lãi / SL bán:
 * không hủy và không «gửi bù» (compensation = 1).
 */
export function orderCountedInStats(...extra: (SQL | undefined)[]): SQL {
  return and(ne(orders.status, 'cancelled'), eq(orders.compensation, 0), ...extra)!;
}
