import { eq } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { backupSettings } from '../../lib/db/schema';
import { hasActiveBackupJob } from './jobs';
import { setBackupSetting } from './settings';

/** Khóa restore trong backup_settings (không cần migration schema). */
export const RESTORE_LOCK_KEY = 'restore_lock' as const;

/** Restore + pre_restore + import thường < 20 phút; TTL tránh khóa vĩnh viễn nếu workflow chết. */
export const RESTORE_LOCK_TTL_MS = 45 * 60 * 1000;

export function restoreLockIsActive(
  startedAt: number | null,
  now: number,
  ttlMs = RESTORE_LOCK_TTL_MS,
): boolean {
  if (startedAt == null) return false;
  if (now - startedAt > ttlMs) return false;
  return true;
}

export async function readRestoreLockStartedAt(db: AppDb): Promise<number | null> {
  const rows = await db
    .select()
    .from(backupSettings)
    .where(eq(backupSettings.key, RESTORE_LOCK_KEY))
    .limit(1);
  const raw = rows[0]?.value?.trim() ?? '';
  if (!raw) return null;
  const started = Number(raw);
  return Number.isFinite(started) && started > 0 ? started : null;
}

export async function isRestoreLocked(db: AppDb, now = Date.now()): Promise<boolean> {
  return restoreLockIsActive(await readRestoreLockStartedAt(db), now);
}

/** Backup job đang chạy/queued sẵn sàng, hoặc restore đang khóa. */
export async function hasActiveDbWork(db: AppDb, now = Date.now()): Promise<boolean> {
  if (await hasActiveBackupJob(db, now)) return true;
  return isRestoreLocked(db, now);
}

export async function tryAcquireRestoreLock(
  db: AppDb,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await hasActiveDbWork(db, now)) {
    return { ok: false, error: 'Đang có job backup/restore chạy. Đợi xong rồi thử lại.' };
  }
  await setBackupSetting(db, RESTORE_LOCK_KEY, String(now), now);
  return { ok: true };
}

export async function releaseRestoreLock(db: AppDb, now = Date.now()): Promise<void> {
  await setBackupSetting(db, RESTORE_LOCK_KEY, '', now);
}
