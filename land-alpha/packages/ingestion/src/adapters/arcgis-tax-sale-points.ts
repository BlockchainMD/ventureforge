import {
  clampToExtractionMethod,
  dollarsToCents,
  type EvidenceInput,
  type ParcelOpportunityInput,
  type SaleStatus,
  type SaleType,
} from '@land-alpha/shared';
import { normalizeParcelGeometry, centroidOf } from '@land-alpha/gis';
import { ArcGisClient, arcgisLiteral } from '../fetch/arcgis';
import {
  validateNormalized,
  type AdapterContext,
  type DiscoveredArtifact,
  type NormalizedBatch,
  type ParsedBatch,
  type SourceAdapter,
} from '../adapter';

/**
 * Adapter for a tax-sale point layer — Florida's statutory "Lands Available for
 * Taxes" list as published by a county clerk or comptroller.
 *
 * This is the sparse-source path, and it is worth having precisely because it
 * is sparse. The layer carries a tax deed application number, a sale date, a
 * status and a parcel ID, and nothing else: no acreage, no value, no legal
 * description. A less careful pipeline would fill those gaps with plausible
 * defaults; this one carries them as unknown, lets the valuation engine decline
 * to produce a number, and lets the confidence model mark the parcel down.
 *
 * The distinction that matters commercially is encoded here too: only records
 * whose status is the configured "Lands Available" value can actually be bought
 * on demand. Scheduled auction records are ingested as well, because knowing a
 * parcel is *about* to fail its auction is itself the signal — but they are
 * marked SCHEDULED, not AVAILABLE.
 */

interface FieldMap {
  sourceRecordId: string;
  apn: string;
  saleDate: string;
  deedStatus: string;
  minimumBid?: string;
  acreage?: string;
  legalDescription?: string;
}

interface AdapterConfig {
  layerUrl: string;
  parcelLayerUrl?: string;
  fieldMap: FieldMap;
  landsAvailableStatus: string;
  acquisitionInstructions?: string;
  /** Attempt to enrich each record from the county parcel layer. */
  enrichFromParcelLayer?: boolean;
  maxFeatures?: number;
}

