import * as turf from '@turf/turf';
import {
  isPlausibleUsPosition,
  repairUsPosition,
  type AnyGeometry,
  type ParcelGeometry,
  type Position,
} from '@land-alpha/shared';

/**
 * Geometry ingest helpers: get whatever a county publishes into clean
 * EPSG:4326 GeoJSON, or reject it.
 */

/** Esri JSON polygon as returned by an ArcGIS REST `query` with `f=json`. */
export interface EsriPolygon {
  rings: number[][][];
  spatialReference?: { wkid?: number; latestWkid?: number };
}

export interface EsriPoint {
  x: number;
  y: number;
  spatialReference?: { wkid?: number; latestWkid?: number };
}

export type EsriGeometry = EsriPolygon | EsriPoint;

const WEB_MERCATOR_WKIDS = new Set([3857, 102100, 900913]);

/**
 * Convert Esri JSON to GeoJSON.
 *
 * Two things Esri does differently and that break naive conversions:
 *
 *  1. Ring winding. Esri encodes outer rings clockwise and holes
 *     counter-clockwise; GeoJSON (RFC 7946) specifies the opposite. A
 *     conversion that ignores this produces polygons whose holes are treated as
 *     separate outer rings, inflating measured area.
 *  2. Multi-ring polygons are a flat list of rings, with no statement of which
 *     hole belongs to which outer ring. Grouping is inferred from winding.
 */
export function esriPolygonToGeoJson(esri: EsriPolygon): ParcelGeometry | null {
  if (!Array.isArray(esri.rings) || esri.rings.length === 0) return null;

  const wkid = esri.spatialReference?.latestWkid ?? esri.spatialReference?.wkid ?? 4326;
  const rings = esri.rings
    .map((ring) => ring.map((position) => toWgs84([position[0]!, position[1]!], wkid)))
    .filter((ring): ring is Position[] => ring.every((p): p is Position => p !== null))
    .map(closeRing)
    .filter((ring) => ring.length >= 4);

  if (rings.length === 0) return null;

  // Esri clockwise === outer ring. `signedArea > 0` in screen coordinates means
  // clockwise for the shoelace formula as written here.
  const outer: Position[][] = [];
  const holes: Position[][] = [];
  for (const ring of rings) {
    if (signedArea(ring) > 0) outer.push(ring);
    else holes.push(ring);
  }

  if (outer.length === 0) {
    // Every ring wound the "hole" way. Treat the largest as the outer ring
    // rather than dropping the parcel entirely.
    const largest = rings.reduce((a, b) => (Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b));
    outer.push(largest);
    const index = holes.indexOf(largest);
    if (index >= 0) holes.splice(index, 1);
  }

  const polygons: Position[][][] = outer.map((ring) => [reverse(ring)]);
  for (const hole of holes) {
    const owner = polygons.find((polygon) => ringContains(polygon[0]!, hole[0]!)) ?? polygons[0]!;
    owner.push(hole);
  }

  if (polygons.length === 1) {
    return { type: 'Polygon', coordinates: polygons[0]! };
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

export function esriPointToPosition(esri: EsriPoint): Position | null {
  const wkid = esri.spatialReference?.latestWkid ?? esri.spatialReference?.wkid ?? 4326;
  return toWgs84([esri.x, esri.y], wkid);
}

/**
 * Reproject a coordinate to WGS84.
 *
 * Only Web Mercator and WGS84 are handled inline; a state-plane coordinate
 * needs a real projection library and full parameter set, so it is rejected
 * rather than approximated. Silently mis-projecting a parcel by 30 km is far
 * worse than declining to place it.
 */
export function toWgs84(position: Position, wkid: number): Position | null {
  if (wkid === 4326 || wkid === 4269) {
    return repairUsPosition(position);
  }
  if (WEB_MERCATOR_WKIDS.has(wkid)) {
    const [x, y] = position;
    const lon = (x / 20037508.34) * 180;
    const rawLat = (y / 20037508.34) * 180;
    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((rawLat * Math.PI) / 180)) - Math.PI / 2);
    const converted: Position = [lon, lat];
    return isPlausibleUsPosition(converted) ? converted : null;
  }
  return null;
}

/**
 * Validate and normalise an arbitrary GeoJSON geometry into a parcel polygon.
 * Returns null with a reason rather than throwing: an unusable geometry on one
 * row must not abort a 4,000-row county import.
 */
