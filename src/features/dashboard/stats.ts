import { and, count, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';

import type { AppDb } from '../../lib/db/client';
import { routes } from '../../lib/routes';
import { media, orderItems, orders, posts, products } from '../../lib/db/schema';
import { provinceLabel } from '../address/provinces';
import { notTrashed } from '../posts/visibility';
import { sourceLabel } from '../orders/staff';
import {
  OVERVIEW_DAYS,
  chartLegend,
  dayChartLabels,
  dayWindows,
  describeDelta,
  fillDailySeries,
  mergeLeastProducts,
  mergeTopProducts,
  overviewWindows,
  percentChange,
  todayHourWindows,
  type ChartRange,
  type ChartSeries,
  type DashboardBreakdown,
  type DashboardKpi,
  type DashboardRankItem,
  type DashboardTopProduct,
} from './metrics';

const TOP_PRODUCTS = 10;
const TOP_PROVINCES = 5;

const num = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number);

/** Ngày lịch VN từ created_at (ms). */
const dayVn = sql<string>`strftime('%Y-%m-%d', ${orders.createdAt} / 1000, 'unixepoch', '+7 hours')`;
/** Giờ 00–23 theo lịch VN. */
const hourVn = sql<string>`strftime('%H', ${orders.createdAt} / 1000, 'unixepoch', '+7 hours')`;

/** Không hủy, không gửi bù — mọi KPI/biểu đồ/top bán. */
const statsOk = sql`${orders.status} <> 'cancelled' AND ${orders.compensation} = 0`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;
const profitExpr = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra} - coalesce(${orders.shippingCost}, 0)`;

async function loadPosts(db: AppDb) {
  const rows = await db
    .select({
      total: count(),
      published: num(sql`sum(case when ${posts.status} = 'published' then 1 else 0 end)`),
      drafts: num(sql`sum(case when ${posts.status} = 'draft' then 1 else 0 end)`),
    })
    .from(posts)
    .where(notTrashed());
  const row = rows[0];
  return { total: row?.total ?? 0, published: row?.published ?? 0, drafts: row?.drafts ?? 0 };
}

/**
 * SL SP đã bán trong kỳ: cộng quantity từ order_items + đơn legacy (không có dòng items).
 * Cùng phạm vi statsOk (không hủy, không gửi bù) — khớp top sản phẩm / soldQty catalog.
 */
async function loadPeriodSold(db: AppDb, currentStart: number, previousStart: number) {
  const inCurrent = sql`${orders.createdAt} >= ${currentStart}`;
  const inPrevious = sql`${orders.createdAt} < ${currentStart}`;
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;
  const [legacyRows, lineRows] = await Promise.all([
    db
      .select({
        cur: num(sql`sum(case when ${inCurrent} and ${statsOk} then ${orders.quantity} else 0 end)`),
        prev: num(sql`sum(case when ${inPrevious} and ${statsOk} then ${orders.quantity} else 0 end)`),
      })
      .from(orders)
      .where(and(gte(orders.createdAt, previousStart), legacyOnly)),
    db
      .select({
        cur: num(sql`sum(case when ${inCurrent} and ${statsOk} then ${orderItems.quantity} else 0 end)`),
        prev: num(sql`sum(case when ${inPrevious} and ${statsOk} then ${orderItems.quantity} else 0 end)`),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(gte(orders.createdAt, previousStart)),
  ]);
  const legacy = legacyRows[0];
  const lines = lineRows[0];
  return {
    curSold: (legacy?.cur ?? 0) + (lines?.cur ?? 0),
    prevSold: (legacy?.prev ?? 0) + (lines?.prev ?? 0),
  };
}

/** KPI kỳ hiện tại + kỳ trước trong một query trên cửa sổ 2 kỳ. */
async function loadPeriodKpi(db: AppDb, currentStart: number, previousStart: number) {
  const inCurrent = sql`${orders.createdAt} >= ${currentStart}`;
  const inPrevious = sql`${orders.createdAt} < ${currentStart}`;
  const [rows, sold] = await Promise.all([
    db
      .select({
        curOrders: num(sql`sum(case when ${inCurrent} and ${statsOk} then 1 else 0 end)`),
        curRevenue: num(sql`sum(case when ${inCurrent} and ${statsOk} then ${orders.totalPrice} else 0 end)`),
        curProfit: num(sql`sum(case when ${inCurrent} and ${statsOk} and ${costed} then ${profitExpr} else 0 end)`),
        curCosted: num(sql`sum(case when ${inCurrent} and ${statsOk} and ${costed} then 1 else 0 end)`),
        prevOrders: num(sql`sum(case when ${inPrevious} and ${statsOk} then 1 else 0 end)`),
        prevRevenue: num(sql`sum(case when ${inPrevious} and ${statsOk} then ${orders.totalPrice} else 0 end)`),
        prevProfit: num(sql`sum(case when ${inPrevious} and ${statsOk} and ${costed} then ${profitExpr} else 0 end)`),
      })
      .from(orders)
      .where(gte(orders.createdAt, previousStart)),
    loadPeriodSold(db, currentStart, previousStart),
  ]);
  const row = rows[0];
  return {
    curOrders: row?.curOrders ?? 0,
    curRevenue: row?.curRevenue ?? 0,
    curProfit: row?.curProfit ?? 0,
    curCosted: row?.curCosted ?? 0,
    curSold: sold.curSold,
    prevOrders: row?.prevOrders ?? 0,
    prevRevenue: row?.prevRevenue ?? 0,
    prevProfit: row?.prevProfit ?? 0,
    prevSold: sold.prevSold,
  };
}

/** Một query: số đơn + doanh thu + lãi ròng theo ngày. */
async function loadDailySeries(db: AppDb, previousStart: number) {
  return db
    .select({
      day: dayVn,
      orders: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
      profit: num(sql`sum(case when ${statsOk} and ${costed} then ${profitExpr} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart))
    .groupBy(dayVn);
}

