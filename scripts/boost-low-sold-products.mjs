/**
 * Tăng sold_base cho SP có tổng bán < 10 → ngẫu nhiên 10–23;
 * gán rating 4.9/5.0, top 10 bán chạy = 5.0.
 *
 * Tổng bán = sold_base + đơn chưa hủy (header + order_items).
 *
 *   node scripts/boost-low-sold-products.mjs --local
 *   node scripts/boost-low-sold-products.mjs --remote
 *   node scripts/boost-low-sold-products.mjs --local --remote --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const APPLY = process.argv.includes('--apply');
const DO_LOCAL = process.argv.includes('--local');
const DO_REMOTE = process.argv.includes('--remote');
if (!DO_LOCAL && !DO_REMOTE) {
  console.error('Chọn --local và/hoặc --remote.');
  process.exit(1);
}

const TOP_N = 10;
const SOLD_MIN = 10;
const SOLD_MAX = 23;
const RATING_FIVE = 50;
const RATING_OPTIONS = [49, 50];

const ACCOUNT_ID = '6732e495e6dc332a4d51e0aba6c0408a';
const DB_ID = 'b98c2657-e991-42e8-bba3-a797452437b2';
const API = 'https://api.cloudflare.com/client/v4';

const LIST_SQL = `SELECT
  p.id,
  p.name,
  p.rating,
  coalesce(p.sold_base, 0) AS sold_base,
  coalesce((select sum(o.quantity) from orders o where o.product_id = p.id and o.status <> 'cancelled'), 0)
    + coalesce((
      select sum(i.quantity)
      from order_items i
      join orders o2 on o2.id = i.order_id
      where i.product_id = p.id and o2.status <> 'cancelled'
    ), 0) AS order_qty
FROM products p
ORDER BY p.id ASC`;

function randomSoldTarget() {
  return SOLD_MIN + Math.floor(Math.random() * (SOLD_MAX - SOLD_MIN + 1));
}

function ratingLabel(value) {
  return (Number(value) / 10).toFixed(1);
}

function planRows(rows) {
  const planned = rows.map((row) => {
    const id = Number(row.id);
    const soldBase = Math.max(0, Number(row.sold_base) || 0);
    const orderQty = Math.max(0, Number(row.order_qty) || 0);
    const sold = soldBase + orderQty;
    let nextSoldBase = soldBase;
    let nextSold = sold;
    let soldChanged = false;
    if (sold < SOLD_MIN) {
      const target = randomSoldTarget();
      nextSoldBase = Math.max(0, target - orderQty);
      nextSold = nextSoldBase + orderQty;
      soldChanged = nextSoldBase !== soldBase;
    }
    return {
      id,
      name: String(row.name ?? ''),
      orderQty,
      soldFrom: sold,
      soldTo: nextSold,
      soldBaseFrom: soldBase,
      soldBaseTo: nextSoldBase,
      soldChanged,
      ratingFrom: Number(row.rating) || 0,
      ratingTo: 0,
      ratingChanged: false,
      top: false,
    };
  });

  planned.sort((a, b) => b.soldTo - a.soldTo || a.id - b.id);
  for (let index = 0; index < planned.length; index += 1) {
    const item = planned[index];
    item.top = index < TOP_N;
    item.ratingTo = item.top ? RATING_FIVE : RATING_OPTIONS[Math.floor(Math.random() * RATING_OPTIONS.length)];
    item.ratingChanged = item.ratingFrom !== item.ratingTo;
  }
  return planned;
}

function summarize(target, plan) {
  const soldUpdates = plan.filter((item) => item.soldChanged);
  const ratingUpdates = plan.filter((item) => item.ratingChanged);
  return {
    target,
    mode: APPLY ? 'apply' : 'dry-run',
    total: plan.length,
    soldBelow10: plan.filter((item) => item.soldFrom < SOLD_MIN).length,
    soldUpdated: soldUpdates.length,
    ratingUpdated: ratingUpdates.length,
    ratingFive: plan.filter((item) => item.ratingTo === 50).length,
    ratingFourNine: plan.filter((item) => item.ratingTo === 49).length,
    top10: plan.slice(0, TOP_N).map((item) => ({
      id: item.id,
      name: item.name,
      sold: item.soldTo,
      rating: ratingLabel(item.ratingTo),
    })),
    soldSamples: soldUpdates.slice(0, 10).map((item) => ({
      id: item.id,
      name: item.name,
      sold: `${item.soldFrom}→${item.soldTo}`,
      sold_base: `${item.soldBaseFrom}→${item.soldBaseTo}`,
    })),
  };
}

function readWranglerOauthToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN.trim();
  const configPath = join(
    process.env.USERPROFILE || process.env.HOME || '',
    'AppData/Roaming/xdg.config/.wrangler/config/default.toml',
  );
  const text = readFileSync(configPath, 'utf8');
  const match = text.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Không tìm thấy oauth_token Wrangler. Chạy wrangler login hoặc set CLOUDFLARE_API_TOKEN.');
  return match[1];
}

function createRemoteApi(token) {
  async function d1(sql, params = []) {
    const res = await fetch(`${API}/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(json.errors || json)}`);
    }
    return json.result?.[0]?.results ?? [];
  }
  return { d1 };
}

async function applyPlan(plan, write) {
  const now = Date.now();
  for (const item of plan) {
    if (!item.soldChanged && !item.ratingChanged) continue;
    await write(item.soldBaseTo, item.ratingTo, now, item.id);
  }
}

if (DO_LOCAL) {
  const proxy = await getPlatformProxy({ persist: true });
  try {
    const db = proxy.env.DB;
    if (!db) throw new Error('Thiếu binding DB local.');
    const rows = (await db.prepare(LIST_SQL).all()).results ?? [];
    const plan = planRows(rows);
    console.log(JSON.stringify(summarize('local', plan), null, 2));
    if (APPLY) {
      await applyPlan(plan, (soldBase, rating, now, id) =>
        db.prepare('UPDATE products SET sold_base = ?, rating = ?, updated_at = ? WHERE id = ?').bind(soldBase, rating, now, id).run(),
      );
      console.log('Local: đã ghi.');
    }
  } finally {
    await proxy.dispose?.();
  }
}

if (DO_REMOTE) {
  const api = createRemoteApi(readWranglerOauthToken());
  const rows = await api.d1(LIST_SQL);
  const plan = planRows(rows);
  console.log(JSON.stringify(summarize('remote', plan), null, 2));
  if (APPLY) {
    await applyPlan(plan, (soldBase, rating, now, id) =>
      api.d1('UPDATE products SET sold_base = ?, rating = ?, updated_at = ? WHERE id = ?', [soldBase, rating, now, id]),
    );
    console.log('Remote: đã ghi.');
  }
}
