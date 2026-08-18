import { env } from '@land-alpha/shared/env';
import { distanceMeters } from '@land-alpha/gis';
import type { Position } from '@land-alpha/shared';
import type { EnrichmentContext, EnrichmentTarget } from './types';

/**
 * Terrain from the USGS 3DEP elevation point query service.
 *
 * The service returns a single elevation per request, so slope is estimated by
 * sampling a small cross around the parcel centroid rather than by processing a
 * DEM raster. That is a deliberate trade: it is one order of magnitude cheaper,
 * needs no raster toolchain, and is entirely adequate for a screen whose only
 * question is "is this parcel flat, rolling, or steep?".
 *
 * A real DEM pass belongs in a later raster service; the output contract here
 * will not change when it arrives.
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
  const source = 'USGS 3DEP Elevation Point Query Service';
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
  const elevations: { position: Position; elevation: number }[] = [];

  for (const position of samples) {
    if (ctx.signal?.aborted) break;
    const url = `${env().USGS_EPQS_URL}?x=${position[0].toFixed(6)}&y=${position[1].toFixed(6)}&units=Meters&wkid=4326&includeDate=false`;
    try {
      const response = await ctx.http.getJson<{ value?: number | string; error?: unknown }>(url);
      const value = Number(response.value);
      // The service returns a large negative sentinel for "no data".
      if (Number.isFinite(value) && value > -1000) {
        elevations.push({ position, elevation: value });
      }
    } catch {
      // A missing sample is tolerable; a missing service is reported below.
    }
  }

  if (elevations.length === 0) {
    return { ...empty, note: 'no elevation samples returned' };
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
