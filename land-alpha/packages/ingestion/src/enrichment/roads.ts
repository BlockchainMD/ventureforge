import { env } from '@land-alpha/shared/env';
import type { AnyGeometry, Position } from '@land-alpha/shared';
import { ArcGisClient } from '../fetch/arcgis.js';
import type { EnrichmentContext, EnrichmentTarget } from './types.js';

/**
 * Road network for the Access Engine.
 *
 * Two sources, in preference order:
 *
 *  1. **A county road-centreline layer**, when the jurisdiction publishes one.
 *     This is authoritative — it is the same data the county's own road
 *     department maintains, and it usually carries maintenance jurisdiction,
 *     which is the field that actually matters for access.
 *  2. **OpenStreetMap via Overpass**, as a fallback. Excellent coverage and
 *     geometry, but crowd-sourced: it will tell you a line exists, not who
 *     maintains it. Roads from OSM are therefore returned with `isPublic: null`
 *     rather than `true`, which is what keeps such a parcel at access class B
 *     instead of A.
 *
 * That distinction is the whole reason this connector reports its provenance
 * per road rather than merging both sources into one list.
 */

export interface RoadFeature {
  readonly name: string | null;
  readonly isPublic: boolean | null;
  readonly isPaved: boolean | null;
  readonly classification: string | null;
  readonly geometry: AnyGeometry;
  readonly source: string;
}

export interface RoadObservation {
  readonly roads: RoadFeature[];
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

/** OSM highway values that are actual vehicular roads. */
const VEHICULAR_HIGHWAYS = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'service',
  'track',
  'living_street',
];

const PAVED_SURFACES = new Set(['asphalt', 'paved', 'concrete', 'chipseal', 'paving_stones']);
const UNPAVED_SURFACES = new Set(['gravel', 'dirt', 'ground', 'unpaved', 'sand', 'grass', 'compacted']);

export async function fetchRoads(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  options: { countyRoadLayerUrl?: string | null; radiusMeters?: number } = {},
): Promise<RoadObservation> {
  const radius = options.radiusMeters ?? 400;

  if (ctx.mode === 'fixture') {
    return { roads: [], available: false, source: 'fixture', note: 'fixture mode' };
  }

  if (options.countyRoadLayerUrl) {
    const county = await fetchCountyRoads(ctx, target, options.countyRoadLayerUrl, radius);
    if (county.available && county.roads.length > 0) return county;
  }

  return fetchOsmRoads(ctx, target, radius);
}

async function fetchCountyRoads(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  layerUrl: string,
  radiusMeters: number,
): Promise<RoadObservation> {
  const source = 'County road centreline layer';
  try {
    const client = new ArcGisClient(ctx.http);
    const bbox = envelopeAround(target.centroid, radiusMeters);
    const params = new URLSearchParams({
      geometry: bbox.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      outSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: 'true',
      f: 'json',
    });
    const response = await ctx.http.getJson<{
      features?: { attributes?: Record<string, unknown>; geometry?: { paths?: number[][][] } }[];
      error?: unknown;
    }>(`${layerUrl}/query?${params.toString()}`);
    void client;

    if (response.error || !response.features) {
      return { roads: [], available: false, source, note: 'service returned an error' };
    }

    const roads: RoadFeature[] = [];
    for (const feature of response.features) {
      const paths = feature.geometry?.paths;
      if (!paths || paths.length === 0) continue;
      const attributes = feature.attributes ?? {};
      roads.push({
        name: pickString(attributes, ['STREETNAME', 'ROADNAME', 'NAME', 'FULLNAME', 'LABEL', 'STREET']),
        isPublic: inferPublicMaintenance(attributes),
        isPaved: inferPaved(attributes),
        classification: pickString(attributes, ['ROADCLASS', 'CLASS', 'FUNCTIONAL_CLASS', 'ROUTE_TYPE']),
        geometry:
          paths.length === 1
            ? { type: 'LineString', coordinates: paths[0] as Position[] }
            : { type: 'MultiLineString', coordinates: paths as Position[][] },
        source,
      });
    }

    return { roads, available: true, source, note: null };
  } catch (error) {
    return { roads: [], available: false, source, note: `unavailable: ${String(error)}` };
  }
}

