import type { APIRoute } from 'astro';
import { csrfMatches } from '../../../../features/auth/session';
import { updateOrderPriority } from '../../../../features/orders/orders';
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

function parseOrderId(raw: string | undefined): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const GET: APIRoute = () => new Response(null, { status: 405 });

/** POST: bật/tắt ưu tiên đơn (extension / API staff). */
export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.admin)}`;
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

  const priority = body.priority === true || body.priority === 1 || body.priority === '1' || body.priority === 'on';

  try {
    const db = createDb(getDbBinding());
    const result = await updateOrderPriority(db, orderId, priority);
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json({ ok: true, id: orderId, priority });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'order_priority_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không đổi được ưu tiên. Thử lại.' }, 500);
  }
};
