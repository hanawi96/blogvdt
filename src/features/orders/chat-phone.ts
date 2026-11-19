import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { chatPhoneMaps, orders } from '../../lib/db/schema';
import { normalizePhone } from './order';

export type ChatChannel = 'pancake' | 'zalo';

const CHAT_ID_MAX = 191;
const PENDING_LIMIT = 40;

export function isChatChannel(value: string): value is ChatChannel {
  return value === 'pancake' || value === 'zalo';
}

export function normalizeChatId(raw: string): string | null {
  const id = raw.trim().slice(0, CHAT_ID_MAX);
  return id.length > 0 ? id : null;
}

export async function getChatPhone(
  db: AppDb,
  channel: ChatChannel,
  chatId: string,
): Promise<{ phone: string; updatedAt: number } | null> {
  const id = normalizeChatId(chatId);
  if (!id) return null;
  const rows = await db
    .select({ phone: chatPhoneMaps.phone, updatedAt: chatPhoneMaps.updatedAt })
    .from(chatPhoneMaps)
    .where(and(eq(chatPhoneMaps.channel, channel), eq(chatPhoneMaps.chatId, id)))
    .limit(1);
  const row = rows[0];
  return row ? { phone: row.phone, updatedAt: row.updatedAt } : null;
}

async function phoneHasActiveOrder(db: AppDb, phone: string): Promise<boolean> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.phone, phone), ne(orders.status, 'cancelled')))
    .limit(1);
  return Boolean(rows[0]);
}

/** Có đơn chưa hủy → tắt badge chờ tạo đơn cho mọi map cùng SĐT. */
export async function clearChatPhonePendingByPhone(db: AppDb, phone: string): Promise<void> {
  if (!phone) return;
  await db
    .update(chatPhoneMaps)
    .set({ pending: false })
    .where(and(eq(chatPhoneMaps.phone, phone), eq(chatPhoneMaps.pending, true)));
}

/**
 * Tính lại pending theo dismiss + còn đơn active.
 * Dùng khi hủy/xóa đơn hoặc đổi SĐT trên đơn.
 */
export async function refreshChatPhonePendingByPhone(db: AppDb, phone: string): Promise<void> {
  if (!phone) return;
  if (await phoneHasActiveOrder(db, phone)) {
    await clearChatPhonePendingByPhone(db, phone);
    return;
  }
  await db
    .update(chatPhoneMaps)
    .set({ pending: true })
    .where(and(eq(chatPhoneMaps.phone, phone), isNull(chatPhoneMaps.dismissedAt), eq(chatPhoneMaps.pending, false)));
}

/** Upsert theo PK; đổi SĐT thì mở lại trạng thái chờ tạo đơn (xóa dismissed), trừ khi đã có đơn. */
export async function upsertChatPhone(
  db: AppDb,
  input: { channel: ChatChannel; chatId: string; phone: string },
  now = Date.now(),
): Promise<{ ok: true; phone: string; changed: boolean } | { ok: false; error: string }> {
  const chatId = normalizeChatId(input.chatId);
  if (!chatId) return { ok: false, error: 'Thiếu id hội thoại.' };
  const phone = normalizePhone(input.phone);
  if (!phone) return { ok: false, error: 'Số điện thoại không hợp lệ.' };

  const existing = await getChatPhone(db, input.channel, chatId);
  if (existing?.phone === phone) return { ok: true, phone, changed: false };

  const pending = !(await phoneHasActiveOrder(db, phone));

  await db
    .insert(chatPhoneMaps)
    .values({
      channel: input.channel,
      chatId,
      phone,
      createdAt: now,
      updatedAt: now,
      dismissedAt: null,
      pending,
    })
    .onConflictDoUpdate({
      target: [chatPhoneMaps.channel, chatPhoneMaps.chatId],
      set: { phone, updatedAt: now, dismissedAt: null, pending },
    });

  return { ok: true, phone, changed: true };
}

export type PendingChatPhone = {
  channel: ChatChannel;
  chatId: string;
  phone: string;
  updatedAt: number;
};

/**
 * Hội thoại chờ tạo đơn — đọc cột `pending` (đã materialize), không join orders.
 * Dùng cho badge extension — Pancake + Zalo.
 */
export async function listPendingChatPhones(db: AppDb): Promise<{ count: number; items: PendingChatPhone[] }> {
  const items = await db
    .select({
      channel: chatPhoneMaps.channel,
      chatId: chatPhoneMaps.chatId,
      phone: chatPhoneMaps.phone,
      updatedAt: chatPhoneMaps.updatedAt,
    })
    .from(chatPhoneMaps)
    .where(eq(chatPhoneMaps.pending, true))
    .orderBy(desc(chatPhoneMaps.updatedAt))
    .limit(PENDING_LIMIT);

  const mapped = items.map((row) => ({
    channel: row.channel as ChatChannel,
    chatId: row.chatId,
    phone: row.phone,
    updatedAt: row.updatedAt,
  }));

  // Dưới limit → count = số dòng trả về; đủ limit mới đếm thêm (vẫn chỉ quét pending=1).
  if (mapped.length < PENDING_LIMIT) {
    return { count: mapped.length, items: mapped };
  }

  const countRows = await db
    .select({ value: sql<number>`count(*)` })
    .from(chatPhoneMaps)
    .where(eq(chatPhoneMaps.pending, true));

  return {
    count: Number(countRows[0]?.value ?? mapped.length),
    items: mapped,
  };
}

export async function dismissChatPhone(
  db: AppDb,
  input: { channel: ChatChannel; chatId: string },
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const chatId = normalizeChatId(input.chatId);
  if (!chatId) return { ok: false, error: 'Thiếu id hội thoại.' };
  await db
    .update(chatPhoneMaps)
    .set({ dismissedAt: now, pending: false })
    .where(and(eq(chatPhoneMaps.channel, input.channel), eq(chatPhoneMaps.chatId, chatId)));
  return { ok: true };
}
