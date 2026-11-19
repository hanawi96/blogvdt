import { and, inArray, ne } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { orders } from '../../lib/db/schema';
import { normalizePhone } from './order';

const BATCH_MAX = 100;

/** Chuẩn hóa + khử trùng, tối đa BATCH_MAX số. */
export function normalizePhoneBatch(rawPhones: unknown): string[] {
  if (!Array.isArray(rawPhones)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawPhones) {
    if (typeof raw !== 'string') continue;
    const phone = normalizePhone(raw);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
    if (out.length >= BATCH_MAX) break;
  }
  return out;
}

/**
 * SĐT nào đã có đơn CMS chưa hủy.
 * Trả map phone → saved (mọi số trong input đều có key).
 */
export async function phoneSavedStatusMap(
  db: AppDb,
  phones: string[],
): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = {};
  for (const phone of phones) result[phone] = false;
  if (phones.length === 0) return result;

  const rows = await db
    .selectDistinct({ phone: orders.phone })
    .from(orders)
    .where(and(inArray(orders.phone, phones), ne(orders.status, 'cancelled')));

  for (const row of rows) {
    if (row.phone in result) result[row.phone] = true;
  }
  return result;
}
