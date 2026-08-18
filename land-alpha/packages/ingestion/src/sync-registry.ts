import { prisma } from '@land-alpha/db';
import { SOURCE_REGISTRY, type RegistryEntry } from '@land-alpha/source-registry';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * Sync the code-defined registry into the `Source` table.
 *
 * The registry is the source of truth for *what exists*; the database is the
 * source of truth for *operational state* (health, last run, failures, and any
 * human approval). Sync therefore writes definitions and never clobbers
 * operational fields — in particular it will not silently re-enable a source an
 * operator disabled, and it will not reset a source that was switched to
 * MANUAL_ONLY after hitting an access control.
 */

const logger = createLogger({ component: 'registry-sync' });

export interface SyncResult {
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

export async function syncRegistry(entries: RegistryEntry[] = SOURCE_REGISTRY): Promise<SyncResult> {
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of entries) {
    const jurisdiction = await upsertJurisdiction(entry);
    const existing = await prisma.source.findUnique({
      where: { registryKey: entry.key },
      select: { id: true, sourceStatus: true, enabled: true, parserVersion: true },
    });

    const definition = {
      jurisdictionId: jurisdiction.id,
      name: entry.name,
      sourceType: entry.sourceType,
      sourceUrl: entry.sourceUrl,
      discoveryUrl: entry.discoveryUrl,
      ingestionMethod: entry.ingestionMethod,
      updateFrequency: entry.updateFrequency,
      inventoryFormat: entry.inventoryFormat,
      failedAuctionBecomesOtc: entry.failedAuctionBecomesOtc,
      acquisitionMethod: entry.acquisitionMethod,
      adapterKey: entry.adapterKey,
      parserVersion: entry.parserVersion,
      attribution: entry.attribution,
      termsUrl: entry.termsUrl,
      notes: entry.notes,
    };

    if (!existing) {
      await prisma.source.create({
        data: {
          ...definition,
          registryKey: entry.key,
          sourceStatus: entry.status,
          enabled: entry.enabled,
        },
      });
      created += 1;
      continue;
    }

    // Operator decisions win over the registry file.
    const operatorDisabled = !existing.enabled && entry.enabled;
    const operatorMarkedManual =
      existing.sourceStatus === 'MANUAL_ONLY' && entry.status !== 'MANUAL_ONLY';

    await prisma.source.update({
      where: { id: existing.id },
      data: {
        ...definition,
        ...(operatorMarkedManual ? {} : { sourceStatus: entry.status }),
        ...(operatorDisabled ? {} : { enabled: entry.enabled }),
      },
    });

    if (operatorDisabled || operatorMarkedManual) {
      logger.info('preserved operator state for source', {
        key: entry.key,
        operatorDisabled,
        operatorMarkedManual,
      });
    }
    updated += 1;
  }

  logger.info('registry synced', { created, updated, unchanged, total: entries.length });
  return { created, updated, unchanged };
}

function jurisdictionType(entry: RegistryEntry): 'MUNICIPALITY' | 'COUNTY' | 'STATE' {
  if (entry.municipality) return 'MUNICIPALITY';
  return entry.county ? 'COUNTY' : 'STATE';
}

async function upsertJurisdiction(entry: RegistryEntry): Promise<{ id: string }> {
  const existing = await prisma.jurisdiction.findFirst({
    where: { state: entry.state, county: entry.county, municipality: entry.municipality },
    select: { id: true },
  });

  const data = {
    fipsCode: entry.fipsCode,
    timezone: entry.timezone,
    type: jurisdictionType(entry),
    officialUrl: entry.officialUrl,
    assessorUrl: entry.assessorUrl,
    recorderUrl: entry.recorderUrl,
    gisUrl: entry.gisUrl,
    taxSaleUrl: entry.taxSaleUrl,
    dispositionNotes: entry.dispositionNotes,
  };

  if (existing) {
    return prisma.jurisdiction.update({
      where: { id: existing.id },
      data,
      select: { id: true },
    });
  }
  return prisma.jurisdiction.create({
    data: {
      state: entry.state,
      county: entry.county,
      municipality: entry.municipality,
      ...data,
    },
    select: { id: true },
  });
}

/** Resolve a DB source row back to its registry definition. */
export async function resolveSource(
  sourceId: string,
): Promise<{ sourceId: string; entry: RegistryEntry } | null> {
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, registryKey: true },
  });
  if (!source) return null;
  const entry = SOURCE_REGISTRY.find((candidate) => candidate.key === source.registryKey);
  if (!entry) return null;
  return { sourceId: source.id, entry };
}
