import { describe, expect, it, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { fetchRoads, clearRoadTileCache } = await import('./roads');
const { IngestHttpClient } = await import('../fetch/http');

/**
 * Road lookups are cached by tile.
 *
 * Asking the public Overpass endpoint for the roads around each parcel earned
 * an HTTP 503 on every request: access came back UNKNOWN for 228 of 304
 * parcels, each costing sixteen seconds of retries to learn nothing. The
 * inventory is not scattered — county tax-forfeited lists cluster, and platted
 * subdivisions especially — so one query per tile answers dozens of parcels.
 */
describe('fetchRoads', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearRoadTileCache();
  });

  function client() {
    return new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });
  }

  function stubOverpass(): () => number {
    let calls = 0;
    vi.stubGlobal('fetch', (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'way',
              tags: { highway: 'residential', name: 'County Road 28', surface: 'asphalt' },
              geometry: [
                { lat: 46.7517, lon: -92.1946 },
                { lat: 46.7517, lon: -92.1926 },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch);
    return () => calls;
  }

  const target = (lon: number, lat: number) => ({
    parcelId: 'roads-test',
    centroid: [lon, lat] as [number, number],
    acreage: 5,
    geometry: null,
  });

  it('answers neighbouring parcels from one request', async () => {
    const calls = stubOverpass();
    const http = client();

    // Three parcels a few hundred metres apart — the shape of a platted
    // subdivision, which is most of what this product buys.
    for (const [lon, lat] of [
      [-92.1936, 46.7517],
      [-92.193, 46.7519],
      [-92.1941, 46.7512],
    ] as [number, number][]) {
      const result = await fetchRoads({ mode: 'live', http } as never, target(lon, lat) as never);
      expect(result.available).toBe(true);
      expect(result.roads).toHaveLength(1);
    }
    expect(calls()).toBe(1);
  });

  it('does not serve one tile’s roads to another', async () => {
    const calls = stubOverpass();
    const http = client();
    await fetchRoads({ mode: 'live', http } as never, target(-92.1936, 46.7517) as never);
    // Orange County, Florida — a different tile by any measure.
    await fetchRoads({ mode: 'live', http } as never, target(-81.4074, 28.5121) as never);
    expect(calls()).toBe(2);
  });

  it('says a rate limit is a rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      (async () => new Response('slow down', { status: 503 })) as unknown as typeof fetch,
    );

    const result = await fetchRoads(
      { mode: 'live', http: client() } as never,
      target(-92.1936, 46.7517) as never,
    );
    expect(result.available).toBe(false);
    // Distinct from a permanent restriction and from a random outage: the fix
    // is on our side, and saying so stops it reading as "no roads here".
    expect(result.note).toContain('asked us to slow down');
  });

  it('reports an empty tile as an answer, not as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(JSON.stringify({ elements: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    );

    const result = await fetchRoads(
      { mode: 'live', http: client() } as never,
      target(-92.1936, 46.7517) as never,
    );
    expect(result.available).toBe(true);
    expect(result.roads).toHaveLength(0);
    expect(result.note).toContain('No mapped road');
  });

  it('reads a maintaining body out of whichever column the county used', async () => {
    // Three counties, three schemas. Ottawa states it in RoadClass, Orange in
    // MAINTENANCE, and St. Louis not at all — its ROUTE_SYS is a bare numeric
    // code, so public maintenance stays unknown rather than being invented.
    const cases = [
      {
        label: 'Ottawa MI',
        attributes: { RoadClass: 'County Local', Act51LegalDesignation: 3, StreetName: 'Stump' },
        expected: { isPublic: true, name: 'Stump' },
      },
      {
        label: 'Orange FL',
        attributes: {
          MAINTENANCE: 'Unincorporated',
          COMPLETE_STREETNAME: '33rd St',
          SURFACE_TYPE: 'ASPHALT',
        },
        expected: { isPublic: true, name: '33rd St' },
      },
      {
        label: 'St. Louis MN',
        attributes: { ROUTE_SYS: '10', ST_CONCAT: 'North 73rd Avenue West' },
        expected: { isPublic: null, name: 'North 73rd Avenue West' },
      },
      {
        label: 'an explicitly private road',
        attributes: { MAINTENANCE: 'Private', COMPLETE_STREETNAME: 'Gated Way' },
        expected: { isPublic: false, name: 'Gated Way' },
      },
    ];

    for (const testCase of cases) {
      vi.stubGlobal(
        'fetch',
        (async () =>
          new Response(
            JSON.stringify({
              features: [
                {
                  attributes: testCase.attributes,
                  geometry: {
                    paths: [
                      [
                        [-92.1946, 46.7517],
                        [-92.1926, 46.7517],
                      ],
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          )) as unknown as typeof fetch,
      );

      const result = await fetchRoads(
        { mode: 'live', http: client() } as never,
        target(-92.1936, 46.7517) as never,
        { countyRoadLayerUrl: 'https://county.example/roads/FeatureServer/0' },
      );
      expect(result.roads[0]?.isPublic, testCase.label).toBe(testCase.expected.isPublic);
      expect(result.roads[0]?.name, testCase.label).toBe(testCase.expected.name);
      vi.unstubAllGlobals();
    }
  });
});
