import type { AppDb } from '../../lib/db/client';
import {
  createBackupJob,
  getBackupJob,
  listDueQueuedJobs,
  markJobRunning,
  type BackupJob,
  type BackupKind,
  type BackupTrigger,
} from './jobs';
import { hasActiveDbWork } from './restore-lock';
import { shouldEnqueueDailySchedule } from './schedule';
import { getBackupSettings, markScheduleDay } from './settings';
import { sanitizeBackupTables } from './tables';
import { vnDayKey } from './time';

type WorkflowBinding = {
  create: (opts: { id?: string; params: { jobId: number } }) => Promise<{ id: string }>;
};

export async function enqueueBackup(
  db: AppDb,
  workflow: WorkflowBinding,
  input: {
    kind: BackupKind;
    trigger: BackupTrigger;
    tables?: string[] | null;
    createdBy?: number | null;
    runAt?: number | null;
    force?: boolean;
  },
): Promise<{ ok: true; job: BackupJob } | { ok: false; error: string }> {
  if (!input.force && (await hasActiveDbWork(db))) {
    return { ok: false, error: 'Đang có job backup/restore chạy. Đợi xong rồi thử lại.' };
  }
  let tables = input.tables ?? null;
  if (input.kind === 'partial') {
    tables = sanitizeBackupTables(input.tables ?? []);
    if (!tables) return { ok: false, error: 'Chọn ít nhất một bảng cho backup partial.' };
  } else {
    tables = null;
  }
  try {
    const job = await createBackupJob(db, {
      kind: input.kind,
      trigger: input.trigger,
      tables,
      createdBy: input.createdBy,
      runAt: input.runAt ?? null,
    });
    if (input.runAt && input.runAt > Date.now()) {
      return { ok: true, job };
    }
    const instance = await workflow.create({
      params: { jobId: job.id },
    });
    await markJobRunning(db, job.id, instance.id);
    const updated = await getBackupJob(db, job.id);
    return { ok: true, job: updated ?? job };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Không tạo được backup.' };
  }
}

export async function runScheduledBackupTick(
  db: AppDb,
  workflow: WorkflowBinding,
  now = Date.now(),
): Promise<{ started: number }> {
  let started = 0;
  const settings = await getBackupSettings(db);
  const due = await listDueQueuedJobs(db, now);
  for (const job of due) {
    if (await hasActiveDbWork(db, now)) break;
    try {
      const instance = await workflow.create({ params: { jobId: job.id } });
      await markJobRunning(db, job.id, instance.id);
      started += 1;
    } catch {
      /* thử job sau */
    }
  }

  const active = await hasActiveDbWork(db, now);
  if (
    shouldEnqueueDailySchedule({
      scheduleEnabled: settings.scheduleEnabled,
      scheduleHourUtc: settings.scheduleHourUtc,
      lastScheduleDay: settings.lastScheduleDay,
      hasActiveJob: active,
      now,
    })
  ) {
    const result = await enqueueBackup(db, workflow, {
      kind: 'full',
      trigger: 'schedule',
      force: true,
    });
    if (result.ok) {
      await markScheduleDay(db, vnDayKey(now), now);
      started += 1;
    }
  }
  return { started };
}