/** Số SP đã bán theo ngày: order_items + đơn legacy (cùng công thức KPI sold). */
async function loadDailySoldSeries(db: AppDb, previousStart: number): Promise<{ day: string; value: number }[]> {
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;
  const [legacyRows, lineRows] = await Promise.all([
    db
      .select({
        day: dayVn,
        sold: num(sql`sum(case when ${statsOk} then ${orders.quantity} else 0 end)`),
      })
      .from(orders)
      .where(and(gte(orders.createdAt, previousStart), legacyOnly))
      .groupBy(dayVn),
    db
      .select({
        day: dayVn,
        sold: num(sql`sum(case when ${statsOk} then ${orderItems.quantity} else 0 end)`),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(gte(orders.createdAt, previousStart))
      .groupBy(dayVn),
  ]);
  return mergeKeyedTotals(
    legacyRows.map((row) => ({ key: row.day, value: row.sold })),
    lineRows.map((row) => ({ key: row.day, value: row.sold })),
  ).map((row) => ({ day: row.key, value: row.value }));
}

/** Số đơn + doanh thu + lãi theo giờ (VN) trong cửa sổ hôm qua → hôm nay. */
async function loadHourlySeries(db: AppDb, previousStart: number) {
  return db
    .select({
      day: dayVn,
      hour: hourVn,
      orders: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
      profit: num(sql`sum(case when ${statsOk} and ${costed} then ${profitExpr} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart))
    .groupBy(dayVn, hourVn);
}

/** Số SP đã bán theo giờ (VN). */
async function loadHourlySoldSeries(
  db: AppDb,
  previousStart: number,
): Promise<{ day: string; hour: string; value: number }[]> {
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;
  const [legacyRows, lineRows] = await Promise.all([
    db
      .select({
        day: dayVn,
        hour: hourVn,
        sold: num(sql`sum(case when ${statsOk} then ${orders.quantity} else 0 end)`),
      })
      .from(orders)
      .where(and(gte(orders.createdAt, previousStart), legacyOnly))
      .groupBy(dayVn, hourVn),
    db
      .select({
        day: dayVn,
        hour: hourVn,
        sold: num(sql`sum(case when ${statsOk} then ${orderItems.quantity} else 0 end)`),
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(gte(orders.createdAt, previousStart))
      .groupBy(dayVn, hourVn),
  ]);
  return mergeKeyedTotals(
    legacyRows.map((row) => ({ key: `${row.day}\0${row.hour}`, value: row.sold })),
    lineRows.map((row) => ({ key: `${row.day}\0${row.hour}`, value: row.sold })),
  ).map((row) => {
    const [day = '', hour = ''] = row.key.split('\0');
    return { day, hour, value: row.value };
  });
}

function mergeKeyedTotals(
  left: { key: string; value: number }[],
  right: { key: string; value: number }[],
): { key: string; value: number }[] {
  const map = new Map<string, number>();
  for (const row of left) map.set(row.key, (map.get(row.key) ?? 0) + row.value);
  for (const row of right) map.set(row.key, (map.get(row.key) ?? 0) + row.value);
  return [...map.entries()].map(([key, value]) => ({ key, value }));
}

function buildDayChart(
  range: Extract<ChartRange, '7' | '30'>,
  windows: ReturnType<typeof dayWindows>,
  seriesRows: Awaited<ReturnType<typeof loadDailySeries>>,
  soldRows: { day: string; value: number }[],
): ChartSeries {
  const orderRows = seriesRows.map((row) => ({ day: row.day, value: row.orders }));
  const revenueRows = seriesRows.map((row) => ({ day: row.day, value: row.revenue }));
  const profitRows = seriesRows.map((row) => ({ day: row.day, value: row.profit }));
  return {
    labels: dayChartLabels(windows.currentDays),
    orders: {
      current: fillDailySeries(windows.currentDays, orderRows),
      previous: fillDailySeries(windows.previousDays, orderRows),
    },
    revenue: {
      current: fillDailySeries(windows.currentDays, revenueRows),
      previous: fillDailySeries(windows.previousDays, revenueRows),
    },
    profit: {
      current: fillDailySeries(windows.currentDays, profitRows),
      previous: fillDailySeries(windows.previousDays, profitRows),
    },
    sold: {
      current: fillDailySeries(windows.currentDays, soldRows),
      previous: fillDailySeries(windows.previousDays, soldRows),
    },
    legend: chartLegend(range),
    grain: 'day',
  };
}

function buildTodayChart(
  windows: ReturnType<typeof todayHourWindows>,
  seriesRows: Awaited<ReturnType<typeof loadHourlySeries>>,
  soldRows: { day: string; hour: string; value: number }[],
): ChartSeries {
  const currentOrders = seriesRows
    .filter((row) => row.day === windows.currentDay)
    .map((row) => ({ day: row.hour, value: row.orders }));
  const previousOrders = seriesRows
    .filter((row) => row.day === windows.previousDay)
    .map((row) => ({ day: row.hour, value: row.orders }));
  const currentRevenue = seriesRows
    .filter((row) => row.day === windows.currentDay)
    .map((row) => ({ day: row.hour, value: row.revenue }));
  const previousRevenue = seriesRows
    .filter((row) => row.day === windows.previousDay)
    .map((row) => ({ day: row.hour, value: row.revenue }));
  const currentProfit = seriesRows
    .filter((row) => row.day === windows.currentDay)
    .map((row) => ({ day: row.hour, value: row.profit }));
  const previousProfit = seriesRows
    .filter((row) => row.day === windows.previousDay)
    .map((row) => ({ day: row.hour, value: row.profit }));
  const currentSold = soldRows
    .filter((row) => row.day === windows.currentDay)
    .map((row) => ({ day: row.hour, value: row.value }));
  const previousSold = soldRows
    .filter((row) => row.day === windows.previousDay)
    .map((row) => ({ day: row.hour, value: row.value }));
  return {
    labels: windows.labels,
    orders: {
      current: fillDailySeries(windows.hours, currentOrders),
      previous: fillDailySeries(windows.hours, previousOrders),
    },
    revenue: {
      current: fillDailySeries(windows.hours, currentRevenue),
      previous: fillDailySeries(windows.hours, previousRevenue),
    },
    profit: {
      current: fillDailySeries(windows.hours, currentProfit),
      previous: fillDailySeries(windows.hours, previousProfit),
    },
    sold: {
      current: fillDailySeries(windows.hours, currentSold),
      previous: fillDailySeries(windows.hours, previousSold),
    },
    legend: chartLegend('today'),
    grain: 'hour',
  };
}

async function loadTopProvinces(db: AppDb, start: number) {
  const rows = await db
    .select({
      provinceCode: orders.provinceCode,
      ordersCount: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, start))
    .groupBy(orders.provinceCode)
    .orderBy(sql`sum(case when ${statsOk} then 1 else 0 end) desc`)
    .limit(TOP_PROVINCES);
  return rows
    .filter((row) => row.ordersCount > 0)
    .map(
      (row): DashboardRankItem => ({
        name: provinceLabel(row.provinceCode),
        orders: row.ordersCount,
        revenue: row.revenue,
      }),
    );
}

async function loadBySource(db: AppDb, start: number): Promise<DashboardRankItem[]> {
  const rows = await db
    .select({
      source: orders.source,
      ordersCount: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, start))
    .groupBy(orders.source)
    .orderBy(sql`sum(case when ${statsOk} then 1 else 0 end) desc`);
  return rows
    .filter((row) => row.ordersCount > 0)
    .map((row) => ({
      name: sourceLabel(row.source) || 'Khác',
      orders: row.ordersCount,
      revenue: row.revenue,
    }));
}

async function loadSoldParts(db: AppDb, start: number) {
  const inRange = and(gte(orders.createdAt, start), eq(orders.compensation, 0), ne(orders.status, 'cancelled'));
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;
  return Promise.all([
    db
      .select({ productId: orders.productId, sold: num(sql`sum(${orders.quantity})`) })
      .from(orders)
      .where(and(inRange, isNotNull(orders.productId), legacyOnly))
      .groupBy(orders.productId),
    db
      .select({ productId: orderItems.productId, sold: num(sql`sum(${orderItems.quantity})`) })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inRange, isNotNull(orderItems.productId)))
      .groupBy(orderItems.productId),
  ]);
}

async function loadProductRanks(
  db: AppDb,
  start: number,
): Promise<{ topProducts: DashboardTopProduct[]; leastProducts: DashboardTopProduct[] }> {
  const parts = await loadSoldParts(db, start);
  const best = mergeTopProducts(parts, TOP_PRODUCTS);
  const least = mergeLeastProducts(parts, TOP_PRODUCTS);
  const ids = [...new Set([...best, ...least].map((item) => item.productId))];
  if (ids.length === 0) return { topProducts: [], leastProducts: [] };
  const details = await db
    .select({
      id: products.id,
      name: products.name,
      coverKey: media.r2Key,
      cardKey: media.cardR2Key,
      thumbKey: media.thumbR2Key,
      coverAlt: media.altText,
    })
    .from(products)
    .leftJoin(media, eq(products.coverMediaId, media.id))
    .where(inArray(products.id, ids));
  const byId = new Map(details.map((row) => [row.id, row]));
  const toView = (ranked: { productId: number; sold: number }[]): DashboardTopProduct[] =>
    ranked.flatMap((item) => {
      const row = byId.get(item.productId);
      if (!row) return [];
      const key = row.thumbKey || row.cardKey || row.coverKey || null;
      return [
        {
          productId: item.productId,
          name: row.name,
          sold: item.sold,
          imageUrl: key ? routes.media(key) : null,
          imageAlt: row.coverAlt || row.name,
        },
      ];
    });
  return { topProducts: toView(best), leastProducts: toView(least) };
}

async function loadBreakdown(db: AppDb, start: number): Promise<DashboardBreakdown> {
  const [provinces, sources, productRanks] = await Promise.all([
    loadTopProvinces(db, start),
    loadBySource(db, start),
    loadProductRanks(db, start),
  ]);
  return { provinces, sources, topProducts: productRanks.topProducts, leastProducts: productRanks.leastProducts };
}

function buildKpi(raw: Awaited<ReturnType<typeof loadPeriodKpi>>): DashboardKpi {
  return {
    orders: raw.curOrders,
    revenue: raw.curRevenue,
    profit: raw.curProfit,
    sold: raw.curSold,
    costedOrders: raw.curCosted,
    deltas: {
      orders: describeDelta(percentChange(raw.curOrders, raw.prevOrders)),
      revenue: describeDelta(percentChange(raw.curRevenue, raw.prevRevenue)),
      profit: describeDelta(percentChange(raw.curProfit, raw.prevProfit)),
      sold: describeDelta(percentChange(raw.curSold, raw.prevSold)),
    },
  };
}

export async function getDashboardOverview(db: AppDb, options: { admin: boolean; now?: number }) {
  const now = options.now ?? Date.now();
  const windows = overviewWindows(now);
  const win30 = dayWindows(30, now);
  const winToday = todayHourWindows(now);

  if (!options.admin) {
    const postStats = await loadPosts(db);
    return {
      admin: false as const,
      posts: postStats,
    };
  }

  const [
    kpiToday,
    kpi7,
    kpi30,
    dailyRows,
    dailySoldRows,
    hourlyRows,
    hourlySoldRows,
    breakdownToday,
    breakdown7,
    breakdown30,
  ] = await Promise.all([
    loadPeriodKpi(db, winToday.currentStart, winToday.previousStart),
    loadPeriodKpi(db, windows.currentStart, windows.previousStart),
    loadPeriodKpi(db, win30.currentStart, win30.previousStart),
    loadDailySeries(db, win30.previousStart),
    loadDailySoldSeries(db, win30.previousStart),
    loadHourlySeries(db, winToday.previousStart),
    loadHourlySoldSeries(db, winToday.previousStart),
    loadBreakdown(db, winToday.currentStart),
    loadBreakdown(db, windows.currentStart),
    loadBreakdown(db, win30.currentStart),
  ]);

  return {
    admin: true as const,
    days: OVERVIEW_DAYS,
    kpis: {
      today: buildKpi(kpiToday),
      '7': buildKpi(kpi7),
      '30': buildKpi(kpi30),
    } satisfies Record<ChartRange, DashboardKpi>,
    charts: {
      today: buildTodayChart(winToday, hourlyRows, hourlySoldRows),
      '7': buildDayChart('7', windows, dailyRows, dailySoldRows),
      '30': buildDayChart('30', win30, dailyRows, dailySoldRows),
    } satisfies Record<ChartRange, ChartSeries>,
    breakdowns: {
      today: breakdownToday,
      '7': breakdown7,
      '30': breakdown30,
    } satisfies Record<ChartRange, DashboardBreakdown>,
  };
}

/** Alias cũ — trang admin gọi getDashboardOverview. */
export const getDashboard = getDashboardOverview;
