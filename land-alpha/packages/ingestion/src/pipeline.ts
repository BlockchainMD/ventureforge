import {
  errorToRecord,
  AccessRestrictedError,
  type ParcelOpportunityInput,
} from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';
import { getStorage, StorageKeys } from '@land-alpha/shared/storage';
import { normalizeApn, parcelNaturalKey } from '@land-alpha/shared/ids';
import {
  prisma,
  toDecimal,
  recordEvidence,
  recordRunCompletion,
  recordRunStart,
  spatial,
} from '@land-alpha/db';
import type { RegistryEntry } from '@land-alpha/source-registry';
import { getAdapter, type AdapterContext } from './adapter.js';
import { IngestHttpClient } from './fetch/http.js';
import { detectChanges, isPriceReduction, requiresRescore, type ComparableSnapshot } from './change-detection.js';

/**
 * The ingestion pipeline.
 *
 * Runs one source end to end: discover, fetch, parse, normalize, validate,
 * upsert with change detection, mark disappearances, and record a complete
 * accounting of what happened.
 *
 * Two properties are non-negotiable:
 *
 *  1. **Idempotent.** Re-running a source updates rows, never duplicates them.
 *     Identity is the natural key (sourceId + record id or normalised APN).
 *  2. **Honest about partial failure.** A run that parses 4,000 of 4,003 rows
 *     is PARTIAL with three named rejections, not a silent success and not a
 *     thrown-away batch.
 */

export interface IngestionOutcome {
  readonly runId: string;
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  readonly discovered: number;
  readonly created: number;
  readonly changed: number;
  readonly unchanged: number;
  readonly removed: number;
  readonly rejected: number;
  readonly priceReductions: number;
  readonly parcelIdsNeedingEnrichment: string[];
  readonly errors: unknown[];
  readonly warnings: string[];
}

export interface RunSourceOptions {
  readonly triggeredBy?: string;
  readonly signal?: AbortSignal;
  readonly http?: IngestHttpClient;
  /** Skip persisting raw artefacts. Only used by tests. */
  readonly skipArtifacts?: boolean;
}

