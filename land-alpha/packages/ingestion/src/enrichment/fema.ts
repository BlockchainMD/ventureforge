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
