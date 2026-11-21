import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import {
  formatPercentBp,
  isShippingOrderCost,
  orderProfit,
  orderShippingCost,
  parseCostLines,
} from '../../../../features/costs/order-costs';
import { spxCodForOrder } from '../../../../features/orders/spx-export';
import { collectionLabel, remainingAfterDeposit } from '../../../../features/orders/staff';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { orders } from '../../../../lib/db/schema';
import { routes } from '../../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

function parseOrderId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const GET: APIRoute = async ({ params, locals, url }) => {
  const session = locals.adminSession;
  if (!session) {
    const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrders)}`;
    return json({ ok: false, error: 'auth', loginUrl }, 401);
  }

  const orderId = parseOrderId(params.id);
  if (orderId == null) return json({ ok: false, error: 'Đơn không hợp lệ.' }, 404);

  try {
    const db = createDb(getDbBinding());
    const rows = await db
      .select({
        code: orders.code,
        totalPrice: orders.totalPrice,
        discountAmount: orders.discountAmount,
        shippingFee: orders.shippingFee,
        shippingCost: orders.shippingCost,
        costGoods: orders.costGoods,
        costExtra: orders.costExtra,
        costLines: orders.costLines,
        paymentMethod: orders.paymentMethod,
        payState: orders.payState,
        depositAmount: orders.depositAmount,
        compensation: orders.compensation,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row) return json({ ok: false, error: 'Không tìm thấy đơn hàng.' }, 404);

    // Chỉ dùng ảnh chụp lúc đặt — không lấy công thức/giá NL hiện tại.
    const parsed = parseCostLines(row.costLines);
    const goods = parsed?.goods ?? [];
    const extraRaw = parsed?.extra ?? [];
    const displayShippingCost = orderShippingCost(row.shippingCost, extraRaw);
    const extras = extraRaw
      .filter((line) => !isShippingOrderCost(line.name))
      .map((line) => ({
        name: line.name,
        kind: line.kind,
        rate: line.rate,
        amount: line.amount,
        rateLabel: line.kind === 'percent' ? `${formatPercentBp(line.rate)}%` : null,
      }));
    const packagingLines = extras.filter((line) => line.kind === 'fixed');
    const taxLines = extras.filter((line) => line.kind === 'percent');
    const packagingTotal = parsed
      ? packagingLines.reduce((sum, line) => sum + line.amount, 0)
      : row.costExtra;

    const profit = orderProfit({
      totalPrice: row.totalPrice,
      costGoods: row.costGoods,
      costExtra: row.costExtra,
      shippingCost: row.shippingCost,
    });
    const totalCost =
      row.costGoods !== null && row.costExtra !== null
        ? row.costGoods + row.costExtra + (row.shippingCost ?? 0)
        : null;
    const marginPercent =
      profit !== null && row.totalPrice > 0 ? Math.round((profit / row.totalPrice) * 1000) / 10 : null;

    const productAmount = Math.max(0, row.totalPrice - row.shippingFee);
    const cod = spxCodForOrder({
      totalPrice: row.totalPrice,
      payState: row.payState,
      depositAmount: row.depositAmount,
      compensation: row.compensation,
    });
    const payLabel = collectionLabel(row.payState, row.paymentMethod);
    const collection =
      row.compensation === 1
        ? { kind: 'compensation' as const, payLabel, depositAmount: 0, collectAmount: 0 }
        : row.payState === 'deposit'
          ? {
              kind: 'deposit' as const,
              payLabel,
              depositAmount: row.depositAmount,
              collectAmount: remainingAfterDeposit(row.totalPrice, row.depositAmount),
            }
          : row.payState === 'paid' || (row.payState == null && row.paymentMethod === 'bank')
            ? { kind: 'paid' as const, payLabel, depositAmount: 0, collectAmount: 0 }
            : { kind: 'cod' as const, payLabel, depositAmount: 0, collectAmount: cod.amount };

    const hasGoodsMaterials = goods.some((line) => Array.isArray(line.materials) && line.materials.length > 0);

    return json({
      ok: true,
      id: orderId,
      code: row.code,
      productAmount,
      shippingFee: row.shippingFee,
      discountAmount: row.discountAmount,
      totalPrice: row.totalPrice,
      collection,
      costGoods: row.costGoods,
      packaging: { total: packagingTotal, lines: packagingLines },
      taxes: taxLines,
      displayShippingCost,
      costExtra: row.costExtra,
      totalCost,
      profit,
      marginPercent,
      goods,
      hasGoodsMaterials,
      missing: parsed?.missing ?? [],
      hasLines: parsed !== null,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'order_costs_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không tải được chi tiết chi phí.' }, 500);
  }
};
