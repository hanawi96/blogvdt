/**
 * Đồng bộ ảnh feedback (media R2 + hàng D1) từ local → production.
 *
 * An toàn mặc định: chỉ dry-run. Ghi thật cần:
 *   node scripts/sync-feedback-to-remote.mjs --apply
 *
 * Idempotent theo r2_key: chạy lại sẽ bỏ qua object/hàng đã có trên remote.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { getPlatformProxy } from 'wrangler';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'vong-dau-tam-media';
const DB_NAME = 'vong-dau-tam';
const WRANGLER_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function sqlString(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInt(value) {
  if (value == null || Number.isNaN(Number(value))) return 'NULL';
  return String(Math.trunc(Number(value)));
}

/** Không dùng shell: trên Windows shell cắt --command SQL thành nhiều argv. */
function runWrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER_BIN, ...args], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(`wrangler ${args.join(' ')} failed:\n${err}`);
  }
  return result.stdout || '';
}

function d1RemoteJson(sql) {
  const out = runWrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  const start = out.indexOf('[');
  if (start < 0) throw new Error(`Không parse được JSON D1:\n${out}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

async function putRemoteObject(key, bytes, contentType) {
  const dir = join(tmpdir(), 'blogvdt-feedback-sync');
  await mkdir(dir, { recursive: true });
  const safe = key.replaceAll(/[\\/]/g, '_');
  const file = join(dir, safe);
  await writeFile(file, Buffer.from(bytes));
  try {
    runWrangler([
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      '--file',
      file,
      '--remote',
      '--content-type',
      contentType || 'application/octet-stream',
    ]);
  } finally {
    await rm(file, { force: true });
  }
}

async function readLocalObject(bucket, key) {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const ab = await obj.arrayBuffer();
  return {
    bytes: new Uint8Array(ab),
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
  };
}

const proxy = await getPlatformProxy({ persist: true });
const workDir = join(tmpdir(), 'blogvdt-feedback-sync');
await mkdir(workDir, { recursive: true });

try {
  const localRows = (
    await proxy.env.DB.prepare(
      `SELECT
        fp.id AS feedback_id,
        fp.alt_text,
        fp.width,
        fp.height,
        fp.sort_order,
        fp.status,
        fp.pin_rank,
        fp.created_at,
        m.r2_key,
        m.card_r2_key,
        m.thumb_r2_key,
        m.filename,
        m.alt_text AS media_alt,
        m.mime_type,
        m.size_bytes,
        m.width AS media_width,
        m.height AS media_height,
        m.created_at AS media_created_at
      FROM feedback_photos fp
      INNER JOIN media m ON m.id = fp.media_id
      ORDER BY fp.id`,
    ).all()
  ).results;

  console.log(`Local feedback có media: ${localRows.length}`);
  console.log(APPLY ? 'Chế độ: APPLY (ghi remote)' : 'Chế độ: DRY-RUN (không ghi). Thêm --apply để đồng bộ.');

  let uploaded = 0;
  let mediaInserted = 0;
  let feedbackInserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of localRows) {
    const label = `feedback#${row.feedback_id} ${row.r2_key}`;
    try {
      const keys = [row.r2_key, row.card_r2_key, row.thumb_r2_key].filter(Boolean);
      for (const key of keys) {
        const localObj = await readLocalObject(proxy.env.MEDIA, key);
        if (!localObj) throw new Error(`Thiếu object local R2: ${key}`);
        if (!APPLY) {
          console.log(`[dry] upload ${key} (${localObj.bytes.byteLength} bytes)`);
        }
      }

      if (!APPLY) {
        console.log(
          `[dry] insert media+feedback ${label}${row.pin_rank != null ? ` pin=${row.pin_rank}` : ''}`,
        );
        continue;
      }

      const existingMedia = d1RemoteJson(
        `SELECT id FROM media WHERE r2_key = ${sqlString(row.r2_key)} LIMIT 1`,
      );
      let remoteMediaId = existingMedia[0]?.id ?? null;

      if (!remoteMediaId) {
        for (const key of keys) {
          const localObj = await readLocalObject(proxy.env.MEDIA, key);
          if (!localObj) throw new Error(`Thiếu object local R2: ${key}`);
          await putRemoteObject(key, localObj.bytes, key === row.r2_key ? row.mime_type : 'image/webp');
          uploaded += 1;
        }

        d1RemoteJson(
          `INSERT INTO media (r2_key, card_r2_key, thumb_r2_key, filename, alt_text, mime_type, size_bytes, width, height, created_at)
           VALUES (
             ${sqlString(row.r2_key)},
             ${sqlString(row.card_r2_key)},
             ${sqlString(row.thumb_r2_key)},
             ${sqlString(row.filename)},
             ${sqlString(row.media_alt ?? '')},
             ${sqlString(row.mime_type)},
             ${sqlInt(row.size_bytes)},
             ${sqlInt(row.media_width)},
             ${sqlInt(row.media_height)},
             ${sqlInt(row.media_created_at)}
           )`,
        );
        const created = d1RemoteJson(
          `SELECT id FROM media WHERE r2_key = ${sqlString(row.r2_key)} LIMIT 1`,
        );
        remoteMediaId = created[0]?.id ?? null;
        if (!remoteMediaId) throw new Error('Insert media remote thất bại');
        mediaInserted += 1;
      } else {
        skipped += 1;
      }

      const existingFeedback = d1RemoteJson(
        `SELECT id FROM feedback_photos WHERE media_id = ${sqlInt(remoteMediaId)} LIMIT 1`,
      );
      if (existingFeedback[0]?.id) {
        console.log(`skip feedback already linked: ${label}`);
        continue;
      }

      // pin_rank unique: nếu rank đã dùng thì bỏ pin (giữ ảnh published).
      let pinRank = row.pin_rank;
      if (pinRank != null) {
        const pinTaken = d1RemoteJson(
          `SELECT id FROM feedback_photos WHERE pin_rank = ${sqlInt(pinRank)} LIMIT 1`,
        );
        if (pinTaken[0]?.id) pinRank = null;
      }

      d1RemoteJson(
        `INSERT INTO feedback_photos (media_id, public_path, alt_text, width, height, sort_order, status, pin_rank, created_at)
         VALUES (
           ${sqlInt(remoteMediaId)},
           NULL,
           ${sqlString(row.alt_text ?? '')},
           ${sqlInt(row.width)},
           ${sqlInt(row.height)},
           ${sqlInt(row.sort_order ?? 0)},
           ${sqlString(row.status || 'published')},
           ${sqlInt(pinRank)},
           ${sqlInt(row.created_at)}
         )`,
      );
      feedbackInserted += 1;
      console.log(`ok ${label} → media_id=${remoteMediaId}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL ${label}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply' : 'dry-run',
        local: localRows.length,
        uploadedObjects: uploaded,
        mediaInserted,
        feedbackInserted,
        mediaAlreadyPresent: skipped,
        failed,
      },
      null,
      2,
    ),
  );
  if (!APPLY) {
    console.log('\nChạy thật: node scripts/sync-feedback-to-remote.mjs --apply');
  }
  if (failed > 0) process.exitCode = 1;
} finally {
  await proxy.dispose();
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
}
