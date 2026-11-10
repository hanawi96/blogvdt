import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orderExportItems, orderExports, orderItems, orders } from '../../lib/db/schema';
import type { AddressSelectRow } from '../address/parse';
import { activityWrite, commitWrites, type ActivityActor } from '../activity/log';
import {
  buildSpxWorkbookBytes,
  mapOrdersToSpxRows,
  spxExportFilename,
  spxExportObjectKey,
  type SpxExportOrder,
} from './spx-export';

export type OrderExportListItem = {
  id: number;
  filename: string;
  orderCount: number;
  skippedCount: number;
  downloadedAt: number | null;
  createdAt: number;
};

export async function listOrderExports(db: AppDb, limit = 20): Promise<OrderExportListItem[]> {
  const rows = await db
    .select({
      id: orderExports.id,
      filename: orderExports.filename,
      orderCount: orderExports.orderCount,
      skippedCount: orderExports.skippedCount,
      downloadedAt: orderExports.downloadedAt,
      createdAt: orderExports.createdAt,
    })
    .from(orderExports)
    .orderBy(desc(orderExports.createdAt), desc(orderExports.id))
    .limit(Math.min(Math.max(1, limit), 20));
  return rows;
}

export async function loadOrdersForSpxExport(db: AppDb, ids: number[]): Promise<SpxExportOrder[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: orders.id,
      code: orders.code,
      customerName: orders.customerName,
      phone: orders.phone,
      address: orders.address,
      status: orders.status,
      fulfillStatus: orders.fulfillStatus,
      shipOn: orders.shipOn,
      totalPrice: orders.totalPrice,
      payState: orders.payState,
      depositAmount: orders.depositAmount,
      compensation: orders.compensation,
      productName: orders.productName,
      quantity: orders.quantity,
      optionLabel: orders.optionLabel,
    })
    .from(orders)
    .where(inArray(orders.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => !!row);

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      optionLabel: orderItems.optionLabel,
      sortOrder: orderItems.sortOrder,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, ordered.map((row) => row.id)))
    .orderBy(orderItems.sortOrder, orderItems.id);

  const linesByOrder = new Map<number, SpxExportOrder['lines']>();
  for (const item of itemRows) {
    const list = linesByOrder.get(item.orderId) ?? [];
    list.push({ productName: item.productName, quantity: item.quantity, optionLabel: item.optionLabel });
    linesByOrder.set(item.orderId, list);
  }

  return ordered.map((row) => ({
    ...row,
    lines: linesByOrder.get(row.id) ?? [],
  }));
}

export async function createSpxOrderExport(
  db: AppDb,
  bucket: R2Bucket,
  input: {
    ids: number[];
    addressRows: readonly AddressSelectRow[];
    actor: ActivityActor;
  },
  now = Date.now(),
): Promise<
  | {
      ok: true;
      id: number;
      filename: string;
      orderCount: number;
      skippedCount: number;
      skipped: { orderId: number; code: string; reason: string }[];
    }
  | { ok: false; error: string; skipped?: { orderId: number; code: string; reason: string }[] }
