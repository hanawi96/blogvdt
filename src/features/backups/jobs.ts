import { and, asc, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { AppDb } from '../../lib/db/client';
import { backupJobs } from '../../lib/db/schema';
import { sanitizeBackupTables } from './tables';

export type BackupKind = 'full' | 'partial';
export type BackupTrigger = 'manual' | 'schedule' | 'pre_restore';
export type BackupStatus = 'queued' | 'running' | 'success' | 'failed';
export type DriveStatus = 'skipped' | 'pending' | 'success' | 'failed';

export type BackupJob = {
  id: number;
  kind: BackupKind;
  trigger: BackupTrigger;
  status: BackupStatus;
  tablesJson: string | null;
  r2Key: string | null;
  bytes: number | null;
  sha256: string | null;
  driveFileId: string | null;
  driveStatus: DriveStatus;
  error: string | null;
  createdBy: number | null;
  createdAt: number;
  finishedAt: number | null;
  runAt: number | null;
  workflowInstanceId: string | null;
};

export async function listBackupJobs(db: AppDb, limit = 50): Promise<BackupJob[]> {
  const rows = await db.select().from(backupJobs).orderBy(desc(backupJobs.createdAt), desc(backupJobs.id)).limit(limit);
  return rows.map(mapJob);
}

export async function getBackupJob(db: AppDb, id: number): Promise<BackupJob | null> {
  const rows = await db.select().from(backupJobs).where(eq(backupJobs.id, id)).limit(1);
  return rows[0] ? mapJob(rows[0]) : null;
}

export async function hasActiveBackupJob(db: AppDb, now = Date.now()): Promise<boolean> {
  const running = await db
    .select({ id: backupJobs.id })
    .from(backupJobs)
    .where(eq(backupJobs.status, 'running'))
    .limit(1);
  if (running[0]) return true;
  // Queued sẵn sàng chạy ngay (không tính job hẹn giờ tương lai).
  const queued = await db
    .select({ id: backupJobs.id })
    .from(backupJobs)
    .where(
      and(
        eq(backupJobs.status, 'queued'),
        sql`(${backupJobs.runAt} is null or ${backupJobs.runAt} <= ${now})`,
      ),
    )
    .limit(1);
  return Boolean(queued[0]);
}

export async function createBackupJob(
  db: AppDb,
  input: {
    kind: BackupKind;
    trigger: BackupTrigger;
    tables?: string[] | null;
    createdBy?: number | null;
    runAt?: number | null;
    now?: number;
  },
): Promise<BackupJob> {
  const now = input.now ?? Date.now();
  const tables = input.kind === 'partial' ? sanitizeBackupTables(input.tables ?? []) : null;
  if (input.kind === 'partial' && (!tables || tables.length === 0)) {
    throw new Error('Chọn ít nhất một bảng cho backup partial.');
  }
  const inserted = await db
    .insert(backupJobs)
    .values({
      kind: input.kind,
      trigger: input.trigger,
      status: 'queued',
      tablesJson: tables ? JSON.stringify(tables) : null,
      driveStatus: 'skipped',
      createdBy: input.createdBy ?? null,
      createdAt: now,
      runAt: input.runAt ?? null,
    })
    .returning();
  const row = inserted[0];
  if (!row) throw new Error('Không tạo được job backup.');
  return mapJob(row);
}

export async function markJobRunning(db: AppDb, id: number, workflowInstanceId: string): Promise<void> {
  await db
    .update(backupJobs)
    .set({ status: 'running', workflowInstanceId, error: null })
    .where(eq(backupJobs.id, id));
}

export async function markJobSuccess(
  db: AppDb,
  id: number,
  data: {
    r2Key: string;
    bytes: number;
    sha256: string;
    driveStatus: DriveStatus;
    driveFileId?: string | null;
    finishedAt?: number;
  },
): Promise<void> {
  await db
    .update(backupJobs)
    .set({
      status: 'success',
      r2Key: data.r2Key,
      bytes: data.bytes,
      sha256: data.sha256,
      driveStatus: data.driveStatus,
      driveFileId: data.driveFileId ?? null,
      finishedAt: data.finishedAt ?? Date.now(),
      error: null,
    })
    .where(eq(backupJobs.id, id));
}

export async function markJobFailed(db: AppDb, id: number, error: string, finishedAt = Date.now()): Promise<void> {
  await db
    .update(backupJobs)
    .set({ status: 'failed', error: error.slice(0, 500), finishedAt })
    .where(eq(backupJobs.id, id));
}

export async function markDriveResult(
  db: AppDb,
  id: number,
  driveStatus: DriveStatus,
  driveFileId: string | null,
): Promise<void> {
  await db.update(backupJobs).set({ driveStatus, driveFileId }).where(eq(backupJobs.id, id));
}

export async function listDueQueuedJobs(db: AppDb, now = Date.now()): Promise<BackupJob[]> {
  const rows = await db
    .select()
    .from(backupJobs)
    .where(and(eq(backupJobs.status, 'queued'), isNotNull(backupJobs.runAt), lte(backupJobs.runAt, now)))
    .orderBy(asc(backupJobs.runAt), asc(backupJobs.id))
    .limit(5);
  return rows.map(mapJob);
}

export async function listOldFullSuccessBeyondRetention(db: AppDb, keep: number): Promise<BackupJob[]> {
  const rows = await db
    .select()
    .from(backupJobs)
    .where(
      and(
        eq(backupJobs.kind, 'full'),
        eq(backupJobs.status, 'success'),
        sql`${backupJobs.trigger} in ('manual', 'schedule')`,
      ),
    )
    .orderBy(desc(backupJobs.createdAt), desc(backupJobs.id));
  return rows.slice(keep).map(mapJob);
}

export async function deleteBackupJobRow(db: AppDb, id: number): Promise<void> {
  await db.delete(backupJobs).where(eq(backupJobs.id, id));
}

export function parseJobTables(job: BackupJob): string[] | null {
  if (!job.tablesJson) return null;
  try {
    return sanitizeBackupTables(JSON.parse(job.tablesJson));
  } catch {
    return null;
  }
}

function mapJob(row: typeof backupJobs.$inferSelect): BackupJob {
  return {
    id: row.id,
    kind: row.kind as BackupKind,
    trigger: row.trigger as BackupTrigger,
    status: row.status as BackupStatus,
    tablesJson: row.tablesJson,
    r2Key: row.r2Key,
    bytes: row.bytes,
    sha256: row.sha256,
    driveFileId: row.driveFileId,
    driveStatus: row.driveStatus as DriveStatus,
    error: row.error,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    runAt: row.runAt,
    workflowInstanceId: row.workflowInstanceId,
  };
}