export async function runSource(
  sourceId: string,
  registryEntry: RegistryEntry,
  options: RunSourceOptions = {},
): Promise<IngestionOutcome> {
  const logger = createLogger({ component: 'ingestion', source: registryEntry.key });
  const adapter = getAdapter(registryEntry.adapterKey);

  if (!adapter) {
    throw new Error(`No adapter registered for key "${registryEntry.adapterKey}"`);
  }

  if (registryEntry.ingestionMethod === 'MANUAL_SOURCE') {
    logger.info('source is manual-only; nothing to automate');
    const runId = await recordRunStart(sourceId, adapter.parserVersion, options.triggeredBy ?? 'scheduler');
    await recordRunCompletion(runId, sourceId, {
      status: 'SKIPPED',
      recordsDiscovered: 0,
      recordsCreated: 0,
      recordsChanged: 0,
      recordsUnchanged: 0,
      recordsRemoved: 0,
      recordsRejected: 0,
      requestCount: 0,
      bytesFetched: 0,
      errors: [],
      warnings: [],
      notes:
        'Registered MANUAL_SOURCE. Inventory is imported by an analyst through the manual import workflow.',
    });
    return emptyOutcome(runId, 'SKIPPED');
  }

  const runId = await recordRunStart(sourceId, adapter.parserVersion, options.triggeredBy ?? 'scheduler');
  const http = options.http ?? new IngestHttpClient({ signal: options.signal });
  const storage = getStorage();

  const errors: unknown[] = [];
  const warnings: string[] = [];
  let discovered = 0;
  let created = 0;
  let changed = 0;
  let unchanged = 0;
  let rejected = 0;
  let priceReductions = 0;
  const seenNaturalKeys = new Set<string>();
  const parcelIdsNeedingEnrichment: string[] = [];

  const ctx: AdapterContext = {
    source: registryEntry,
    sourceId,
    runId,
    http,
    logger,
    signal: options.signal,
    persistArtifact: async (filename, body, meta) => {
      if (options.skipArtifacts) return `memory://${filename}`;
      const key = StorageKeys.rawArtifact(sourceId, runId, filename);
      const stored = await storage.put(key, body, { contentType: meta.contentType ?? undefined });
      await prisma.rawArtifact.create({
        data: {
          sourceId,
          ingestionRunId: runId,
          storageKey: key,
          originalUrl: meta.url ?? null,
          contentType: meta.contentType ?? null,
          byteSize: stored.size,
          sha256: stored.sha256,
        },
      });
      return key;
    },
  };

  try {
    const artifacts = await adapter.discover(ctx);
    logger.info('discovered artifacts', { count: artifacts.length });

    for (const artifact of artifacts) {
      if (options.signal?.aborted) break;
      try {
        const batch = await adapter.fetchAndParse(ctx, artifact);
        const normalized = await adapter.normalize(ctx, batch);

        warnings.push(...batch.warnings, ...normalized.warnings);
        rejected += normalized.rejected.length;
        discovered += batch.records.length;

        for (const item of normalized.items) {
          if (options.signal?.aborted) break;
          const result = await upsertParcel(item, registryEntry, runId);
          seenNaturalKeys.add(result.naturalKey);
          if (result.outcome === 'created') {
            created += 1;
            parcelIdsNeedingEnrichment.push(result.parcelId);
          } else if (result.outcome === 'changed') {
            changed += 1;
            if (result.priceReduced) priceReductions += 1;
            if (result.needsRescore) parcelIdsNeedingEnrichment.push(result.parcelId);
          } else {
            unchanged += 1;
          }
        }
      } catch (error) {
        if (error instanceof AccessRestrictedError) {
          // Never retried, never worked around: the source is taken out of
          // automated ingestion and handed to the manual workflow.
          logger.warn('source is access-restricted; switching to manual', {
            restriction: error.restriction,
          });
          await prisma.source.update({
            where: { id: sourceId },
            data: {
              sourceStatus: 'MANUAL_ONLY',
              enabled: false,
              notes: `Automated ingestion disabled ${new Date().toISOString()}: ${error.message}`,
            },
          });
        }
        errors.push(errorToRecord(error));
        logger.error('artifact failed', { artifact: artifact.label, error: String(error) });
      }
    }

    const removed = await markDisappeared(sourceId, seenNaturalKeys, runId, discovered > 0);

    const status: IngestionOutcome['status'] =
      errors.length > 0 && discovered === 0
        ? 'FAILED'
        : errors.length > 0 || rejected > 0 || warnings.length > 0
          ? 'PARTIAL'
          : 'SUCCEEDED';

    await recordRunCompletion(runId, sourceId, {
      status,
      recordsDiscovered: discovered,
      recordsCreated: created,
      recordsChanged: changed,
      recordsUnchanged: unchanged,
      recordsRemoved: removed,
      recordsRejected: rejected,
      requestCount: http.stats.requestCount,
      bytesFetched: http.stats.bytesFetched,
      errors,
      warnings,
    });

    logger.info('ingestion complete', { status, discovered, created, changed, removed, rejected });

    return {
      runId,
      status,
      discovered,
      created,
      changed,
      unchanged,
      removed,
      rejected,
      priceReductions,
      parcelIdsNeedingEnrichment,
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(errorToRecord(error));
    await recordRunCompletion(runId, sourceId, {
      status: 'FAILED',
      recordsDiscovered: discovered,
      recordsCreated: created,
      recordsChanged: changed,
      recordsUnchanged: unchanged,
      recordsRemoved: 0,
      recordsRejected: rejected,
      requestCount: http.stats.requestCount,
      bytesFetched: http.stats.bytesFetched,
      errors,
      warnings,
    });
    throw error;
  }
}

interface UpsertResult {
  readonly parcelId: string;
  readonly naturalKey: string;
  readonly outcome: 'created' | 'changed' | 'unchanged';
  readonly priceReduced: boolean;
  readonly needsRescore: boolean;
}

async function upsertParcel(
  item: ParcelOpportunityInput,
  registryEntry: RegistryEntry,
  runId: string,
): Promise<UpsertResult> {
  const naturalKey = parcelNaturalKey({
    sourceId: item.sourceId,
    sourceRecordId: item.sourceRecordId,
    apn: item.apn,
  });

  const jurisdiction = await resolveJurisdiction(registryEntry);
  const existing = await prisma.parcelOpportunity.findUnique({
    where: { naturalKey },
    select: {
      id: true,
      minimumBid: true,
      askingPrice: true,
      auctionDate: true,
      offerDeadline: true,
      saleStatus: true,
      acreage: true,
      taxesDue: true,
      legalDescription: true,
      currentOwner: true,
      failedSaleCount: true,
      removedFromSourceAt: true,
    },
  });

  const scalarData = {
    state: item.state,
    county: item.county,
    jurisdictionId: jurisdiction.id,
    apn: item.apn ?? null,
    apnNormalized: item.apn ? normalizeApn(item.apn) : null,
    alternateApns: [...(item.alternateApns ?? [])],
    sourceId: item.sourceId,
    sourceUrl: item.sourceUrl ?? null,
    sourceRecordId: item.sourceRecordId ?? null,

    saleType: item.saleType ?? 'UNKNOWN',
    saleStatus: item.saleStatus ?? 'UNKNOWN',
    auctionDate: item.auctionDate ?? null,
    offerDeadline: item.offerDeadline ?? null,
    minimumBid: toDecimal(item.minimumBid ?? null),
    askingPrice: toDecimal(item.askingPrice ?? null),
    taxesDue: toDecimal(item.taxesDue ?? null),
    fees: toDecimal(item.fees ?? null),
    priorAuctionStatus: item.priorAuctionStatus ?? null,
    priorAuctionDate: item.priorAuctionDate ?? null,
    priorMinimumBid: toDecimal(item.priorMinimumBid ?? null),
    otcEligible: item.otcEligible ?? null,
    acquisitionInstructions: item.acquisitionInstructions ?? null,

    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null,
    acreage: item.acreage ?? null,
    lotSquareFeet: item.lotSquareFeet ?? null,
    municipality: item.municipality ?? null,
    zip: item.zip ?? null,
    situsAddress: item.situsAddress ?? null,
    legalDescription: item.legalDescription ?? null,

    assessedValue: toDecimal(item.assessedValue ?? null),
    taxableValue: toDecimal(item.taxableValue ?? null),
    landAssessedValue: toDecimal(item.landAssessedValue ?? null),
    improvementAssessedValue: toDecimal(item.improvementAssessedValue ?? null),
    propertyClass: item.propertyClass ?? null,
    isVacant: item.isVacant ?? null,
    currentUse: item.currentUse ?? null,
    zoning: item.zoning ?? null,
    zoningSource: item.zoningSource ?? null,
    zoningConfidence: item.zoning ? ('HIGH' as const) : ('UNKNOWN' as const),
    annualTaxEstimate: toDecimal(item.annualTaxEstimate ?? null),

    currentOwner: item.currentOwner ?? null,
    ownerType: item.ownerType ?? 'UNKNOWN',
    governmentOwner: item.governmentOwner ?? null,
    priorOwner: item.priorOwner ?? null,
    lastDeedDate: item.lastDeedDate ?? null,

    lastSeenAt: new Date(),
    removedFromSourceAt: null,
  };

  if (!existing) {
    const createdParcel = await prisma.parcelOpportunity.create({
      data: {
        ...scalarData,
        naturalKey,
        failedSaleCount: item.failedSaleCount ?? 0,
        status: 'DISCOVERED',
      },
      select: { id: true },
    });

    await persistGeometry(createdParcel.id, item);
    await recordEvidence(createdParcel.id, item.evidence ?? []);
    await prisma.parcelChange.create({
      data: { parcelId: createdParcel.id, ingestionRunId: runId, kind: 'CREATED' },
    });

    return {
      parcelId: createdParcel.id,
      naturalKey,
      outcome: 'created',
      priceReduced: false,
      needsRescore: true,
    };
  }

  const before: ComparableSnapshot = {
    minimumBid: existing.minimumBid == null ? null : Number(existing.minimumBid),
    askingPrice: existing.askingPrice == null ? null : Number(existing.askingPrice),
    auctionDate: existing.auctionDate,
    offerDeadline: existing.offerDeadline,
    saleStatus: existing.saleStatus,
    acreage: existing.acreage,
    taxesDue: existing.taxesDue == null ? null : Number(existing.taxesDue),
    legalDescription: existing.legalDescription,
    currentOwner: existing.currentOwner,
  };
  const after: ComparableSnapshot = {
    minimumBid: item.minimumBid == null ? null : item.minimumBid / 100,
    askingPrice: item.askingPrice == null ? null : item.askingPrice / 100,
    auctionDate: item.auctionDate ?? null,
    offerDeadline: item.offerDeadline ?? null,
    saleStatus: item.saleStatus ?? 'UNKNOWN',
    acreage: item.acreage ?? null,
    taxesDue: item.taxesDue == null ? null : item.taxesDue / 100,
    legalDescription: item.legalDescription ?? null,
    currentOwner: item.currentOwner ?? null,
  };

  const changes = detectChanges(before, after);
  const reappeared = existing.removedFromSourceAt != null;

  // A parcel that vanished and came back has, in practice, been through
  // another disposal cycle. That is exactly the pattern worth counting.
  const failedSaleCount = reappeared
    ? existing.failedSaleCount + 1
    : Math.max(existing.failedSaleCount, item.failedSaleCount ?? 0);

  await prisma.parcelOpportunity.update({
    where: { id: existing.id },
    data: { ...scalarData, failedSaleCount },
  });

  if (item.geometry || (item.latitude != null && item.longitude != null)) {
    await persistGeometry(existing.id, item);
  }
  await recordEvidence(existing.id, item.evidence ?? []);

  const allChanges = reappeared
    ? [{ kind: 'REAPPEARED' as const, field: null, oldValue: null, newValue: null }, ...changes]
    : changes;

  if (allChanges.length > 0) {
    await prisma.parcelChange.createMany({
      data: allChanges.map((change) => ({
        parcelId: existing.id,
        ingestionRunId: runId,
        kind: change.kind,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
      })),
    });
  }

  return {
    parcelId: existing.id,
    naturalKey,
    outcome: allChanges.length > 0 ? 'changed' : 'unchanged',
    priceReduced: isPriceReduction(changes),
    needsRescore: reappeared || requiresRescore(changes),
  };
}

async function persistGeometry(parcelId: string, item: ParcelOpportunityInput): Promise<void> {
  try {
    if (item.geometry) {
      const measurements = await spatial.writeParcelGeometry(parcelId, item.geometry);
      await prisma.parcelOpportunity.update({
        where: { id: parcelId },
        data: {
          geometrySource: 'County parcel layer',
          geometryConfidence: 'VERIFIED',
          bboxWest: measurements.bbox[0],
          bboxSouth: measurements.bbox[1],
          bboxEast: measurements.bbox[2],
          bboxNorth: measurements.bbox[3],
          perimeterMeters: measurements.perimeterMeters,
          latitude: measurements.centroid[1],
          longitude: measurements.centroid[0],
        },
      });
    } else if (item.latitude != null && item.longitude != null) {
      await spatial.writeParcelPoint(parcelId, [item.longitude, item.latitude]);
      await prisma.parcelOpportunity.update({
        where: { id: parcelId },
        data: { geometrySource: 'Source point location', geometryConfidence: 'MEDIUM' },
      });
    }
  } catch (error) {
    // A geometry failure must degrade the parcel, not abort the county.
    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: { geometryConfidence: 'UNKNOWN', geometrySource: `Failed to store: ${String(error)}` },
    });
  }
}

