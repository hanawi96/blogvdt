import { and, desc, eq, isNull, ne, notExists, sql } from 'drizzle-orm';
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

/** Upsert theo PK; đổi SĐT thì mở lại trạng thái chờ tạo đơn (xóa dismissed). */
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

  await db
    .insert(chatPhoneMaps)
    .values({
      channel: input.channel,
      chatId,
      phone,
      createdAt: now,
      updatedAt: now,
      dismissedAt: null,
    })
    .onConflictDoUpdate({
      target: [chatPhoneMaps.channel, chatPhoneMaps.chatId],
      set: { phone, updatedAt: now, dismissedAt: null },
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
 * Hội thoại đã gắn SĐT nhưng chưa có đơn chưa hủy với số đó (và chưa «bỏ qua»).
 * Dùng cho badge extension — Pancake + Zalo.
 */
export async function listPendingChatPhones(db: AppDb): Promise<{ count: number; items: PendingChatPhone[] }> {
  const hasActiveOrder = db
    .select({ one: sql`1` })
    .from(orders)
    .where(and(eq(orders.phone, chatPhoneMaps.phone), ne(orders.status, 'cancelled')));

  const items = await db
    .select({
      channel: chatPhoneMaps.channel,
      chatId: chatPhoneMaps.chatId,
      phone: chatPhoneMaps.phone,
      updatedAt: chatPhoneMaps.updatedAt,
    })
    .from(chatPhoneMaps)
    .where(and(isNull(chatPhoneMaps.dismissedAt), notExists(hasActiveOrder)))
    .orderBy(desc(chatPhoneMaps.updatedAt))
    .limit(PENDING_LIMIT);

  const countRows = await db
    .select({ value: sql<number>`count(*)` })
    .from(chatPhoneMaps)
    .where(and(isNull(chatPhoneMaps.dismissedAt), notExists(hasActiveOrder)));

  return {
    count: Number(countRows[0]?.value ?? 0),
    items: items.map((row) => ({
      channel: row.channel as ChatChannel,
      chatId: row.chatId,
      phone: row.phone,
      updatedAt: row.updatedAt,
    })),
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
    .set({ dismissedAt: now })
    .where(and(eq(chatPhoneMaps.channel, input.channel), eq(chatPhoneMaps.chatId, chatId)));
  return { ok: true };
}
