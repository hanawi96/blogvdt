import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { ingestD1Import, initD1Import, md5Hex, pollD1Import } from '../features/backups/d1-api';
import { getBackupJob } from '../features/backups/jobs';
import { releaseRestoreLock } from '../features/backups/restore-lock';
import { enqueueBackup } from '../features/backups/service';
import { createDb } from '../lib/db/client';
import { sessions } from '../lib/db/schema';

export type RestoreParams = {
  jobId?: number;
  r2Key?: string;
  actorId?: number;
};

type RestoreEnv = {
  DB: D1Database;
  BACKUPS: R2Bucket;
  BACKUP_WORKFLOW: { create: (opts: { params: { jobId: number } }) => Promise<{ id: string }> };
  CF_ACCOUNT_ID: string;
  D1_DATABASE_ID: string;
  D1_API_TOKEN: string;
};

export class RestoreWorkflow extends WorkflowEntrypoint<RestoreEnv, RestoreParams> {
  async run(event: WorkflowEvent<RestoreParams>, step: WorkflowStep) {
    const db = createDb(this.env.DB);
    let runError: unknown = null;

    try {
      const source = await step.do('load-source', async () => {
        const uploaded = typeof event.payload?.r2Key === 'string' ? event.payload.r2Key.trim() : '';
        if (uploaded) {
          if (!uploaded.startsWith('backups/imports/')) throw new Error('File import không hợp lệ.');
          return { r2Key: uploaded };
        }
        const jobId = Number(event.payload?.jobId);
        if (!Number.isInteger(jobId) || jobId < 1) throw new Error('Thiếu nguồn khôi phục.');
        const job = await getBackupJob(db, jobId);
        if (!job || job.kind !== 'full' || job.status !== 'success' || !job.r2Key) {
          throw new Error('Chỉ khôi phục từ backup full thành công.');
        }
        return { r2Key: job.r2Key };
      });

      const preId = await step.do('pre-restore-backup', async () => {
        const created = await enqueueBackup(db, this.env.BACKUP_WORKFLOW, {
          kind: 'full',
          trigger: 'pre_restore',
          createdBy: event.payload?.actorId ?? null,
          force: true,
        });
        if (!created.ok) throw new Error(created.error);
        return created.job.id;
      });

      for (let attempt = 0; attempt < 90; attempt += 1) {
        const status = await step.do(`wait-pre-${attempt}`, async () => {
          const row = await getBackupJob(db, preId);
          return row?.status ?? 'missing';
        });
        if (status === 'success') break;
        if (status === 'failed') throw new Error('Backup trước restore thất bại.');
        await step.sleep(`sleep-pre-${attempt}`, '2 seconds');
        if (attempt === 89) throw new Error('Hết thời gian chờ backup trước restore.');
      }

      const meta = await step.do('hash-r2', async () => {
        const obj = await this.env.BACKUPS.get(source.r2Key);
        if (!obj) throw new Error('Không đọc được file backup trên R2.');
        const buffer = await obj.arrayBuffer();
        const etag = await md5Hex(buffer);
        return { etag, bytes: buffer.byteLength };
      });

      const upload = await step.do('init-import', async () => initD1Import(this.env, meta.etag));

      await step.do('put-import', async () => {
        const obj = await this.env.BACKUPS.get(source.r2Key);
        if (!obj) throw new Error('Mất file backup trước khi upload import.');
        const bytes = await obj.arrayBuffer();
        const put = await fetch(upload.uploadUrl, {
          method: 'PUT',
          body: bytes,
          headers: { 'content-type': 'application/sql' },
        });
        if (!put.ok) throw new Error(`Upload import thất bại (${put.status}).`);
        const putEtag = (put.headers.get('etag') || '').replace(/"/g, '');
        if (putEtag && putEtag !== meta.etag) {
          throw new Error('ETag file import không khớp MD5 — hủy để tránh ghi DB lệch.');
        }
      });

      const bookmark = await step.do('ingest-import', async () =>
        ingestD1Import(this.env, meta.etag, upload.filename),
      );

      for (let attempt = 0; attempt < 90; attempt += 1) {
        const status = await step.do(`poll-import-${attempt}`, async () => pollD1Import(this.env, bookmark));
        if (status === 'complete') break;
        await step.sleep(`sleep-import-${attempt}`, '3 seconds');
        if (attempt === 89) throw new Error('Hết thời gian chờ import D1.');
      }

      await step.do('clear-sessions', async () => {
        await db.delete(sessions);
      });
    } catch (error) {
      runError = error;
    }

    // Một step duy nhất để luôn nhả khóa (kể cả khi lỗi) — tên cố định cho replay.
    await step.do('release-restore-lock', async () => {
      await releaseRestoreLock(db);
    });

    if (runError) throw runError;
  }
}
