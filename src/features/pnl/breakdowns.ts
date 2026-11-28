import { and, desc, eq, gte, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { AppDb } from '../../lib/db/client';
import { orderItems, orders } from '../../lib/db/schema';
import { routes } from '../../lib/routes';
import { orderAdminQuery } from '../orders/orders';
import { sourceLabel } from '../orders/staff';
import type { PnlPeriod } from './period';

const num = (expression: ReturnType<typeof sql>) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number);

const statsOk = sql`${orders.status} <> 'cancelled' AND ${orders.compensation} = 0`;
const costed = sql`${orders.costGoods} is not null and ${orders.costExtra} is not null`;
const profitExpr = sql`${orders.totalPrice} - ${orders.costGoods} - ${orders.costExtra} - coalesce(${orders.shippingCost}, 0)`;

export const PNL_TOP_PRODUCTS = 10;
export const PNL_UNCOSTED_SAMPLE = 8;

export type PnlUncostedSample = { id: number; code: string; totalPrice: number };
export type PnlSourceRow = {
  source: string | null;
  label: string;
  orders: number;
  costedOrders: number;
  revenue: number;
  grossProfit: number;
};
export type PnlProductRank = {
  productId: number;
  name: string;
  sold: number;
  revenue: number;
  goodsCost: number;
  /** Doanh thu dòng − vốn hàng phân bổ (chưa trừ phí đơn/ship/ads). */
  contribution: number;
};

export type PnlQuality = {
  uncostedOrders: number;
  uncostedRevenue: number;
  samples: PnlUncostedSample[];
  ordersListHref: string;
};

export type PnlBreakdowns = {
  quality: PnlQuality;
  sources: PnlSourceRow[];
  topProducts: PnlProductRank[];
};

type ItemLine = {
  orderId: number;
  productId: number;
  name: string;
  quantity: number;
  lineTotal: number;
  costGoods: number;
};

type LegacyLine = {
  productId: number;
  name: string;
  quantity: number;
  revenue: number;
  costGoods: number;
};

/** Phân bổ cost_goods theo tỷ lệ line_total trong đơn; cộng đơn legacy. Pure — dùng cho test. */
export function aggregateProductGoodsMargins(
  lines: readonly ItemLine[],
  legacy: readonly LegacyLine[],
  limit = PNL_TOP_PRODUCTS,
): PnlProductRank[] {
  const orderTotals = new Map<number, number>();
  for (const line of lines) {
    orderTotals.set(line.orderId, (orderTotals.get(line.orderId) ?? 0) + line.lineTotal);
  }

  const byProduct = new Map<number, PnlProductRank>();
  const bump = (productId: number, name: string, sold: number, revenue: number, goodsCost: number) => {
    const current = byProduct.get(productId);
    if (!current) {
      byProduct.set(productId, {
        productId,
        name,
        sold,
        revenue,
        goodsCost,
        contribution: revenue - goodsCost,
      });
      return;
    }
    current.sold += sold;
    current.revenue += revenue;
    current.goodsCost += goodsCost;
    current.contribution = current.revenue - current.goodsCost;
    if (name) current.name = name;
  };

  // Phân bổ theo đơn rồi chỉnh dòng lớn nhất để tổng share = costGoods (tránh lệch làm tròn).
  const byOrder = new Map<number, ItemLine[]>();
  for (const line of lines) {
    const bucket = byOrder.get(line.orderId);
    if (bucket) bucket.push(line);
    else byOrder.set(line.orderId, [line]);
  }
  for (const orderLines of byOrder.values()) {
    const orderSum = orderLines.reduce((sum, line) => sum + line.lineTotal, 0);
    const costGoods = orderLines[0]?.costGoods ?? 0;
    const shares = orderLines.map((line) =>
      orderSum > 0 ? Math.round((line.lineTotal * costGoods) / orderSum) : 0,
    );
    const drift = costGoods - shares.reduce((sum, value) => sum + value, 0);
    if (drift !== 0 && shares.length > 0) {
      let adjustAt = 0;
      for (let i = 1; i < orderLines.length; i += 1) {
        if (orderLines[i]!.lineTotal > orderLines[adjustAt]!.lineTotal) adjustAt = i;
      }
      shares[adjustAt] = (shares[adjustAt] ?? 0) + drift;
    }
    for (let i = 0; i < orderLines.length; i += 1) {
      const line = orderLines[i]!;
      bump(line.productId, line.name, line.quantity, line.lineTotal, shares[i] ?? 0);
    }
  }
  for (const line of legacy) {
    bump(line.productId, line.name, line.quantity, line.revenue, line.costGoods);
  }

  return [...byProduct.values()].sort((a, b) => b.contribution - a.contribution || b.revenue - a.revenue).slice(0, limit);
}

