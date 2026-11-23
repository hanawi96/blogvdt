import type { APIRoute } from 'astro';
import { lookupCustomerByPhone } from '../../../features/orders/customers';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = locals.adminSession;
  // JSON 401 (không redirect) — đồng bộ chat-phone / pos-* cho extension SW.
  if (!session) {
    return json(
      { ok: false, error: 'auth', loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.admin)}` },
      401,
    );
  }
  const phone = url.searchParams.get('phone') ?? '';
  if (!phone.trim()) return json({ ok: false, error: 'Nhập số điện thoại.' }, 422);
  try {
    const found = await lookupCustomerByPhone(createDb(getDbBinding()), phone);
    if (!found) return json({ ok: true, found: false, canDelete: session.role === 'admin' });
    return json({ ok: true, found: true, canDelete: session.role === 'admin', customer: found });
  } catch (error) {
    console.error(JSON.stringify({ event: 'order_phone_lookup_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ ok: false, error: 'Không tra được khách.' }, 500);
  }
};

export const POST: APIRoute = () => new Response(null, { status: 405 });
