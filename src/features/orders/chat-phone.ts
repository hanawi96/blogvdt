import { and, eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { chatPhoneMaps } from '../../lib/db/schema';
import { normalizePhone } from './order';

export type ChatChannel = 'pancake' | 'zalo';

const CHAT_ID_MAX = 191;

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

/** Upsert theo PK; bỏ qua ghi nếu SĐT không đổi (giảm I/O khi dữ liệu lớn). */
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
    })
    .onConflictDoUpdate({
      target: [chatPhoneMaps.channel, chatPhoneMaps.chatId],
      set: { phone, updatedAt: now },
    });

  return { ok: true, phone, changed: true };
}
