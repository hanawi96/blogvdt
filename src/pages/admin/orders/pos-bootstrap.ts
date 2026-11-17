import type { APIRoute } from 'astro';
import { listStaffDiscountChoices } from '../../../features/discounts/discounts';
import { isShippingOrderCost, listOrderCosts } from '../../../features/costs/order-costs';
import { ORDER_SOURCES, PAY_STATES, STAFF_SHIP_DAY_PRESETS } from '../../../features/orders/staff';
import { listStaffPickerProducts } from '../../../features/products/public';
import { WEIGHT_SCALES, weightChips, weightExtras } from '../../../features/products/weight';
import { baseCustomerShippingFee } from '../../../features/shipping/customer-fee';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { groupDigits } from '../../../lib/group-digits';
import { routes } from '../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`;
  if (!session) return json({ ok: false, error: 'auth', loginUrl }, 401);

  try {
    const db = createDb(getDbBinding());
    const [picker, discountChoices, orderCosts] = await Promise.all([
      listStaffPickerProducts(db),
      listStaffDiscountChoices(db),
      listOrderCosts(db),
    ]);
    const shippingCosts = orderCosts
      .filter((cost) => cost.active && isShippingOrderCost(cost.name))
      .map((cost) => ({ name: cost.name, kind: cost.kind, value: cost.value }));
    const defaultShippingFeeAmount = baseCustomerShippingFee(shippingCosts);
    const defaultShippingFee = defaultShippingFeeAmount > 0 ? groupDigits(String(defaultShippingFeeAmount), 8) : '';

    const weightScales = (Object.keys(WEIGHT_SCALES) as Array<keyof typeof WEIGHT_SCALES>).map((scale) => ({
      scale,
      chips: [...weightChips(scale)],
      extras: [...weightExtras(scale)],
    }));

    return json({
      ok: true,
      csrf: session.csrfToken,
      user: { displayName: session.displayName, role: session.role },
      products: picker.products,
      categories: picker.categories,
      discountChoices,
      shippingCosts,
      defaultShippingFee,
      weightScales,
      sources: ORDER_SOURCES.map((item) => ({ value: item.value, label: item.label })),
      payStates: PAY_STATES.map((item) => ({ value: item.value, label: item.label })),
      shipDayPresets: [...STAFF_SHIP_DAY_PRESETS],
      ordersUrl: routes.adminOrders,
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'pos_bootstrap_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không tải được dữ liệu tạo đơn.' }, 500);
  }
};

export const POST: APIRoute = () => new Response(null, { status: 405 });
