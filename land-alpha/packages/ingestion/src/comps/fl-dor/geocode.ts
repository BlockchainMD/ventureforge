// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- see below
/// <reference path="./shapefile.d.ts" />
// `shapefile` ships no types, and the web app typechecks this file through its
// own tsconfig, which does not include a sibling declaration. A reference is
// the mechanism TypeScript provides for a file that has to carry its own
// declaration across a compilation boundary; an import cannot substitute,
// because importing the untyped module is the thing being declared.
import { open as openShapefile } from 'shapefile';
import { unzipSync } from 'fflate';
import { prisma } from '@land-alpha/db';
import { createLogger } from '@land-alpha/shared/logger';
import type { IngestHttpClient } from '../../fetch/http';
import { absoluteUrl } from './catalog';

/**
 * Put the Florida comparables on the map.
 *
 * The assessment roll carries no coordinates, which caps every Florida
 * valuation at LOW confidence however many sales back it — in a county spanning
 * a city and its farmland, plenty of agreeing sales is not the same as plenty
 * of nearby ones, and the valuation engine is right to say so.
 *
 * The Department of Revenue publishes the missing half in the same library: a
 * parcel shapefile per county, keyed on the same parcel identifier as the roll,
 * produced by the same agency. Joining them is the cheapest way to turn a pile
 * of prices into a comparable set that knows where it is.
 *
 * Two details make it work:
 *
 *   Projection. The shapefiles are in NAD83(HARN) State Plane feet, in one of
 *   Florida's three zones, so the coordinates are in feet from a false origin
 *   and mean nothing until transformed. The zone is read from the `.prj` rather
 *   than assumed, and the transform is done by PostGIS, which already carries
 *   the datum shifts.
 *
 *   Centroids. Computed by the shoelace formula on the largest ring, in
 *   projected space where the plane geometry the formula assumes actually
 *   holds. Averaging vertices would pull the point towards whichever edge has
 *   the most of them, which for a river-front parcel is the river.
 */

const logger = createLogger({ component: 'fl-dor-geocode' });

const MAP_LIBRARY = '/property/dataportal/Documents/PTO Data Portal/Map Data';

/**
 * Florida's three State Plane zones as NAD83(HARN), US survey feet. The
 * shapefiles name the zone in their projection string; this maps the name to
 * the code PostGIS knows it by.
 */
const FLORIDA_ZONE_SRID: { pattern: RegExp; srid: number }[] = [
  { pattern: /Florida_East|FIPS_0901/i, srid: 2881 },
  { pattern: /Florida_West|FIPS_0902/i, srid: 2882 },
  { pattern: /Florida_North|FIPS_0903/i, srid: 2883 },
];

export interface GeocodeResult {
  readonly county: string;
  readonly vintage: string;
  readonly comparablesWanted: number;
  readonly parcelsScanned: number;
  readonly located: number;
  readonly srid: number;
  readonly warnings: string[];
}

export function sridFromProjection(prj: string): number | null {
  // Geographic already: nothing to transform.
  if (/GEOGCS/i.test(prj) && !/PROJCS/i.test(prj)) return 4326;
  for (const zone of FLORIDA_ZONE_SRID) {
    if (zone.pattern.test(prj)) return zone.srid;
  }
  return null;
}

/**
 * Area-weighted centroid of a ring, by the shoelace formula.
 *
 * Returns null for a degenerate ring — a sliver with zero computed area would
 * otherwise divide by zero and produce a parcel somewhere off the coast.
 */
export function ringCentroid(ring: readonly (readonly number[])[]): [number, number] | null {
  if (ring.length < 3) return null;
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = [ring[i]![0]!, ring[i]![1]!];
    const [xj, yj] = [ring[j]![0]!, ring[j]![1]!];
    const cross = xj * yi - xi * yj;
    twiceArea += cross;
    x += (xj + xi) * cross;
    y += (yj + yi) * cross;
  }
  if (twiceArea === 0) return null;
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/** The largest ring of a polygon or multipolygon, by absolute shoelace area. */
export function representativeCentroid(geometry: {
  type: string;
  coordinates: unknown;
}): [number, number] | null {
  const rings: (readonly number[])[][] = [];
  if (geometry.type === 'Polygon') {
    rings.push(...(geometry.coordinates as (readonly number[])[][]));
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates as (readonly number[])[][][]) {
      rings.push(...polygon);
    }
  } else {
    return null;
  }

  let best: { ring: (readonly number[])[]; area: number } | null = null;
  for (const ring of rings) {
    let twiceArea = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      twiceArea += ring[j]![0]! * ring[i]![1]! - ring[i]![0]! * ring[j]![1]!;
    }
    const area = Math.abs(twiceArea) / 2;
    if (!best || area > best.area) best = { ring, area };
  }
  return best ? ringCentroid(best.ring) : null;
}

