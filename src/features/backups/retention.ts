import type { AppDb } from '../../lib/db/client';
import { deleteDriveFile, driveConfigured } from './drive';
import {
  deleteBackupJobRow,
  getBackupJob,
  listOldFullSuccessBeyondRetention,
  type BackupJob,
} from './jobs';

type EnvLike = {
  BACKUPS: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
};

/** Chỉ xóa bản đã kết thúc — không đụng job đang chờ/chạy. */
export function canDeleteBackupJob(job: Pick<BackupJob, 'status'>): boolean {
  return job.status === 'success' || job.status === 'failed';
}

/** Xóa file R2 + Drive (best-effort) rồi xóa metadata job. */
export async function removeBackupJob(db: AppDb, env: EnvLike, job: BackupJob): Promise<void> {
  if (job.r2Key) {
    try {
      await env.BACKUPS.delete(job.r2Key);
    } catch {
      /* tiếp tục xóa metadata */
    }
  }
  if (job.driveFileId && driveConfigured(env)) {
    try {
      await deleteDriveFile(env, job.driveFileId);
    } catch {
      /* bỏ qua lỗi Drive khi dọn */
    }
  }
  await deleteBackupJobRow(db, job.id);
}

export async function deleteBackupById(
  db: AppDb,
  env: EnvLike,
  id: number,
): Promise<{ ok: true; job: BackupJob } | { ok: false; error: string }> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: 'Backup không hợp lệ.' };
  const job = await getBackupJob(db, id);
  if (!job) return { ok: false, error: 'Không tìm thấy bản backup.' };
  if (!canDeleteBackupJob(job)) {
    return { ok: false, error: 'Không xóa được backup đang chờ hoặc đang chạy.' };
  }
  await removeBackupJob(db, env, job);
  return { ok: true, job };
}

export async function applyBackupRetention(db: AppDb, env: EnvLike, keep: number): Promise<number> {
  const stale = await listOldFullSuccessBeyondRetention(db, keep);
  let removed = 0;
  for (const job of stale) {
    await removeBackupJob(db, env, job);
    removed += 1;
  }
  return removed;
}
