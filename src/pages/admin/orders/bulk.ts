import type { APIRoute } from 'astro';
import { activityActor } from '../../../features/activity/log';
import { mutationError } from '../../../features/auth/session';
import { deleteOrders, orderAdminQuery, readOrderBulk, readOrderListContext } from '../../../features/orders/orders';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

export const GET: APIRoute = () => new Response(null, { status: 405 });

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const form = await request.formData();
  const list = readOrderListContext(form);
  if (session.role !== 'admin') {
    return new Response('Bạn không có quyền xóa đơn hàng.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  const bulk = readOrderBulk(form);
  if (!bulk || bulk.action !== 'delete') return redirect(orderAdminQuery({ ...list, notice: 'bulk-error' }), 303);
  const db = createDb(getDbBinding());
  try {
    const count = await deleteOrders(db, bulk.ids, await activityActor(db, session.userId));
    return redirect(orderAdminQuery({ ...list, page: 1, notice: 'bulk-deleted', n: count }), 303);
  } catch (failure) {
    console.error(JSON.stringify({ event: 'order_bulk_failed', action: bulk.action, name: failure instanceof Error ? failure.name : 'unknown' }));
    return redirect(orderAdminQuery({ ...list, notice: 'bulk-error' }), 303);
  }
};
