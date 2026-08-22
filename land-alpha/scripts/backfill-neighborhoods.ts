/**
 * Populate comparable-sale neighbourhood codes from a county's parcel layer.
 *
 *   pnpm tsx scripts/backfill-neighborhoods.ts fl-orange-lands-available
 *
 * Comparable selection prefers sales inside the subject's assessor
 * neighbourhood, which only means anything if both sides were coded by the
 * same office. Taking the code for the sales from the same layer that supplies
 * it for the parcels removes that question entirely — where a county roll also
 * publishes a neighbourhood, the two may or may not correspond, and a silent
 * mismatch looks exactly like a county with no comparable neighbours.
 */
import { prisma } from '@land-alpha/db';
import { registryByKey } from '@land-alpha/source-registry';
import { IngestHttpClient, ArcGisClient } from '@land-alpha/ingestion';
import { parcelIdCandidates } from '@land-alpha/ingestion/adapters/arcgis-tax-sale-points';
import { createLogger } from '@land-alpha/shared/logger';

const logger = createLogger({ component: 'backfill-neighborhoods' });

async function main(): Promise<void> {
  const key = process.argv[2];
  if (!key) throw new Error('Usage: backfill-neighborhoods.ts <source-registry-key>');
  const entry = registryByKey(key);
  if (!entry) throw new Error(`Unknown source ${key}`);
  const layerUrl = (entry.config as { parcelLayerUrl?: string } | undefined)?.parcelLayerUrl;
  if (!layerUrl) throw new Error(`${key} has no parcelLayerUrl configured`);

  const comps = await prisma.comparableSale.findMany({
    where: {
      state: entry.state,
      county: entry.county ?? '',
      apn: { not: null },
      // Fixture comparables are demonstration rows with invented parcel ids.
      // They never match a real county layer, and including them in the probe
      // would understate whichever ordering is right.
      NOT: { apn: { startsWith: 'FIX-' } },
    },
    select: { id: true, apn: true },
  });
  console.log(`${comps.length} comparable sales in ${entry.county}, ${entry.state}`);

  const client = new ArcGisClient(new IngestHttpClient({}));

  // Work out which spelling this county uses before asking for all of them.
  //
  // parcelIdCandidates offers several orderings because counties disagree
  // about where section, township and range go. Firing all of them at a public
  // service multiplies the load to learn something a sample settles — and a
  // county uses one ordering consistently, so probe, then commit to the winner.
  //
  // The probe is one query per ordering, not one per parcel per ordering: the
  // serial version needed ninety throttled round trips and had not finished in
  // four minutes.
  const probes = comps.slice(0, 40);
  const spellingCount = Math.max(
    ...probes.map((comp) => parcelIdCandidates(comp.apn ?? '').length),
    0,
  );

  let winner: { index: number; hits: number } | null = null;
  for (let index = 0; index < spellingCount; index += 1) {
    const spellings = probes
      .map((comp) => parcelIdCandidates(comp.apn ?? '')[index])
      .filter((value): value is string => Boolean(value));
    if (spellings.length === 0) continue;
    try {
      const hits = await client.queryAll(layerUrl, {
        where: `PARCEL IN (${spellings.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`,
        returnGeometry: false,
        maxFeatures: spellings.length * 2,
      });
      console.log(`  spelling #${index}: ${hits.length}/${spellings.length} probes matched`);
      if (!winner || hits.length > winner.hits) winner = { index, hits: hits.length };
      // A clean sweep needs no further probing.
      if (hits.length >= spellings.length) break;
    } catch (error) {
      logger.warn('probe failed', { index, error: String(error).slice(0, 160) });
    }
  }

  if (!winner || winner.hits === 0) {
    console.log('  no parcel-id spelling matched the layer; nothing to backfill');
    return;
  }
  console.log(`  using spelling #${winner.index} for the remaining lookups`);

  const byCandidate = new Map<string, string[]>();
  for (const comp of comps) {
    const spelling = parcelIdCandidates(comp.apn ?? '')[winner.index];
    if (!spelling) continue;
    const list = byCandidate.get(spelling) ?? [];
    list.push(comp.id);
    byCandidate.set(spelling, list);
  }

  const candidates = [...byCandidate.keys()];
  const updates = new Map<string, string>();

  for (let i = 0; i < candidates.length; i += 40) {
    const chunk = candidates.slice(i, i + 40);
    const where = `PARCEL IN (${chunk.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')})`;
    let features: { attributes: Record<string, unknown> }[] = [];
    try {
      features = await client.queryAll(layerUrl, {
        where,
        returnGeometry: false,
        maxFeatures: chunk.length * 2,
      });
    } catch (error) {
      logger.warn('chunk failed', { error: String(error).slice(0, 160) });
      continue;
    }
    for (const feature of features) {
      const parcelId = String(feature.attributes.PARCEL ?? '');
      const code = String(feature.attributes.NBHD_CODE ?? '').trim();
      if (!parcelId || !code) continue;
      for (const compId of byCandidate.get(parcelId) ?? []) updates.set(compId, code);
    }
    console.log(`  ${Math.min(i + 40, candidates.length)}/${candidates.length}`);
  }

  // Grouped by code and written with updateMany: a thousand single-row updates
  // is a thousand round trips, and this script exists to be run per county.
  const byCode = new Map<string, string[]>();
  for (const [id, neighborhood] of updates) {
    const list = byCode.get(neighborhood) ?? [];
    list.push(id);
    byCode.set(neighborhood, list);
  }
  let written = 0;
  for (const [neighborhood, ids] of byCode) {
    const result = await prisma.comparableSale.updateMany({
      where: { id: { in: ids } },
      data: { neighborhood },
    });
    written += result.count;
  }

  const distinct = new Set(updates.values()).size;
  console.log(`\n  coded ${written} of ${comps.length} sales across ${distinct} neighbourhoods`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
