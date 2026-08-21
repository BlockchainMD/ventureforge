import { dollarsToCents } from '@land-alpha/shared';
import { centroidOf, normalizeParcelGeometry } from '@land-alpha/gis';
import { createLogger } from '@land-alpha/shared/logger';
import { ArcGisClient } from '../fetch/arcgis';
import type { IngestHttpClient } from '../fetch/http';
import type { ComparableSaleInput, CompsSource } from './types';

/**
 * Adapter for a county assessor's published sales table.
 *
 * Minnesota counties commonly publish one, because the assessor already
 * maintains a sales-ratio study for the Department of Revenue and the same
 * table backs their public comp-finder. Where it is exposed without a token it
 * is the best comparable-sales source available: the assessor has already
 * classified each transfer as vacant or improved and qualified or disqualified,
 * which is precisely the judgement a valuation needs and cannot make itself.
 *
 * The two classifications are read from the county's own fields rather than
 * inferred. Guessing "this looks vacant" from a price would be circular — the
 * price is the thing being explained.
 */

const logger = createLogger({ component: 'comps-assessor' });

interface FieldMap {
  apn: string;
  saleDate: string;
  salePrice: string;
  acreage: string;
  propertyClass?: string;
  vacantFlag?: string;
  qualifiedFlag?: string;
  deedType?: string;
  municipality?: string;
}

interface AdapterConfig {
  layerUrl: string;
  where?: string;
  fieldMap: FieldMap;
  /** Substrings in the property-class field that denote vacant land. */
  vacantClassPatterns?: string[];
  /** Values of the qualified field that denote an arm's-length sale. */
  qualifiedValues?: string[];
  /** Sale codes that disqualify a transfer regardless of the qualified flag. */
  disqualifyingCodePatterns?: string[];
  maxFeatures?: number;
  /** Only ingest sales on or after this ISO date. */
  soldSince?: string;
}

export async function fetchAssessorSales(
  source: CompsSource,
  http: IngestHttpClient,
  options: { signal?: AbortSignal } = {},
): Promise<{ rows: ComparableSaleInput[]; warnings: string[] }> {
  const config = source.config as unknown as AdapterConfig;
  if (!config?.layerUrl || !config.fieldMap) {
    throw new Error(`Comps source ${source.key} needs config.layerUrl and config.fieldMap`);
  }

  const client = new ArcGisClient(http);
  const map = config.fieldMap;
  const warnings: string[] = [];
  const rows: ComparableSaleInput[] = [];

  const where = config.where ?? '1=1';
  const expected = await client.count(config.layerUrl, where);
  logger.info('assessor sales layer resolved', { source: source.key, expected });

  const soldSince = config.soldSince ? new Date(config.soldSince) : null;

  for await (const feature of client.query(config.layerUrl, {
    where,
    returnGeometry: true,
    maxFeatures: config.maxFeatures ?? 20_000,
    // Sales tables are keyed on their own OID; the parcel id is not unique
    // because a parcel can sell more than once.
    orderByFields: 'OBJECTID',
  })) {
    if (options.signal?.aborted) break;
    const attributes = feature.attributes;

    const saleDate = parseEsriDate(attributes[map.saleDate]);
    if (!saleDate) continue;
    if (soldSince && saleDate < soldSince) continue;

    const salePrice = numeric(attributes[map.salePrice]);
    const acreage = numeric(attributes[map.acreage]);
    if (salePrice == null || acreage == null) continue;

    const propertyClass = text(attributes[map.propertyClass ?? '']);
    const isVacantLand = classifyVacant(
      propertyClass,
      text(attributes[map.vacantFlag ?? '']),
      config,
    );
    const isArmsLength = classifyArmsLength(attributes, map, config);

    // Prefer the parcel centroid so the spatial comp search can use it; a sale
    // that cannot be located is still usable, just weighted lower.
    let latitude: number | null = null;
    let longitude: number | null = null;
    if (feature.geometry) {
      const normalized = normalizeParcelGeometry(feature.geometry);
      if (normalized.geometry) {
        const centroid = centroidOf(normalized.geometry);
        longitude = centroid[0];
        latitude = centroid[1];
      }
    } else if (feature.point) {
      longitude = feature.point[0];
      latitude = feature.point[1];
    }

    rows.push({
      state: source.state,
      county: source.county,
      apn: text(attributes[map.apn]),
      saleDate,
      salePriceCents: dollarsToCents(salePrice),
      acreage,
      latitude,
      longitude,
      zoning: null,
      landUse: propertyClass,
      hasUtilities: null,
      isVacantLand,
      isArmsLength,
      deedType: text(attributes[map.deedType ?? '']),
      source: source.name,
      sourceUrl: source.sourceUrl,
    });
  }

  if (expected > 0 && rows.length === 0) {
    warnings.push(
      `Layer reported ${expected} matching rows but none parsed into a comparable — check the field map.`,
    );
  }

  return { rows, warnings };
}