export function normalizeParcelGeometry(
  geometry: unknown,
): { geometry: ParcelGeometry | null; reason: string | null } {
  if (!geometry || typeof geometry !== 'object') {
    return { geometry: null, reason: 'not an object' };
  }
  const candidate = geometry as AnyGeometry;
  if (candidate.type !== 'Polygon' && candidate.type !== 'MultiPolygon') {
    return { geometry: null, reason: `unsupported geometry type ${String(candidate.type)}` };
  }

  const polygons: Position[][][] =
    candidate.type === 'Polygon' ? [candidate.coordinates as Position[][]] : (candidate.coordinates as Position[][][]);

  const cleaned: Position[][][] = [];
  for (const polygon of polygons) {
    const rings = polygon
      .map((ring) => ring.filter(isFinitePosition).map(clampPosition))
      .map(closeRing)
      .filter((ring) => ring.length >= 4);
    if (rings.length > 0) cleaned.push(rings);
  }

  if (cleaned.length === 0) return { geometry: null, reason: 'no valid rings' };

  const outerRing = cleaned[0]![0]!;
  const sample = outerRing[0]!;
  if (!isPlausibleUsPosition(sample)) {
    const repaired = repairUsPosition(sample);
    if (!repaired) {
      return {
        geometry: null,
        reason: `coordinates outside the United States: ${sample[0].toFixed(4)}, ${sample[1].toFixed(4)}`,
      };
    }
    // A whole-geometry transposition: repair every position consistently.
    const swapped = cleaned.map((polygon) =>
      polygon.map((ring) => ring.map(([a, b]): Position => [b, a])),
    );
    return {
      geometry:
        swapped.length === 1
          ? { type: 'Polygon', coordinates: swapped[0]! }
          : { type: 'MultiPolygon', coordinates: swapped },
      reason: 'latitude/longitude were transposed and have been corrected',
    };
  }

  const result: ParcelGeometry =
    cleaned.length === 1
      ? { type: 'Polygon', coordinates: cleaned[0]! }
      : { type: 'MultiPolygon', coordinates: cleaned };

  const area = turf.area(turf.feature(result));
  if (!Number.isFinite(area) || area <= 0) {
    return { geometry: null, reason: 'degenerate geometry with zero area' };
  }
  // A single parcel larger than ~50 square miles is a data error (usually the
  // whole county boundary joined onto every row).
  if (area > 130_000_000) {
    return { geometry: null, reason: `implausible parcel area of ${(area / 1e6).toFixed(1)} km²` };
  }

  return { geometry: result, reason: null };
}

export function centroidOf(geometry: ParcelGeometry): Position {
  const surface = turf.pointOnFeature(turf.feature(geometry));
  return surface.geometry.coordinates as Position;
}

export function bboxOf(geometry: AnyGeometry): [number, number, number, number] {
  return turf.bbox(turf.feature(geometry)) as [number, number, number, number];
}

export function distanceMeters(a: Position, b: Position): number {
  return turf.distance(turf.point(a), turf.point(b), { units: 'meters' });
}

/** Build a square-ish polygon of the given acreage around a point. */
export function syntheticParcel(center: Position, acres: number, aspect = 1): ParcelGeometry {
  const areaSqMeters = acres * 4046.8564224;
  const width = Math.sqrt(areaSqMeters / aspect);
  const height = width * aspect;
  const latRad = (center[1] * Math.PI) / 180;
  const degPerMeterLat = 1 / 110_574;
  const degPerMeterLon = 1 / (111_320 * Math.cos(latRad));
  const dx = (width / 2) * degPerMeterLon;
  const dy = (height / 2) * degPerMeterLat;
  const ring: Position[] = [
    [center[0] - dx, center[1] - dy],
    [center[0] + dx, center[1] - dy],
    [center[0] + dx, center[1] + dy],
    [center[0] - dx, center[1] + dy],
    [center[0] - dx, center[1] - dy],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

// --- internals -------------------------------------------------------------

function isFinitePosition(position: unknown): position is Position {
  return (
    Array.isArray(position) &&
    position.length >= 2 &&
    Number.isFinite(position[0]) &&
    Number.isFinite(position[1])
  );
}

function clampPosition(position: Position): Position {
  return [position[0], position[1]];
}

function closeRing(ring: Position[]): Position[] {
  if (ring.length < 3) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function reverse(ring: Position[]): Position[] {
  return [...ring].reverse();
}

/** Shoelace. Positive result means clockwise in standard x/y orientation. */
function signedArea(ring: Position[]): number {
  let total = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    total += (x2 - x1) * (y2 + y1);
  }
  return total;
}

function ringContains(ring: Position[], point: Position): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