> {
  const loaded = await loadOrdersForSpxExport(db, input.ids);
  if (loaded.length === 0) return { ok: false, error: 'Không tìm thấy đơn đã chọn.' };

  const mapped = mapOrdersToSpxRows(loaded, input.addressRows);
  if (mapped.rows.length === 0) {
    return {
      ok: false,
      error:
        mapped.skipped.length > 0
          ? `Không có đơn hợp lệ để export. ${mapped.skipped.length} đơn bị bỏ qua.`
          : 'Không có đơn hợp lệ để export.',
      skipped: mapped.skipped,
    };
  }

  const filename = spxExportFilename(mapped.rows.length, now);
  const r2Key = spxExportObjectKey(filename, new Date(now));
  const bytes = buildSpxWorkbookBytes(mapped.rows);
  await bucket.put(r2Key, bytes, {
    httpMetadata: {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contentDisposition: `attachment; filename="${filename}"`,
    },
  });

  try {
    const inserted = await db
      .insert(orderExports)
      .values({
        filename,
        r2Key,
        orderCount: mapped.rows.length,
        skippedCount: mapped.skipped.length,
        downloadedAt: null,
        createdBy: input.actor.id,
        createdAt: now,
      })
      .returning({ id: orderExports.id });
    const exportId = inserted[0]?.id;
    if (!exportId) throw new Error('missing export id');

    await commitWrites(db, [
      db.insert(orderExportItems).values(
        mapped.rows.map((row) => ({
          exportId,
          orderId: row.orderId,
        })),
      ),
      activityWrite(
        db,
        {
          actorId: input.actor.id,
          actorName: input.actor.name,
        action: 'order.export_spx',
        objectType: 'order',
        objectId: String(exportId),
        summary: `Đã tạo file SPX ${filename} (${mapped.rows.length} đơn).`,
        createdAt: now,
      },
      true,
    ),
  ]);

  return {
      ok: true,
      id: exportId,
      filename,
      orderCount: mapped.rows.length,
      skippedCount: mapped.skipped.length,
      skipped: mapped.skipped,
    };
  } catch (error) {
    await bucket.delete(r2Key);
    console.error(JSON.stringify({ event: 'order_export_insert_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return { ok: false, error: 'Không lưu được file export.' };
  }
}

export async function getOrderExport(
  db: AppDb,
  id: number,
): Promise<{ id: number; filename: string; r2Key: string; downloadedAt: number | null; orderCount: number } | null> {
  const rows = await db
    .select({
      id: orderExports.id,
      filename: orderExports.filename,
      r2Key: orderExports.r2Key,
      downloadedAt: orderExports.downloadedAt,
      orderCount: orderExports.orderCount,
    })
    .from(orderExports)
    .where(eq(orderExports.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listExportOrderIds(db: AppDb, exportId: number): Promise<number[]> {
  const rows = await db
    .select({ orderId: orderExportItems.orderId })
    .from(orderExportItems)
    .where(eq(orderExportItems.exportId, exportId));
  return rows.map((row) => row.orderId);
}

/**
 * Tải file: lần đầu đánh dấu shipped cho các đơn trong file rồi set downloadedAt.
 * Lần sau chỉ stream lại, không đụng trạng thái đơn.
 */
export async function downloadSpxOrderExport(
  db: AppDb,
  bucket: R2Bucket,
  exportId: number,
  actor: ActivityActor,
  now = Date.now(),
): Promise<
  | { ok: true; filename: string; bytes: Uint8Array; firstDownload: boolean; shippedCount: number }
  | { ok: false; error: string }
> {
  const item = await getOrderExport(db, exportId);
  if (!item) return { ok: false, error: 'Không tìm thấy file export.' };
  const object = await bucket.get(item.r2Key);
  if (!object) return { ok: false, error: 'File không còn trên lưu trữ.' };
  const bytes = new Uint8Array(await object.arrayBuffer());

  if (item.downloadedAt != null) {
    return { ok: true, filename: item.filename, bytes, firstDownload: false, shippedCount: 0 };
  }

  const orderIds = await listExportOrderIds(db, exportId);
  let shippedCount = 0;
  if (orderIds.length > 0) {
    const editable = await db
      .select({ id: orders.id, status: orders.status })
      .from(orders)
      .where(and(inArray(orders.id, orderIds), sql`${orders.status} not in ('completed', 'cancelled')`));
    const ids = editable.map((row) => row.id);
    if (ids.length > 0) {
      await db
        .update(orders)
        .set({
          fulfillStatus: 'shipped',
          status: 'shipped',
          shipOn: null,
          shippedAt: sql`coalesce(${orders.shippedAt}, ${now})`,
          updatedAt: now,
        })
        .where(inArray(orders.id, ids));
      shippedCount = ids.length;
    }
  }

  await commitWrites(db, [
    db.update(orderExports).set({ downloadedAt: now }).where(and(eq(orderExports.id, exportId), sql`${orderExports.downloadedAt} is null`)),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'order.export_download',
        objectType: 'order',
        objectId: String(exportId),
        summary: `Đã tải ${item.filename} và đánh dấu ${shippedCount} đơn đã gửi hàng.`,
        createdAt: now,
      },
      true,
    ),
  ]);

  return { ok: true, filename: item.filename, bytes, firstDownload: true, shippedCount };
}

export async function deleteOrderExports(
  db: AppDb,
  bucket: R2Bucket,
  ids: number[],
  actor: ActivityActor,
  now = Date.now(),
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return { ok: false, error: 'Chưa chọn file để xóa.' };
  const rows = await db
    .select({ id: orderExports.id, r2Key: orderExports.r2Key, filename: orderExports.filename })
    .from(orderExports)
    .where(inArray(orderExports.id, unique));
  if (rows.length === 0) return { ok: false, error: 'Không tìm thấy file.' };

  await commitWrites(db, [
    db.delete(orderExports).where(inArray(orderExports.id, rows.map((row) => row.id))),
    activityWrite(
      db,
      {
        actorId: actor.id,
        actorName: actor.name,
        action: 'order.export_delete',
        objectType: 'order',
        objectId: rows.map((row) => row.id).join(','),
        summary: `Đã xóa ${rows.length} file export SPX.`,
        createdAt: now,
      },
      true,
    ),
  ]);

  await Promise.all(rows.map((row) => bucket.delete(row.r2Key).catch(() => undefined)));
  return { ok: true, count: rows.length };
}
