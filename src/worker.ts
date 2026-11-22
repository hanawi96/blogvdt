import { handle } from '@astrojs/cloudflare/handler';
import { runScheduledBackupTick } from './features/backups/service';
import { createDb } from './lib/db/client';
import { BackupWorkflow } from './workflows/backup';
import { RestoreWorkflow } from './workflows/restore';

export { BackupWorkflow, RestoreWorkflow };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        try {
          const db = createDb(env.DB);
          await runScheduledBackupTick(db, env.BACKUP_WORKFLOW);
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'backup_schedule_tick_failed',
              name: error instanceof Error ? error.name : 'unknown',
            }),
          );
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
