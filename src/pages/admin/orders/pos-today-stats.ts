import type { APIRoute } from 'astro';
import { loadPosTodayStats } from '../../../features/orders/pos-today-stats';
import { createDb } from '../../../lib/db/client';
import { getDbBinding } from '../../../lib/cloudflare/env';
import { routes } from '../../../lib/routes';

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' },
  });
}

/** GET: doanh thu + lãi + số đơn tạo hôm nay (giờ VN) — header extension. */
export const GET: APIRoute = async ({ locals, url }) => {
  const session = locals.adminSession;
  if (!session) {
    return json(
      {
        ok: false,
        error: 'auth',
        loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminOrderPos)}`,
      },
      401,
    );
  }
  try {
    const stats = await loadPosTodayStats(createDb(getDbBinding()));
    return json({ ok: true, orders: stats.orders, revenue: stats.revenue, profit: stats.profit });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'pos_today_stats_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không tải được thống kê hôm nay.' }, 500);
  }
};

export const POST: APIRoute = () => new Response(null, { status: 405 });