/**
 * Vacant/improved classification, read from the county's own fields.
 *
 * A dedicated vacant flag is trusted first. Otherwise the property-class text
 * is matched against the county's vocabulary ("BARE LAND", "VACANT"). Anything
 * unrecognised is treated as improved, because including a sale that included a
 * house would inflate every valuation that used it.
 */
export function classifyVacant(
  propertyClass: string | null,
  vacantFlag: string | null,
  config: AdapterConfig,
): boolean {
  if (vacantFlag) {
    const flag = vacantFlag.trim().toUpperCase();
    if (flag === 'VACANT' || flag === 'V' || flag === 'Y' || flag === 'YES') return true;
    if (flag === 'IMPROVED' || flag === 'I' || flag === 'N' || flag === 'NO') return false;
  }
  if (!propertyClass) return false;

  const patterns = config.vacantClassPatterns ?? ['VACANT', 'BARE LAND'];
  const upper = propertyClass.toUpperCase();
  // "LAND W/ BLDG" contains "LAND" but is emphatically not vacant.
  if (/W\/\s*BLDG|WITH BUILDING|IMPROVED/.test(upper)) return false;
  return patterns.some((pattern) => upper.includes(pattern.toUpperCase()));
}

/**
 * Arm's-length classification.
 *
 * Trusts the assessor's qualified-sale determination where one exists — they
 * investigated the transfer and we did not. Disqualifying sale codes (relative
 * sales, forced sales, estate distributions) veto a positive flag.
 */
export function classifyArmsLength(
  attributes: Record<string, unknown>,
  map: FieldMap,
  config: AdapterConfig,
): boolean {
  const disqualifiers = config.disqualifyingCodePatterns ?? [
    'RELATIVE',
    'RELATED',
    'FORECLOS',
    'ESTATE',
    'QUIT CLAIM',
    'GIFT',
    'TRADE',
    'CORRECT',
    'DIVORCE',
  ];

  const haystack = Object.entries(attributes)
    .filter(([key]) => /CODE|DESC|DOCNAME|DEED|REASON/i.test(key))
    .map(([, value]) => String(value ?? '').toUpperCase())
    .join(' ');
  if (disqualifiers.some((pattern) => haystack.includes(pattern))) return false;

  if (map.qualifiedFlag) {
    const flag = text(attributes[map.qualifiedFlag]);
    if (flag) {
      const qualified = config.qualifiedValues ?? ['Y', 'YES', 'Q', 'QUALIFIED', 'GOOD', 'TRUE'];
      return qualified.some((value) => flag.trim().toUpperCase() === value.toUpperCase());
    }
    // The county publishes a qualified flag and left it empty: that is an
    // unqualified sale by omission, not an endorsement.
    return false;
  }

  return true;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' || trimmed.toUpperCase() === 'NULL' ? null : trimmed;
}

function numeric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed =
    typeof value === 'number' ? value : Number.parseFloat(String(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** ArcGIS date fields arrive as epoch milliseconds; guard the sentinels. */
export function parseEsriDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    if (value <= 0) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 ? null : date;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return date.getUTCFullYear() < 1900 ? null : date;
}