async function fetchOsmRoads(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  radiusMeters: number,
): Promise<RoadObservation> {
  const source = 'OpenStreetMap (Overpass)';
  const [lon, lat] = target.centroid;
  const query = `[out:json][timeout:25];way(around:${Math.round(radiusMeters)},${lat.toFixed(6)},${lon.toFixed(6)})[highway~"^(${VEHICULAR_HIGHWAYS.join('|')})$"];out geom;`;

  try {
    const response = await ctx.http.getJson<{
      elements?: {
        type: string;
        tags?: Record<string, string>;
        geometry?: { lat: number; lon: number }[];
      }[];
    }>(`${env().OVERPASS_URL}?data=${encodeURIComponent(query)}`);

    const roads: RoadFeature[] = [];
    for (const element of response.elements ?? []) {
      if (element.type !== 'way' || !element.geometry || element.geometry.length < 2) continue;
      const tags = element.tags ?? {};
      roads.push({
        name: tags.name ?? tags.ref ?? null,
        // Crowd-sourced data cannot establish public maintenance. `access=private`
        // is a positive statement and is honoured; everything else stays unknown.
        isPublic: tags.access === 'private' ? false : null,
        isPaved: inferPavedFromOsm(tags),
        classification: tags.highway ?? null,
        geometry: {
          type: 'LineString',
          coordinates: element.geometry.map((point): Position => [point.lon, point.lat]),
        },
        source,
      });
    }

    return {
      roads,
      available: true,
      source,
      note:
        roads.length > 0
          ? 'Road maintenance status is not established by OpenStreetMap and remains unverified.'
          : 'No mapped road found within the search radius.',
    };
  } catch (error) {
    return { roads: [], available: false, source, note: `unavailable: ${String(error)}` };
  }
}

function envelopeAround(centroid: Position, radiusMeters: number): [number, number, number, number] {
  const [lon, lat] = centroid;
  const degLat = radiusMeters / 110_574;
  const degLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - degLon, lat - degLat, lon + degLon, lat + degLat];
}

function pickString(attributes: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = attributes[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    // County layers are inconsistent about case.
    const found = Object.entries(attributes).find(
      ([name]) => name.toUpperCase() === key.toUpperCase(),
    );
    if (found && typeof found[1] === 'string' && found[1].trim()) return found[1].trim();
  }
  return null;
}

function inferPublicMaintenance(attributes: Record<string, unknown>): boolean | null {
  const text = Object.entries(attributes)
    .filter(([key]) => /JURIS|MAINT|OWNER|AUTHORITY|SYSTEM/i.test(key))
    .map(([, value]) => String(value ?? ''))
    .join(' ')
    .toUpperCase();
  if (!text.trim()) return null;
  if (/PRIVATE/.test(text)) return false;
  if (/COUNTY|CITY|STATE|TOWNSHIP|MUNICIPAL|TWP|MNDOT|PUBLIC|FEDERAL/.test(text)) return true;
  return null;
}

function inferPaved(attributes: Record<string, unknown>): boolean | null {
  const text = Object.entries(attributes)
    .filter(([key]) => /SURF|PAVE|MATERIAL/i.test(key))
    .map(([, value]) => String(value ?? ''))
    .join(' ')
    .toUpperCase();
  if (!text.trim()) return null;
  if (/GRAVEL|DIRT|UNPAVED|EARTH|AGGREGATE/.test(text)) return false;
  if (/ASPHALT|BITUMIN|CONCRETE|PAVED|SEAL/.test(text)) return true;
  return null;
}

function inferPavedFromOsm(tags: Record<string, string>): boolean | null {
  const surface = tags.surface?.toLowerCase();
  if (surface) {
    if (PAVED_SURFACES.has(surface)) return true;
    if (UNPAVED_SURFACES.has(surface)) return false;
  }
  // Classification implies surface only at the top of the hierarchy.
  if (['motorway', 'trunk', 'primary', 'secondary'].includes(tags.highway ?? '')) return true;
  if (tags.highway === 'track') return false;
  return null;
}

/** True when mapped data suggests a driveway or track reaches the parcel. */
export function hasApparentDriveway(roads: readonly RoadFeature[]): boolean | null {
  if (roads.length === 0) return null;
  return roads.some(
    (road) => road.classification === 'service' || road.classification === 'track',
  );
}
