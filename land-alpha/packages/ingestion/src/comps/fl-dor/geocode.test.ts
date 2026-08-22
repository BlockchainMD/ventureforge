import { describe, expect, it } from 'vitest';
import { representativeCentroid, ringCentroid, sridFromProjection } from './geocode';

/**
 * Getting a parcel's location wrong is worse than not knowing it: an
 * unlocated comparable is weighted down and warned about, a misplaced one is
 * trusted.
 */

describe('sridFromProjection', () => {
  it('reads Florida’s three State Plane zones by name', () => {
    expect(
      sridFromProjection('PROJCS["NAD_1983_HARN_StatePlane_Florida_East_FIPS_0901_Feet"'),
    ).toBe(2881);
    expect(
      sridFromProjection('PROJCS["NAD_1983_HARN_StatePlane_Florida_West_FIPS_0902_Feet"'),
    ).toBe(2882);
    expect(
      sridFromProjection('PROJCS["NAD_1983_HARN_StatePlane_Florida_North_FIPS_0903_Feet"'),
    ).toBe(2883);
  });

  it('recognises a file that is already geographic', () => {
    expect(sridFromProjection('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]')).toBe(4326);
  });

  it('returns null rather than guessing at an unfamiliar projection', () => {
    // The caller refuses to proceed on null. A guessed coordinate system puts
    // parcels in the wrong county at best.
    expect(sridFromProjection('PROJCS["NAD_1983_UTM_Zone_17N"]')).toBeNull();
    expect(sridFromProjection('')).toBeNull();
  });
});

describe('ringCentroid', () => {
  it('finds the centre of a square', () => {
    const centre = ringCentroid([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    expect(centre![0]).toBeCloseTo(5, 9);
    expect(centre![1]).toBeCloseTo(5, 9);
  });

  it('is unmoved by extra vertices along one edge', () => {
    // This is the whole reason for using an area weighting. Averaging vertices
    // would drag the point towards the densely-sampled edge — for a
    // river-front parcel, into the river.
    const dense = ringCentroid([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
      [7, 0],
      [8, 0],
      [9, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    expect(dense![0]).toBeCloseTo(5, 6);
    expect(dense![1]).toBeCloseTo(5, 6);
  });

  it('handles a ring wound the other way', () => {
    const clockwise = ringCentroid([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ]);
    expect(clockwise![0]).toBeCloseTo(5, 9);
    expect(clockwise![1]).toBeCloseTo(5, 9);
  });

  it('refuses a degenerate ring rather than dividing by zero', () => {
    expect(
      ringCentroid([
        [0, 0],
        [1, 1],
      ]),
    ).toBeNull();
    expect(
      ringCentroid([
        [0, 0],
        [5, 5],
        [10, 10],
        [0, 0],
      ]),
    ).toBeNull();
  });
});

describe('representativeCentroid', () => {
  it('locates a simple polygon', () => {
    const centre = representativeCentroid({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0],
        ],
      ],
    });
    expect(centre).toEqual([2, 2]);
  });

  it('uses the largest piece of a split parcel', () => {
    // A parcel divided by a road is two polygons. The point belongs in the
    // part that is actually the parcel, not in a fragment across the street.
    const centre = representativeCentroid({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
        [
          [
            [100, 100],
            [120, 100],
            [120, 120],
            [100, 120],
            [100, 100],
          ],
        ],
      ],
    });
    expect(centre![0]).toBeCloseTo(110, 6);
    expect(centre![1]).toBeCloseTo(110, 6);
  });

  it('returns null for geometry it cannot place', () => {
    expect(representativeCentroid({ type: 'Point', coordinates: [1, 2] })).toBeNull();
    expect(representativeCentroid({ type: 'LineString', coordinates: [] })).toBeNull();
  });
});
