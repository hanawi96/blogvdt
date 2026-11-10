import type { APIRoute } from 'astro';
import addressSelect from '../../../../public/data/address-select.json';
import { activityActor } from '../../../features/activity/log';
import type { AddressSelectRow } from '../../../features/address/parse';
import { mutationError } from '../../../features/auth/session';
import { createSpxOrderExport } from '../../../features/orders/order-exports';
import { deleteOrders, orderAdminQuery, readOrderBulk, readOrderListContext } from '../../../features/orders/orders';
import { createDb } from '../../../lib/db/client';
import { getDbBinding, getMediaBucket } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

const ADDRESS_ROWS = addressSelect as unknown as AddressSelectRow[];

export const GET: APIRoute = () => new Response(null, { status: 405 });

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const form = await request.formData();
  const list = readOrderListContext(form);
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });
  const bulk = readOrderBulk(form);
  if (!bulk) return redirect(orderAdminQuery({ ...list, notice: 'bulk-error' }), 303);

  if (bulk.action === 'export') {
    const db = createDb(getDbBinding());
    try {
      const result = await createSpxOrderExport(db, getMediaBucket(), {
        ids: bulk.ids,
        addressRows: ADDRESS_ROWS,
        actor: await activityActor(db, session.userId),
      });
      if (!result.ok) return json({ ok: false, error: result.error, skipped: result.skipped ?? [] }, 422);
      return json({
        ok: true,
        id: result.id,
        filename: result.filename,
        orderCount: result.orderCount,
        skippedCount: result.skippedCount,
        skipped: result.skipped,
      });
    } catch (failure) {
      console.error(JSON.stringify({ event: 'order_bulk_export_failed', name: failure instanceof Error ? failure.name : 'unknown' }));
      return json({ ok: false, error: 'Không export được đơn hàng.' }, 500);
    }
  }

  if (bulk.action === 'delete') {
    if (session.role !== 'admin') {
      return new Response('Bạn không có quyền xóa đơn hàng.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    const db = createDb(getDbBinding());
    try {
      const count = await deleteOrders(db, bulk.ids, await activityActor(db, session.userId));
      return redirect(orderAdminQuery({ ...list, page: 1, notice: 'bulk-deleted', n: count }), 303);
    } catch (failure) {
      console.error(JSON.stringify({ event: 'order_bulk_failed', action: bulk.action, name: failure instanceof Error ? failure.name : 'unknown' }));
      return redirect(orderAdminQuery({ ...list, notice: 'bulk-error' }), 303);
    }
  }

  return redirect(orderAdminQuery({ ...list, notice: 'bulk-error' }), 303);
};
