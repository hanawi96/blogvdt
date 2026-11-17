import type { APIRoute } from 'astro';
import { activityActor } from '../../../../features/activity/log';
import { csrfMatches } from '../../../../features/auth/session';
import { deleteOrder } from '../../../../features/orders/orders';
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

export const POST: APIRoute = async ({ params, request, locals, url }) => {
  const session = locals.adminSession;
  const loginUrl = `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`;
  if (!session) return json({ ok: false, error: 'auth', loginUrl }, 401);
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);
  if (session.role !== 'admin') return json({ ok: false, error: 'Bạn không có quyền xóa đơn hàng.' }, 403);

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

  try {
    const db = createDb(getDbBinding());
    const removed = await deleteOrder(db, orderId, await activityActor(db, session.userId));
    if (!removed.ok) return json({ ok: false, error: removed.error }, 404);
    return json({ ok: true, id: orderId });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'order_delete_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không xóa được đơn. Thử lại.' }, 500);
  }
};