async function loadUncostedSamples(db: AppDb, period: PnlPeriod): Promise<PnlUncostedSample[]> {
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      totalPrice: orders.totalPrice,
    })
    .from(orders)
    .where(
      and(
        gte(orders.createdAt, period.start),
        lt(orders.createdAt, period.end),
        ne(orders.status, 'cancelled'),
        eq(orders.compensation, 0),
        or(isNull(orders.costGoods), isNull(orders.costExtra)),
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(PNL_UNCOSTED_SAMPLE);
  return rows;
}

async function loadBySource(db: AppDb, period: PnlPeriod): Promise<PnlSourceRow[]> {
  const rows = await db
    .select({
      source: orders.source,
      ordersCount: num(sql`sum(case when ${statsOk} then 1 else 0 end)`),
      costedOrders: num(sql`sum(case when ${statsOk} and ${costed} then 1 else 0 end)`),
      revenue: num(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end)`),
      grossProfit: num(sql`sum(case when ${statsOk} and ${costed} then ${profitExpr} else 0 end)`),
    })
    .from(orders)
    .where(and(gte(orders.createdAt, period.start), lt(orders.createdAt, period.end)))
    .groupBy(orders.source)
    .orderBy(sql`sum(case when ${statsOk} then ${orders.totalPrice} else 0 end) desc`);

  return rows
    .filter((row) => row.ordersCount > 0)
    .map((row) => ({
      source: row.source,
      label: sourceLabel(row.source) || (row.source ? row.source : 'Không ghi nhận'),
      orders: row.ordersCount,
      costedOrders: row.costedOrders,
      revenue: row.revenue,
      grossProfit: row.grossProfit,
    }));
}

async function loadTopProducts(db: AppDb, period: PnlPeriod): Promise<PnlProductRank[]> {
  const inPeriod = and(gte(orders.createdAt, period.start), lt(orders.createdAt, period.end));
  const costedOk = and(inPeriod, ne(orders.status, 'cancelled'), eq(orders.compensation, 0), isNotNull(orders.costGoods), isNotNull(orders.costExtra));
  const legacyOnly = sql`not exists (select 1 from order_items where order_items.order_id = ${orders.id})`;

  const [itemRows, legacyRows] = await Promise.all([
    db
      .select({
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        name: orderItems.productName,
        quantity: orderItems.quantity,
        lineTotal: orderItems.lineTotal,
        costGoods: orders.costGoods,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(costedOk, isNotNull(orderItems.productId))),
    db
      .select({
        productId: orders.productId,
        name: orders.productName,
        quantity: orders.quantity,
        revenue: num(sql`${orders.unitPrice} * ${orders.quantity}`),
        costGoods: orders.costGoods,
      })
      .from(orders)
      .where(and(costedOk, isNotNull(orders.productId), legacyOnly)),
  ]);

  const lines: ItemLine[] = itemRows.flatMap((row) =>
    row.productId !== null && row.costGoods !== null
      ? [
          {
            orderId: row.orderId,
            productId: row.productId,
            name: row.name,
            quantity: row.quantity,
            lineTotal: row.lineTotal,
            costGoods: row.costGoods,
          },
        ]
      : [],
  );
  const legacy: LegacyLine[] = legacyRows.flatMap((row) =>
    row.productId !== null && row.costGoods !== null
      ? [
          {
            productId: row.productId,
            name: row.name,
            quantity: row.quantity,
            revenue: row.revenue,
            costGoods: row.costGoods,
          },
        ]
      : [],
  );

  return aggregateProductGoodsMargins(lines, legacy, PNL_TOP_PRODUCTS);
}

export async function loadPnlBreakdowns(
  db: AppDb,
  period: PnlPeriod,
  waterfall: { orders: number; costedOrders: number; revenue: number; costedRevenue: number },
): Promise<PnlBreakdowns> {
  const uncostedOrders = Math.max(0, waterfall.orders - waterfall.costedOrders);
  const uncostedRevenue = Math.max(0, waterfall.revenue - waterfall.costedRevenue);
  const [samples, sources, topProducts] = await Promise.all([
    uncostedOrders > 0 ? loadUncostedSamples(db, period) : Promise.resolve([] as PnlUncostedSample[]),
    loadBySource(db, period),
    loadTopProducts(db, period),
  ]);

  return {
    quality: {
      uncostedOrders,
      uncostedRevenue,
      samples,
      ordersListHref: orderAdminQuery({ status: 'all', from: period.from, to: period.to }),
    },
    sources,
    topProducts,
  };
}

export function productAdminHref(productId: number): string {
  return routes.adminProduct(productId);
}

export function orderAdminHref(orderId: number): string {
  return routes.adminOrder(orderId);
}