export const arcgisTaxSalePointsAdapter: SourceAdapter = {
  key: 'arcgis-tax-sale-points',
  description: 'County tax deed / Lands Available inventory published as an ArcGIS point layer.',
  parserVersion: '1',

  async discover(ctx: AdapterContext): Promise<DiscoveredArtifact[]> {
    const config = readConfig(ctx);
    return [
      {
        url: config.layerUrl,
        kind: 'ARCGIS_LAYER',
        label: `${ctx.source.name} tax sale layer`,
      },
    ];
  },

  async fetchAndParse(ctx: AdapterContext, artifact: DiscoveredArtifact): Promise<ParsedBatch> {
    const config = readConfig(ctx);
    const client = new ArcGisClient(ctx.http);
    const warnings: string[] = [];

    const records: Record<string, unknown>[] = [];
    for await (const feature of client.query(config.layerUrl, {
      where: '1=1',
      returnGeometry: true,
      maxFeatures: config.maxFeatures ?? 5000,
    })) {
      records.push({ ...feature.attributes, __point: feature.point });
    }

    // Best-effort enrichment, batched.
    //
    // The naive form is one lookup per record per candidate ID format, which
    // for a 55-record county is ~220 rate-limited requests against a public
    // server for information that fits in two. Candidates are collected first
    // and resolved with `IN` queries instead.
    //
    // Where the two layers' parcel-ID formats genuinely do not reconcile, the
    // record stays thin rather than being joined to the wrong parcel: a wrong
    // join silently attributes another property's acreage and value to this
    // one, which is far worse than a gap.
    if (config.parcelLayerUrl && config.enrichFromParcelLayer !== false) {
      const candidatesByRecord = new Map<Record<string, unknown>, string[]>();
      const allCandidates = new Set<string>();
      for (const record of records) {
        const apn = str(record[config.fieldMap.apn]);
        if (!apn) continue;
        const candidates = parcelIdCandidates(apn);
        candidatesByRecord.set(record, candidates);
        for (const candidate of candidates) allCandidates.add(candidate);
      }

      const resolved = await batchLookupParcels(
        client,
        config.parcelLayerUrl,
        [...allCandidates],
        ctx.signal,
      );

      let enriched = 0;
      for (const [record, candidates] of candidatesByRecord) {
        for (const candidate of candidates) {
          const attributes = resolved.get(candidate);
          if (attributes) {
            record.__parcel = attributes;
            enriched += 1;
            break;
          }
        }
      }
      if (enriched < records.length) {
        warnings.push(
          `Parcel-layer enrichment matched ${enriched} of ${records.length} records; the remainder carry unknown acreage and value rather than an assumed one.`,
        );
      }
    }

    const artifactKey = await ctx.persistArtifact(
      `${ctx.source.key}-tax-sale.json`,
      Buffer.from(JSON.stringify({ count: records.length, records }), 'utf8'),
      { url: artifact.url, contentType: 'application/json' },
    );

    return { records, artifactKey, sourceUrl: artifact.url, warnings };
  },

  async normalize(ctx: AdapterContext, batch: ParsedBatch): Promise<NormalizedBatch> {
    const config = readConfig(ctx);
    const map = config.fieldMap;
    const retrievedAt = new Date();
    const items: ParcelOpportunityInput[] = [];
    const warnings: string[] = [];

    for (const record of batch.records) {
      const apn = str(record[map.apn]);
      const status = str(record[map.deedStatus]);
      const saleDate = parseDate(record[map.saleDate]);
      const parcel = (record.__parcel as Record<string, unknown> | undefined) ?? undefined;

      const isLandsAvailable =
        status != null && status.toLowerCase() === config.landsAvailableStatus.toLowerCase();

      const saleStatus: SaleStatus = isLandsAvailable
        ? 'AVAILABLE'
        : saleDate && saleDate.getTime() > Date.now()
          ? 'SCHEDULED'
          : 'UNKNOWN';
      const saleType: SaleType = isLandsAvailable ? 'OVER_THE_COUNTER' : 'AUCTION';

      const evidence: EvidenceInput[] = [
        {
          field: 'saleStatus',
          value: status ?? 'unknown',
          source: ctx.source.name,
          sourceUrl: batch.sourceUrl,
          documentKey: batch.artifactKey,
          extractedText: `Deed status as published: "${status ?? ''}"`,
          retrievedAt,
          confidence: clampToExtractionMethod('VERIFIED', 'ARCGIS_QUERY'),
          extractionMethod: 'ARCGIS_QUERY',
          notes: isLandsAvailable
            ? 'On the statutory List of Lands Available for Taxes: purchasable on demand for the opening bid plus accrued costs.'
            : 'Scheduled tax deed sale; not yet available for over-the-counter purchase.',
        },
      ];

      if (saleDate) {
        evidence.push({
          field: isLandsAvailable ? 'priorAuctionDate' : 'auctionDate',
          value: saleDate.toISOString(),
          source: ctx.source.name,
          sourceUrl: batch.sourceUrl,
          documentKey: batch.artifactKey,
          extractedText: null,
          retrievedAt,
          confidence: 'HIGH',
          extractionMethod: 'ARCGIS_QUERY',
          notes: null,
        });
      }

      const point = record.__point as [number, number] | null;
      const acreage = parcel ? num(parcel[map.acreage ?? 'ACREAGE']) : null;

      const rawGeometry = parcel?.__geometry;
      const { geometry, reason } = rawGeometry
        ? normalizeParcelGeometry(rawGeometry)
        : { geometry: null, reason: null };
      if (reason) warnings.push(`${apn ?? 'unknown parcel'}: ${reason}`);
      // The dot the tax-sale layer publishes is a label position, not a
      // centroid. Where a boundary exists it decides where the parcel is.
      const centroid = geometry ? centroidOf(geometry) : point;

      items.push({
        sourceId: ctx.sourceId,
        sourceRecordId: str(record[map.sourceRecordId]),
        sourceUrl: ctx.source.discoveryUrl ?? ctx.source.sourceUrl,
        state: ctx.source.state,
        county: ctx.source.county ?? '',
        apn,

        saleType,
        saleStatus,
        // A Lands Available parcel already failed its auction — that is the
        // statutory definition of how it got on the list.
        failedSaleCount: isLandsAvailable ? 1 : 0,
        otcEligible: isLandsAvailable,
        auctionDate: isLandsAvailable ? null : saleDate,
        priorAuctionDate: isLandsAvailable ? saleDate : null,
        priorAuctionStatus: isLandsAvailable ? 'No bid received; placed on Lands Available' : null,
        acquisitionInstructions: config.acquisitionInstructions ?? null,

        latitude: centroid ? centroid[1] : null,
        longitude: centroid ? centroid[0] : null,
        geometry,
        acreage,
        legalDescription: parcel ? str(parcel[map.legalDescription ?? 'LEGAL']) : null,
        situsAddress: parcel ? str(parcel.SITUS) : null,
        zip: parcel ? str(parcel.SITUS_ZIP) : null,

        landAssessedValue: parcel ? centsFrom(parcel.LAND_MKT) : null,
        assessedValue: parcel ? centsFrom(parcel.TOTAL_MKT) : null,
        annualTaxEstimate: parcel ? centsFrom(parcel.TAXES) : null,
        zoning: parcel ? str(parcel.ZONING_CODE) : null,
        // The assessor's own neighbourhood. Comparable selection prefers sales
        // inside it, because it is the boundary the county drew around land it
        // considers to trade alike.
        neighborhood: parcel ? str(parcel.NBHD_CODE) : null,
        zoningSource: parcel ? 'County property appraiser parcel layer' : null,

        ownerType: 'COUNTY',
        governmentOwner: `${ctx.source.county} County (${isLandsAvailable ? 'Lands Available for Taxes' : 'tax deed sale'})`,

        evidence,
        rawRecord: stripInternal(record),
        rawArtifactKey: batch.artifactKey,
      });
    }

    const validated = validateNormalized(items);
    return { items: validated.items, rejected: validated.rejected, warnings };
  },
};

