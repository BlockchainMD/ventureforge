import { Prisma } from '@prisma/client';
import { prisma } from '../client';
import {
  backoffMs,
  type ConsumerOptions,
  type EnqueueOptions,
  type JobConsumer,
  type JobHandlerMap,
  type JobPayloadMap,
  type JobQueue,
  type JobRecord,
  type JobType,
} from '@land-alpha/shared/queue';

/**
 * Postgres-backed queue (the default driver).
 *
 * Work is claimed with `FOR UPDATE SKIP LOCKED`, the standard safe pattern for
 * multiple workers competing over a job table: each worker locks only rows it
 * takes, and never blocks waiting for rows another worker already holds.
 *
 * Everything runs inside one transaction so a crash between "select" and
 * "mark running" cannot lose a job.
 */
export class PostgresJobQueue implements JobQueue, JobConsumer {
  private running = false;

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const dedupeKey = options.dedupeKey ?? null;

    if (dedupeKey) {
      // A pending job with the same key is the job we would have created.
      const existing = await prisma.job.findFirst({
        where: { dedupeKey, status: { in: ['QUEUED', 'RUNNING'] } },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const job = await prisma.job.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        dedupeKey,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 3,
        priority: options.priority ?? 0,
      },
      select: { id: true },
    });
    return job.id;
  }

  /** Claim up to `limit` runnable jobs, atomically marking them RUNNING. */
  async claim(limit: number): Promise<JobRecord[]> {
    const rows = await prisma.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Job"
        WHERE "status" = 'QUEUED' AND "runAt" <= NOW()
        ORDER BY "priority" DESC, "runAt" ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (candidates.length === 0) return [];
      const ids = candidates.map((c) => c.id);
      await tx.job.updateMany({
        where: { id: { in: ids } },
        data: { status: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
      });
      return tx.job.findMany({ where: { id: { in: ids } } });
    });

    return rows.map(toJobRecord);
  }

  async complete(jobId: string, result?: unknown): Promise<void> {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        result: (result ?? null) as Prisma.InputJsonValue,
        lastError: null,
        // Free the dedupe slot so the same work can be scheduled again later.
        dedupeKey: null,
      },
    });
  }

  async fail(jobId: string, error: string, options: { retry?: boolean } = {}): Promise<void> {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;
    const canRetry = (options.retry ?? true) && job.attempts < job.maxAttempts;
    await prisma.job.update({
      where: { id: jobId },
      data: canRetry
        ? {
            status: 'QUEUED',
            runAt: new Date(Date.now() + backoffMs(job.attempts)),
            lastError: truncateError(error),
            startedAt: null,
          }
        : {
            status: 'FAILED',
            finishedAt: new Date(),
            lastError: truncateError(error),
            dedupeKey: null,
          },
    });
  }

  async cancel(jobId: string): Promise<void> {
    await prisma.job.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date(), dedupeKey: null },
    });
  }

  async close(): Promise<void> {
    this.running = false;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  /**
   * Poll-and-claim loop.
   *
   * Deliberately simple: claim a batch sized to the free concurrency, run the
   * batch, sleep only when the queue came back empty. Under load this never
   * sleeps, so the poll interval costs nothing when there is work to do.
   */
  async start(handlers: JobHandlerMap, options: ConsumerOptions): Promise<void> {
    this.running = true;
    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const inFlight = new Set<Promise<void>>();

    while (this.running && !options.signal?.aborted) {
      const capacity = options.concurrency - inFlight.size;
      if (capacity <= 0) {
        await Promise.race(inFlight);
        continue;
      }

      const jobs = await this.claim(capacity);
      if (jobs.length === 0) {
        if (inFlight.size > 0) {
          await Promise.race(inFlight);
        } else {
          await delay(pollIntervalMs, options.signal);
        }
        continue;
      }

      for (const job of jobs) {
        options.onJobStart?.(job);
        const task = this.runJob(job, handlers, options).finally(() => inFlight.delete(task));
        inFlight.add(task);
      }
    }

    await Promise.allSettled(inFlight);
  }

  private async runJob(
    job: JobRecord,
    handlers: JobHandlerMap,
    options: ConsumerOptions,
  ): Promise<void> {
    const handler = handlers[job.type];
    if (!handler) {
      await this.fail(job.id, `No handler registered for job type ${job.type}`, { retry: false });
      options.onJobEnd?.(job, 'FAILED', 'no handler');
      return;
    }
    try {
      const result = await (handler as (p: unknown, c: unknown) => Promise<unknown>)(job.payload, {
        jobId: job.id,
        attempt: job.attempts,
      });
      await this.complete(job.id, result);
      options.onJobEnd?.(job, 'SUCCEEDED');
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      await this.fail(job.id, message);
      options.onJobEnd?.(job, 'FAILED', message);
    }
  }

  /**
   * Recover jobs orphaned by a worker that died mid-flight. Called on worker
   * startup; without it a hard crash leaves jobs RUNNING forever.
   */
  static async requeueStale(olderThanMs = 15 * 60_000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await prisma.job.updateMany({
      where: { status: 'RUNNING', startedAt: { lt: cutoff } },
      data: { status: 'QUEUED', startedAt: null, lastError: 'Requeued after stale RUNNING state' },
    });
    return result.count;
  }
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function truncateError(message: string): string {
  return message.length > 4000 ? `${message.slice(0, 3997)}...` : message;
}

function toJobRecord(row: {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  result: unknown;
}): JobRecord {
  return {
    id: row.id,
    type: row.type as JobType,
    payload: row.payload as JobPayloadMap[JobType],
    status: row.status as JobRecord['status'],
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAt: row.runAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    lastError: row.lastError,
    result: row.result,
  };
}
