import type { APIRoute } from 'astro';
import { listHomeCollectionProductPicksPaged } from '../../../features/home-collections/collections';
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
  if (!session) {
    return json(
      { ok: false, error: 'auth', loginUrl: `${url.origin}${routes.adminLogin}?next=${encodeURIComponent(routes.adminHomeCollections)}` },
      401,
    );
  }
  if (session.role !== 'admin') {
    return json({ ok: false, error: 'Bạn không có quyền.' }, 403);
  }

  const categoryRaw = Number(url.searchParams.get('category') ?? '');
  const pageRaw = Number(url.searchParams.get('page') ?? '1');
  const categoryId = Number.isInteger(categoryRaw) && categoryRaw > 0 ? categoryRaw : undefined;
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  try {
    const result = await listHomeCollectionProductPicksPaged(createDb(getDbBinding()), { categoryId, page });
    return json({
      ok: true,
      items: result.items.map((item) => ({
        id: item.id,
        name: item.name,
        coverUrl: item.coverUrl,
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pageCount: result.pageCount,
    });
  } catch (error) {
    console.error(
      JSON.stringify({ event: 'home_collection_picks_failed', name: error instanceof Error ? error.name : 'unknown' }),
    );
    return json({ ok: false, error: 'Không tải được danh sách sản phẩm.' }, 500);
  }
};

export const POST: APIRoute = () => new Response(null, { status: 405 });
