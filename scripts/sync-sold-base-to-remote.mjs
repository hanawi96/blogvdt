/**
 * Đồng bộ products.sold_base: D1 local → D1 production (theo tên sản phẩm).
 *
 *   node scripts/sync-sold-base-to-remote.mjs
 *   node scripts/sync-sold-base-to-remote.mjs --apply
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const APPLY = process.argv.includes('--apply');
const ACCOUNT_ID = '6732e495e6dc332a4d51e0aba6c0408a';
const DB_ID = 'b98c2657-e991-42e8-bba3-a797452437b2';
const API = 'https://api.cloudflare.com/client/v4';

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

function createApi(token) {
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

const token = readWranglerOauthToken();
const api = createApi(token);
const proxy = await getPlatformProxy({ persist: true });

try {
  const localDb = proxy.env.DB;
  if (!localDb) throw new Error('Thiếu binding DB local.');

  console.log(APPLY ? 'APPLY → ghi production.' : 'Dry-run (không ghi). Thêm --apply để ghi production.');

  const local = (await localDb.prepare('SELECT id, name, sold_base FROM products ORDER BY id').all()).results;
  const remote = await api.d1('SELECT id, name, sold_base FROM products ORDER BY id');

  /** @type {Map<string, { id: number, name: string, sold_base: number }>} */
  const remoteByName = new Map();
  for (const row of remote) {
    const name = String(row.name ?? '').trim().toLowerCase();
    if (!name) continue;
    remoteByName.set(name, {
      id: Number(row.id),
      name: String(row.name ?? ''),
      sold_base: Number(row.sold_base) || 0,
    });
  }

  let matched = 0;
  let changed = 0;
  let skippedSame = 0;
  let missing = 0;
  const samples = [];
  const now = Date.now();

  for (const row of local) {
    const soldBase = Math.max(0, Number(row.sold_base) || 0);
    if (soldBase === 0) continue;
    const key = String(row.name ?? '').trim().toLowerCase();
    const hit = remoteByName.get(key);
    if (!hit) {
      missing += 1;
      if (samples.length < 12) samples.push({ kind: 'missing', name: row.name, sold_base: soldBase });
      continue;
    }
    matched += 1;
    if (hit.sold_base === soldBase) {
      skippedSame += 1;
      continue;
    }
    changed += 1;
    if (samples.length < 12) {
      samples.push({ kind: 'update', id: hit.id, name: hit.name, from: hit.sold_base, to: soldBase });
    }
    if (APPLY) {
      await api.d1('UPDATE products SET sold_base = ?, updated_at = ? WHERE id = ?', [soldBase, now, hit.id]);
    }
  }

  console.log(
    JSON.stringify(
      {
        localWithSold: local.filter((r) => Number(r.sold_base) > 0).length,
        remoteRows: remote.length,
        matched,
        changed,
        skippedSame,
        missing,
        applied: APPLY,
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  await proxy.dispose();
}
