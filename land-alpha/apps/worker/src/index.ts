import { PostgresJobQueue, getQueue, prisma } from '@land-alpha/db';
import { env } from '@land-alpha/shared/env';
import { createLogger } from '@land-alpha/shared/logger';
import type { JobConsumer } from '@land-alpha/shared/queue';
import { handlers } from './handlers';

/**
 * The Land Alpha worker.
 *
 * Runs the queue consumer and a periodic maintenance sweep that refreshes due
 * sources and evaluates alert rules — the loop that turns the product from
 * something you query into something that tells you when a parcel worth having
 * appears.
 */

const logger = createLogger({ component: 'worker-main' });

async function main(): Promise<void> {
  const config = env();
  const controller = new AbortController();

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    controller.abort();
    // Give in-flight jobs a moment, then exit regardless.
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // A worker that died mid-job leaves rows stuck RUNNING; recover them first.
  if (config.QUEUE_DRIVER === 'postgres') {
    const requeued = await PostgresJobQueue.requeueStale();
    if (requeued > 0) logger.warn('requeued stale jobs from a previous run', { requeued });
  }

  const queue = (await getQueue()) as unknown as JobConsumer;

  const maintenanceIntervalMs = 15 * 60_000;
  const maintenance = setInterval(() => {
    void (async () => {
      try {
        const producer = await getQueue();
        await producer.enqueue(
          'maintenance.sourceHealth',
          {},
          { dedupeKey: 'maintenance.sourceHealth' },
        );
      } catch (error) {
        logger.error('failed to schedule maintenance', { error: String(error) });
      }
    })();
  }, maintenanceIntervalMs);
  maintenance.unref();

  logger.info('worker started', {
    driver: config.QUEUE_DRIVER,
    concurrency: config.WORKER_CONCURRENCY,
    enrichmentMode: config.ENRICHMENT_MODE,
    aiProvider: config.AI_PROVIDER,
  });

  // Kick a maintenance sweep immediately so a cold start refreshes due sources.
  const producer = await getQueue();
  await producer.enqueue('maintenance.sourceHealth', {}, { dedupeKey: 'maintenance.sourceHealth' });

  await queue.start(handlers, {
    concurrency: config.WORKER_CONCURRENCY,
    signal: controller.signal,
    onJobStart: (job) => logger.info('job started', { id: job.id, type: job.type }),
    onJobEnd: (job, outcome, detail) =>
      outcome === 'SUCCEEDED'
        ? logger.info('job finished', { id: job.id, type: job.type })
        : logger.error('job failed', {
            id: job.id,
            type: job.type,
            attempt: job.attempts,
            error: detail?.slice(0, 500),
          }),
  });

  clearInterval(maintenance);
  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error('worker crashed', { error: String(error) });
  process.exit(1);
});
