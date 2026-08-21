/**
 * Minimal GeoJSON contracts. We deliberately do not re-export a GIS library's
 * types from `shared` — `shared` must stay dependency-light so every package
 * and the browser bundle can import it.
 *
 * All coordinates are [longitude, latitude] in EPSG:4326, matching GeoJSON and
 * PostGIS SRID 4326.
 */

export type Position = [number, number];

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}

export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}

export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: Position[][];
}

export type ParcelGeometry = PolygonGeometry | MultiPolygonGeometry;

export type AnyGeometry =
  | PointGeometry
  | PolygonGeometry
  | MultiPolygonGeometry
  | LineStringGeometry
  | MultiLineStringGeometry;

export interface Feature<G extends AnyGeometry = AnyGeometry, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
  id?: string | number;
}

export interface FeatureCollection<
  G extends AnyGeometry = AnyGeometry,
  P = Record<string, unknown>,
> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
}

/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export function isPolygonal(geometry: AnyGeometry | null | undefined): geometry is ParcelGeometry {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon';
}

export function bboxContains(bbox: BBox, position: Position): boolean {
  const [west, south, east, north] = bbox;
  const [lon, lat] = position;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

export function expandBBox(bbox: BBox, degrees: number): BBox {
  return [bbox[0] - degrees, bbox[1] - degrees, bbox[2] + degrees, bbox[3] + degrees];
}

/**
 * Sanity bounds for the contiguous United States plus Alaska/Hawaii.
 * Coordinates outside this box are almost always a swapped lat/lon or a
 * state-plane value that was never reprojected, and are rejected at ingestion.
 */
export const US_BOUNDS: BBox = [-179.5, 17.5, -64.5, 72.0];

export function isPlausibleUsPosition(position: Position): boolean {
  return bboxContains(US_BOUNDS, position);
}

/**
 * Detect and repair the single most common coordinate defect in county data:
 * latitude and longitude transposed. Returns null when the position cannot be
 * made plausible, so the caller can reject rather than persist nonsense.
 */
export function repairUsPosition(position: Position): Position | null {
  if (isPlausibleUsPosition(position)) return position;
  const swapped: Position = [position[1], position[0]];
  if (isPlausibleUsPosition(swapped)) return swapped;
  return null;
}
