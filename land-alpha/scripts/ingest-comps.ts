/**
 * Ingest comparable sales.
 *
 *   pnpm comps                        list sources, and what is in the database
 *   pnpm comps mn-grant-sales         ingest one source
 *   pnpm comps --all                  ingest every enabled source
 *   pnpm comps --enrich-fl Orange     fill parcel facts from the Florida roll
 *   pnpm comps --geocode-fl Marion    put the county's comparables on the map
 */
import { actionableCoverage, comparableCoverage, prisma } from '@land-alpha/db';
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
      const result = await comps.geocodeFromStatewideCentroids(http, { county });
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
    // The registry says which counties have an *automated* sales source. The
    // database says which counties actually have sales. They disagree, and
    // printing both claims side by side without reconciling them produced the
    // same contradiction the source panel used to have: "Requires import:
    // St. Louis, MN" directly above 880 St. Louis sales. Sales reach a county
    // by more than one route, so absence from the registry is not absence of
    // data.
    const inDatabase = await comparableCoverage();
    const present = new Set(inDatabase.map((row) => `${row.county}, ${row.state}`));
    const missing = coverage.needsImport.filter((name) => !present.has(name));
    const viaOtherRoute = coverage.needsImport.filter((name) => present.has(name));

    console.log(`\n  Automated source:    ${coverage.active.join(', ') || 'none'}`);
    console.log(`  No source, no data:  ${missing.join(', ') || 'none'}`);
    if (viaOtherRoute.length > 0) {
      console.log(`  No source, has data: ${viaOtherRoute.join(', ')} (imported another way)`);
    }

    console.log('\nIn the database:\n');
    if (inDatabase.length === 0) {
      console.log('  none — run an import above\n');
      return;
    }
    console.log(
      `  ${'COUNTY'.padEnd(20)} ${'SALES'.padStart(7)} ${'LOCATED'.padStart(8)} ${'NBHD'.padStart(6)}  ${'YEARS'.padEnd(11)} STATUS`,
    );
    for (const row of inDatabase) {
      const years =
        row.earliestSale && row.latestSale
          ? `${row.earliestSale.getFullYear()}–${row.latestSale.getFullYear()}`
          : '—';
      console.log(
        `  ${`${row.county}, ${row.state}`.padEnd(20)} ` +
          `${row.total.toLocaleString().padStart(7)} ` +
          `${`${(row.geocodedShare * 100).toFixed(0)}%`.padStart(8)} ` +
          `${`${(row.neighborhoodShare * 100).toFixed(0)}%`.padStart(6)}  ` +
          `${years.padEnd(11)} ${row.status}`,
      );
    }

    const actionable = actionableCoverage(inDatabase);
    if (actionable.length > 0) {
      console.log('');
      for (const row of actionable) console.log(`  ! ${row.diagnosis}`);
    }
    console.log('');
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
