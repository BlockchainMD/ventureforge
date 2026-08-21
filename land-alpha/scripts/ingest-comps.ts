/**
 * Ingest comparable sales.
 *
 *   pnpm comps                        list registered sources and coverage
 *   pnpm comps mn-grant-sales         ingest one source
 *   pnpm comps --all                  ingest every enabled source
 *   pnpm comps --enrich-fl Orange     fill parcel facts from the Florida roll
 *   pnpm comps --geocode-fl Marion    put the county's comparables on the map
 */
import { prisma } from '@land-alpha/db';
import { comps, IngestHttpClient } from '@land-alpha/ingestion';

async function main(): Promise<void> {
  const key = process.argv[2];
  const limitFlag = process.argv.indexOf('--limit');
  const limit = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) : undefined;

  if (key === '--geocode-fl') {
    const counties = process.argv.slice(3).filter((arg) => !arg.startsWith('--'));
    if (counties.length === 0) throw new Error('Usage: pnpm comps --geocode-fl <County> [County…]');
    const http = new IngestHttpClient();
    for (const county of counties) {
      const result = await comps.geocodeFloridaComparables(http, { county });
      console.log(`\n─── Geocoding ${county} County ───`);
      console.log(`  comparables needing a location  ${result.comparablesWanted}`);
      console.log(`  parcels scanned                 ${result.parcelsScanned}`);
      console.log(`  located                         ${result.located}`);
      if (result.srid) console.log(`  source projection               EPSG:${result.srid}`);
      for (const warning of result.warnings) console.log(`  ! ${warning}`);
    }
    console.log('');
    return;
  }

  if (key === '--enrich-fl') {
    const county = process.argv[3];
    if (!county) throw new Error('Usage: pnpm comps --enrich-fl <County>');
    const result = await comps.enrichFloridaParcels(new IngestHttpClient(), { county });
    console.log(`\n─── Florida roll enrichment: ${county} County ───`);
    console.log(`  parcels examined  ${result.examined}`);
    console.log(`  found on the roll ${result.matched}`);
    console.log(`  acreage filled    ${result.acreageFilled}`);
    console.log(`  values filled     ${result.valuesFilled}`);
    for (const warning of result.warnings) console.log(`  ! ${warning}`);
    console.log('');
    return;
  }

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
