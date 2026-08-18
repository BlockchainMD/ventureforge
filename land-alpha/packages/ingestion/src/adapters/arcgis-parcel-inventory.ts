import {
  clampToExtractionMethod,
  dollarsToCents,
  sqFeetToAcres,
  type ConfidenceLevel,
  type EvidenceInput,
  type OwnerType,
  type ParcelOpportunityInput,
  type SaleStatus,
} from '@land-alpha/shared';
import { normalizeParcelGeometry, centroidOf } from '@land-alpha/gis';
import { ArcGisClient } from '../fetch/arcgis';
import {
  validateNormalized,
  type AdapterContext,
  type DiscoveredArtifact,
  type NormalizedBatch,
  type ParsedBatch,
  type SourceAdapter,
} from '../adapter';

/**
 * Generic adapter for a county parcel layer filtered to government-held
 * inventory.
 *
 * This one adapter serves St. Louis County MN (tax-forfeited land) and Ottawa
 * County MI (treasurer and land-bank vested parcels) because the shape of the
 * problem is identical: an authoritative parcel layer, a `where` clause that
 * isolates the inventory, and a field map. Adding a third county with the same
 * shape is a registry entry, not code — which is the point.
 *
 * What the adapter deliberately does NOT do is claim a parcel is for sale.
 * Presence in a tax-forfeited or treasurer-vested layer proves ownership, not
 * an active offering, so `saleStatus` comes from the registry (UNKNOWN by
 * default) and acquisition instructions tell the analyst what to confirm.
 */

interface FieldMap {
  apn?: string;
  alternateApn?: string;
  acreage?: string;
  deededAcreage?: string;
  lotSquareFeet?: string;
  owner?: string;
  legalDescription?: string;
  plat?: string;
  landAssessedValue?: string;
  assessedValue?: string;
  taxableValue?: string;
  taxableLandValue?: string;
  annualTax?: string;
  balanceDue?: string;
  propertyClass?: string;
  propertyClassDescription?: string;
  situsAddress?: string;
  situsCity?: string;
  situsZip?: string;
  municipality?: string;
  minimumBid?: string;
  saleDate?: string;
}

interface AdapterConfig {
  layerUrl: string;
  where?: string;
  fieldMap: FieldMap;
  governmentOwner?: string;
  ownerType?: OwnerType;
  saleStatus?: SaleStatus;
  vacantClassPattern?: string;
  acquisitionInstructions?: string;
  maxFeatures?: number;
}

