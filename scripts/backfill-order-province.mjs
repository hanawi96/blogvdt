/**
 * Backfill orders.province_code từ address.
 *   node scripts/backfill-order-province.mjs
 *   node scripts/backfill-order-province.mjs --remote
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';

const REMOTE = process.argv.includes('--remote');
const rows = JSON.parse(readFileSync(join(process.cwd(), 'public/data/address-select.json'), 'utf8'));
const WRANGLER_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function provinceCodeFromAddress(composed) {
  const text = String(composed ?? '').trim();
  if (!text) return null;
  for (const [provinceCode, provinceName, wards] of rows) {
    const provinceSuffix = `, ${provinceName}`;
    if (!text.endsWith(provinceSuffix)) continue;
    const withoutProvince = text.slice(0, -provinceSuffix.length);
    for (const [, wardName] of wards) {
      const wardSuffix = `, ${wardName}`;
      if (!withoutProvince.endsWith(wardSuffix)) continue;
      if (withoutProvince.slice(0, -wardSuffix.length).trim()) return provinceCode;
    }
  }
  for (const [provinceCode, provinceName] of rows) {
    if (text === provinceName || text.endsWith(`, ${provinceName}`)) return provinceCode;
  }
  return null;
}

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 40 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = `${result.stderr || ''}\n${result.stdout || ''}`.trim() || `exit ${result.status}`;
    throw new Error(err);
  }
  return result.stdout || '';
}

function d1RemoteJson(sql) {
  const out = runWrangler(['d1', 'execute', 'vong-dau-tam', '--remote', '--json', '--command', sql]);
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`Không parse JSON D1:\n${out}`);
  return JSON.parse(out.slice(start))[0]?.results ?? [];
}

function d1RemoteFile(sql) {
  const file = join(tmpdir(), `blogvdt-province-${process.pid}-${Date.now()}.sql`);
  writeFileSync(file, sql, 'utf8');
  try {
    runWrangler(['d1', 'execute', 'vong-dau-tam', '--remote', '--json', '--yes', '--file', file]);
  } finally {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

if (!REMOTE) {
  const proxy = await getPlatformProxy({ persist: true });
  try {
    const list = (await proxy.env.DB.prepare('SELECT id, address, province_code FROM orders').all()).results;
    let updated = 0;
    let skipped = 0;
    for (const row of list) {
      const next = provinceCodeFromAddress(row.address);
      if (next === row.province_code) {
        skipped += 1;
        continue;
      }
      await proxy.env.DB.prepare('UPDATE orders SET province_code = ? WHERE id = ?').bind(next, row.id).run();
      updated += 1;
    }
    console.log(JSON.stringify({ mode: 'local', total: list.length, updated, skipped }, null, 2));
  } finally {
    await proxy.dispose();
  }
  process.exit(0);
}

const list = d1RemoteJson('SELECT id, address, province_code FROM orders');
const updates = [];
let skipped = 0;
for (const row of list) {
  const next = provinceCodeFromAddress(row.address);
  if (next === row.province_code) {
    skipped += 1;
    continue;
  }
  updates.push(`UPDATE orders SET province_code = ${sqlString(next)} WHERE id = ${Number(row.id)};`);
}

const BATCH = 40;
let updated = 0;
for (let i = 0; i < updates.length; i += BATCH) {
  const chunk = updates.slice(i, i + BATCH);
  d1RemoteFile(chunk.join('\n'));
  updated += chunk.length;
  console.log(`remote batch ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
}

console.log(JSON.stringify({ mode: 'remote', total: list.length, updated, skipped }, null, 2));
