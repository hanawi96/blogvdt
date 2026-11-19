/**
 * Gán điểm đánh giá local: top 10 bán chạy = 5.0; còn lại ngẫu nhiên 4.9 hoặc 5.0.
 * Rating DB = điểm × 10 (49 = 4.9, 50 = 5.0).
 *
 *   node scripts/set-product-ratings-local.mjs           # dry-run
 *   node scripts/set-product-ratings-local.mjs --apply   # ghi D1 local
 */
import { getPlatformProxy } from 'wrangler';

if (process.argv.includes('--remote')) {
  console.error('Script này chỉ chạy local. Không dùng --remote.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const TOP_N = 10;
const RATING_FIVE = 50;
const RATING_OPTIONS = [49, 50];

const proxy = await getPlatformProxy({ persist: true });

try {
  const db = proxy.env.DB;
  if (!db) {
    console.error('Thiếu binding DB local.');
    process.exit(1);
  }

  const listed = await db
    .prepare(
      `SELECT
        p.id,
        p.name,
        p.rating,
        (
          coalesce(p.sold_base, 0)
          + coalesce((select sum(o.quantity) from orders o where o.product_id = p.id and o.status <> 'cancelled'), 0)
          + coalesce((
            select sum(i.quantity)
            from order_items i
            join orders o2 on o2.id = i.order_id
            where i.product_id = p.id and o2.status <> 'cancelled'
          ), 0)
        ) AS sold
      FROM products p
      ORDER BY sold DESC, p.sort_order ASC, p.id ASC`,
    )
    .all();

  const rows = listed.results ?? [];
  if (rows.length === 0) {
    console.log('Không có sản phẩm nào.');
    process.exit(0);
  }

  const now = Date.now();
  const plan = rows.map((row, index) => {
    const id = Number(row.id);
    const from = Number(row.rating) || 0;
    const sold = Number(row.sold) || 0;
    const to = index < TOP_N ? RATING_FIVE : RATING_OPTIONS[Math.floor(Math.random() * RATING_OPTIONS.length)];
    return {
      id,
      name: String(row.name ?? ''),
      sold,
      from,
      to,
      top: index < TOP_N,
      changed: from !== to,
    };
  });

  let updated = 0;
  for (const item of plan) {
    if (!item.changed) continue;
    if (APPLY) {
      await db.prepare('UPDATE products SET rating = ?, updated_at = ? WHERE id = ?').bind(item.to, now, item.id).run();
    }
    updated += 1;
  }

  const label = (value) => (value / 10).toFixed(1);
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        total: plan.length,
        topSellerIds: plan.filter((item) => item.top).map((item) => item.id),
        ratingFive: plan.filter((item) => item.to === 50).length,
        ratingFourNine: plan.filter((item) => item.to === 49).length,
        wouldUpdate: updated,
        applied: APPLY,
        top10: plan.slice(0, TOP_N).map((item) => ({
          id: item.id,
          name: item.name,
          sold: item.sold,
          from: label(item.from),
          to: label(item.to),
        })),
        samples: plan
          .filter((item) => !item.top && item.changed)
          .slice(0, 8)
          .map((item) => ({
            id: item.id,
            name: item.name,
            sold: item.sold,
            from: label(item.from),
            to: label(item.to),
          })),
      },
      null,
      2,
    ),
  );
} finally {
  await proxy.dispose?.();
}