/**
 * Mark parcels that were present last run and are absent now.
 *
 * Guarded: if this run discovered nothing at all, the absence is far more
 * likely to be our failure than the county selling out overnight, so nothing is
 * marked removed. Getting this wrong would wipe an entire county's inventory on
 * a single bad fetch.
 */
async function markDisappeared(
  sourceId: string,
  seenNaturalKeys: Set<string>,
  runId: string,
  discoveredAnything: boolean,
): Promise<number> {
  if (!discoveredAnything || seenNaturalKeys.size === 0) return 0;

  const stale = await prisma.parcelOpportunity.findMany({
    where: {
      sourceId,
      removedFromSourceAt: null,
      naturalKey: { notIn: [...seenNaturalKeys] },
    },
    select: { id: true },
  });
  if (stale.length === 0) return 0;

  const now = new Date();
  await prisma.parcelOpportunity.updateMany({
    where: { id: { in: stale.map((row) => row.id) } },
    data: { removedFromSourceAt: now, saleStatus: 'UNKNOWN' },
  });
  await prisma.parcelChange.createMany({
    data: stale.map((row) => ({
      parcelId: row.id,
      ingestionRunId: runId,
      kind: 'REMOVED_FROM_SOURCE' as const,
      newValue: now.toISOString(),
    })),
  });
  return stale.length;
}

async function resolveJurisdiction(entry: RegistryEntry): Promise<{ id: string }> {
  const existing = await prisma.jurisdiction.findFirst({
    where: {
      state: entry.state,
      county: entry.county,
      municipality: entry.municipality,
    },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.jurisdiction.create({
    data: {
      state: entry.state,
      county: entry.county,
      municipality: entry.municipality,
      fipsCode: entry.fipsCode,
      timezone: entry.timezone,
      type: entry.municipality ? 'MUNICIPALITY' : entry.county ? 'COUNTY' : 'STATE',
      officialUrl: entry.officialUrl,
      assessorUrl: entry.assessorUrl,
      recorderUrl: entry.recorderUrl,
      gisUrl: entry.gisUrl,
      taxSaleUrl: entry.taxSaleUrl,
      dispositionNotes: entry.dispositionNotes,
    },
    select: { id: true },
  });
}

function emptyOutcome(runId: string, status: IngestionOutcome['status']): IngestionOutcome {
  return {
    runId,
    status,
    discovered: 0,
    created: 0,
    changed: 0,
    unchanged: 0,
    removed: 0,
    rejected: 0,
    priceReductions: 0,
    parcelIdsNeedingEnrichment: [],
    errors: [],
    warnings: [],
  };
}
