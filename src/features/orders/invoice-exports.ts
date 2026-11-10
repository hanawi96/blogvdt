import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { invoiceExportItems, invoiceExports } from '../../lib/db/schema';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import {
  buildEinvoiceWorkbookBytes,
  einvoiceExportFilename,
  einvoiceExportObjectKey,
  mapOrdersToEinvoiceRows,
} from './einvoice-export';
import {
  filterDoneInvoiceIds,
  filterReadyInvoiceIds,
  loadOrdersForInvoiceExport,
  markOrdersInvoiceExported,
  parseInvoiceTab,
  type InvoiceTab,
} from './einvoice';

export type InvoiceExportListItem = {
  id: number;
  filename: string;
  orderCount: number;
  downloadedAt: number | null;
  createdAt: number;
};

export async function listInvoiceExports(db: AppDb, limit = 20): Promise<InvoiceExportListItem[]> {
  const rows = await db
    .select({
      id: invoiceExports.id,
      filename: invoiceExports.filename,
      orderCount: invoiceExports.orderCount,
      downloadedAt: invoiceExports.downloadedAt,
      createdAt: invoiceExports.createdAt,
    })
    .from(invoiceExports)
    .orderBy(desc(invoiceExports.createdAt), desc(invoiceExports.id))
    .limit(Math.min(Math.max(1, limit), 20));
  return rows;
}

export async function createInvoiceExport(
  db: AppDb,
  bucket: R2Bucket,
  input: {
    ids: number[];
    tab: InvoiceTab | string;
    actor: ActivityActor;
  },
  now = Date.now(),
): Promise<{ ok: true; id: number; filename: string; orderCount: number } | { ok: false; error: string }> {
  const tab = parseInvoiceTab(input.tab);
  const allowed =
    tab === 'done' ? await filterDoneInvoiceIds(db, input.ids) : await filterReadyInvoiceIds(db, input.ids, now);
  if (allowed.length === 0) {
    return {
      ok: false,
      error:
        tab === 'done'
          ? 'Không có đơn đã xuất nào trong lựa chọn.'
          : 'Không có đơn đủ điều kiện xuất (đã gửi ≥ 10 ngày, chưa xuất).',
    };
  }

  const orders = await loadOrdersForInvoiceExport(db, allowed);
  if (orders.length === 0) return { ok: false, error: 'Không tải được đơn đã chọn.' };

  const mapped = mapOrdersToEinvoiceRows(orders, now);
  if (mapped.orderCount === 0) return { ok: false, error: 'Không có dòng hóa đơn để xuất.' };

  const filename = einvoiceExportFilename(mapped.orderCount, now);
  const r2Key = einvoiceExportObjectKey(filename, new Date(now));
  const bytes = buildEinvoiceWorkbookBytes(mapped.rows);
  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentDisposition: `attachment; filename="${filename}"`,
    },
  });

  try {
    const inserted = await db
      .insert(invoiceExports)
      .values({
        filename,
        r2Key,
        orderCount: mapped.orderCount,
        downloadedAt: null,
        createdBy: input.actor.id,
        createdAt: now,
      })
      .returning({ id: invoiceExports.id });
    const exportId = inserted[0]?.id;
    if (!exportId) throw new Error('missing export id');

    await commitWrites(db, [
      db.insert(invoiceExportItems).values(orders.map((order) => ({ exportId, orderId: order.id }))),
      activityWrite(
        db,
        {
          actorId: input.actor.id,
          actorName: input.actor.name,
          action: 'order.invoice_export_create',
          objectType: 'order',
          objectId: String(exportId),
          summary: `Đã tạo file HĐĐT ${filename} (${mapped.orderCount} đơn).`,
          createdAt: now,
        },
        true,
      ),
    ]);

    return { ok: true, id: exportId, filename, orderCount: mapped.orderCount };
  } catch (error) {
    await bucket.delete(r2Key);
    console.error(
      JSON.stringify({ event: 'invoice_export_insert_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return { ok: false, error: 'Không lưu được file xuất HĐĐT.' };
  }
}

export async function getInvoiceExport(
  db: AppDb,
  id: number,
): Promise<{ id: number; filename: string; r2Key: string; downloadedAt: number | null; orderCount: number } | null> {
  const rows = await db
    .select({
      id: invoiceExports.id,
      filename: invoiceExports.filename,
      r2Key: invoiceExports.r2Key,
      downloadedAt: invoiceExports.downloadedAt,
      orderCount: invoiceExports.orderCount,
    })
    .from(invoiceExports)
    .where(eq(invoiceExports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

async function listInvoiceExportOrderIds(db: AppDb, exportId: number): Promise<number[]> {
  const rows = await db
    .select({ orderId: invoiceExportItems.orderId })
    .from(invoiceExportItems)
    .where(eq(invoiceExportItems.exportId, exportId));
  return rows.map((row) => row.orderId);
}

/**
 * Tải file: lần đầu đánh dấu invoice_exported_at cho đơn còn null, rồi set downloaded_at.
 * Lần sau chỉ stream lại.
 */
export async function downloadInvoiceExport(
  db: AppDb,
  bucket: R2Bucket,
  exportId: number,
  actor: ActivityActor,
  now = Date.now(),
): Promise<
  | { ok: true; filename: string; bytes: Uint8Array; firstDownload: boolean; markedCount: number }
  | { ok: false; error: string }
> {
  const item = await getInvoiceExport(db, exportId);
  if (!item) return { ok: false, error: 'Không tìm thấy file xuất HĐĐT.' };
  const object = await bucket.get(item.r2Key);
  if (!object) return { ok: false, error: 'File không còn trên lưu trữ.' };
  const bytes = new Uint8Array(await object.arrayBuffer());

  if (item.downloadedAt != null) {
    return { ok: true, filename: item.filename, bytes, firstDownload: false, markedCount: 0 };
  }

  const orderIds = await listInvoiceExportOrderIds(db, exportId);
  const markedCount = orderIds.length > 0 ? await markOrdersInvoiceExported(db, orderIds, now) : 0;

  await commitWrites(db, [
    db
      .update(invoiceExports)
      .set({ downloadedAt: now })
      .where(and(eq(invoiceExports.id, exportId), sql`${invoiceExports.downloadedAt} is null`)),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'order.invoice_export_download',
        objectType: 'order',
        objectId: String(exportId),
        summary: `Đã tải ${item.filename} và đánh dấu ${markedCount} đơn đã xuất HĐĐT.`,
        createdAt: now,
      },
      true,
    ),
  ]);

  return { ok: true, filename: item.filename, bytes, firstDownload: true, markedCount };
}

export async function deleteInvoiceExports(
  db: AppDb,
  bucket: R2Bucket,
  ids: number[],
  actor: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return { ok: false, error: 'Chưa chọn file để xóa.' };
  const rows = await db
    .select({ id: invoiceExports.id, r2Key: invoiceExports.r2Key })
    .from(invoiceExports)
    .where(inArray(invoiceExports.id, unique));
  if (rows.length === 0) return { ok: false, error: 'Không tìm thấy file.' };

  await commitWrites(db, [
    db.delete(invoiceExports).where(inArray(invoiceExports.id, rows.map((row) => row.id))),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'order.invoice_export_delete',
        objectType: 'order',
        objectId: rows.map((row) => row.id).join(','),
        summary: `Đã xóa ${rows.length} file xuất HĐĐT.`,
        createdAt: now,
      },
      true,
    ),
  ]);

  await Promise.all(rows.map((row) => bucket.delete(row.r2Key).catch(() => undefined)));
  return { ok: true, count: rows.length };
}
