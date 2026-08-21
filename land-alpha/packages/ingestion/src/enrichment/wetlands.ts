import { esriPolygonToGeoJson, type EsriPolygon } from '@land-alpha/gis';
import { env } from '@land-alpha/shared/env';
import type { AnyGeometry } from '@land-alpha/shared';
import { envelopeParam } from './fema';
import type { EnrichmentContext, EnrichmentTarget } from './types';

/**
 * USFWS National Wetlands Inventory.
 *
 * The NWI is a screening layer produced largely from aerial photo
 * interpretation. It is genuinely useful for rejecting parcels that are mostly
 * marsh, and genuinely insufficient as a basis for saying a parcel is clear —
 * both facts are carried through to the interpretation layer, which always
 * states that absence from the NWI does not prove absence of jurisdictional
 * wetlands.
 */

const WETLANDS_LAYER = 0;

export interface WetlandObservation {
  readonly types: string[];
  readonly polygons: AnyGeometry[];
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

export async function fetchWetlands(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
): Promise<WetlandObservation> {
  const source = 'USFWS National Wetlands Inventory';
  if (ctx.mode === 'fixture') {
    return { types: [], polygons: [], available: false, source, note: 'fixture mode' };
  }

  const params = new URLSearchParams({
    geometry: envelopeParam(target),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'WETLAND_TYPE,ATTRIBUTE',
    returnGeometry: 'true',
    f: 'json',
  });

  try {
    const response = await ctx.http.getJson<{
      features?: { attributes?: Record<string, unknown>; geometry?: EsriPolygon }[];
      error?: unknown;
    }>(`${env().USFWS_WETLANDS_URL}/${WETLANDS_LAYER}/query?${params.toString()}`);

    if (response.error || !response.features) {
      return {
        types: [],
        polygons: [],
        available: false,
        source,
        note: 'service returned an error',
      };
    }

    const types = new Set<string>();
    const polygons: AnyGeometry[] = [];
    for (const feature of response.features) {
      const type = feature.attributes?.WETLAND_TYPE ?? feature.attributes?.ATTRIBUTE;
      if (typeof type === 'string' && type.trim()) types.add(type.trim());
      if (feature.geometry?.rings) {
        const converted = esriPolygonToGeoJson(feature.geometry);
        if (converted) polygons.push(converted);
      }
    }

    return { types: [...types], polygons, available: true, source, note: null };
  } catch (error) {
    return {
      types: [],
      polygons: [],
      available: false,
      source,
      note: `unavailable: ${String(error)}`,
    };
  }
}
