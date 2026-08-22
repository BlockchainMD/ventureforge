/**
 * Run the enrichment → valuation → scoring pipeline over parcels.
 *
 *   pnpm tsx scripts/pipeline.ts              every live parcel
 *   pnpm tsx scripts/pipeline.ts --state MN   one state
 *   pnpm tsx scripts/pipeline.ts --id <uuid>  one parcel
 */
import { prisma } from '@land-alpha/db';
import { enrichParcel, scoreParcelById, valuateParcel } from '@land-alpha/core';
import { createLogger } from '@land-alpha/shared/logger';
import { IngestHttpClient } from '@land-alpha/ingestion';

const logger = createLogger({ component: 'pipeline-cli' });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | null => {
    const index = args.indexOf(`--${name}`);
    return index > -1 ? (args[index + 1] ?? null) : null;
  };

  const id = flag('id');
  const state = flag('state');
  const limit = Number(flag('limit') ?? '0') || undefined;

  const parcels = id
    ? await prisma.parcelOpportunity.findMany({ where: { id }, select: { id: true, apn: true } })
    : await prisma.parcelOpportunity.findMany({
        where: { removedFromSourceAt: null, ...(state ? { state } : {}) },
        select: { id: true, apn: true },
        orderBy: { firstSeenAt: 'desc' },
        ...(limit ? { take: limit } : {}),
      });

  console.log(`Running pipeline over ${parcels.length} parcels\n`);
  let ok = 0;
  const failures: { apn: string | null; error: string }[] = [];

  // One client for the whole run. Its circuit breaker counts failures per host,
  // which is worth nothing if each parcel gets a fresh client and therefore a
  // fresh count — the point is to stop asking a dead service the same question
  // once per parcel, and that only works if the run remembers.
  const http = new IngestHttpClient({});

  for (const parcel of parcels) {
    try {
      await enrichParcel(parcel.id, { http });
      await valuateParcel(parcel.id);
      await scoreParcelById(parcel.id);
      ok += 1;
    } catch (error) {
      failures.push({ apn: parcel.apn, error: String(error) });
      logger.error('pipeline failed for parcel', { apn: parcel.apn, error: String(error) });
    }
  }

  console.log(`\n  succeeded ${ok} / ${parcels.length}`);
  if (failures.length > 0) {
    console.log('  failures:');
    for (const failure of failures.slice(0, 10)) {
      console.log(`   - ${failure.apn}: ${failure.error.slice(0, 200)}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
