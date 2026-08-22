import { esriPolygonToGeoJson, type EsriPolygon } from '@land-alpha/gis';
import { env } from '@land-alpha/shared/env';
import type { AnyGeometry } from '@land-alpha/shared';
import type { EnrichmentContext, EnrichmentTarget } from './types';
import { describeUnavailable } from './unavailable';

/**
 * FEMA National Flood Hazard Layer.
 *
 * Queries the public NFHL MapServer for flood hazard polygons intersecting the
 * parcel. Two subtleties that matter:
 *
 *  - The flood *zone* alone is not the whole answer. A parcel 5% inside zone AE
 *    is a different asset from one 95% inside it, so the polygons are returned
 *    and the overlap is measured in PostGIS rather than reduced to a boolean.
 *  - Zone D means "unstudied", not "safe". It is preserved verbatim and the
 *    interpretation layer treats it as an unknown, not an all-clear.
 */

/** Layer 28 of the public NFHL service is the Flood Hazard Zones polygon layer. */
const FLOOD_HAZARD_LAYER = 28;

export interface FloodObservation {
  readonly zones: string[];
  readonly polygons: AnyGeometry[];
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
  /**
   * Overlap the publisher measured itself, 0-1.
   *
   * Some counties publish a parcel-keyed flood table with the share of each
   * parcel already computed against its own boundary. That is a better number
   * than one this engine derives by intersecting a zone polygon with a
   * geometry, and where it exists it is used in preference.
   */
  readonly overlapFraction?: number | null;
  /**
   * Set directly where the publisher states it rather than leaving it to be
   * inferred from a zone letter. A parcel-keyed table names the 100-year
   * floodplain outright, and the 100-year floodplain is the Special Flood
   * Hazard Area by definition — reading that off a zone code we were never
   * given would mean inventing the code first.
   */
  readonly inSpecialFloodHazardArea?: boolean | null;
}

/** Fields a parcel-keyed county flood table exposes. */
export interface ParcelFloodLayerConfig {
  readonly url: string;
  /** The column holding the parcel identifier. */
  readonly parcelIdField: string;
  readonly floodplainPercentField?: string;
  readonly floodwayPercentField?: string;
  readonly floodplain100PercentField?: string;
}

/**
 * Flood from a county table keyed by parcel rather than by geometry.
 *
 * Ottawa County publishes every parcel that intersects a flood zone, with the
 * share of each already measured against its own boundary. Two things follow.
 * The percentages are better than anything derived here, because the county
 * computed them against the authoritative parcel shape. And absence is an
 * answer: a parcel the county holds and did not put in this table is a parcel
 * outside the mapped flood zones, which is a screening result rather than a
 * silence.
 */
export async function fetchParcelFlood(
  ctx: EnrichmentContext,
  parcelId: string,
  config: ParcelFloodLayerConfig,
): Promise<FloodObservation> {
  const source = 'County parcel flood table';
  if (ctx.mode === 'fixture') {
    return { zones: [], polygons: [], available: false, source, note: 'fixture mode' };
  }

  const params = new URLSearchParams({
    where: `${config.parcelIdField} = '${parcelId.replace(/'/g, "''")}'`,
    outFields: '*',
    returnGeometry: 'false',
    f: 'json',
  });

  try {
    const response = await ctx.http.getJson<{
      features?: { attributes?: Record<string, unknown> }[];
      error?: unknown;
    }>(`${config.url}/query?${params.toString()}`);
    if (response.error) {
      return {
        zones: [],
        polygons: [],
        available: false,
        source,
        note: 'the table returned an error',
      };
    }

    const attributes = response.features?.[0]?.attributes;
    if (!attributes) {
      return {
        zones: [],
        polygons: [],
        available: true,
        source,
        overlapFraction: 0,
        inSpecialFloodHazardArea: false,
        note: 'The county lists every parcel touching a mapped flood zone, and this parcel is not among them.',
      };
    }

    const percent = (field?: string): number | null => {
      if (!field) return null;
      const value = Number(attributes[field]);
      return Number.isFinite(value) ? value / 100 : null;
    };
    const floodplain = percent(config.floodplainPercentField);
    const floodway = percent(config.floodwayPercentField);
    const floodplain100 = percent(config.floodplain100PercentField);

    const zones: string[] = [];
    // Named for what the county measured, not translated into FEMA zone
    // letters it never supplied. The engine's SFHA determination is set
    // directly below rather than inferred from these.
    if (floodway != null && floodway > 0) zones.push('FLOODWAY');
    if (floodplain100 != null && floodplain100 > 0) zones.push('100-YEAR FLOODPLAIN');
    if (zones.length === 0 && floodplain != null && floodplain > 0) zones.push('FLOODPLAIN');

    return {
      zones,
      polygons: [],
      available: true,
      source,
      // The widest measure the county gave, since it is the share of the
      // parcel a buyer cannot treat as ordinary upland.
      overlapFraction: Math.max(floodplain ?? 0, floodway ?? 0, floodplain100 ?? 0) || null,
      // The floodway is inside the 100-year floodplain by construction, so
      // either one puts the parcel in the Special Flood Hazard Area.
      inSpecialFloodHazardArea:
        (floodway != null && floodway > 0) || (floodplain100 != null && floodplain100 > 0),
      note:
        floodway != null && floodway > 0.5
          ? `The county measures ${(floodway * 100).toFixed(0)}% of this parcel inside the regulatory floodway, where construction is prohibited or severely restricted.`
          : null,
    };
  } catch (error) {
    return {
      zones: [],
      polygons: [],
      available: false,
      source,
      note: describeUnavailable(error, null),
    };
  }
}

