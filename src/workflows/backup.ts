import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { backupObjectKey, pollD1Export, sha256Hex, startD1Export } from '../features/backups/d1-api';
import { driveConfigured, uploadBackupToDrive } from '../features/backups/drive';
import { clampRetentionKeep, getBackupJob, markJobFailed, markJobSuccess } from '../features/backups/jobs';
import { applyBackupRetention } from '../features/backups/retention';
import { getBackupSettings } from '../features/backups/settings';
import { tablesForD1Export } from '../features/backups/tables';
import { vnDayKey } from '../features/backups/time';
import { createDb } from '../lib/db/client';

export type BackupParams = { jobId: number };

type BackupEnv = {
  DB: D1Database;
  BACKUPS: R2Bucket;
  CF_ACCOUNT_ID: string;
  D1_DATABASE_ID: string;
  D1_API_TOKEN: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
};

export class BackupWorkflow extends WorkflowEntrypoint<BackupEnv, BackupParams> {
  async run(event: WorkflowEvent<BackupParams>, step: WorkflowStep) {
    const jobId = Number(event.payload?.jobId);
    if (!Number.isInteger(jobId) || jobId < 1) throw new Error('jobId không hợp lệ.');
    const db = createDb(this.env.DB);

    const job = await step.do('load-job', async () => {
      const row = await getBackupJob(db, jobId);
      if (!row) throw new Error(`Không tìm thấy job #${jobId}.`);
      return {
        id: row.id,
        kind: row.kind,
        createdAt: row.createdAt,
        tablesJson: row.tablesJson,
      };
    });

    try {
      const bookmark = await step.do('start-export', async () => {
        const tables = tablesForD1Export(job.kind, job.tablesJson);
        return startD1Export(this.env, tables);
      });

      let exported: { filename: string; signedUrl: string } | null = null;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        exported = await step.do(`poll-export-${attempt}`, async () => pollD1Export(this.env, bookmark));
        if (exported) break;
        await step.sleep(`wait-export-${attempt}`, '5 seconds');
      }
      if (!exported) throw new Error('Hết thời gian chờ export D1.');

      const stored = await step.do('store-r2', async () => {
        const dump = await fetch(exported!.signedUrl);
        if (!dump.ok || !dump.body) throw new Error('Không tải được file export.');
        const buffer = await dump.arrayBuffer();
        const key = backupObjectKey(job.id, job.createdAt);
        const hash = await sha256Hex(buffer);
        await this.env.BACKUPS.put(key, buffer, {
          httpMetadata: { contentType: 'application/sql; charset=utf-8' },
          customMetadata: {
            kind: job.kind,
            jobId: String(job.id),
            sha256: hash,
            createdAt: String(job.createdAt),
          },
        });
        return { key, bytes: buffer.byteLength, sha256: hash };
      });

      const settings = await step.do('load-settings', async () => getBackupSettings(db));

      let driveStatus: 'skipped' | 'success' | 'failed' = 'skipped';
      let driveFileId: string | null = null;
      if (settings.driveEnabled && driveConfigured(this.env)) {
        const drive = await step.do('upload-drive', async () => {
          try {
            const obj = await this.env.BACKUPS.get(stored.key);
            if (!obj) throw new Error('Thiếu object R2 để đẩy Drive.');
            const bytes = await obj.arrayBuffer();
            const day = vnDayKey(job.createdAt);
            const id = await uploadBackupToDrive(this.env, {
              name: `vongdautambyanh-${day}-${job.id}.sql`,
              bytes,
            });
            return { status: 'success' as const, id };
          } catch (error) {
            console.error(
              JSON.stringify({
                event: 'backup_drive_failed',
                jobId,
                name: error instanceof Error ? error.name : 'unknown',
              }),
            );
            return { status: 'failed' as const, id: null };
          }
        });
        driveStatus = drive.status;
        driveFileId = drive.id;
      }

      await step.do('mark-success', async () => {
        await markJobSuccess(db, jobId, {
          r2Key: stored.key,
          bytes: stored.bytes,
          sha256: stored.sha256,
          driveStatus,
          driveFileId,
        });
      });

      await step.do('retention', async () => {
        await applyBackupRetention(db, this.env, clampRetentionKeep(settings.retentionCount));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup thất bại.';
      await markJobFailed(db, jobId, message);
      throw error;
    }
  }
}
