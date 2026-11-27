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

/** KPI 7 ngày + kỳ trước trong một query trên cửa sổ 14 ngày. */
async function loadPeriodKpi(db: AppDb, currentStart: number, previousStart: number) {
  const inCurrent = sql`${orders.createdAt} >= ${currentStart}`;
  const inPrevious = sql`${orders.createdAt} < ${currentStart}`;
  const rows = await db
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
    .where(gte(orders.createdAt, previousStart));
  const row = rows[0];
  return {
    curOrders: row?.curOrders ?? 0,
    curRevenue: row?.curRevenue ?? 0,
    curProfit: row?.curProfit ?? 0,
    curCosted: row?.curCosted ?? 0,
    prevOrders: row?.prevOrders ?? 0,
    prevRevenue: row?.prevRevenue ?? 0,
    prevProfit: row?.prevProfit ?? 0,
  };
}

/** Một query: số đơn + doanh thu theo ngày. */
async function loadDailySeries(db: AppDb, previousStart: number) {
  return db
    .select({
      day: dayVn,
      orders: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart))
    .groupBy(dayVn);
}

/** Số đơn + doanh thu theo giờ (VN) trong cửa sổ hôm qua → hôm nay. */
async function loadHourlySeries(db: AppDb, previousStart: number) {
  return db
    .select({
      day: dayVn,
      hour: hourVn,
      orders: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart))
    .groupBy(dayVn, hourVn);
}

function buildDayChart(
  range: Extract<ChartRange, '7' | '30'>,
  windows: ReturnType<typeof dayWindows>,
  seriesRows: Awaited<ReturnType<typeof loadDailySeries>>,
): ChartSeries {
  const orderRows = seriesRows.map((row) => ({ day: row.day, value: row.orders }));
  const revenueRows = seriesRows.map((row) => ({ day: row.day, value: row.revenue }));
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
    legend: chartLegend(range),
    grain: 'day',
  };
}

function buildTodayChart(
  windows: ReturnType<typeof todayHourWindows>,
  seriesRows: Awaited<ReturnType<typeof loadHourlySeries>>,
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

async function loadTopProducts(db: AppDb, start: number): Promise<DashboardTopProduct[]> {
  const inRange = and(gte(orders.createdAt, start), eq(orders.compensation, 0), ne(orders.status, 'cancelled'));
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;
  const [single, many] = await Promise.all([
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
  const top = mergeTopProducts([single, many], TOP_PRODUCTS);
  if (top.length === 0) return [];
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
    .where(inArray(products.id, top.map((item) => item.productId)));
  const byId = new Map(details.map((row) => [row.id, row]));
  return top.flatMap((item) => {
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
}

async function loadBreakdown(db: AppDb, start: number): Promise<DashboardBreakdown> {
  const [provinces, sources, topProducts] = await Promise.all([
    loadTopProvinces(db, start),
    loadBySource(db, start),
    loadTopProducts(db, start),
  ]);
  return { provinces, sources, topProducts };
}

function buildKpi(raw: Awaited<ReturnType<typeof loadPeriodKpi>>): DashboardKpi {
  return {
    orders: raw.curOrders,
    revenue: raw.curRevenue,
    profit: raw.curProfit,
    costedOrders: raw.curCosted,
    deltas: {
      orders: describeDelta(percentChange(raw.curOrders, raw.prevOrders)),
      revenue: describeDelta(percentChange(raw.curRevenue, raw.prevRevenue)),
      profit: describeDelta(percentChange(raw.curProfit, raw.prevProfit)),
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
    hourlyRows,
    breakdownToday,
    breakdown7,
    breakdown30,
  ] = await Promise.all([
    loadPeriodKpi(db, winToday.currentStart, winToday.previousStart),
    loadPeriodKpi(db, windows.currentStart, windows.previousStart),
    loadPeriodKpi(db, win30.currentStart, win30.previousStart),
    loadDailySeries(db, win30.previousStart),
    loadHourlySeries(db, winToday.previousStart),
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
      today: buildTodayChart(winToday, hourlyRows),
      '7': buildDayChart('7', windows, dailyRows),
      '30': buildDayChart('30', win30, dailyRows),
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
