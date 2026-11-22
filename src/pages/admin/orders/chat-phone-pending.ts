import type { APIRoute } from 'astro';
import {
  dismissChatPhone,
  isChatChannel,
  listPendingChatPhones,
} from '../../../features/orders/chat-phone';
import { csrfMatches } from '../../../features/auth/session';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { allowsStaffApiOrigin } from '../../../lib/http';
import { routes } from '../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

/** GET: danh sách hội thoại có SĐT nhưng chưa có đơn. */
export const GET: APIRoute = async ({ locals, url }) => {
  const session = locals.adminSession;
  if (!session) {
    return json(
      { ok: false, error: 'auth', loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.admin)}` },
      401,
    );
  }
  try {
    const result = await listPendingChatPhones(createDb(getDbBinding()));
    return json({ ok: true, count: result.count, items: result.items });
  } catch (error) {
    console.error(JSON.stringify({ event: 'chat_phone_pending_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không tải được danh sách chờ tạo đơn.' }, 500);
  }
};

/** POST: bỏ qua hội thoại (không đặt). */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const session = locals.adminSession;
  if (!session) {
    return json(
      { ok: false, error: 'auth', loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.admin)}` },
      401,
    );
  }
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

  let body: { channel?: unknown; chatId?: unknown; csrf?: unknown };
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
  if (typeof body.chatId !== 'string') {
    return json({ ok: false, error: 'Thiếu id hội thoại.' }, 422);
  }

  try {
    const result = await dismissChatPhone(createDb(getDbBinding()), {
      channel: body.channel,
      chatId: body.chatId,
    });
    if (!result.ok) return json({ ok: false, error: result.error }, 422);
    const pending = await listPendingChatPhones(createDb(getDbBinding()));
    return json({ ok: true, count: pending.count, items: pending.items });
  } catch (error) {
    console.error(JSON.stringify({ event: 'chat_phone_dismiss_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không bỏ qua được hội thoại.' }, 500);
  }
};