export async function geocodeFloridaComparables(
  http: IngestHttpClient,
  options: { county: string; state?: string; vintage?: string; signal?: AbortSignal },
): Promise<GeocodeResult> {
  const state = options.state ?? 'FL';
  const warnings: string[] = [];

  // Only comparables that still need a location.
  const pending = await prisma.comparableSale.findMany({
    where: { state, county: options.county, latitude: null },
    select: { id: true, apn: true },
  });
  if (pending.length === 0) {
    return {
      county: options.county,
      vintage: '',
      comparablesWanted: 0,
      parcelsScanned: 0,
      located: 0,
      srid: 0,
      warnings: ['Every comparable in this county already has a location.'],
    };
  }

  const wanted = new Map<string, string[]>();
  for (const row of pending) {
    const key = (row.apn ?? '').trim();
    if (!key) continue;
    const bucket = wanted.get(key);
    if (bucket) bucket.push(row.id);
    else wanted.set(key, [row.id]);
  }

  const file = await resolveParcelShapefile(http, options.county, options.vintage);
  logger.info('parcel shapefile resolved', {
    county: options.county,
    vintage: file.vintage,
    megabytes: (file.bytes / 1e6).toFixed(1),
  });

  // Inflate only the three entries that matter. A parcel archive also carries
  // spatial indexes and metadata that are useless here, and Orange County's is
  // a quarter of a gigabyte compressed — expanding all of it would cost several
  // hundred megabytes of memory to then throw away.
  // Allow roughly a minute per hundred megabytes, with a floor. Orange
  // County's archive is 257MB and will not arrive inside an API-sized deadline.
  const downloadTimeoutMs = Math.max(120_000, Math.ceil(file.bytes / 1e6) * 900);
  const archive = unzipSync(
    new Uint8Array((await http.get(file.url, {}, { timeoutMs: downloadTimeoutMs })).body),
    {
      filter: (entry) => /\.(shp|dbf|prj)$/i.test(entry.name),
    },
  );
  const entry = (extension: string): Uint8Array | null => {
    const name = Object.keys(archive).find((key) => key.toLowerCase().endsWith(extension));
    return name ? archive[name]! : null;
  };

  const shp = entry('.shp');
  const dbf = entry('.dbf');
  const prj = entry('.prj');
  if (!shp || !dbf) throw new Error(`${file.url} has no .shp/.dbf pair`);

  const srid = prj ? sridFromProjection(new TextDecoder().decode(prj)) : null;
  if (srid == null) {
    throw new Error(
      `Could not identify the projection of ${options.county}'s parcel file; refusing to guess a coordinate system.`,
    );
  }

  const idField = await detectIdField(shp, dbf);
  if (!idField) {
    throw new Error(`No parcel-identifier field found in ${options.county}'s parcel file`);
  }

  // (comparable id, x, y) in the file's own projection; PostGIS does the rest.
  const located: { ids: string[]; x: number; y: number }[] = [];
  let scanned = 0;

  const source = await openShapefile(shp, dbf);
  for (;;) {
    if (options.signal?.aborted) break;
    const result = await source.read();
    if (result.done) break;
    scanned += 1;
    const feature = result.value as {
      properties?: Record<string, unknown>;
      geometry?: { type: string; coordinates: unknown } | null;
    };
    const key = String(feature.properties?.[idField] ?? '').trim();
    if (!key) continue;
    const ids = wanted.get(key);
    if (!ids || !feature.geometry) continue;
    const centroid = representativeCentroid(feature.geometry);
    if (!centroid) continue;
    located.push({ ids, x: centroid[0], y: centroid[1] });
    wanted.delete(key);
  }

  let written = 0;
  for (const batch of chunk(located, 500)) {
    written += await writeCentroids(batch, srid);
  }

  if (wanted.size > 0) {
    warnings.push(
      `${wanted.size} parcels sold but are absent from the ${file.vintage} parcel file — usually split or combined since it was published.`,
    );
  }

  logger.info('florida comparables geocoded', {
    county: options.county,
    wanted: pending.length,
    scanned,
    located: written,
    srid,
  });

  return {
    county: options.county,
    vintage: file.vintage,
    comparablesWanted: pending.length,
    parcelsScanned: scanned,
    located: written,
    srid,
    warnings,
  };
}

