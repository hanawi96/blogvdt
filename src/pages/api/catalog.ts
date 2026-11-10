import type { APIRoute } from 'astro';
import { discountPercent, listCatalogProducts, readCatalogQuery } from '../../features/products/catalog';
import { createDb } from '../../lib/db/client';
import { getDbBinding } from '../../lib/cloudflare/env';
import { PUBLIC_PAGE_CACHE } from '../../lib/seo/cache';

export const prerender = false;

/** JSON nhẹ cho filter / Xem tiếp trang chủ — cùng query với catalog, không trả HTML. */
export const GET: APIRoute = async ({ url }) => {
  const query = readCatalogQuery(url.searchParams);
  try {
    const list = await listCatalogProducts(createDb(getDbBinding()), query);
    return json(
      {
        page: list.page,
        pageCount: list.pageCount,
        total: list.total,
        products: list.products.map((product) => ({
          id: product.id,
          name: product.name,
          slug: product.slug,
          price: product.price,
          comparePrice: product.comparePrice,
          discountPercent: discountPercent(product.price, product.comparePrice),
          weightScale: product.weightScale,
          shipBadge: product.shipBadge,
          ratingLabel: product.ratingLabel,
          sold: product.sold,
          coverUrl: product.coverUrl,
          coverAlt: product.coverAlt,
          coverWidth: product.coverWidth,
          coverHeight: product.coverHeight,
        })),
      },
      200,
      PUBLIC_PAGE_CACHE,
    );
  } catch (error) {
    console.error(JSON.stringify({ event: 'catalog_api_failed', name: error instanceof Error ? error.name : 'unknown' }));
    return json({ page: 1, pageCount: 1, total: 0, products: [] }, 503, 'no-store');
  }
};

function json(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      'x-robots-tag': 'noindex',
    },
  });
}