/**
 * Candidate parcel-ID spellings for a county layer.
 *
 * County parcel layers store the same ID with and without punctuation and
 * sometimes with the section/township/range components in a different order.
 */
export function parcelIdCandidates(apn: string): string[] {
  const bare = apn.replace(/[^A-Za-z0-9]/g, '');
  const candidates = [apn, bare];
  const parts = apn.split('-');
  if (parts.length >= 3) {
    const tail = parts.slice(3);
    // section-township-range -> range-township-section
    candidates.push([parts[2], parts[1], parts[0], ...tail].join(''));
    // section-township-range -> township-range-section
    candidates.push([parts[1], parts[2], parts[0], ...tail].join(''));
  } else if (/^\d{15}$/.test(bare)) {
    // The same reorderings, for an ID that arrives without punctuation.
    //
    // Florida's tax roll publishes parcel IDs as a bare fifteen digits and the
    // county parcel layer stores the first three pairs in the opposite order.
    // Only the hyphenated form was ever reversed, so 655 Orange comparables
    // silently matched nothing: 032229262817070 is 292203262817070 in the
    // layer, and without this branch the two never meet.
    const sec = bare.slice(0, 2);
    const twp = bare.slice(2, 4);
    const rng = bare.slice(4, 6);
    const tail = bare.slice(6);
    candidates.push(`${rng}${twp}${sec}${tail}`);
    candidates.push(`${twp}${rng}${sec}${tail}`);
  }
  return [
    ...new Set(candidates.map((value) => value.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean)),
  ];
}

/**
 * Resolve many parcel IDs in as few requests as possible.
 *
 * Only unambiguous single matches are kept: if one candidate ID resolves to
 * more than one parcel, none of them is used.
 */
async function batchLookupParcels(
  client: ArcGisClient,
  parcelLayerUrl: string,
  candidates: string[],
  signal?: AbortSignal,
): Promise<Map<string, Record<string, unknown>>> {
  const resolved = new Map<string, Record<string, unknown>>();
  const ambiguous = new Set<string>();

  // Chunk by URL length, not by record count. ArcGIS queries are sent as GET,
  // and servers reject an over-long query string with a bare 404 that looks
  // exactly like a missing layer — so the budget is enforced here rather than
  // discovered in production.
  const WHERE_BUDGET_CHARS = 1400;

  for (const chunk of chunkByLength(candidates, WHERE_BUDGET_CHARS)) {
    if (signal?.aborted) break;
    const literals = chunk.map((value) => arcgisLiteral(value)).join(', ');
    try {
      const features = await client.queryAll(parcelLayerUrl, {
        where: `PARCEL IN (${literals})`,
        // The polygon is the point of this lookup, not a bonus. A tax-sale
        // layer publishes a dot; without a boundary there is no frontage to
        // measure, no shape to judge and no buildable area to speak of, so
        // every parcel from such a source scores UNKNOWN on a fifth of the
        // Alpha Score for want of an outline the county publishes for free.
        returnGeometry: true,
        maxFeatures: chunk.length * 3,
      });
      for (const feature of features) {
        const key = str(feature.attributes.PARCEL);
        if (!key) continue;
        if (resolved.has(key)) {
          ambiguous.add(key);
          continue;
        }
        resolved.set(key, { ...feature.attributes, __geometry: feature.geometry });
      }
    } catch {
      // Enrichment is best-effort: a failure here must never fail the run.
      break;
    }
  }

  for (const key of ambiguous) resolved.delete(key);
  return resolved;
}

/** Group values so each group's quoted, comma-joined form stays under `budget`. */
export function chunkByLength(values: readonly string[], budget: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const value of values) {
    const cost = value.length + 4; // quotes, comma, space
    if (current.length > 0 && length + cost > budget) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(value);
    length += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// --- helpers ---------------------------------------------------------------

function readConfig(ctx: AdapterContext): AdapterConfig {
  const config = ctx.source.config as unknown as AdapterConfig;
  if (!config?.layerUrl || !config.fieldMap || !config.landsAvailableStatus) {
    throw new Error(
      `Source ${ctx.source.key} needs config.layerUrl, config.fieldMap and config.landsAvailableStatus`,
    );
  }
  return config;
}

function str(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text === '' || text.toUpperCase() === 'NULL' ? null : text;
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function centsFrom(value: unknown): number | null {
  const dollars = num(value);
  return dollars == null || dollars <= 0 ? null : dollarsToCents(dollars);
}

/**
 * Parse the date formats county layers actually publish. Returns null on
 * anything unrecognised — a wrong auction date is worse than no auction date,
 * because the analyst plans around it.
 */
export function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  // ArcGIS date fields arrive as epoch milliseconds.
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 ? null : date;
  }

  const text = String(value).trim();
  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (mdy) {
    return new Date(Date.UTC(Number(mdy[3]), Number(mdy[1]) - 1, Number(mdy[2])));
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function stripInternal(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('__')) continue;
    out[key] = value;
  }
  return out;
}
