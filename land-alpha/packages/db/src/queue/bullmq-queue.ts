import { Prisma } from '@prisma/client';
import { prisma } from '../client';
import type {
  ConsumerOptions,
  EnqueueOptions,
  JobConsumer,
  JobHandlerMap,
  JobPayloadMap,
  JobQueue,
  JobRecord,
  JobType,
} from '@land-alpha/shared/queue';

/**
 * BullMQ driver, selected when `REDIS_URL` is set.
 *
 * It mirrors every job into the `Job` table as well as pushing it to Redis.
 * That looks redundant but is deliberate: the analyst-facing Ingestion and Job
 * History screens are then identical under both drivers, and job history
 * survives a Redis flush. Redis owns *scheduling*; Postgres owns *the record*.
 */

interface BullQueueLike {
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<{ id?: string }>;
  close(): Promise<void>;
  getJob(id: string): Promise<{ remove(): Promise<void> } | undefined>;
}

interface BullWorkerLike {
  close(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

const QUEUE_NAME = 'land-alpha';

export class BullMqJobQueue implements JobQueue, JobConsumer {
  private queue: BullQueueLike | null = null;
  private worker: BullWorkerLike | null = null;

  constructor(private readonly redisUrl: string) {}

  private async getQueue(): Promise<BullQueueLike> {
    if (this.queue) return this.queue;
    const { Queue } = await import('bullmq');
    this.queue = new Queue(QUEUE_NAME, {
      connection: { url: this.redisUrl },
    }) as unknown as BullQueueLike;
    return this.queue;
  }

  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options: EnqueueOptions = {},
  ): Promise<string> {
    const dedupeKey = options.dedupeKey ?? null;
    if (dedupeKey) {
      const existing = await prisma.job.findFirst({
        where: { dedupeKey, status: { in: ['QUEUED', 'RUNNING'] } },
        select: { id: true },
      });
      if (existing) return existing.id;
    }

    const row = await prisma.job.create({
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

    const queue = await this.getQueue();
    await queue.add(
      type,
      { jobRowId: row.id, type, payload },
      {
        jobId: row.id,
        delay: options.runAt ? Math.max(0, options.runAt.getTime() - Date.now()) : 0,
        attempts: options.maxAttempts ?? 3,
        priority: options.priority ? -options.priority : undefined,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
    return row.id;
  }

  async cancel(jobId: string): Promise<void> {
    const queue = await this.getQueue();
    const job = await queue.getJob(jobId);
    await job?.remove();
    await prisma.job.updateMany({
      where: { id: jobId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date(), dedupeKey: null },
    });
  }

  async start(handlers: JobHandlerMap, options: ConsumerOptions): Promise<void> {
    const { Worker } = await import('bullmq');
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: { id?: string; data: unknown; attemptsMade: number }) => {
        const data = job.data as { jobRowId: string; type: JobType; payload: unknown };
        const handler = handlers[data.type];
        const rowId = data.jobRowId;
        await prisma.job.update({
          where: { id: rowId },
          data: { status: 'RUNNING', startedAt: new Date(), attempts: job.attemptsMade + 1 },
        });
        if (!handler) {
          await prisma.job.update({
            where: { id: rowId },
            data: {
              status: 'FAILED',
              finishedAt: new Date(),
              lastError: `No handler registered for job type ${data.type}`,
              dedupeKey: null,
            },
          });
          throw new Error(`No handler registered for job type ${data.type}`);
        }
        try {
          const result = await (handler as (p: unknown, c: unknown) => Promise<unknown>)(
            data.payload,
            { jobId: rowId, attempt: job.attemptsMade + 1 },
          );
          await prisma.job.update({
            where: { id: rowId },
            data: {
              status: 'SUCCEEDED',
              finishedAt: new Date(),
              result: (result ?? null) as Prisma.InputJsonValue,
              dedupeKey: null,
            },
          });
          return result;
        } catch (error) {
          const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
          await prisma.job.update({
            where: { id: rowId },
            data: { status: 'FAILED', finishedAt: new Date(), lastError: message.slice(0, 4000) },
          });
          throw error;
        }
      },
      {
        connection: { url: this.redisUrl },
        concurrency: options.concurrency,
      },
    ) as unknown as BullWorkerLike;

    options.signal?.addEventListener('abort', () => void this.stop(), { once: true });

    await new Promise<void>((resolve) => {
      this.worker?.on('closed', () => resolve());
      options.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }

  async close(): Promise<void> {
    await this.stop();
    await this.queue?.close();
    this.queue = null;
  }
}

/** Not part of the interface — used by the job-history screen under both drivers. */
export function toJobRecord(row: {
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
