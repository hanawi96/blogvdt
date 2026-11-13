import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { routes } from '../../lib/routes';
import { media, orderItems, orders, posts, products, seoHealthIssues, seoHealthRuns } from '../../lib/db/schema';
import { provinceLabel } from '../address/provinces';
import { notTrashed } from '../posts/visibility';
import { sourceLabel } from '../orders/staff';
import {
  AGED_ORDER_MS,
  OLD_DRAFT_MS,
  OVERVIEW_DAYS,
  buildActionItems,
  describeDelta,
  fillDailySeries,
  mergeTopProducts,
  overviewWindows,
  percentChange,
} from './metrics';

const TOP_PRODUCTS = 10;
const TOP_PROVINCES = 5;

const num = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number);

/** Ngày lịch VN từ created_at (ms). */
const dayVn = sql<string>`strftime('%Y-%m-%d', ${orders.createdAt} / 1000, 'unixepoch', '+7 hours')`;

const live = sql`${orders.status} <> 'cancelled'`;
const revenueOk = sql`${orders.status} <> 'cancelled' AND ${orders.compensation} = 0`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;
const profitExpr = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra} - coalesce(${orders.shippingCost}, 0)`;

async function loadPosts(db: AppDb, now: number) {
  const rows = await db
    .select({
      total: count(),
      published: num(sql`sum(case when ${posts.status} = 'published' then 1 else 0 end)`),
      drafts: num(sql`sum(case when ${posts.status} = 'draft' then 1 else 0 end)`),
      oldDrafts: num(sql`sum(case when ${posts.status} = 'draft' and ${posts.updatedAt} < ${now - OLD_DRAFT_MS} then 1 else 0 end)`),
    })
    .from(posts)
    .where(notTrashed());
  const row = rows[0];
  return { total: row?.total ?? 0, published: row?.published ?? 0, drafts: row?.drafts ?? 0, oldDrafts: row?.oldDrafts ?? 0 };
}

async function loadProducts(db: AppDb) {
  const rows = await db
    .select({
      active: num(sql`sum(case when ${products.status} = 'active' then 1 else 0 end)`),
      noCover: num(sql`sum(case when ${products.status} = 'active' and ${products.coverMediaId} is null then 1 else 0 end)`),
      noCategory: num(sql`sum(case when ${products.status} = 'active' and ${products.categoryId} is null then 1 else 0 end)`),
    })
    .from(products);
  const row = rows[0];
  return { active: row?.active ?? 0, noCover: row?.noCover ?? 0, noCategory: row?.noCategory ?? 0 };
}

async function loadStatusCounts(db: AppDb, now: number) {
  const rows = await db
    .select({
      status: orders.status,
      value: count(),
      aged: num(sql`sum(case when ${orders.createdAt} < ${now - AGED_ORDER_MS} then 1 else 0 end)`),
    })
    .from(orders)
    .groupBy(orders.status);
  let newOrders = 0;
  let agedNewOrders = 0;
  let processing = 0;
  for (const row of rows) {
    if (row.status === 'new') {
      newOrders += row.value;
      agedNewOrders += row.aged;
    }
    if (row.status === 'confirmed' || row.status === 'preparing' || row.status === 'shipped') processing += row.value;
  }
  return { newOrders, agedNewOrders, processing };
}

async function loadSeo(db: AppDb): Promise<{ state: 'none' | 'checked'; errors: number }> {
  const runs = await db.select({ id: seoHealthRuns.id }).from(seoHealthRuns).orderBy(desc(seoHealthRuns.id)).limit(1);
  const run = runs[0];
  if (!run) return { state: 'none', errors: 0 };
  const rows = await db
    .select({ value: count() })
    .from(seoHealthIssues)
    .where(
      and(
        eq(seoHealthIssues.runId, run.id),
        eq(seoHealthIssues.severity, 'error'),
        sql`(${seoHealthIssues.postId} is null or exists (select 1 from posts where posts.id = ${seoHealthIssues.postId} and posts.status = 'published' and posts.deleted_at is null))`,
      ),
    );
  return { state: 'checked', errors: rows[0]?.value ?? 0 };
}

/** KPI 7 ngày + kỳ trước trong một query trên cửa sổ 14 ngày. */
async function loadPeriodKpi(db: AppDb, currentStart: number, previousStart: number) {
  const inCurrent = sql`${orders.createdAt} >= ${currentStart}`;
  const inPrevious = sql`${orders.createdAt} < ${currentStart}`;
  const rows = await db
    .select({
      curOrders: num(sql`sum(case when ${inCurrent} and ${live} then 1 else 0 end)`),
      curRevenue: num(sql`sum(case when ${inCurrent} and ${revenueOk} then ${orders.totalPrice} else 0 end)`),
      curProfit: num(sql`sum(case when ${inCurrent} and ${live} and ${costed} then ${profitExpr} else 0 end)`),
      curCosted: num(sql`sum(case when ${inCurrent} and ${live} and ${costed} then 1 else 0 end)`),
      prevOrders: num(sql`sum(case when ${inPrevious} and ${live} then 1 else 0 end)`),
      prevRevenue: num(sql`sum(case when ${inPrevious} and ${revenueOk} then ${orders.totalPrice} else 0 end)`),
      prevProfit: num(sql`sum(case when ${inPrevious} and ${live} and ${costed} then ${profitExpr} else 0 end)`),
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

/** Một query: số đơn + doanh thu theo ngày (cửa sổ 14 ngày). */
async function loadDailySeries(db: AppDb, previousStart: number) {
  return db
    .select({
      day: dayVn,
      orders: num(sql`sum(case when ${live} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${revenueOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart))
    .groupBy(dayVn);
}

