/**
 * Minimal Workflow / Worker handler types.
 * Project keeps `wrangler types --include-runtime=false` to avoid DOM conflicts;
 * these shims cover Backup/Restore Workflows and the custom worker entry.
 */

interface WorkflowInstance {
  id: string;
  status(): Promise<{ status: string }>;
}

interface WorkflowInstanceCreateOptions<PARAMS = unknown> {
  id?: string;
  params?: PARAMS;
}

interface Workflow<PARAMS = unknown> {
  create(options?: WorkflowInstanceCreateOptions<PARAMS>): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

interface ExportedHandler<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
  scheduled?(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void | Promise<void>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  scheduledTime: number;
  cron: string;
  noRetry(): void;
}

declare module 'cloudflare:workers' {
  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected env: Env;
    constructor(ctx: ExecutionContext, env: Env);
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }

  export interface WorkflowEvent<T> {
    payload: Readonly<T>;
    timestamp: Date;
    instanceId: string;
  }

  export abstract class WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    sleep(name: string, duration: string | number): Promise<void>;
  }

  export const env: Env;
}
