import { describe, expect, it, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { fetchFloodHazard } = await import('./fema');
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
