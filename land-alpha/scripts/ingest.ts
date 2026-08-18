/**
 * Run one registered source end to end.
 *
 *   pnpm tsx scripts/ingest.ts mn-st-louis-tax-forfeited [--limit 200]
 *
 * Used by operators for a one-off refresh and by the worker's job handler.
 */
import { prisma } from '@land-alpha/db';
import { registryByKey, SOURCE_REGISTRY } from '@land-alpha/source-registry';
import { runSource, syncRegistry } from '@land-alpha/ingestion';
import '@land-alpha/ingestion/adapters/index';
import { createLogger } from '@land-alpha/shared/logger';

const logger = createLogger({ component: 'ingest-cli' });

async function main(): Promise<void> {
  const key = process.argv[2];
  const limitFlag = process.argv.indexOf('--limit');
  const limit = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) : null;

  if (!key) {
    console.log('Registered sources:\n');
    for (const entry of SOURCE_REGISTRY) {
      console.log(
        `  ${entry.key.padEnd(36)} ${entry.status.padEnd(12)} ${entry.state} ${entry.county ?? ''} — ${entry.name}`,
      );
    }
    console.log('\nUsage: tsx scripts/ingest.ts <source-key> [--limit N]');
    return;
  }

  const entry = registryByKey(key);
  if (!entry) throw new Error(`Unknown source key: ${key}`);

  await syncRegistry();
  const source = await prisma.source.findUnique({ where: { registryKey: key } });
  if (!source) throw new Error(`Source ${key} was not synced`);

  const effective = limit ? { ...entry, config: { ...entry.config, maxFeatures: limit } } : entry;

  logger.info('starting ingestion', { key, limit });
  const outcome = await runSource(source.id, effective, { triggeredBy: 'cli' });

  console.log('\n─── ingestion result ───────────────────────────────');
  console.log(`  status      ${outcome.status}`);
  console.log(`  discovered  ${outcome.discovered}`);
  console.log(`  created     ${outcome.created}`);
  console.log(`  changed     ${outcome.changed}`);
  console.log(`  unchanged   ${outcome.unchanged}`);
  console.log(`  removed     ${outcome.removed}`);
  console.log(`  rejected    ${outcome.rejected}`);
  if (outcome.warnings.length) {
    console.log('\n  warnings:');
    for (const warning of outcome.warnings.slice(0, 10)) console.log(`   - ${warning}`);
  }
  if (outcome.errors.length) {
    console.log('\n  errors:');
    for (const error of outcome.errors.slice(0, 5)) console.log(`   - ${JSON.stringify(error)}`);
  }
  console.log('────────────────────────────────────────────────────\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
