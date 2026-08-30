import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Database } from '@magic/db';
import { jobIdOf } from '@magic/contracts';
import type { Logger } from 'pino';

export interface OutboxRelayOptions {
  readonly db: Database;
  readonly queues: ReadonlyMap<string, Queue>;
  readonly logger: Logger;
  readonly pollMs: number;
  readonly batchSize: number;
}

interface ClaimedJob extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  queue: string;
  job_key: string;
  payload: Record<string, unknown>;
}

/**
 * Moves committed outbox rows onto the queue.
 *
 * Delivery is at-least-once by design: the relay may publish a job and die before marking the row
 * published, in which case it republishes on the next pass. That is harmless because every
 * consumer is keyed by `jobId = job_key`, which makes a repeat an update of an existing job
 * rather than a second execution.
 *
 * `FOR UPDATE SKIP LOCKED` lets several relay instances run without coordinating: each claims a
 * disjoint batch and none of them blocks on the others.
 */
export class OutboxRelay {
  private readonly options: OutboxRelayOptions;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(options: OutboxRelayOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), this.options.pollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }

  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;

    try {
      const claimed = await this.claim();

      for (const job of claimed) {
        const queue = this.options.queues.get(job.queue)!;
        await queue.add(
          job.queue,
          { ...job.payload, tenantId: job.tenant_id },
          { jobId: jobIdOf(job.tenant_id, job.job_key) },
        );
      }

      if (claimed.length > 0) await this.markPublished(claimed.map((j) => j.id));
      return claimed.length;
    } catch (error) {
      this.options.logger.error({ err: error }, 'Outbox relay pass failed; rows stay claimable.');
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * The claim goes through `outbox_claim` rather than a direct statement for two reasons. The
   * relay drains every tenant from one process, and row-level security hides every row from an
   * unbound connection, so a direct query returns nothing at all. And the queue allow-list
   * belongs inside the claim: a batch filled with rows this worker cannot dispatch would starve
   * the ones it can, and marking that batch published would discard them.
   */
  private async claim(): Promise<ClaimedJob[]> {
    const served = [...this.options.queues.keys()];
    if (served.length === 0) return [];

    const rows = await this.options.db.execute<ClaimedJob>(sql`
      SELECT id::text, tenant_id::text, queue, job_key, payload
        FROM outbox_claim(${sql.param(served)}, ${this.options.batchSize})
    `);
    return [...rows];
  }

  private async markPublished(ids: readonly string[]): Promise<void> {
    await this.options.db.execute(sql`SELECT outbox_mark_published(${sql.param(ids.map(Number))})`);
  }
}
