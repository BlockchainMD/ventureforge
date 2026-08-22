import { describeUnavailable } from './unavailable';
import type { EnrichmentContext, EnrichmentTarget } from './types';

/**
 * Zoning from a county's own zoning layer.
 *
 * Buildability turns on what the land may be used for, and until now the only
 * parcels carrying a zoning code were the fixtures. St. Louis County publishes
 * a zoning polygon layer alongside the parcels we already ingest, and the
 * registry has recorded its URL — and claimed the buildability engine used it —
 * since the county was added. Nothing read it.
 *
 * What this deliberately does not do is convert the county's dimensional code
 * into a minimum lot size. `DIM` is an index into a table of dimensional
 * standards that the layer does not publish, and guessing that a 3 means five
 * acres would put an invented number into the one field that decides whether a
 * parcel can be split.
 */

export interface ZoningObservation {
  readonly code: string | null;
  readonly description: string | null;
  /** The county's dimensional-standard code, verbatim and untranslated. */
  readonly dimensionalCode: string | null;
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

const EMPTY: Omit<ZoningObservation, 'source'> = {
  code: null,
  description: null,
  dimensionalCode: null,
  available: false,
  note: null,
};

export async function fetchZoning(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  options: { zoningLayerUrl?: string | null } = {},
): Promise<ZoningObservation> {
  const source = 'County zoning layer';
  if (ctx.mode === 'fixture') return { ...EMPTY, source, note: 'fixture mode' };
  if (!options.zoningLayerUrl) {
    return { ...EMPTY, source, note: 'no zoning layer is published for this jurisdiction' };
  }

  const [lon, lat] = target.centroid;
  const params = new URLSearchParams({
    // A point query, not an envelope: a parcel straddling two zoning districts
    // is a real thing, and the district its centre sits in is the defensible
    // answer rather than whichever polygon happens to clip the bounding box.
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const response = await ctx.http.getJson<{
      features?: { attributes?: Record<string, unknown> }[];
      error?: unknown;
    }>(`${options.zoningLayerUrl}/query?${params.toString()}`);

    if (response.error || !response.features) {
      return { ...EMPTY, source, note: 'the zoning service returned an error' };
    }
    const attributes = response.features[0]?.attributes;
    if (!attributes) {
      return {
        ...EMPTY,
        source,
        available: true,
        note: 'No zoning district covers this parcel in the county layer.',
      };
    }

    const code = pick(attributes, ['USE_', 'ZONE', 'ZONING', 'ZONE_CODE', 'ZONECLASS']);
    const description = pick(attributes, ['DESCRIPTIO', 'DESCRIPTION', 'ZONE_DESC', 'ZONING_DESC']);
    const dimensionalCode = pick(attributes, ['DIM', 'DIM2', 'DIMENSION']);

    // "Non Jurisdiction Area" is how this layer records land the county does
    // not zone — a city, a reservation, state forest. That is an answer, but
    // it is not a zoning code, and treating it as one would put a phrase where
    // a district belongs.
    if (!code && /non[ -]?jurisdiction/i.test(description ?? '')) {
      return {
        ...EMPTY,
        source,
        available: true,
        description,
        note: 'The parcel lies outside the county zoning jurisdiction; a municipality or other authority zones it.',
      };
    }

    return {
      code,
      description,
      dimensionalCode,
      available: true,
      source,
      note: null,
    };
  } catch (error) {
    return { ...EMPTY, source, note: describeUnavailable(error, null) };
  }
}

function pick(attributes: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = attributes[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** Test seam so the enrichment context can be exercised without the network. */
export const ZONING_UNAVAILABLE_NOTE = 'no zoning layer is published for this jurisdiction';
