import type { APIRoute } from 'astro';
import { csrfMatches } from '../../../../features/auth/session';
import { getOrder, updateStaffOrder } from '../../../../features/orders/orders';
import {
  canEditOrderProducts,
  orderLineSources,
  parseStaffCustomer,
  priceStaffLines,
  readStaffFlags,
  staffFlagForm,
  type StaffLineInput,
} from '../../../../features/orders/staff';
import { listStaffPickerProducts } from '../../../../features/products/public';
import { qualifiesFreeShip, shipGroupOf } from '../../../../features/shipping/customer-fee';
import { createDb } from '../../../../lib/db/client';
import { getDbBinding } from '../../../../lib/cloudflare/env';
import { allowsStaffApiOrigin } from '../../../../lib/http';
import { formatVnd } from '../../../../lib/money';
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

function asBool(value: unknown): boolean {
  return value === true || value === 'on' || value === '1';
}

function parseOrderId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readLines(raw: unknown): StaffLineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: StaffLineInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    lines.push({
      slot: asString(row.slot) || String(index),
      productId: row.productId == null ? '' : String(row.productId),
      weight: asString(row.weight),
      quantity: asString(row.quantity),
      price: asString(row.price),
      name: asString(row.name),
      note: asString(row.note),
    });
  }
  return lines;
}

function orderPayload(
  order: NonNullable<Awaited<ReturnType<typeof getOrder>>>,
  categoryByProduct: Map<number, string>,
) {
  const lines = orderLineSources(order).map((line) => ({
    productId: line.productId,
    productName: line.productName,
    weight: String(line.optionLabel || '').trim(),
    quantity: Math.max(1, Number(line.quantity) || 1),
    note: String(line.note || '').trim(),
    unitPrice: Math.max(0, Number(line.unitPrice) || 0),
    categorySlug: line.productId != null ? categoryByProduct.get(line.productId) || '' : '',
  }));
  return {
    id: order.id,
    code: order.code,
    editable: canEditOrderProducts(order.status),
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    note: order.note || '',
    provinceCode: order.provinceCode || '',
    discountCode: order.discountCode || '',
    discountAmount: order.discountAmount,
    subtotal: order.subtotal ?? order.totalPrice + order.discountAmount,
    totalPrice: order.totalPrice,
    lines,
    flags: staffFlagForm(order),
  };
}

export const GET: APIRoute = async ({ params, request, locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`;
  if (!session) return json({ ok: false, error: 'auth', loginUrl }, 401);
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

  const orderId = parseOrderId(params.id);
  if (orderId == null) return json({ ok: false, error: 'Đơn không hợp lệ.' }, 404);

  try {
    const db = createDb(getDbBinding());
    const order = await getOrder(db, orderId);
    if (!order) return json({ ok: false, error: 'Không tìm thấy đơn hàng.' }, 404);
    // GET cho phép đọc cả đơn đã kết thúc (để nhân bản); chỉ POST sửa mới chặn.
    const picker = await listStaffPickerProducts(db);
    const categoryByProduct = new Map(
      picker.products.map((product) => [product.id, product.categorySlug || ''] as const),
    );
    return json({ ok: true, order: orderPayload(order, categoryByProduct) });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'order_pos_get_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không tải được đơn.' }, 500);
  }
};

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

  const values = {
    customerName: asString(body.customerName),
    phone: asString(body.phone),
    address: asString(body.address),
    note: asString(body.note),
    orderTotal: asString(body.orderTotal),
    discountCode: asString(body.discountCode),
    discountExtra: asString(body.discountExtra),
  };
  const flagInput = {
    payState: asString(body.payState) || 'cod',
    source: asString(body.source),
    priority: asBool(body.priority) ? 'on' : '',
    compensation: asBool(body.compensation) ? 'on' : '',
    shipLater: asBool(body.shipLater) ? 'on' : '',
    shipOn: asString(body.shipOn),
    shippingFee: asString(body.shippingFee),
    freeShip: asBool(body.freeShip) ? 'on' : '',
    depositAmount: asString(body.depositAmount),
  };

  const flags = readStaffFlags(flagInput);
  if (!flags.ok) return json({ ok: false, error: flags.error, field: 'flags' }, 422);

  const customer = parseStaffCustomer({
    ...values,
    paymentMethod: flags.flags.paymentMethod,
  });
  if (!customer.ok) return json({ ok: false, error: 'Thông tin khách chưa hợp lệ.', errors: customer.errors }, 422);

  const postedLines = readLines(body.lines);
  if (!postedLines) return json({ ok: false, error: 'Thêm ít nhất một sản phẩm.', field: 'lines' }, 422);

  try {
    const db = createDb(getDbBinding());
    const current = await getOrder(db, orderId);
    if (!current) return json({ ok: false, error: 'Không tìm thấy đơn hàng.' }, 404);
    if (!canEditOrderProducts(current.status)) {
      return json({ ok: false, error: 'Đơn đã kết thúc, không sửa được.' }, 422);
    }

    const picker = await listStaffPickerProducts(db);
    const priced = priceStaffLines(postedLines, picker.products, orderLineSources(current));
    if (!priced.ok) return json({ ok: false, error: priced.error, field: 'lines' }, 422);

    let staffFlags = flags.flags;
    if (
      qualifiesFreeShip(
        priced.lines.map((line) => ({
          group: shipGroupOf(picker.products.find((product) => product.id === line.productId)?.categorySlug),
          lineTotal: line.lineTotal,
        })),
      )
    ) {
      staffFlags = { ...staffFlags, shippingFee: 0 };
    }

    const updated = await updateStaffOrder(db, orderId, {
      ...customer.value,
      lines: priced.lines,
      discountCode: values.discountCode.trim() ? values.discountCode : null,
      orderTotal: values.orderTotal,
      discountExtra: values.discountExtra,
      flags: staffFlags,
    });
    if (!updated.ok) return json({ ok: false, error: updated.error }, 422);

    const saved = await getOrder(db, orderId);
    return json({
      ok: true,
      id: orderId,
      code: saved?.code ?? '',
      total: saved ? formatVnd(saved.totalPrice) : '',
      url: routes.adminOrder(orderId),
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'order_pos_update_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không cập nhật được đơn. Thử lại.' }, 500);
  }
};
