import * as turf from '@turf/turf';
import {
  sqMetersToAcres,
  type BBox,
  type ParcelGeometry,
  type Position,
  type ShapeMetrics,
} from '@land-alpha/shared';

/**
 * Parcel shape analysis.
 *
 * Government surplus inventory is full of parcels that are technically real
 * estate and practically worthless: 8-foot strips left over from a road
 * widening, slivers between two platted lots, drainage remnants. They have
 * APNs, minimum bids and acreage figures, and they look like deals in a table.
 *
 * This module's job is to recognise them from geometry alone, before an analyst
 * spends attention on them. That is the highest-leverage rejection in the whole
 * pipeline: it is cheap, it is deterministic, and it removes the largest
 * category of junk.
 *
 * Measurements come from PostGIS at ingestion time where a database round-trip
 * is acceptable; this module provides the same computations in-process for
 * fixtures, tests and adapters that have not persisted yet.
 */

export interface ShapeThresholds {
  /** Below this, a parcel is a "tiny parcel" regardless of shape. */
  tinyAcreage: number;
  /** 4πA/P² below this is a sliver. */
  sliverCompactness: number;
  /** Long-axis / short-axis above this is a narrow strip. */
  narrowAspectRatio: number;
  /** Absolute width below this (metres) reads as a strip, whatever the ratio. */
  narrowWidthMeters: number;
  /** Compactness below this is "irregular" but not necessarily unusable. */
  irregularCompactness: number;
}

export const DEFAULT_SHAPE_THRESHOLDS: ShapeThresholds = {
  tinyAcreage: 0.08,
  sliverCompactness: 0.12,
  narrowAspectRatio: 8,
  narrowWidthMeters: 15,
  irregularCompactness: 0.3,
};

/**
 * Compute shape metrics from a polygon.
 *
 * Width and height are taken from the *minimum-area oriented bounding box*, not
 * the axis-aligned envelope. A diagonal 10m × 400m strip has a nearly square
 * axis-aligned bbox and would otherwise be scored as a well-formed parcel —
 * exactly the failure this module exists to prevent.
 */
export function analyzeShape(
  geometry: ParcelGeometry,
  thresholds: ShapeThresholds = DEFAULT_SHAPE_THRESHOLDS,
): ShapeMetrics {
  const feature = turf.feature(geometry);
  const areaSqMeters = turf.area(feature);
  const acreage = sqMetersToAcres(areaSqMeters);
  const perimeterMeters = polygonPerimeterMeters(geometry);
  const surface = turf.pointOnFeature(feature);
  const centroid = surface.geometry.coordinates as Position;
  const bbox = turf.bbox(feature) as BBox;
  const vertexCount = countVertices(geometry);

  const { widthMeters, heightMeters } = orientedExtents(geometry);
  const longest = Math.max(widthMeters, heightMeters);
  const shortest = Math.max(Math.min(widthMeters, heightMeters), 0.0001);
  const aspectRatio = longest / shortest;

  // Polsby-Popper compactness. 1.0 = circle, 0.78 = square, < 0.15 = sliver.
  const compactness =
    perimeterMeters > 0 ? (4 * Math.PI * areaSqMeters) / (perimeterMeters * perimeterMeters) : 0;

  const isTinyParcel = acreage < thresholds.tinyAcreage;
  const isNarrowStrip =
    aspectRatio >= thresholds.narrowAspectRatio || shortest <= thresholds.narrowWidthMeters;
  const isSliver = compactness < thresholds.sliverCompactness;
  const isIrregular = compactness < thresholds.irregularCompactness && !isSliver;

  /**
   * Roadway remnant heuristic: long, thin, and roughly the width of a public
   * right-of-way. Flagged rather than auto-rejected — a genuine 20m-wide
   * lakefront strip exists and an analyst should get the chance to see it.
   */
  const likelyRoadwayRemnant =
    isNarrowStrip && longest > 60 && shortest <= 25 && compactness < 0.18;

  const flags: string[] = [];
  if (isTinyParcel) flags.push('TINY_PARCEL');
  if (isNarrowStrip) flags.push('NARROW_STRIP');
  if (isSliver) flags.push('SLIVER');
  if (isIrregular) flags.push('IRREGULAR_SHAPE');
  if (likelyRoadwayRemnant) flags.push('LIKELY_ROADWAY_REMNANT');
  if (vertexCount > 400) flags.push('COMPLEX_BOUNDARY');
  if (geometry.type === 'MultiPolygon' && geometry.coordinates.length > 1) {
    flags.push('MULTIPART_PARCEL');
  }

  return {
    acreage,
    areaSqMeters,
    perimeterMeters,
    centroid,
    bbox,
    widthMeters,
    heightMeters,
    compactness,
    aspectRatio,
    vertexCount,
    isNarrowStrip,
    isSliver,
    isIrregular,
    isTinyParcel,
    likelyRoadwayRemnant,
    shapeScore: shapeScore({
      compactness,
      aspectRatio,
      acreage,
      isSliver,
      isNarrowStrip,
      likelyRoadwayRemnant,
    }),
    flags,
  };
}

