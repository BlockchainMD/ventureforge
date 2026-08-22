import { Prisma } from '@prisma/client';
import { prisma } from './client';
import type { AnyGeometry, BBox, ParcelGeometry, Position } from '@land-alpha/shared';

/**
 * Every PostGIS interaction in Land Alpha lives here.
 *
 * Note on ids: Prisma maps `String @id @default(uuid())` to a `text` column,
 * not Postgres `uuid`. Parameters are therefore bound as text with no cast —
 * adding `::uuid` produces `operator does not exist: text = uuid` at runtime.
 *
 * Two rules, both load-bearing:
 *
 *  1. Geometry is always SRID 4326. Anything arriving in another projection is
 *     reprojected by the caller before it gets here.
 *  2. Every *measurement* is taken on the `geography` type. `ST_Area(geom)` on a
 *     4326 geometry returns square degrees, which is a meaningless number that
 *     silently becomes a wrong acreage; `ST_Area(geom::geography)` returns
 *     square metres. This distinction is the most common way a GIS pipeline
 *     produces confidently wrong land measurements, so it is enforced here
 *     rather than left to each caller.
 *
 * All values are interpolated through Prisma's tagged-template parameter
 * binding, never string concatenation.
 */

export interface GeometryMeasurements {
  readonly areaSqMeters: number;
  readonly perimeterMeters: number;
  readonly centroid: Position;
  readonly bbox: BBox;
  readonly isValid: boolean;
  readonly invalidReason: string | null;
  readonly vertexCount: number;
}

function geoJsonParam(geometry: AnyGeometry): string {
  return JSON.stringify(geometry);
}

/**
 * Measure a geometry using PostGIS rather than an in-process approximation.
 * Used at ingestion time so that acreage derived from geometry is authoritative.
 */
export async function measureGeometry(geometry: AnyGeometry): Promise<GeometryMeasurements> {
  const json = geoJsonParam(geometry);
  const rows = await prisma.$queryRaw<
    {
      area_sq_m: number;
      perimeter_m: number;
      centroid_lon: number;
      centroid_lat: number;
      west: number;
      south: number;
      east: number;
      north: number;
      is_valid: boolean;
      invalid_reason: string | null;
      vertex_count: number;
    }[]
  >`
    WITH g AS (
      SELECT ST_SetSRID(ST_GeomFromGeoJSON(${json}::text), 4326) AS geom
    )
    SELECT
      ST_Area(geom::geography)                     AS area_sq_m,
      ST_Perimeter(geom::geography)                AS perimeter_m,
      ST_X(ST_PointOnSurface(geom))                AS centroid_lon,
      ST_Y(ST_PointOnSurface(geom))                AS centroid_lat,
      ST_XMin(geom)                                AS west,
      ST_YMin(geom)                                AS south,
      ST_XMax(geom)                                AS east,
      ST_YMax(geom)                                AS north,
      ST_IsValid(geom)                             AS is_valid,
      ST_IsValidReason(geom)                       AS invalid_reason,
      ST_NPoints(geom)                             AS vertex_count
    FROM g
  `;
  const row = rows[0];
  if (!row) throw new Error('PostGIS returned no measurement row');
  return {
    areaSqMeters: Number(row.area_sq_m),
    perimeterMeters: Number(row.perimeter_m),
    centroid: [Number(row.centroid_lon), Number(row.centroid_lat)],
    bbox: [Number(row.west), Number(row.south), Number(row.east), Number(row.north)],
    isValid: row.is_valid,
    invalidReason: row.is_valid ? null : row.invalid_reason,
    vertexCount: Number(row.vertex_count),
  };
}

/**
 * Persist parcel geometry.
 *
 * `ST_MakeValid` is applied because county polygons routinely contain
 * self-intersections; storing an invalid polygon poisons every later
 * intersection query. `ST_Multi` normalises to MultiPolygon so the check
 * constraint and downstream consumers see one shape family.
 */