export const arcgisParcelInventoryAdapter: SourceAdapter = {
  key: 'arcgis-parcel-inventory',
  description:
    'Government-held parcel inventory from an ArcGIS REST parcel layer, isolated by a where clause.',
  parserVersion: '1',

  async discover(ctx: AdapterContext): Promise<DiscoveredArtifact[]> {
    const config = readConfig(ctx);
    return [
      {
        url: config.layerUrl,
        kind: 'ARCGIS_LAYER',
        label: `${ctx.source.name} parcel layer`,
        meta: { where: config.where ?? '1=1' },
      },
    ];
  },

  async fetchAndParse(ctx: AdapterContext, artifact: DiscoveredArtifact): Promise<ParsedBatch> {
    const config = readConfig(ctx);
    const client = new ArcGisClient(ctx.http);
    const where = config.where ?? '1=1';
    const warnings: string[] = [];

    const info = await client.layerInfo(config.layerUrl);
    const expected = await client.count(config.layerUrl, where);
    ctx.logger.info('arcgis layer resolved', {
      layer: info.name,
      geometryType: info.geometryType,
      expected,
    });

    const records: Record<string, unknown>[] = [];
    for await (const feature of client.query(config.layerUrl, {
      where,
      returnGeometry: true,
      pageSize: info.maxRecordCount,
      maxFeatures: config.maxFeatures ?? 25_000,
    })) {
      records.push({
        ...feature.attributes,
        __geometry: feature.geometry,
        __point: feature.point,
      });
      if (ctx.signal?.aborted) break;
    }

    // A count/fetch mismatch means the service paged inconsistently or the
    // inventory changed mid-run. Surfaced rather than silently accepted.
    if (expected > 0 && records.length < expected * 0.95) {
      warnings.push(
        `Layer reported ${expected} matching features but only ${records.length} were retrieved.`,
      );
    }

    const artifactKey = await ctx.persistArtifact(
      `${ctx.source.key}-features.json`,
      Buffer.from(JSON.stringify({ where, count: records.length, records }, null, 0), 'utf8'),
      { url: artifact.url, contentType: 'application/json' },
    );

    return { records, artifactKey, sourceUrl: artifact.url, warnings };
  },

  async normalize(ctx: AdapterContext, batch: ParsedBatch): Promise<NormalizedBatch> {
    const config = readConfig(ctx);
    const map = config.fieldMap;
    const retrievedAt = new Date();
    const warnings: string[] = [];
    const items: ParcelOpportunityInput[] = [];

    for (const record of batch.records) {
      const evidence: EvidenceInput[] = [];
      const addEvidence = (
        field: string,
        value: unknown,
        confidence: ConfidenceLevel = 'HIGH',
      ): void => {
        if (value == null || value === '') return;
        evidence.push({
          field,
          value: String(value),
          source: ctx.source.name,
          sourceUrl: batch.sourceUrl,
          documentKey: batch.artifactKey,
          extractedText: null,
          retrievedAt,
          confidence: clampToExtractionMethod(confidence, 'ARCGIS_QUERY'),
          extractionMethod: 'ARCGIS_QUERY',
          notes: null,
        });
      };

      const apn = str(record[map.apn ?? '']);
      const rawGeometry = record.__geometry;
      const { geometry, reason } = rawGeometry
        ? normalizeParcelGeometry(rawGeometry)
        : { geometry: null, reason: null };
      if (reason) warnings.push(`${apn ?? 'unknown parcel'}: ${reason}`);

      const point = (record.__point as [number, number] | null) ?? null;
      const centroid = geometry ? centroidOf(geometry) : point;

      // Prefer deeded acreage where the county publishes it: it is the legal
      // figure, whereas the GIS acreage is a measurement of the drawn polygon.
      const deeded = num(record[map.deededAcreage ?? '']);
      const mapped = num(record[map.acreage ?? '']);
      const lotSquareFeet = num(record[map.lotSquareFeet ?? '']);
      const acreage =
        deeded != null && deeded > 0
          ? deeded
          : mapped != null && mapped > 0
            ? mapped
            : lotSquareFeet != null && lotSquareFeet > 0
              ? sqFeetToAcres(lotSquareFeet)
              : null;

      const classDescription = str(record[map.propertyClassDescription ?? '']);
      const propertyClass = str(record[map.propertyClass ?? '']);
      const isVacant = config.vacantClassPattern
        ? classDescription
          ? classDescription.toUpperCase().includes(config.vacantClassPattern.toUpperCase())
          : null
        : null;

      addEvidence('apn', apn, 'VERIFIED');
      addEvidence('acreage', acreage);
      addEvidence('legalDescription', str(record[map.legalDescription ?? '']));
      addEvidence('currentOwner', str(record[map.owner ?? '']), 'VERIFIED');
      addEvidence('landAssessedValue', num(record[map.landAssessedValue ?? '']));
      addEvidence('assessedValue', num(record[map.assessedValue ?? '']));
      addEvidence('propertyClass', propertyClass ?? classDescription);
      if (geometry) addEvidence('geometry', `${geometry.type} from county parcel layer`, 'VERIFIED');

      items.push({
        sourceId: ctx.sourceId,
        sourceRecordId: apn ?? null,
        sourceUrl: ctx.source.discoveryUrl ?? ctx.source.sourceUrl,
        state: ctx.source.state,
        county: ctx.source.county ?? '',
        apn,
        alternateApns: [str(record[map.alternateApn ?? ''])].filter(
          (value): value is string => Boolean(value) && value !== apn,
        ),

        saleType: 'UNKNOWN',
        saleStatus: config.saleStatus ?? 'UNKNOWN',
        minimumBid: cents(record[map.minimumBid ?? '']),
        taxesDue: cents(record[map.balanceDue ?? '']),
        acquisitionInstructions: config.acquisitionInstructions ?? null,
        otcEligible: ctx.source.failedAuctionBecomesOtc ? null : false,

        latitude: centroid ? centroid[1] : null,
        longitude: centroid ? centroid[0] : null,
        geometry,
        acreage,
        lotSquareFeet,
        municipality: str(record[map.municipality ?? '']),
        zip: normalizeZip(record[map.situsZip ?? '']),
        situsAddress: joinAddress(
          str(record[map.situsAddress ?? '']),
          str(record[map.situsCity ?? '']),
        ),
        legalDescription: composeLegal(
          str(record[map.legalDescription ?? '']),
          str(record[map.plat ?? '']),
        ),

        assessedValue: cents(record[map.assessedValue ?? '']),
        taxableValue: cents(record[map.taxableValue ?? '']),
        landAssessedValue:
          cents(record[map.landAssessedValue ?? '']) ?? cents(record[map.taxableLandValue ?? '']),
        propertyClass: propertyClass ?? classDescription,
        isVacant,
        annualTaxEstimate: cents(record[map.annualTax ?? '']),

        currentOwner: str(record[map.owner ?? '']),
        ownerType: config.ownerType ?? 'UNKNOWN',
        governmentOwner: config.governmentOwner ?? null,

        evidence,
        rawRecord: stripInternal(record),
        rawArtifactKey: batch.artifactKey,
      });
    }

    const validated = validateNormalized(items);
    return { items: validated.items, rejected: validated.rejected, warnings };
  },
};

// --- helpers ---------------------------------------------------------------

function readConfig(ctx: AdapterContext): AdapterConfig {
  const config = ctx.source.config as unknown as AdapterConfig;
  if (!config?.layerUrl) {
    throw new Error(`Source ${ctx.source.key} is missing config.layerUrl`);
  }
  if (!config.fieldMap) {
    throw new Error(`Source ${ctx.source.key} is missing config.fieldMap`);
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
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** County layers publish money as whole dollars; the domain wants cents. */
function cents(value: unknown): number | null {
  const dollars = num(value);
  if (dollars == null || dollars <= 0) return null;
  return dollarsToCents(dollars);
}

function normalizeZip(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

function joinAddress(address: string | null, city: string | null): string | null {
  if (!address && !city) return null;
  return [address, city].filter(Boolean).join(', ');
}

function composeLegal(legal: string | null, plat: string | null): string | null {
  if (!legal && !plat) return null;
  if (legal && plat) return `${legal} — ${plat}`;
  return legal ?? plat;
}

function stripInternal(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('__')) continue;
    out[key] = value;
  }
  return out;
}
