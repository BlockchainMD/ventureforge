/**
 * Enqueue a job by hand.
 *
 *   pnpm --filter @land-alpha/worker enqueue maintenance.sourceHealth
 *   pnpm --filter @land-alpha/worker enqueue parcel.enrich '{"parcelId":"..."}'
 */
import { getQueue, prisma } from '@land-alpha/db';
import { JOB_TYPES, type JobType } from '@land-alpha/shared/queue';

async function main(): Promise<void> {
  const type = process.argv[2] as JobType | undefined;
  const payloadArg = process.argv[3];

  if (!type || !JOB_TYPES.includes(type)) {
    console.log('Job types:\n' + JOB_TYPES.map((value) => `  ${value}`).join('\n'));
    return;
  }

  const payload = payloadArg ? JSON.parse(payloadArg) : {};
  const queue = await getQueue();
  const id = await queue.enqueue(type, payload, { dedupeKey: `${type}:${payloadArg ?? ''}` });
  console.log(`Enqueued ${type} as ${id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
