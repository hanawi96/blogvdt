import type { APIRoute } from 'astro';
import { csrfMatches } from '../../../features/auth/session';
import { normalizePhoneBatch, phoneSavedStatusMap } from '../../../features/orders/phone-saved';
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

/** POST: batch SĐT → đã có đơn CMS chưa hủy hay chưa (badge Pancake POS). */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const session = locals.adminSession;
  if (!session) {
    return json(
      { ok: false, error: 'auth', loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}` },
      401,
    );
  }
  if (!allowsStaffApiOrigin(request)) return json({ ok: false, error: 'Nguồn gửi không hợp lệ.' }, 403);

  let body: { phones?: unknown; csrf?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: 'Payload không hợp lệ.' }, 422);
  }
  if (typeof body.csrf !== 'string' || !csrfMatches(session.csrfToken, body.csrf)) {
    return json({ ok: false, error: 'Phiên không hợp lệ. Tải lại trang.' }, 403);
  }

  const phones = normalizePhoneBatch(body.phones);
  if (phones.length === 0) return json({ ok: true, items: [] });

  try {
    const map = await phoneSavedStatusMap(createDb(getDbBinding()), phones);
    return json({
      ok: true,
      items: phones.map((phone) => ({ phone, saved: Boolean(map[phone]) })),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'phone_saved_status_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không kiểm tra được trạng thái lưu đơn.' }, 500);
  }
};