export async function writeParcelGeometry(
  parcelId: string,
  geometry: ParcelGeometry,
): Promise<GeometryMeasurements> {
  const json = geoJsonParam(geometry);
  await prisma.$executeRaw`
    UPDATE "ParcelOpportunity"
    SET
      "geometry" = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}::text), 4326))),
      "centroid" = ST_PointOnSurface(
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}::text), 4326))
      )
    WHERE "id" = ${parcelId}
  `;
  return measureGeometry(geometry);
}

/** Persist a point-only location when no authoritative polygon is available. */
export async function writeParcelPoint(parcelId: string, position: Position): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ParcelOpportunity"
    SET "centroid" = ST_SetSRID(ST_MakePoint(${position[0]}::double precision, ${position[1]}::double precision), 4326)
    WHERE "id" = ${parcelId}
  `;
}

export async function readParcelGeometry(parcelId: string): Promise<ParcelGeometry | null> {
  const rows = await prisma.$queryRaw<{ geojson: string | null }[]>`
    SELECT ST_AsGeoJSON("geometry") AS geojson
    FROM "ParcelOpportunity"
    WHERE "id" = ${parcelId}
  `;
  const raw = rows[0]?.geojson;
  return raw ? (JSON.parse(raw) as ParcelGeometry) : null;
}

export async function readParcelGeometries(
  parcelIds: readonly string[],
): Promise<Map<string, ParcelGeometry>> {
  if (parcelIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ id: string; geojson: string | null }[]>`
    SELECT "id", ST_AsGeoJSON("geometry") AS geojson
    FROM "ParcelOpportunity"
    WHERE "id" IN (${Prisma.join(parcelIds.map((id) => Prisma.sql`${id}`))})
      AND "geometry" IS NOT NULL
  `;
  const out = new Map<string, ParcelGeometry>();
  for (const row of rows) {
    if (row.geojson) out.set(row.id, JSON.parse(row.geojson) as ParcelGeometry);
  }
  return out;
}

export interface MapParcelRow {
  id: string;
  apn: string | null;
  county: string;
  state: string;
  alphaScore: number | null;
  status: string;
  acreage: number | null;
  askingPrice: string | null;
  geojson: string | null;
  lon: number | null;
  lat: number | null;
}

/**
 * Viewport query for the map screen. Bounded by a hard row limit — an analyst
 * zoomed out to the whole country must not pull 400k polygons into a browser.
 */
export async function queryParcelsInBounds(
  bbox: BBox,
  options: { limit?: number; includeRejected?: boolean; minAlphaScore?: number } = {},
): Promise<MapParcelRow[]> {
  const limit = Math.min(options.limit ?? 2000, 5000);
  const includeRejected = options.includeRejected ?? false;
  const minAlpha = options.minAlphaScore ?? null;

  return prisma.$queryRaw<MapParcelRow[]>`
    SELECT
      p."id",
      p."apn",
      p."county",
      p."state",
      p."alphaScore",
      p."status"::text AS status,
      p."acreage",
      p."askingPrice"::text AS "askingPrice",
      ST_AsGeoJSON(ST_SimplifyPreserveTopology(p."geometry", 0.00002)) AS geojson,
      ST_X(p."centroid") AS lon,
      ST_Y(p."centroid") AS lat
    FROM "ParcelOpportunity" p
    WHERE
      COALESCE(p."geometry", p."centroid") && ST_MakeEnvelope(
        ${bbox[0]}::double precision, ${bbox[1]}::double precision,
        ${bbox[2]}::double precision, ${bbox[3]}::double precision, 4326
      )
      AND p."removedFromSourceAt" IS NULL
      AND (${includeRejected}::boolean OR p."rejected" = false)
      AND (${minAlpha}::double precision IS NULL OR p."alphaScore" >= ${minAlpha}::double precision)
    ORDER BY p."alphaScore" DESC NULLS LAST
    LIMIT ${limit}
  `;
}

export interface NearbyComparableRow {
  id: string;
  apn: string | null;
  saleDate: Date;
  salePrice: string;
  acreage: number;
  zoning: string | null;
  neighborhood: string | null;
  accessClass: string | null;
  hasUtilities: boolean | null;
  source: string;
  distance_m: number | null;
}

/**
 * Candidate comparable sales near a parcel.
 *
 * Uses `ST_DWithin(geography, geography, metres)`, which is index-assisted via
 * the GiST index on `ComparableSale.centroid`. Filtering happens in SQL rather
 * than by pulling the county's sales into Node: a busy Florida county has tens
 * of thousands of vacant-land transfers.
 */
export async function findNearbyComparables(params: {
  origin: Position;
  state: string;
  county?: string | null;
  radiusMeters: number;
  minAcreage: number;
  maxAcreage: number;
  soldSince: Date;
  limit?: number;
  /**
   * `exclude` for a real parcel, `only` for a fixture one. Synthetic and
   * recorded sales never appear in the same valuation: a fixture exists to make
   * the pipeline's conclusion deterministic, and one real sale in its comp set
   * would end that.
   */
  fixtures?: 'exclude' | 'only';
}): Promise<NearbyComparableRow[]> {
  const limit = Math.min(params.limit ?? 60, 250);
  const fixtureMode = params.fixtures ?? 'exclude';
  return prisma.$queryRaw<NearbyComparableRow[]>`
    SELECT
      c."id",
      c."apn",
      c."saleDate",
      c."salePrice"::text AS "salePrice",
      c."acreage",
      c."zoning",
      c."neighborhood",
      c."accessClass"::text AS "accessClass",
      c."hasUtilities",
      c."source",
      ST_Distance(
        c."centroid"::geography,
        ST_SetSRID(ST_MakePoint(${params.origin[0]}::double precision, ${params.origin[1]}::double precision), 4326)::geography
      ) AS distance_m
    FROM "ComparableSale" c
    WHERE
      c."state" = ${params.state}
      AND (${params.county ?? null}::text IS NULL OR c."county" = ${params.county ?? null}::text)
      AND c."isVacantLand" = true
      AND c."isArmsLength" = true
      AND (c."source" LIKE 'Development fixture%') = ${fixtureMode === 'only'}
      AND c."saleDate" >= ${params.soldSince}
      AND c."acreage" BETWEEN ${params.minAcreage}::double precision AND ${params.maxAcreage}::double precision
      AND c."salePrice" > 0
      AND (
        c."centroid" IS NULL
        OR ST_DWithin(
          c."centroid"::geography,
          ST_SetSRID(ST_MakePoint(${params.origin[0]}::double precision, ${params.origin[1]}::double precision), 4326)::geography,
          ${params.radiusMeters}::double precision
        )
      )
    ORDER BY distance_m NULLS LAST, c."saleDate" DESC
    LIMIT ${limit}
  `;
}

export async function writeComparableCentroid(
  comparableId: string,
  position: Position,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ComparableSale"
    SET "centroid" = ST_SetSRID(ST_MakePoint(${position[0]}::double precision, ${position[1]}::double precision), 4326)
    WHERE "id" = ${comparableId}
  `;
}

