import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { activityLogs, orderItems, orders, posts, products, seoHealthIssues, seoHealthRuns } from '../../lib/db/schema';
import { adTotals } from '../costs/ads';
import { notTrashed } from '../posts/visibility';
import {
  AGED_ORDER_MS,
  OLD_DRAFT_MS,
  averageValue,
  buildActionItems,
  cancelRate,
  mergeTopProducts,
  percentChange,
  periodRange,
  type DashboardPeriod,
} from './metrics';

const TOP_PRODUCTS = 5;
const RECENT_ORDERS = 6;
const RECENT_ACTIVITY = 6;

const num = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number);

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

// Một truy vấn cho cả hai kỳ: chỉ quét đơn từ đầu kỳ trước, dùng index theo ngày tạo.
async function loadKpi(db: AppDb, start: number, previousStart: number) {
  const inCurrent = sql`${orders.createdAt} >= ${start}`;
  const inPrevious = sql`${orders.createdAt} < ${start}`;
  const live = sql`${orders.status} <> 'cancelled'`;
  const cancelled = sql`${orders.status} = 'cancelled'`;
  // Chỉ tính lợi nhuận cho đơn có đủ số liệu chi phí lúc đặt (đơn cũ hoặc thiếu công thức thì bỏ qua).
  const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;
  const profit = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra}`;
  const rows = await db
    .select({
      curOrders: num(sql`sum(case when ${inCurrent} and ${live} then 1 else 0 end)`),
      curValue: num(sql`sum(case when ${inCurrent} and ${live} then ${orders.totalPrice} else 0 end)`),
      curCancelled: num(sql`sum(case when ${inCurrent} and ${cancelled} then 1 else 0 end)`),
      prevOrders: num(sql`sum(case when ${inPrevious} and ${live} then 1 else 0 end)`),
      prevValue: num(sql`sum(case when ${inPrevious} and ${live} then ${orders.totalPrice} else 0 end)`),
      prevCancelled: num(sql`sum(case when ${inPrevious} and ${cancelled} then 1 else 0 end)`),
      curCosted: num(sql`sum(case when ${inCurrent} and ${live} and ${costed} then 1 else 0 end)`),
      curProfit: num(sql`sum(case when ${inCurrent} and ${live} and ${costed} then ${profit} else 0 end)`),
      prevProfit: num(sql`sum(case when ${inPrevious} and ${live} and ${costed} then ${profit} else 0 end)`),
    })
    .from(orders)
    .where(gte(orders.createdAt, previousStart));
  const row = rows[0];
  return {
    curOrders: row?.curOrders ?? 0,
    curValue: row?.curValue ?? 0,
    curCancelled: row?.curCancelled ?? 0,
    prevOrders: row?.prevOrders ?? 0,
    prevValue: row?.prevValue ?? 0,
    prevCancelled: row?.prevCancelled ?? 0,
    curCosted: row?.curCosted ?? 0,
    curProfit: row?.curProfit ?? 0,
    prevProfit: row?.prevProfit ?? 0,
  };
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
  let all = 0;
  let newOrders = 0;
  let agedNewOrders = 0;
  let processing = 0;
  for (const row of rows) {
    all += row.value;
    if (row.status === 'new') {
      newOrders += row.value;
      agedNewOrders += row.aged;
    }
    if (row.status === 'confirmed' || row.status === 'preparing' || row.status === 'shipped') processing += row.value;
  }
  return { all, newOrders, agedNewOrders, processing };
}

// Số lượng bán trong kỳ = đơn một mẫu (orders) + đơn nhiều mẫu (order_items), bỏ đơn đã hủy.
async function loadTopProducts(db: AppDb, start: number) {
  const inRange = and(gte(orders.createdAt, start), ne(orders.status, 'cancelled'));
  const [single, many] = await Promise.all([
    db
      .select({ productId: orders.productId, sold: num(sql`sum(${orders.quantity})`) })
      .from(orders)
      .where(and(inRange, isNotNull(orders.productId)))
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
  const names = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(inArray(products.id, top.map((item) => item.productId)));
  const byId = new Map(names.map((item) => [item.id, item.name]));
  return top.flatMap((item) => {
    const name = byId.get(item.productId);
    return name ? [{ productId: item.productId, name, sold: item.sold }] : [];
  });
}

function loadRecentOrders(db: AppDb) {
  return db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      productName: orders.productName,
      totalPrice: orders.totalPrice,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(RECENT_ORDERS);
}

// Đọc kết quả kiểm tra SEO đã lưu, không quét lại. Chỉ tính lỗi của bài đang xuất bản (giống trang kiểm tra SEO).
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

function loadRecentActivity(db: AppDb) {
  return db
    .select({ id: activityLogs.id, actorName: activityLogs.actorName, summary: activityLogs.summary, createdAt: activityLogs.createdAt })
    .from(activityLogs)
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id))
    .limit(RECENT_ACTIVITY);
}

export async function getDashboard(db: AppDb, options: { admin: boolean; days: DashboardPeriod; now?: number }) {
  const now = options.now ?? Date.now();
  const { start, previousStart } = periodRange(options.days, now);
  const empty = {
    kpi: {
      orders: 0,
      value: 0,
      average: 0,
      cancelRate: 0,
      previousCancelRate: 0,
      profit: 0,
      adSpend: 0,
      costedOrders: 0,
      changes: { orders: 0 as number | null, value: 0 as number | null, average: 0 as number | null, profit: 0 as number | null },
    },
    totalOrders: 0,
    topProducts: [] as Awaited<ReturnType<typeof loadTopProducts>>,
    recentOrders: [] as Awaited<ReturnType<typeof loadRecentOrders>>,
    activity: [] as Awaited<ReturnType<typeof loadRecentActivity>>,
    activeProducts: 0,
  };

  if (!options.admin) {
    const postStats = await loadPosts(db, now);
    return {
      ...empty,
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

  const [postStats, productStats, kpiRaw, statusCounts, topProducts, recentOrders, seo, activity, ads] = await Promise.all([
    loadPosts(db, now),
    loadProducts(db),
    loadKpi(db, start, previousStart),
    loadStatusCounts(db, now),
    loadTopProducts(db, start),
    loadRecentOrders(db),
    loadSeo(db),
    loadRecentActivity(db),
    adTotals(db, now, options.days),
  ]);

  // Lợi nhuận = lợi nhuận các đơn có đủ chi phí trừ quảng cáo của cả kỳ.
  const profit = kpiRaw.curProfit - ads.current;
  const previousProfit = kpiRaw.prevProfit - ads.previous;
  const average = averageValue(kpiRaw.curValue, kpiRaw.curOrders);
  const previousAverage = averageValue(kpiRaw.prevValue, kpiRaw.prevOrders);
  return {
    kpi: {
      orders: kpiRaw.curOrders,
      value: kpiRaw.curValue,
      average,
      cancelRate: cancelRate(kpiRaw.curCancelled, kpiRaw.curOrders),
      previousCancelRate: cancelRate(kpiRaw.prevCancelled, kpiRaw.prevOrders),
      profit,
      adSpend: ads.current,
      costedOrders: kpiRaw.curCosted,
      changes: {
        orders: percentChange(kpiRaw.curOrders, kpiRaw.prevOrders),
        value: percentChange(kpiRaw.curValue, kpiRaw.prevValue),
        average: percentChange(average, previousAverage),
        profit: percentChange(profit, previousProfit),
      },
    },
    totalOrders: statusCounts.all,
    topProducts,
    recentOrders,
    activity,
    activeProducts: productStats.active,
    posts: postStats,
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