async function loadTopProvinces(db: AppDb, start: number) {
  const rows = await db
    .select({
      provinceCode: orders.provinceCode,
      ordersCount: num(sql`sum(case when ${live} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${revenueOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, start))
    .groupBy(orders.provinceCode)
    .orderBy(sql`sum(case when ${live} then 1 else 0 end) desc`)
    .limit(TOP_PROVINCES);
  return rows
    .filter((row) => row.ordersCount > 0)
    .map((row) => ({
      provinceCode: row.provinceCode,
      name: provinceLabel(row.provinceCode),
      orders: row.ordersCount,
      revenue: row.revenue,
    }));
}

async function loadBySource(db: AppDb, start: number) {
  const rows = await db
    .select({
      source: orders.source,
      ordersCount: num(sql`sum(case when ${live} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${revenueOk} then ${orders.totalPrice} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, start))
    .groupBy(orders.source)
    .orderBy(sql`sum(case when ${live} then 1 else 0 end) desc`);
  return rows
    .filter((row) => row.ordersCount > 0)
    .map((row) => ({
      source: row.source,
      name: sourceLabel(row.source) || 'Khác',
      orders: row.ordersCount,
      revenue: row.revenue,
    }));
}

async function loadTopProducts(db: AppDb, start: number) {
  const inRange = and(gte(orders.createdAt, start), ne(orders.status, 'cancelled'));
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

/** Lifetime: tránh double-count — đơn có order_items chỉ đếm items; đơn legacy (không có item) đếm orders.quantity. */
async function loadLifetimeSales(db: AppDb) {
  const [orderAgg, itemQty, legacyQty] = await Promise.all([
    db
      .select({
        ordersCount: num(sql`sum(case when ${live} then 1 else 0 end)`),
        revenue: num(sql`sum(case when ${revenueOk} then ${orders.totalPrice} else 0 end)`),
      })
      .from(orders),
    db
      .select({ sold: num(sql`sum(${orderItems.quantity})`) })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(ne(orders.status, 'cancelled')),
    db
      .select({ sold: num(sql`sum(${orders.quantity})`) })
      .from(orders)
      .where(
        and(
          ne(orders.status, 'cancelled'),
          sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`,
        ),
      ),
  ]);
  return {
    orders: orderAgg[0]?.ordersCount ?? 0,
    revenue: orderAgg[0]?.revenue ?? 0,
    soldQty: (itemQty[0]?.sold ?? 0) + (legacyQty[0]?.sold ?? 0),
  };
}

export async function getDashboardOverview(db: AppDb, options: { admin: boolean; now?: number }) {
  const now = options.now ?? Date.now();
  const windows = overviewWindows(now);

  if (!options.admin) {
    const postStats = await loadPosts(db, now);
    return {
      admin: false as const,
      posts: postStats,
      actions: buildActionItems({
        admin: false,
        newOrders: 0,
        agedNewOrders: 0,
        processingOrders: 0,
        productsNoCover: 0,
        productsNoCategory: 0,
        drafts: postStats.drafts,
        oldDrafts: postStats.oldDrafts,
        publishedPosts: postStats.published,
        seo: { state: 'none', errors: 0 },
      }),
    };
  }

  const [postStats, productStats, statusCounts, seo, kpiRaw, seriesRows, provinces, sources, topProducts, lifetime] =
    await Promise.all([
      loadPosts(db, now),
      loadProducts(db),
      loadStatusCounts(db, now),
      loadSeo(db),
      loadPeriodKpi(db, windows.currentStart, windows.previousStart),
      loadDailySeries(db, windows.previousStart),
      loadTopProvinces(db, windows.currentStart),
      loadBySource(db, windows.currentStart),
      loadTopProducts(db, windows.currentStart),
      loadLifetimeSales(db),
    ]);

  const orderRows = seriesRows.map((row) => ({ day: row.day, value: row.orders }));
  const revenueRows = seriesRows.map((row) => ({ day: row.day, value: row.revenue }));
  const labels = windows.currentDays.map((day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`);

  return {
    admin: true as const,
    days: OVERVIEW_DAYS,
    posts: postStats,
    kpi: {
      orders: kpiRaw.curOrders,
      revenue: kpiRaw.curRevenue,
      profit: kpiRaw.curProfit,
      costedOrders: kpiRaw.curCosted,
      changes: {
        orders: percentChange(kpiRaw.curOrders, kpiRaw.prevOrders),
        revenue: percentChange(kpiRaw.curRevenue, kpiRaw.prevRevenue),
        profit: percentChange(kpiRaw.curProfit, kpiRaw.prevProfit),
      },
      deltas: {
        orders: describeDelta(percentChange(kpiRaw.curOrders, kpiRaw.prevOrders)),
        revenue: describeDelta(percentChange(kpiRaw.curRevenue, kpiRaw.prevRevenue)),
        profit: describeDelta(percentChange(kpiRaw.curProfit, kpiRaw.prevProfit)),
      },
    },
    chart: {
      labels,
      orders: {
        current: fillDailySeries(windows.currentDays, orderRows),
        previous: fillDailySeries(windows.previousDays, orderRows),
      },
      revenue: {
        current: fillDailySeries(windows.currentDays, revenueRows),
        previous: fillDailySeries(windows.previousDays, revenueRows),
      },
    },
    provinces,
    sources,
    topProducts,
    lifetime: {
      products: productStats.active,
      publishedPosts: postStats.published,
      drafts: postStats.drafts,
      soldQty: lifetime.soldQty,
      revenue: lifetime.revenue,
      orders: lifetime.orders,
    },
    actions: buildActionItems({
      admin: true,
      newOrders: statusCounts.newOrders,
      agedNewOrders: statusCounts.agedNewOrders,
      processingOrders: statusCounts.processing,
      productsNoCover: productStats.noCover,
      productsNoCategory: productStats.noCategory,
      drafts: postStats.drafts,
      oldDrafts: postStats.oldDrafts,
      publishedPosts: postStats.published,
      seo,
    }),
  };
}

/** Alias cũ — trang admin gọi getDashboardOverview. */
export const getDashboard = getDashboardOverview;