/**
 * Fraction of a parcel covered by an overlay geometry (flood zone, wetland).
 *
 * Returned as a 0..1 fraction of parcel area, computed in geography space.
 * Returns null when the parcel has no polygon — a point parcel cannot have a
 * meaningful overlap percentage, and reporting 0 would read as "no wetlands",
 * which is a materially different claim from "unknown".
 */
export async function overlayCoverageFraction(
  parcelId: string,
  overlay: AnyGeometry,
): Promise<number | null> {
  const json = geoJsonParam(overlay);
  const rows = await prisma.$queryRaw<{ fraction: number | null }[]>`
    WITH parcel AS (
      SELECT "geometry" AS geom FROM "ParcelOpportunity" WHERE "id" = ${parcelId}
    ),
    ov AS (
      SELECT ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${json}::text), 4326)) AS geom
    )
    SELECT
      CASE
        WHEN parcel.geom IS NULL THEN NULL
        WHEN ST_Area(parcel.geom::geography) = 0 THEN NULL
        ELSE ST_Area(ST_Intersection(parcel.geom, ov.geom)::geography)
             / ST_Area(parcel.geom::geography)
      END AS fraction
    FROM parcel, ov
  `;
  const fraction = rows[0]?.fraction;
  if (fraction == null) return null;
  return Math.min(1, Math.max(0, Number(fraction)));
}