/**
 * Write the points, transforming from the file's projection in the database.
 *
 * PostGIS carries the datum shifts for the State Plane zones; reimplementing
 * them in JavaScript would be a second, worse copy of a solved problem.
 */
async function writeCentroids(
  rows: { ids: string[]; x: number; y: number }[],
  srid: number,
): Promise<number> {
  const ids: string[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (const row of rows) {
    for (const id of row.ids) {
      ids.push(id);
      xs.push(row.x);
      ys.push(row.y);
    }
  }
  if (ids.length === 0) return 0;

  const updated = await prisma.$executeRaw`
    WITH points AS (
      SELECT
        t.id,
        ST_Transform(
          ST_SetSRID(ST_MakePoint(t.x, t.y), ${srid}::int),
          4326
        ) AS geom
      FROM UNNEST(
        ${ids}::text[],
        ${xs}::double precision[],
        ${ys}::double precision[]
      ) AS t(id, x, y)
    )
    UPDATE "ComparableSale" c
    SET "centroid" = points.geom,
        "longitude" = ST_X(points.geom),
        "latitude"  = ST_Y(points.geom)
    FROM points
    WHERE c."id" = points.id
      -- A transform that lands outside Florida means the projection was read
      -- wrongly, and a comparable in the wrong state is worse than one with no
      -- location at all.
      AND ST_X(points.geom) BETWEEN -88 AND -79
      AND ST_Y(points.geom) BETWEEN 24 AND 31.5
  `;
  return updated;
}

async function detectIdField(shp: Uint8Array, dbf: Uint8Array): Promise<string | null> {
  const source = await openShapefile(shp, dbf);
  const first = await source.read();
  if (first.done) return null;
  const properties = (first.value as { properties?: Record<string, unknown> }).properties ?? {};
  const names = Object.keys(properties);
  return (
    names.find((name) => /^PARCELNO$/i.test(name)) ??
    names.find((name) => /^PARCEL_?ID$/i.test(name)) ??
    names.find((name) => /PARCEL/i.test(name)) ??
    names.find((name) => /^PIN$/i.test(name)) ??
    null
  );
}

async function resolveParcelShapefile(
  http: IngestHttpClient,
  county: string,
  vintage?: string,
): Promise<{ url: string; bytes: number; vintage: string }> {
  interface SpEntry {
    Name: string;
    Length: string | number;
    ServerRelativeUrl: string;
    ItemCount?: number;
  }
  const api = (path: string, child: 'Folders' | 'Files'): string =>
    `https://floridarevenue.com/property/dataportal/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(path)}')/${child}`;

  let vintages: string[];
  if (vintage) {
    vintages = [vintage];
  } else {
    const folders = await http.getJson<{ value: SpEntry[] }>(api(MAP_LIBRARY, 'Folders'));
    vintages = folders.value
      // A year with only a handful of files is a partial publication; the ones
      // worth reading carry a file per county.
      .filter((folder) => /^\d{4}[A-Z]?$/.test(folder.Name) && (folder.ItemCount ?? 0) >= 60)
      .map((folder) => folder.Name)
      .sort()
      .reverse();
  }

  const slug = county.toLowerCase().replace(/[^a-z]/g, '');
  for (const candidate of vintages) {
    const files = await http.getJson<{ value: SpEntry[] }>(
      api(`${MAP_LIBRARY}/${candidate}`, 'Files'),
    );
    const match = files.value.find((file) =>
      file.Name.toLowerCase()
        .replace(/[^a-z]/g, '')
        .startsWith(slug),
    );
    if (match) {
      return {
        url: absoluteUrl(match.ServerRelativeUrl),
        bytes: Number(match.Length) || 0,
        vintage: candidate,
      };
    }
  }
  throw new Error(`No parcel shapefile published for ${county} County`);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
