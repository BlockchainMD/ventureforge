import { describe, expect, it } from 'vitest';
import { analyzeShape, acreageAgreement, orientedExtents, shapeScore } from './shape';
import {
  syntheticParcel,
  esriPolygonToGeoJson,
  normalizeParcelGeometry,
  toWgs84,
} from './geometry';
import { sqMetersToAcres } from '@land-alpha/shared';
import type { ParcelGeometry, Position } from '@land-alpha/shared';

const NORTHERN_MN: Position = [-92.35, 47.42];

/** Build a rotated rectangle of the given metre dimensions around a centre. */
function rotatedRect(
  center: Position,
  widthMeters: number,
  heightMeters: number,
  rotationDegrees: number,
): ParcelGeometry {
  const latRad = (center[1] * Math.PI) / 180;
  const degPerMeterLat = 1 / 110_574;
  const degPerMeterLon = 1 / (111_320 * Math.cos(latRad));
  const rad = (rotationDegrees * Math.PI) / 180;
  const corners: [number, number][] = [
    [-widthMeters / 2, -heightMeters / 2],
    [widthMeters / 2, -heightMeters / 2],
    [widthMeters / 2, heightMeters / 2],
    [-widthMeters / 2, heightMeters / 2],
  ];
  const ring: Position[] = corners.map(([x, y]) => {
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);
    return [center[0] + rx * degPerMeterLon, center[1] + ry * degPerMeterLat];
  });
  ring.push(ring[0]!);
  return { type: 'Polygon', coordinates: [ring] };
}

