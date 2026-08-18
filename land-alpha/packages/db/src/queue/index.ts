import { env } from '@land-alpha/shared/env';
import type { JobQueue } from '@land-alpha/shared/queue';
import { PostgresJobQueue } from './postgres-queue.js';

let cached: JobQueue | null = null;

/**
 * Resolve the configured queue driver.
 *
 * BullMQ is loaded lazily so that a Postgres-only deployment never requires
 * `ioredis` to be installed or a Redis server to exist.
 */
export async function getQueue(): Promise<JobQueue> {
  if (cached) return cached;
  const config = env();
  if (config.QUEUE_DRIVER === 'bullmq') {
    const { BullMqJobQueue } = await import('./bullmq-queue.js');
    cached = new BullMqJobQueue(config.REDIS_URL!);
  } else {
    cached = new PostgresJobQueue();
  }
  return cached;
}

export function setQueue(queue: JobQueue | null): void {
  cached = queue;
}

export { PostgresJobQueue };