/**
 * Fraction of a parcel covered by the union of several overlay geometries.
 * Unioning first matters: two overlapping FEMA polygons would otherwise
 * double-count and report >100% coverage.
 */
export async function overlayCoverageFractionMany(
  parcelId: string,
  overlays: readonly AnyGeometry[],
): Promise<number | null> {
  if (overlays.length === 0) return 0;
  const collection = JSON.stringify({
    type: 'GeometryCollection',
    geometries: overlays,
  });
  const rows = await prisma.$queryRaw<{ fraction: number | null }[]>`
    WITH parcel AS (
      SELECT "geometry" AS geom FROM "ParcelOpportunity" WHERE "id" = ${parcelId}
    ),
    ov AS (
      SELECT ST_UnaryUnion(
        ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${collection}::text), 4326))
      ) AS geom
    )
    SELECT
      CASE
        WHEN parcel.geom IS NULL THEN NULL
        WHEN ST_Area(parcel.geom::geography) = 0 THEN NULL
        ELSE ST_Area(ST_Intersection(parcel.geom, ov.geom)::geography)
             / ST_Area(parcel.geom::geography)
      END AS fraction
    FROM parcel, ov
  `;
  const fraction = rows[0]?.fraction;
  if (fraction == null) return null;
  return Math.min(1, Math.max(0, Number(fraction)));
}

/**
 * Length of the parcel boundary that lies within `toleranceMeters` of a road
 * centreline, and the name of the nearest road.
 *
 * This measures *physical adjacency only*. Nothing in this function establishes
 * legal access, and its output must never be labelled as such — see
 * docs/decisions/0006.
 */
