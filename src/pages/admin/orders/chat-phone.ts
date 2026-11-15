import type { APIRoute } from 'astro';
import {
  getChatPhone,
  isChatChannel,
  upsertChatPhone,
} from '../../../features/orders/chat-phone';
import { csrfMatches } from '../../../features/auth/session';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { isSameOrigin } from '../../../lib/http';
import { routes } from '../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  const session = locals.adminSession;
  if (!session) return redirect(routes.adminLogin);
  const channel = url.searchParams.get('channel') ?? '';
  const chatId = url.searchParams.get('chatId') ?? '';
  if (!isChatChannel(channel)) return json({ ok: false, error: 'Kênh không hợp lệ.' }, 422);
  if (!chatId.trim()) return json({ ok: false, error: 'Thiếu id hội thoại.' }, 422);
  try {
    const found = await getChatPhone(createDb(getDbBinding()), channel, chatId);
    if (!found) return json({ ok: true, found: false });
    return json({ ok: true, found: true, phone: found.phone, updatedAt: found.updatedAt });
  } catch (error) {
    console.error(JSON.stringify({ event: 'chat_phone_lookup_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không tra được map chat.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.adminSession;
  if (!session) return json({ ok: false, error: 'auth' }, 401);
  if (!isSameOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

  let body: { channel?: unknown; chatId?: unknown; phone?: unknown; csrf?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Payload không hợp lệ.' }, 422);
  }
  if (typeof body.csrf !== 'string' || !csrfMatches(session.csrfToken, body.csrf)) {
    return json({ ok: false, error: 'Phiên không hợp lệ. Tải lại trang.' }, 403);
  }
  if (typeof body.channel !== 'string' || !isChatChannel(body.channel)) {
    return json({ ok: false, error: 'Kênh không hợp lệ.' }, 422);
  }
  if (typeof body.chatId !== 'string' || typeof body.phone !== 'string') {
    return json({ ok: false, error: 'Thiếu id hội thoại hoặc SĐT.' }, 422);
  }

  try {
    const result = await upsertChatPhone(createDb(getDbBinding()), {
      channel: body.channel,
      chatId: body.chatId,
      phone: body.phone,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    return json({ ok: true, phone: result.phone, changed: result.changed });
  } catch (error) {
    console.error(JSON.stringify({ event: 'chat_phone_upsert_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không lưu được map chat.' }, 500);
  }
};
