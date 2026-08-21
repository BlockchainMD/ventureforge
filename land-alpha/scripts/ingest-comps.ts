/**
 * Ingest comparable sales.
 *
 *   pnpm comps                        list registered sources and coverage
 *   pnpm comps mn-grant-sales         ingest one source
 *   pnpm comps --all                  ingest every enabled source
 */
import { prisma } from '@land-alpha/db';
import { comps } from '@land-alpha/ingestion';

async function main(): Promise<void> {
  const key = process.argv[2];
  const limitFlag = process.argv.indexOf('--limit');
  const limit = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) : undefined;

  if (!key) {
    const coverage = comps.compsCoverage();
    console.log('Comparable-sales sources:\n');
    for (const source of comps.COMPS_REGISTRY) {
      console.log(`  ${source.key.padEnd(22)} ${source.status.padEnd(15)} ${source.name}`);
      if (source.status !== 'ACTIVE' && source.notes) {
        console.log(`     ${source.notes.slice(0, 150)}…`);
      }
    }
    console.log(`\n  Real sales data: ${coverage.active.join(', ') || 'none'}`);
    console.log(`  Requires import: ${coverage.needsImport.join(', ') || 'none'}\n`);
    return;
  }

  const keys = key === '--all' ? comps.enabledCompsSources().map((source) => source.key) : [key];

  for (const sourceKey of keys) {
    const result = await comps.ingestComparableSales(sourceKey, { limit });
    console.log(`\n─── ${sourceKey} ────────────────────────────────`);
    console.log(`  discovered  ${result.discovered}`);
    console.log(`  accepted    ${result.accepted}`);
    if (result.rejected.length > 0) {
      console.log('  rejected:');
      for (const entry of result.rejected) console.log(`   - ${entry.count} ${entry.reason}`);
    }
    for (const warning of result.warnings) console.log(`  ! ${warning}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
