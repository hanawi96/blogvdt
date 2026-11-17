import type { APIRoute } from 'astro';
import { csrfMatches } from '../../../features/auth/session';
import { createStaffOrder, getOrder } from '../../../features/orders/orders';
import {
  parseStaffCustomer,
  priceStaffLines,
  readStaffFlags,
  type StaffLineInput,
} from '../../../features/orders/staff';
import { listStaffPickerProducts } from '../../../features/products/public';
import { qualifiesFreeShip, shipGroupOf } from '../../../features/shipping/customer-fee';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { allowsStaffApiOrigin } from '../../../lib/http';
import { formatVnd } from '../../../lib/money';
import { routes } from '../../../lib/routes';

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

function readLines(raw: unknown): StaffLineInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lines: StaffLineInput[] = [];
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    lines.push({
      slot: asString(row.slot) || `ext-${index}`,
      productId: asString(row.productId),
      weight: asString(row.weight),
      quantity: asString(row.quantity),
      price: asString(row.price),
      name: asString(row.name),
      note: asString(row.note),
    });
  }
  return lines;
}

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ request, locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`;
  if (!session) return json({ ok: false, error: 'auth', loginUrl }, 401);
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

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
    const picker = await listStaffPickerProducts(db);
    const priced = priceStaffLines(postedLines, picker.products, []);
    if (!priced.ok) return json({ ok: false, error: priced.error, field: 'lines' }, 422);

    let staffFlags = flags.flags;
    // Đủ điều kiện miễn ship theo giỏ → luôn về 0 (giống trang POS).
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

    const created = await createStaffOrder(
      db,
      {
        ...customer.value,
        lines: priced.lines,
        discountCode: values.discountCode.trim() ? values.discountCode : null,
        orderTotal: values.orderTotal,
        discountExtra: values.discountExtra,
        flags: staffFlags,
      },
      session.userId,
    );
    if (!created.ok) return json({ ok: false, error: created.error }, 422);

    const saved = await getOrder(db, created.id);
    return json({
      ok: true,
      id: created.id,
      code: saved?.code ?? '',
      total: saved ? formatVnd(saved.totalPrice) : '',
      url: routes.adminOrder(created.id),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'pos_create_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không tạo được đơn. Thử lại.' }, 500);
  }
};
