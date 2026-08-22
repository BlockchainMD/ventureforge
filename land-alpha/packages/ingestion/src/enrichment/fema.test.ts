import { describe, expect, it, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { fetchFloodHazard, fetchParcelFlood } = await import('./fema');
const { IngestHttpClient } = await import('../fetch/http');

/**
 * Flood hazard, preferring a county's republication of its own FIRM.
 *
 * FEMA's host forbids automated queries against the NFHL, which left every
 * parcel unscreened for flood and capped buildability at UNKNOWN across the
 * whole of Florida. Counties that adopt a FIRM commonly republish it, and
 * Orange County's layer carries the identical schema because it is the same
 * data. Reading it there is not a way around FEMA's preference — it is a
 * different publisher who permits it.
 */
describe('fetchFloodHazard', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = {
    parcelId: 'flood-test',
    centroid: [-81.4074, 28.5121] as [number, number],
    acreage: 1,
    geometry: null,
  };
  const client = () =>
    new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });

  it('reads the county layer and names it as the source', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify({
          features: [{ attributes: { FLD_ZONE: 'AE', ZONE_SUBTY: '', SFHA_TF: 'T' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch);

    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
      {
        countyFloodLayerUrl: 'https://county.example/flood/MapServer/19',
      },
    );
    expect(result.zones).toEqual(['AE']);
    expect(result.source).toContain('County republication');
    // FEMA is never reached when the county answers.
    expect(urls.every((url) => url.includes('county.example'))).toBe(true);
  });

  it('falls back to FEMA when no county layer is configured', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
    );
    expect(result.source).toBe('FEMA National Flood Hazard Layer');
    expect(urls.some((url) => url.includes('hazards.fema.gov'))).toBe(true);
  });

  it('falls through to FEMA when the county layer fails', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('county.example')) return new Response('down', { status: 500 });
      return new Response(JSON.stringify({ features: [{ attributes: { FLD_ZONE: 'X' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
      {
        countyFloodLayerUrl: 'https://county.example/flood/MapServer/19',
      },
    );
    expect(result.zones).toEqual(['X']);
    expect(result.source).toBe('FEMA National Flood Hazard Layer');
  });

  it('reports a parcel outside any mapped hazard area as screened, not unknown', async () => {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(JSON.stringify({ features: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    );

    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
      {
        countyFloodLayerUrl: 'https://county.example/flood/MapServer/19',
      },
    );
    // An answered query with no polygons is a fact about the parcel. Treating
    // it as a failure would send it back down the unscreened path.
    expect(result.available).toBe(true);
    expect(result.zones).toEqual([]);
    expect(result.note).toContain('No mapped flood hazard area');
  });
});

/**
 * Flood from a county table keyed by parcel rather than by geometry.
 *
 * Ottawa County publishes every parcel touching a mapped flood zone with the
 * share of each already measured against its own boundary. Sixty-three of the
 * ninety-nine parcels in inventory appear in it, several almost entirely
 * inside the regulatory floodway — and none of that was visible before.
 */
describe('fetchParcelFlood', () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = () =>
    new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });
  const config = {
    url: 'https://county.example/FloodParcels/FeatureServer/5',
    parcelIdField: 'FinalPIN',
    floodplainPercentField: 'PercentAcresFloodplain',
    floodwayPercentField: 'PercentAcresFloodway',
    floodplain100PercentField: 'PercentAcresFloodplain100',
  };

  function stub(attributes: Record<string, unknown> | null) {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(JSON.stringify({ features: attributes ? [{ attributes }] : [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    );
  }

  it('uses the county’s own measurement rather than deriving one', async () => {
    stub({
      PercentAcresFloodplain: 95.18,
      PercentAcresFloodway: 73.84,
      PercentAcresFloodplain100: 21.19,
    });
    const result = await fetchParcelFlood(
      { mode: 'live', http: client() } as never,
      '70-17-29-300-048',
      config,
    );
    // The widest measure, because that is the share of the parcel a buyer
    // cannot treat as ordinary upland.
    expect(result.overlapFraction).toBeCloseTo(0.9518, 4);
    expect(result.inSpecialFloodHazardArea).toBe(true);
    expect(result.zones).toContain('FLOODWAY');
  });

  it('treats absence from the table as a screening result, not a silence', async () => {
    // The county lists every parcel touching a flood zone. A parcel it holds
    // and left out is a parcel outside them — which is an answer.
    stub(null);
    const result = await fetchParcelFlood(
      { mode: 'live', http: client() } as never,
      '70-01-01-000-000',
      config,
    );
    expect(result.available).toBe(true);
    expect(result.inSpecialFloodHazardArea).toBe(false);
    expect(result.overlapFraction).toBe(0);
    expect(result.note).toContain('not among them');
  });

  it('calls out a parcel mostly inside the regulatory floodway', async () => {
    stub({
      PercentAcresFloodplain: 100,
      PercentAcresFloodway: 100,
      PercentAcresFloodplain100: null,
    });
    const result = await fetchParcelFlood(
      { mode: 'live', http: client() } as never,
      '70-09-10-200-006',
      config,
    );
    expect(result.note).toContain('construction is prohibited or severely restricted');
    expect(result.inSpecialFloodHazardArea).toBe(true);
  });

  it('does not invent FEMA zone letters it was never given', async () => {
    // The table names the 100-year floodplain and supplies no zone code.
    // Inferring "AE" would mean inventing the code before reading it.
    stub({ PercentAcresFloodplain: 40, PercentAcresFloodway: null, PercentAcresFloodplain100: 40 });
    const result = await fetchParcelFlood(
      { mode: 'live', http: client() } as never,
      '70-00-00-000-001',
      config,
    );
    expect(result.zones).toEqual(['100-YEAR FLOODPLAIN']);
    expect(result.zones).not.toContain('AE');
  });
});

describe('flood overlap measures hazard, not any mapped polygon', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = {
    parcelId: 'overlap-test',
    centroid: [-81.4074, 28.5121] as [number, number],
    acreage: 1,
    geometry: null,
  };
  const client = () =>
    new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });

  function stubZones(zones: { zone: string; withGeometry: boolean }[]) {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(
          JSON.stringify({
            features: zones.map((z) => ({
              attributes: { FLD_ZONE: z.zone },
              geometry: z.withGeometry
                ? {
                    // A real box around the target centroid: the converter
                    // rejects positions that are not plausibly in the US, so
                    // a unit square at [0, 0] would be dropped before the
                    // hazard filter ever saw it.
                    rings: [
                      [
                        [-81.41, 28.505],
                        [-81.41, 28.52],
                        [-81.4, 28.52],
                        [-81.4, 28.505],
                        [-81.41, 28.505],
                      ],
                    ],
                  }
                : undefined,
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );
  }

  it('keeps zone X out of the polygons whose coverage becomes the overlap', async () => {
    // Zone X is "area of minimal flood hazard" and blankets everything the
    // floodplain does not, so counting it put every dry parcel in Orange
    // County at an overlap of 1.00 — reported on the parcel page as land
    // entirely inside a floodplain it is entirely outside of.
    stubZones([{ zone: 'X', withGeometry: true }]);
    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
    );
    expect(result.zones).toEqual(['X']);
    expect(result.polygons).toHaveLength(0);
  });

  it('keeps the hazard polygons and drops the rest from the same response', async () => {
    stubZones([
      { zone: 'AE', withGeometry: true },
      { zone: 'X', withGeometry: true },
      { zone: 'VE', withGeometry: true },
    ]);
    const result = await fetchFloodHazard(
      { mode: 'live', http: client() } as never,
      target as never,
    );
    // Every zone is still reported — the parcel does touch zone X — but only
    // AE and VE contribute to how much of it is exposed.
    expect(result.zones.sort()).toEqual(['AE', 'VE', 'X']);
    expect(result.polygons).toHaveLength(2);
  });
});
