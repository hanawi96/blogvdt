import type { APIRoute } from 'astro';
import { csrfMatches } from '../../../../features/auth/session';
import { getOrder, updateStaffOrderLines } from '../../../../features/orders/orders';
import {
  canEditOrderProducts,
  orderLineSources,
  priceStaffLines,
  type StaffLineInput,
} from '../../../../features/orders/staff';
import { listStaffPickerProducts } from '../../../../features/products/public';
import { readWeightScale, weightChips, weightExtras } from '../../../../features/products/weight';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { allowsStaffApiOrigin } from '../../../../lib/http';
import { routes } from '../../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readLines(raw: unknown): StaffLineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: StaffLineInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const productId = row.productId == null ? '' : String(row.productId);
    lines.push({
      slot: asString(row.slot) || String(index),
      productId,
      weight: asString(row.weight),
      quantity: asString(row.quantity),
      price: asString(row.price),
      name: asString(row.name),
      note: asString(row.note),
    });
  }
  return lines;
}

function parseOrderId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function orderLinesPayload(db: ReturnType<typeof createDb>, orderId: number) {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  const stored = orderLineSources(order);
  const picker = await listStaffPickerProducts(db);
  const byId = new Map(picker.products.map((product) => [product.id, product]));
  const lines = stored.map((line) => {
    const product = line.productId != null ? byId.get(line.productId) : undefined;
    const weightScale = readWeightScale(product?.weightScale);
    return {
      productId: line.productId,
      productName: line.productName,
      weight: String(line.optionLabel || '').trim(),
      quantity: Math.max(1, Number(line.quantity) || 1),
      note: String(line.note || '').trim(),
      weightScale,
      chips: [...weightChips(weightScale)],
      extras: [...weightExtras(weightScale)],
    };
  });
  return {
    id: order.id,
    code: order.code,
    totalPrice: order.totalPrice,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    editable: canEditOrderProducts(order.status),
    discountCode: order.discountCode || '',
    shippingFee: Math.max(0, Number(order.shippingFee) || 0),
    lines,
  };
}

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`;
  if (!session) return json({ ok: false, error: 'auth', loginUrl }, 401);
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

  const orderId = parseOrderId(params.id);
  if (orderId == null) return json({ ok: false, error: 'Đơn không hợp lệ.' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: 'Payload không hợp lệ.' }, 422);
  }

  if (typeof body.csrf !== 'string' || !csrfMatches(session.csrfToken, body.csrf)) {
    return json({ ok: false, error: 'Phiên không hợp lệ. Tải lại trang.' }, 403);
  }

  const postedLines = readLines(body.lines);
  if (!postedLines) return json({ ok: false, error: 'Thêm ít nhất một sản phẩm.', field: 'lines' }, 422);

  try {
    const db = createDb(getDbBinding());
    const current = await getOrder(db, orderId);
    if (!current) return json({ ok: false, error: 'Không tìm thấy đơn hàng.' }, 404);
    if (!canEditOrderProducts(current.status)) {
      return json({ ok: false, error: 'Đơn đã kết thúc, không sửa sản phẩm.' }, 422);
    }

    const picker = await listStaffPickerProducts(db);
    const priced = priceStaffLines(postedLines, picker.products, orderLineSources(current));
    if (!priced.ok) return json({ ok: false, error: priced.error, field: 'lines' }, 422);

    const updated = await updateStaffOrderLines(
      db,
      orderId,
      priced.lines,
      current.discountCode || '',
      '',
      '',
    );
    if (!updated.ok) return json({ ok: false, error: updated.error }, 422);

    const order = await orderLinesPayload(db, orderId);
    if (!order) return json({ ok: false, error: 'Không tải lại được đơn.' }, 500);
    return json({ ok: true, order });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'order_lines_update_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không cập nhật được đơn. Thử lại.' }, 500);
  }
};
