import { env } from '@land-alpha/shared/env';
import { distanceMeters } from '@land-alpha/gis';
import type { Position } from '@land-alpha/shared';
import type { EnrichmentContext, EnrichmentTarget } from './types';
import { describeUnavailable } from './unavailable';

/**
 * Terrain from USGS 3DEP.
 *
 * Slope is estimated by sampling a small cross around the parcel centroid
 * rather than by processing a DEM raster. That is a deliberate trade: it is an
 * order of magnitude cheaper, needs no raster toolchain, and is entirely
 * adequate for a screen whose only question is "is this parcel flat, rolling,
 * or steep?".
 *
 * Two services answer, and which one is used dominates the cost of an
 * enrichment run. The 3DEP ImageServer's `getSamples` takes every point in one
 * request; the Elevation Point Query Service takes one point per request, and
 * with the politeness delay between calls to the same host that turned five
 * samples into roughly forty seconds — per parcel. The batch service is tried
 * first and the point service is the fallback, so a parcel outside 3DEP
 * coverage or a batch outage still produces an answer.
 */

export interface TerrainObservation {
  readonly meanElevationMeters: number | null;
  readonly minElevationMeters: number | null;
  readonly maxElevationMeters: number | null;
  readonly meanSlopePercent: number | null;
  readonly sampleCount: number;
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

export async function fetchTerrain(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
): Promise<TerrainObservation> {
  const source = 'USGS 3DEP elevation';
  const empty: TerrainObservation = {
    meanElevationMeters: null,
    minElevationMeters: null,
    maxElevationMeters: null,
    meanSlopePercent: null,
    sampleCount: 0,
    available: false,
    source,
    note: null,
  };
  if (ctx.mode === 'fixture') return { ...empty, note: 'fixture mode' };

  const samples = samplePositions(target);

  // Kept so that a run where *every* sample failed can say why. One dropped
  // sample is noise; all of them dropped is a fact about the service, and
  // "no elevation samples returned" hides which.
  let lastError: unknown = null;

  let elevations = await sampleInOneRequest(ctx, samples).catch((error: unknown) => {
    lastError = error;
    return [] as { position: Position; elevation: number }[];
  });

  if (elevations.length === 0) {
    const fallback = await samplePointByPoint(ctx, samples);
    elevations = fallback.elevations;
    lastError = fallback.lastError ?? lastError;
  }

  if (elevations.length === 0) {
    return {
      ...empty,
      note: lastError
        ? describeUnavailable(lastError, null)
        : 'the elevation service returned no samples for this location',
    };
  }

  const values = elevations.map((sample) => sample.elevation);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

  // Slope from the steepest pairwise gradient between the centre sample and
  // each outer sample — a conservative reading, since a screen should not
  // under-report steepness.
  let maxSlope = 0;
  const centre = elevations[0]!;
  for (const sample of elevations.slice(1)) {
    const horizontal = distanceMeters(centre.position, sample.position);
    if (horizontal < 1) continue;
    const slope = Math.abs(sample.elevation - centre.elevation) / horizontal;
    if (slope > maxSlope) maxSlope = slope;
  }

  return {
    meanElevationMeters: round(mean),
    minElevationMeters: round(Math.min(...values)),
    maxElevationMeters: round(Math.max(...values)),
    meanSlopePercent: elevations.length > 1 ? round(maxSlope * 100) : null,
    sampleCount: elevations.length,
    available: true,
    source,
    note:
      elevations.length < samples.length
        ? `${elevations.length} of ${samples.length} elevation samples returned data.`
        : null,
  };
}

/**
 * Every sample in one request, via the 3DEP ImageServer.
 *
 * `getSamples` is the documented multipoint operation on an ArcGIS image
 * service. `locationId` maps each returned sample back to its input index, and
 * points outside coverage simply do not come back — so the caller gets fewer
 * samples rather than wrong ones.
 */
async function sampleInOneRequest(
  ctx: EnrichmentContext,
  samples: Position[],
): Promise<{ position: Position; elevation: number }[]> {
  const params = new URLSearchParams({
    geometry: JSON.stringify({
      points: samples.map((position) => [position[0], position[1]]),
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    f: 'json',
  });

  const response = await ctx.http.getJson<{
    samples?: { locationId?: number; value?: string | number }[];
    error?: unknown;
  }>(`${env().USGS_3DEP_IMAGE_URL}/getSamples?${params.toString()}`);

  if (response.error || !response.samples) return [];

  const located: { index: number; position: Position; elevation: number }[] = [];
  for (const sample of response.samples) {
    const index = sample.locationId;
    if (typeof index !== 'number') continue;
    const position = samples[index];
    if (!position) continue;
    const value = Number(sample.value);
    // A large negative sentinel means "no data", not "below sea level".
    if (!Number.isFinite(value) || value <= -1000) continue;
    located.push({ index, position, elevation: value });
  }
  // Slope is measured from the centre outwards, so the centre sample has to
  // come first whatever order the service returned things in. Sorting on the
  // service's own locationId rather than on the position keeps that true even
  // if two sample points coincide.
  return located
    .sort((a, b) => a.index - b.index)
    .map(({ position, elevation }) => ({ position, elevation }));
}

/** One request per point. Correct, and slow enough to matter at scale. */
async function samplePointByPoint(
  ctx: EnrichmentContext,
  samples: Position[],
): Promise<{ elevations: { position: Position; elevation: number }[]; lastError: unknown }> {
  const elevations: { position: Position; elevation: number }[] = [];
  let lastError: unknown = null;

  for (const position of samples) {
    if (ctx.signal?.aborted) break;
    const url = `${env().USGS_EPQS_URL}?x=${position[0].toFixed(6)}&y=${position[1].toFixed(6)}&units=Meters&wkid=4326&includeDate=false`;
    try {
      const response = await ctx.http.getJson<{ value?: number | string; error?: unknown }>(url);
      const value = Number(response.value);
      if (Number.isFinite(value) && value > -1000) {
        elevations.push({ position, elevation: value });
      }
    } catch (error) {
      // A missing sample is tolerable; a missing service is reported by caller.
      lastError = error;
    }
  }
  return { elevations, lastError };
}

/** Centre plus four points at roughly the parcel's own radius. */
function samplePositions(target: EnrichmentTarget): Position[] {
  const [lon, lat] = target.centroid;
  const acres = target.acreage ?? 5;
  const radiusMeters = Math.max(40, Math.min(400, Math.sqrt(acres * 4046.86) / 2));
  const degLat = radiusMeters / 110_574;
  const degLon = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon, lat],
    [lon, lat + degLat],
    [lon, lat - degLat],
    [lon + degLon, lat],
    [lon - degLon, lat],
  ];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