/**
 * 0-100 usability score for the parcel's geometry.
 *
 * A conventional rectangular lot scores in the 80s; a circle would score 100
 * but no parcel is circular. The score feeds the Alpha Score's 5% shape weight.
 */
export function shapeScore(input: {
  compactness: number;
  aspectRatio: number;
  acreage: number;
  isSliver: boolean;
  isNarrowStrip: boolean;
  likelyRoadwayRemnant: boolean;
}): number {
  if (input.likelyRoadwayRemnant) return 2;
  if (input.isSliver) return 8;

  // A square (0.785) is the practical ceiling for a real parcel, so normalise
  // against it rather than against a circle nobody will ever plat.
  const compactnessComponent = Math.min(1, input.compactness / 0.785) * 70;

  const aspectPenalty = input.aspectRatio <= 2 ? 0 : Math.min(30, (input.aspectRatio - 2) * 5);

  const usabilityBonus = input.acreage >= 1 ? 30 : input.acreage >= 0.25 ? 22 : 12;

  return clamp(Math.round(compactnessComponent + usabilityBonus - aspectPenalty), 0, 100);
}

/**
 * Minimum-area oriented bounding box extents.
 *
 * Turf has no oriented-bbox helper, so the rotating-calipers approximation is
 * done here: rotate the polygon through 90° in 3° steps, take the axis-aligned
 * extents at each angle, and keep the rotation with the smallest area.
 */
export function orientedExtents(geometry: ParcelGeometry): {
  widthMeters: number;
  heightMeters: number;
  angleDegrees: number;
} {
  const points = collectPositions(geometry);
  if (points.length < 3) return { widthMeters: 0, heightMeters: 0, angleDegrees: 0 };

  const origin = points[0]!;
  // Project to a local metric plane so rotation is meaningful. At parcel scale
  // (< a few km) an equirectangular projection about the parcel's own latitude
  // is accurate to well under a metre.
  const latRad = (origin[1] * Math.PI) / 180;
  const metersPerDegLat = 111_132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegLon = 111_412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

  const local = points.map(([lon, lat]): [number, number] => [
    (lon - origin[0]) * metersPerDegLon,
    (lat - origin[1]) * metersPerDegLat,
  ]);

  let best = { width: Infinity, height: Infinity, area: Infinity, angle: 0 };
  for (let deg = 0; deg < 90; deg += 3) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of local) {
      const rx = x * cos + y * sin;
      const ry = -x * sin + y * cos;
      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;
    if (area < best.area) best = { width, height, area, angle: deg };
  }

  return {
    widthMeters: Math.min(best.width, best.height),
    heightMeters: Math.max(best.width, best.height),
    angleDegrees: best.angle,
  };
}

export function polygonPerimeterMeters(geometry: ParcelGeometry): number {
  const rings =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flatMap((p) => p);
  let total = 0;
  for (const ring of rings) {
    if (ring.length < 2) continue;
    total += turf.length(turf.lineString(ring as number[][]), { units: 'meters' });
  }
  return total;
}

export function collectPositions(geometry: ParcelGeometry): Position[] {
  const rings =
    geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flatMap((p) => p);
  return rings.flat() as Position[];
}

function countVertices(geometry: ParcelGeometry): number {
  return collectPositions(geometry).length;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Cross-check a source-reported acreage against the acreage implied by the
 * geometry. A large disagreement means one of them is wrong, and we must not
 * quietly average them: it is reported so the parcel's confidence drops.
 */
export function acreageAgreement(
  reportedAcres: number | null | undefined,
  geometryAcres: number | null | undefined,
): { agrees: boolean | null; deltaFraction: number | null; note: string | null } {
  if (reportedAcres == null || geometryAcres == null || reportedAcres <= 0 || geometryAcres <= 0) {
    return { agrees: null, deltaFraction: null, note: null };
  }
  const delta = Math.abs(reportedAcres - geometryAcres) / Math.max(reportedAcres, geometryAcres);
  if (delta <= 0.1) return { agrees: true, deltaFraction: delta, note: null };
  return {
    agrees: false,
    deltaFraction: delta,
    note: `Source reports ${reportedAcres.toFixed(2)} ac but mapped geometry measures ${geometryAcres.toFixed(2)} ac (${(delta * 100).toFixed(0)}% apart). Acreage requires verification.`,
  };
}
