import { prisma, toDecimal } from '@land-alpha/db';
import { createLogger } from '@land-alpha/shared/logger';
import { IngestHttpClient } from '../fetch/http';
import { fetchAssessorSales } from './arcgis-assessor-sales';
import { fetchFloridaRollSales } from './fl-dor';
import { compsSourceByKey, COMPS_REGISTRY } from './registry';
import { validateComparables, type ComparableSaleInput, type CompsImportResult } from './types';

/**
 * Comparable-sales ingestion pipeline.
 *
 * Idempotent on the natural key the ComparableSale table already enforces —
 * (state, county, apn, saleDate, salePrice) — so re-running a county updates
 * rather than duplicating, and a duplicated sale cannot quietly double its own
 * weight in a valuation.
 */

const logger = createLogger({ component: 'comps-pipeline' });

/**
 * Adapters that can run unattended, keyed as the registry names them.
 *
 * A source whose adapter is absent here is one we have deliberately not
 * automated — token-gated, CAPTCHA-protected, or publishing nothing usable —
 * and asking for it returns the reason rather than an empty result.
 */
const COMPS_ADAPTERS: Record<
  string,
  (
    source: ReturnType<typeof compsSourceByKey> & object,
    http: IngestHttpClient,
    options: { signal?: AbortSignal },
  ) => Promise<{ rows: ComparableSaleInput[]; warnings: string[] }>
> = {
  'arcgis-assessor-sales': fetchAssessorSales,
  'fl-dor-roll': fetchFloridaRollSales,
};

export async function ingestComparableSales(
  sourceKey: string,
  options: { signal?: AbortSignal; http?: IngestHttpClient; limit?: number } = {},
): Promise<CompsImportResult> {
  const source = compsSourceByKey(sourceKey);
  if (!source) throw new Error(`Unknown comparable-sales source: ${sourceKey}`);

  const adapter = COMPS_ADAPTERS[source.adapterKey];
  if (!adapter) {
    return {
      discovered: 0,
      accepted: 0,
      rejected: [],
      warnings: [
        `${source.name} is registered ${source.status} and is not fetched automatically. ${source.notes ?? ''}`.trim(),
      ],
    };
  }

  const http = options.http ?? new IngestHttpClient({ signal: options.signal });
  // `limit` means the same thing to an analyst whichever adapter runs, but the
  // adapters bound different things: an ArcGIS layer is capped on features
  // fetched, a bulk roll on comparables kept.
  const effective = options.limit
    ? {
        ...source,
        config: { ...source.config, maxFeatures: options.limit, maxComparables: options.limit },
      }
    : source;

  const { rows, warnings } = await adapter(effective, http, { signal: options.signal });
  const { accepted, rejected } = validateComparables(rows);

  const written = await persistComparables(accepted);

  logger.info('comparable sales ingested', {
    source: sourceKey,
    discovered: rows.length,
    accepted: accepted.length,
    written,
    rejected: rejected.reduce((sum, entry) => sum + entry.count, 0),
  });

  return { discovered: rows.length, accepted: written, rejected, warnings };
}

export async function persistComparables(rows: readonly ComparableSaleInput[]): Promise<number> {
  if (rows.length === 0) return 0;

  // createMany with skipDuplicates relies on the (state, county, apn, saleDate,
  // salePrice) unique constraint, which is exactly the identity of a sale.
  const result = await prisma.comparableSale.createMany({
    data: rows.map((row) => ({
      state: row.state,
      county: row.county,
      apn: row.apn,
      saleDate: row.saleDate,
      salePrice: toDecimal(row.salePriceCents)!,
      acreage: row.acreage,
      latitude: row.latitude,
      longitude: row.longitude,
      zoning: row.zoning,
      landUse: row.landUse,
      neighborhood: row.neighborhood ?? null,
      hasUtilities: row.hasUtilities,
      isVacantLand: row.isVacantLand,
      isArmsLength: row.isArmsLength,
      deedType: row.deedType,
      source: row.source,
      sourceUrl: row.sourceUrl,
    })),
    skipDuplicates: true,
  });

  // Populate the PostGIS centroid so the spatial comp search can use its index.
  await prisma.$executeRaw`
    UPDATE "ComparableSale"
    SET "centroid" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
    WHERE "centroid" IS NULL AND "longitude" IS NOT NULL AND "latitude" IS NOT NULL
  `;

  return result.count;
}

/** Ingest every enabled comparable-sales source. */
export async function ingestAllComparableSales(
  options: { signal?: AbortSignal } = {},
): Promise<Record<string, CompsImportResult>> {
  const results: Record<string, CompsImportResult> = {};
  for (const source of COMPS_REGISTRY.filter((entry) => entry.enabled)) {
    if (options.signal?.aborted) break;
    results[source.key] = await ingestComparableSales(source.key, options);
  }
  return results;
}