export async function fetchFloodHazard(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  options: { countyFloodLayerUrl?: string | null } = {},
): Promise<FloodObservation> {
  if (ctx.mode === 'fixture') {
    return {
      zones: [],
      polygons: [],
      available: false,
      source: 'FEMA National Flood Hazard Layer',
      note: 'fixture mode',
    };
  }

  // The county's republication first, where it exists.
  //
  // FEMA's own host forbids automated queries against the NFHL, which left
  // every parcel unscreened for flood and so capped buildability at UNKNOWN.
  // Counties that adopt a FIRM commonly republish it in their own GIS, and
  // Orange County's layer carries the identical schema — FLD_ZONE, ZONE_SUBTY,
  // SFHA_TF, DFIRM_ID — because it is the same data. Reading it there is not a
  // way around FEMA's preference; it is a different publisher who permits it.
  if (options.countyFloodLayerUrl) {
    const county = await queryFloodLayer(
      ctx,
      target,
      options.countyFloodLayerUrl,
      'County republication of the FEMA National Flood Hazard Layer',
    );
    if (county.available) return county;
  }

  return queryFloodLayer(
    ctx,
    target,
    `${env().FEMA_NFHL_URL}/${FLOOD_HAZARD_LAYER}`,
    'FEMA National Flood Hazard Layer',
  );
}

async function queryFloodLayer(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  layerUrl: string,
  source: string,
): Promise<FloodObservation> {
  const geometry = envelopeParam(target);

  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE',
    returnGeometry: 'true',
    f: 'json',
  });

  try {
    const response = await ctx.http.getJson<{
      features?: { attributes?: Record<string, unknown>; geometry?: EsriPolygon }[];
      error?: unknown;
    }>(`${layerUrl}/query?${params.toString()}`);

    if (response.error || !response.features) {
      return {
        zones: [],
        polygons: [],
        available: false,
        source,
        note: 'service returned an error',
      };
    }

    const zones = new Set<string>();
    const polygons: AnyGeometry[] = [];
    for (const feature of response.features) {
      const zone = feature.attributes?.FLD_ZONE;
      if (typeof zone === 'string' && zone.trim()) zones.add(zone.trim().toUpperCase());
      if (feature.geometry?.rings) {
        const converted = esriPolygonToGeoJson(feature.geometry);
        if (converted) polygons.push(converted);
      }
    }

    return {
      zones: [...zones],
      polygons,
      available: true,
      source,
      note: zones.size === 0 ? 'No mapped flood hazard area intersects the parcel envelope.' : null,
    };
  } catch (error) {
    return {
      zones: [],
      polygons: [],
      available: false,
      source,
      note: describeUnavailable(error, 'https://msc.fema.gov/portal/search'),
    };
  }
}

/**
 * Query envelope. Uses the parcel's bounding box where geometry exists, or a
 * small box around the point otherwise — federal services reject very large or
 * very complex geometry parameters, so the envelope is the reliable form.
 */
export function envelopeParam(target: EnrichmentTarget, paddingDegrees = 0.0009): string {
  if (target.geometry) {
    const positions =
      target.geometry.type === 'Polygon'
        ? target.geometry.coordinates.flat()
        : target.geometry.coordinates.flat(2);
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of positions) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    return `${west},${south},${east},${north}`;
  }
  const [lon, lat] = target.centroid;
  return `${lon - paddingDegrees},${lat - paddingDegrees},${lon + paddingDegrees},${lat + paddingDegrees}`;
}
