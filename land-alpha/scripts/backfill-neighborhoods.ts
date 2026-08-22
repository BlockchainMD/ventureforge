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
    where: { state: entry.state, county: entry.county ?? '', apn: { not: null } },
    select: { id: true, apn: true },
  });
  console.log(`${comps.length} comparable sales in ${entry.county}, ${entry.state}`);

  // One candidate spelling per comp, matching how the adapter joins: the roll
  // and the parcel layer order section, township and range differently.
  const byCandidate = new Map<string, string[]>();
  for (const comp of comps) {
    for (const candidate of parcelIdCandidates(comp.apn ?? '')) {
      const list = byCandidate.get(candidate) ?? [];
      list.push(comp.id);
      byCandidate.set(candidate, list);
    }
  }

  const client = new ArcGisClient(new IngestHttpClient({}));
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
    if (i % 400 === 0) console.log(`  ${i}/${candidates.length}`);
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
