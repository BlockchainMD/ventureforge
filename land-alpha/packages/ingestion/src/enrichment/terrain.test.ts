import { describe, expect, it, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { fetchTerrain } = await import('./terrain');
const { IngestHttpClient } = await import('../fetch/http');

/**
 * Batched elevation sampling.
 *
 * The point-query service answers one sample per request. With the politeness
 * delay between calls to a host, five samples per parcel was roughly forty
 * seconds — the single largest cost in an enrichment run, and the reason a
 * full pass over three hundred parcels took hours.
 */
describe('fetchTerrain', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = {
    parcelId: 'terrain-test',
    centroid: [-92.1936, 46.7517] as [number, number],
    acreage: 5,
    geometry: null,
  };

  function client() {
    return new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });
  }

  it('takes every sample in a single request', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      requests += 1;
      const url = String(input);
      expect(url).toContain('getSamples');
      return new Response(
        JSON.stringify({
          samples: [
            { locationId: 0, value: '357.5' },
            { locationId: 1, value: '360.2' },
            { locationId: 2, value: '360.0' },
            { locationId: 3, value: '355.2' },
            { locationId: 4, value: '364.3' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch);

    const result = await fetchTerrain({ mode: 'live', http: client() } as never, target as never);
    expect(requests).toBe(1);
    expect(result.available).toBe(true);
    expect(result.sampleCount).toBe(5);
    expect(result.minElevationMeters).toBe(355.2);
    expect(result.maxElevationMeters).toBe(364.3);
    expect(result.meanSlopePercent).toBeGreaterThan(0);
  });

  it('orders samples by the service’s own index, not the order they arrive', async () => {
    // Slope is measured from the centre outwards, so sample 0 has to be the
    // centre whatever order the response came back in.
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(
          JSON.stringify({
            samples: [
              { locationId: 3, value: '100' },
              { locationId: 0, value: '200' },
              { locationId: 1, value: '100' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );

    const result = await fetchTerrain({ mode: 'live', http: client() } as never, target as never);
    // Centre at 200 against outer samples at 100: a real drop, not a flat run.
    expect(result.meanSlopePercent).toBeGreaterThan(0);
    expect(result.maxElevationMeters).toBe(200);
  });

  it('drops the no-data sentinel rather than reading it as below sea level', async () => {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(
          JSON.stringify({
            samples: [
              { locationId: 0, value: '357.5' },
              { locationId: 1, value: '-3.4028234663852886e+38' },
              { locationId: 2, value: '360.0' },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as unknown as typeof fetch,
    );

    const result = await fetchTerrain({ mode: 'live', http: client() } as never, target as never);
    expect(result.sampleCount).toBe(2);
    expect(result.minElevationMeters).toBe(357.5);
    expect(result.note).toContain('2 of 5');
  });

  it('falls back to the point service when the batch returns nothing', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('getSamples')) {
        return new Response(JSON.stringify({ error: { code: 500 } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ value: '350.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const result = await fetchTerrain({ mode: 'live', http: client() } as never, target as never);
    // A parcel outside 3DEP coverage, or a batch outage, still produces an
    // answer — just an expensive one.
    expect(result.available).toBe(true);
    expect(result.sampleCount).toBe(5);
    expect(urls.filter((url) => url.includes('epqs')).length).toBe(5);
  });
});