export async function measureRoadAdjacency(params: {
  parcelId: string;
  roads: readonly { name: string | null; paved: boolean; geometry: AnyGeometry }[];
  toleranceMeters?: number;
}): Promise<{
  frontageMeters: number;
  nearestRoadName: string | null;
  nearestRoadMeters: number | null;
  nearestPavedRoadName: string | null;
  nearestPavedRoadMeters: number | null;
  touchesNamedRoad: boolean;
} | null> {
  if (params.roads.length === 0) return null;
  const tolerance = params.toleranceMeters ?? 12;

  const roadRows = params.roads.map(
    (road, index) =>
      Prisma.sql`SELECT
      ${index}::int AS idx,
      ${road.name ?? null}::text AS name,
      ${road.paved}::boolean AS paved,
      ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(road.geometry)}::text), 4326)) AS geom`,
  );

  const rows = await prisma.$queryRaw<
    {
      frontage_m: number | null;
      nearest_name: string | null;
      nearest_m: number | null;
      nearest_paved_name: string | null;
      nearest_paved_m: number | null;
    }[]
  >`
    WITH parcel AS (
      SELECT "geometry" AS geom FROM "ParcelOpportunity" WHERE "id" = ${params.parcelId}
    ),
    roads AS (
      ${Prisma.join(roadRows, ' UNION ALL ')}
    ),
    boundary AS (
      SELECT ST_Boundary(geom) AS geom FROM parcel WHERE geom IS NOT NULL
    ),
    buffered AS (
      SELECT ST_Union(ST_Buffer(r.geom::geography, ${tolerance}::double precision)::geometry) AS geom
      FROM roads r
    ),
    distances AS (
      SELECT
        r.name,
        r.paved,
        ST_Distance(p.geom::geography, r.geom::geography) AS dist
      FROM roads r, parcel p
      WHERE p.geom IS NOT NULL
    )
    SELECT
      (SELECT ST_Length(ST_Intersection(b.geom, bf.geom)::geography)
         FROM boundary b, buffered bf)                                     AS frontage_m,
      (SELECT name FROM distances ORDER BY dist ASC LIMIT 1)               AS nearest_name,
      (SELECT dist FROM distances ORDER BY dist ASC LIMIT 1)               AS nearest_m,
      (SELECT name FROM distances WHERE paved ORDER BY dist ASC LIMIT 1)   AS nearest_paved_name,
      (SELECT dist FROM distances WHERE paved ORDER BY dist ASC LIMIT 1)   AS nearest_paved_m
  `;

  const row = rows[0];
  if (!row) return null;
  const nearestName = row.nearest_name;
  return {
    frontageMeters: row.frontage_m == null ? 0 : Number(row.frontage_m),
    nearestRoadName: nearestName,
    nearestRoadMeters: row.nearest_m == null ? null : Number(row.nearest_m),
    nearestPavedRoadName: row.nearest_paved_name,
    nearestPavedRoadMeters: row.nearest_paved_m == null ? null : Number(row.nearest_paved_m),
    touchesNamedRoad: Boolean(nearestName && Number(row.nearest_m ?? Infinity) <= tolerance),
  };
}

/** Parcels adjacent to (touching) the given parcel — used for assemblage hints. */
export async function findAdjacentParcels(
  parcelId: string,
  limit = 20,
): Promise<{ id: string; apn: string | null; acreage: number | null }[]> {
  return prisma.$queryRaw<{ id: string; apn: string | null; acreage: number | null }[]>`
    WITH target AS (
      SELECT "geometry" AS geom FROM "ParcelOpportunity" WHERE "id" = ${parcelId}
    )
    SELECT p."id", p."apn", p."acreage"
    FROM "ParcelOpportunity" p, target t
    WHERE t.geom IS NOT NULL
      AND p."id" <> ${parcelId}
      AND p."geometry" IS NOT NULL
      AND ST_DWithin(p."geometry"::geography, t.geom::geography, 5)
    LIMIT ${limit}
  `;
}

/**
 * Duplicate detection: another parcel with a substantially overlapping polygon.
 * Duplicates are a hard rejection rule, and the same parcel appearing in two
 * county lists under different APNs is common.
 */
export async function findGeometricDuplicates(
  parcelId: string,
  minOverlapFraction = 0.9,
): Promise<{ id: string; overlap: number }[]> {
  return prisma.$queryRaw<{ id: string; overlap: number }[]>`
    WITH target AS (
      SELECT "geometry" AS geom FROM "ParcelOpportunity" WHERE "id" = ${parcelId}
    )
    SELECT
      p."id",
      ST_Area(ST_Intersection(p."geometry", t.geom)::geography)
        / NULLIF(ST_Area(t.geom::geography), 0) AS overlap
    FROM "ParcelOpportunity" p, target t
    WHERE t.geom IS NOT NULL
      AND p."id" <> ${parcelId}
      AND p."geometry" IS NOT NULL
      AND p."geometry" && t.geom
      AND ST_Area(ST_Intersection(p."geometry", t.geom)::geography)
          / NULLIF(ST_Area(t.geom::geography), 0) >= ${minOverlapFraction}::double precision
    LIMIT 10
  `;
}

/** True when PostGIS is present and usable. Surfaced on the settings screen. */
export async function postgisVersion(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRaw<{ version: string }[]>`SELECT PostGIS_Version() AS version`;
    return rows[0]?.version ?? null;
  } catch {
    return null;
  }
}