describe('analyzeShape', () => {
  it('measures a conventional square parcel accurately', () => {
    const parcel = syntheticParcel(NORTHERN_MN, 5.23);
    const metrics = analyzeShape(parcel);

    expect(metrics.acreage).toBeCloseTo(5.23, 1);
    expect(metrics.isNarrowStrip).toBe(false);
    expect(metrics.isSliver).toBe(false);
    expect(metrics.likelyRoadwayRemnant).toBe(false);
    expect(metrics.flags).toHaveLength(0);
    expect(metrics.shapeScore).toBeGreaterThan(75);
  });

  it('flags a narrow strip even when it is rotated off-axis', () => {
    // 8m x 500m diagonal strip: its axis-aligned bounding box is almost square,
    // so only an oriented measurement can catch it.
    const strip = rotatedRect(NORTHERN_MN, 8, 500, 45);
    const metrics = analyzeShape(strip);

    expect(metrics.isNarrowStrip).toBe(true);
    expect(metrics.likelyRoadwayRemnant).toBe(true);
    expect(metrics.flags).toContain('LIKELY_ROADWAY_REMNANT');
    expect(metrics.shapeScore).toBeLessThan(10);
    expect(metrics.widthMeters).toBeLessThan(20);
    expect(metrics.heightMeters).toBeGreaterThan(400);
  });

  it('flags a tiny utility parcel', () => {
    const tiny = syntheticParcel(NORTHERN_MN, 0.02);
    const metrics = analyzeShape(tiny);

    expect(metrics.isTinyParcel).toBe(true);
    expect(metrics.flags).toContain('TINY_PARCEL');
  });

  it('scores a compact rural parcel above an elongated one of equal acreage', () => {
    const compact = analyzeShape(syntheticParcel(NORTHERN_MN, 4, 1));
    const elongated = analyzeShape(syntheticParcel(NORTHERN_MN, 4, 12));

    expect(compact.shapeScore).toBeGreaterThan(elongated.shapeScore);
    expect(elongated.aspectRatio).toBeGreaterThan(compact.aspectRatio);
  });

  it('never returns a score outside 0-100', () => {
    for (const aspect of [1, 3, 10, 40]) {
      for (const acres of [0.01, 0.5, 5, 200]) {
        const metrics = analyzeShape(syntheticParcel(NORTHERN_MN, acres, aspect));
        expect(metrics.shapeScore).toBeGreaterThanOrEqual(0);
        expect(metrics.shapeScore).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('orientedExtents', () => {
  it('recovers true dimensions regardless of rotation', () => {
    for (const rotation of [0, 17, 45, 73]) {
      const rect = rotatedRect(NORTHERN_MN, 30, 300, rotation);
      const { widthMeters, heightMeters } = orientedExtents(rect);
      // 3-degree search granularity gives a few percent of slack.
      expect(widthMeters).toBeGreaterThan(25);
      expect(widthMeters).toBeLessThan(45);
      expect(heightMeters).toBeGreaterThan(280);
      expect(heightMeters).toBeLessThan(330);
    }
  });
});

describe('shapeScore', () => {
  it('rejects an apparent roadway remnant outright', () => {
    expect(
      shapeScore({
        compactness: 0.1,
        aspectRatio: 30,
        acreage: 1.2,
        isSliver: false,
        isNarrowStrip: true,
        likelyRoadwayRemnant: true,
      }),
    ).toBeLessThan(5);
  });
});

describe('acreageAgreement', () => {
  it('accepts small differences between reported and mapped acreage', () => {
    const result = acreageAgreement(5.0, 5.2);
    expect(result.agrees).toBe(true);
    expect(result.note).toBeNull();
  });

  it('reports a material disagreement instead of averaging it away', () => {
    const result = acreageAgreement(10, 2.5);
    expect(result.agrees).toBe(false);
    expect(result.deltaFraction).toBeCloseTo(0.75, 2);
    expect(result.note).toContain('requires verification');
  });

  it('returns unknown when either figure is missing', () => {
    expect(acreageAgreement(null, 4).agrees).toBeNull();
    expect(acreageAgreement(4, undefined).agrees).toBeNull();
  });
});

describe('esriPolygonToGeoJson', () => {
  it('reverses Esri clockwise winding into RFC 7946 order', () => {
    // Esri outer rings are clockwise; GeoJSON wants counter-clockwise.
    const esri = {
      rings: [
        [
          [-92.35, 47.42],
          [-92.35, 47.43],
          [-92.34, 47.43],
          [-92.34, 47.42],
          [-92.35, 47.42],
        ],
      ],
      spatialReference: { wkid: 4326 },
    };
    const geometry = esriPolygonToGeoJson(esri);
    expect(geometry?.type).toBe('Polygon');
    const ring = (geometry as { coordinates: Position[][] }).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('preserves a hole as a hole rather than a second parcel', () => {
    const outer = [
      [-92.36, 47.41],
      [-92.36, 47.44],
      [-92.33, 47.44],
      [-92.33, 47.41],
      [-92.36, 47.41],
    ];
    const hole = [
      [-92.35, 47.42],
      [-92.34, 47.42],
      [-92.34, 47.43],
      [-92.35, 47.43],
      [-92.35, 47.42],
    ];
    const geometry = esriPolygonToGeoJson({
      rings: [outer, hole],
      spatialReference: { wkid: 4326 },
    });
    expect(geometry?.type).toBe('Polygon');
    expect((geometry as { coordinates: Position[][] }).coordinates).toHaveLength(2);
  });

  it('reprojects Web Mercator geometry into WGS84', () => {
    const geometry = esriPolygonToGeoJson({
      rings: [
        [
          [-10_280_000, 6_000_000],
          [-10_280_000, 6_001_000],
          [-10_279_000, 6_001_000],
          [-10_279_000, 6_000_000],
          [-10_280_000, 6_000_000],
        ],
      ],
      spatialReference: { wkid: 102100, latestWkid: 3857 },
    });
    expect(geometry).not.toBeNull();
    const first = (geometry as { coordinates: Position[][] }).coordinates[0]![0]!;
    expect(first[0]).toBeGreaterThan(-95);
    expect(first[0]).toBeLessThan(-90);
    expect(first[1]).toBeGreaterThan(45);
    expect(first[1]).toBeLessThan(50);
  });
});

describe('toWgs84', () => {
  it('refuses to approximate an unknown projection', () => {
    // A state-plane coordinate. Guessing here would place the parcel tens of
    // kilometres from reality, so null is the only safe answer.
    expect(toWgs84([548_123, 5_251_987], 26915)).toBeNull();
  });
});

describe('normalizeParcelGeometry', () => {
  it('rejects a non-polygon geometry with a reason', () => {
    const result = normalizeParcelGeometry({ type: 'Point', coordinates: [-92.3, 47.4] });
    expect(result.geometry).toBeNull();
    expect(result.reason).toContain('unsupported geometry type');
  });

  it('repairs transposed latitude/longitude and says so', () => {
    const good = syntheticParcel(NORTHERN_MN, 3) as { type: 'Polygon'; coordinates: Position[][] };
    const swapped: ParcelGeometry = {
      type: 'Polygon',
      coordinates: good.coordinates.map((ring) => ring.map(([lon, lat]): Position => [lat, lon])),
    };
    const result = normalizeParcelGeometry(swapped);
    expect(result.geometry).not.toBeNull();
    expect(result.reason).toContain('transposed');
    expect(sqMetersToAcres(1)).toBeGreaterThan(0);
  });

  it('rejects a parcel the size of a county', () => {
    const huge = syntheticParcel(NORTHERN_MN, 60_000);
    const result = normalizeParcelGeometry(huge);
    expect(result.geometry).toBeNull();
    expect(result.reason).toContain('implausible');
  });

  it('closes an unclosed ring', () => {
    const open: ParcelGeometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-92.35, 47.42],
          [-92.34, 47.42],
          [-92.34, 47.43],
          [-92.35, 47.43],
        ],
      ],
    };
    const result = normalizeParcelGeometry(open);
    expect(result.geometry).not.toBeNull();
    const ring = (result.geometry as { coordinates: Position[][] }).coordinates[0]!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
