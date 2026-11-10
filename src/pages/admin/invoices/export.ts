import type { APIRoute } from 'astro';
import { activityActor } from '../../../features/activity/log';
import { mutationError } from '../../../features/auth/session';
import {
  createInvoiceExport,
  deleteInvoiceExports,
  downloadInvoiceExport,
  listInvoiceExports,
} from '../../../features/orders/invoice-exports';
import { INVOICE_EXPORT_MAX, parseInvoiceTab } from '../../../features/orders/einvoice';
import { createDb } from '../../../lib/db/client';
import { getDbBinding, getMediaBucket } from '../../../lib/cloudflare/env';
import { formatDateShort, formatTimeHm } from '../../../lib/datetime';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function readIds(form: FormData): number[] {
  return [...new Set(form.getAll('ids').map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, INVOICE_EXPORT_MAX);
}

export const GET: APIRoute = async ({ locals }) => {
  const session = locals.adminSession;
  if (!session) return new Response(null, { status: 401 });
  if (session.role !== 'admin') return new Response(null, { status: 403 });
  const db = createDb(getDbBinding());
  const rows = await listInvoiceExports(db);
  return json({
    ok: true,
    items: rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      orderCount: row.orderCount,
      downloaded: row.downloadedAt != null,
      createdAt: row.createdAt,
      createdLabel: `${formatTimeHm(row.createdAt)} ${formatDateShort(row.createdAt)}`,
    })),
  });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.adminSession;
  if (!session) return new Response(null, { status: 401 });
  if (session.role !== 'admin') {
    return new Response('Bạn không có quyền xuất hóa đơn.', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const form = await request.formData();
  const error = mutationError(request, session, form);
  if (error) return new Response(error, { status: 403 });

  const intent = form.get('intent');
  const db = createDb(getDbBinding());
  const actor = await activityActor(db, session.userId);

  if (intent === 'create') {
    const ids = readIds(form);
    if (ids.length === 0) return json({ ok: false, error: 'Chọn ít nhất một đơn.' }, 422);
    try {
      const result = await createInvoiceExport(db, getMediaBucket(), {
        ids,
        tab: parseInvoiceTab(String(form.get('tab') || 'ready')),
        actor,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, 422);
      return json({
        ok: true,
        id: result.id,
        filename: result.filename,
        orderCount: result.orderCount,
      });
    } catch (failure) {
      console.error(
        JSON.stringify({
          event: 'invoice_export_create_failed',
          name: failure instanceof Error ? failure.name : 'unknown',
        }),
      );
      return json({ ok: false, error: 'Không xuất được hóa đơn.' }, 500);
    }
  }

  if (intent === 'download') {
    const id = Number(form.get('id'));
    if (!Number.isInteger(id) || id < 1) return json({ ok: false, error: 'File không hợp lệ.' }, 422);
    try {
      const result = await downloadInvoiceExport(db, getMediaBucket(), id, actor);
      if (!result.ok) return json({ ok: false, error: result.error }, 404);
      return new Response(new Uint8Array(result.bytes), {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${result.filename}"`,
          'cache-control': 'no-store',
          'x-invoice-first-download': result.firstDownload ? '1' : '0',
          'x-invoice-marked-count': String(result.markedCount),
        },
      });
    } catch (failure) {
      console.error(
        JSON.stringify({
          event: 'invoice_export_download_failed',
          name: failure instanceof Error ? failure.name : 'unknown',
        }),
      );
      return json({ ok: false, error: 'Không tải được file.' }, 500);
    }
  }

  if (intent === 'delete') {
    const ids = [...new Set(form.getAll('ids').map(Number))].filter((id) => Number.isInteger(id) && id > 0);
    try {
      const result = await deleteInvoiceExports(db, getMediaBucket(), ids, actor);
      if (!result.ok) return json({ ok: false, error: result.error }, 422);
      return json({ ok: true, count: result.count });
    } catch (failure) {
      console.error(
        JSON.stringify({
          event: 'invoice_export_delete_failed',
          name: failure instanceof Error ? failure.name : 'unknown',
        }),
      );
      return json({ ok: false, error: 'Không xóa được file.' }, 500);
    }
  }

  return json({ ok: false, error: 'Thao tác không hợp lệ.' }, 422);
};
