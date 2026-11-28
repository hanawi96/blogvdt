import { and, gte, lt, sql } from 'drizzle-orm';

import type { AppDb } from '../../lib/db/client';
import { orders } from '../../lib/db/schema';
import { adSpendForDays } from '../costs/ads';
import { loadPnlBreakdowns, type PnlBreakdowns } from './breakdowns';
import { getLaborBudget } from './labor';
import { periodDayKeys, type PnlPeriod } from './period';
import { buildPnlWaterfall, type PnlWaterfall } from './waterfall';

const num = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number);

/** Không hủy, không gửi bù — khớp dashboard. */
const statsOk = sql`${orders.status} <> 'cancelled' AND ${orders.compensation} = 0`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;

export type PnlOverview = {
  period: PnlPeriod;
  waterfall: PnlWaterfall;
  /** true khi đã lưu ngân sách tiền công cho tháng đang xem. */
  laborBudgetSet: boolean;
  breakdowns: PnlBreakdowns;
};

export async function loadPnlOverview(db: AppDb, period: PnlPeriod): Promise<PnlOverview> {
  const inPeriod = and(gte(orders.createdAt, period.start), lt(orders.createdAt, period.end));
  const dayKeys = periodDayKeys(period.from, period.to) ?? [];

  const [rows, adSpend, laborAmount] = await Promise.all([
    db
      .select({
        orders: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
        costedOrders: num(sql`sum(case when ${statsOk} and ${costed} then 1 else 0 end)`),
        revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
        costedRevenue: num(sql`sum(case when ${statsOk} and ${costed} then ${orders.totalPrice} else 0 end)`),
        costGoods: num(sql`sum(case when ${statsOk} and ${costed} then ${orders.costGoods} else 0 end)`),
        costExtra: num(sql`sum(case when ${statsOk} and ${costed} then ${orders.costExtra} else 0 end)`),
        shippingCost: num(sql`sum(case when ${statsOk} and ${costed} then coalesce(${orders.shippingCost}, 0) else 0 end)`),
        discountAmount: num(sql`sum(case when ${statsOk} then ${orders.discountAmount} else 0 end)`),
      })
      .from(orders)
      .where(inPeriod),
    adSpendForDays(db, dayKeys),
    period.monthKey ? getLaborBudget(db, period.monthKey) : Promise.resolve(null),
  ]);

  const row = rows[0];
  const laborBudgetSet = laborAmount !== null;
  const waterfall = buildPnlWaterfall({
    orders: row?.orders ?? 0,
    costedOrders: row?.costedOrders ?? 0,
    revenue: row?.revenue ?? 0,
    costedRevenue: row?.costedRevenue ?? 0,
    costGoods: row?.costGoods ?? 0,
    costExtra: row?.costExtra ?? 0,
    shippingCost: row?.shippingCost ?? 0,
    discountAmount: row?.discountAmount ?? 0,
    adSpend,
    laborBudget: laborAmount ?? 0,
  });

  const breakdowns = await loadPnlBreakdowns(db, period, waterfall);
  return { period, waterfall, laborBudgetSet, breakdowns };
}
