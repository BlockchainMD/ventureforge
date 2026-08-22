import { describe, expect, it, vi, afterEach } from 'vitest';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { fetchZoning } = await import('./zoning');
const { IngestHttpClient } = await import('../fetch/http');

/**
 * Zoning from the county's own layer.
 *
 * The registry has carried a zoning layer URL for St. Louis County since the
 * county was added, and a note claiming the buildability engine used it, while
 * nothing read it — so every live parcel was judged buildable or not without
 * knowing what it may be used for.
 */
describe('fetchZoning', () => {
  afterEach(() => vi.unstubAllGlobals());

  const target = {
    parcelId: 'zoning-test',
    centroid: [-92.45, 47.35] as [number, number],
    acreage: 5,
    geometry: null,
  };
  const client = () =>
    new IngestHttpClient({ minDelayMs: 0, respectRobots: false, offline: false });
  const layer = { zoningLayerUrl: 'https://county.example/zoning/MapServer/19' };

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

  it('reads the district the parcel centre sits in', async () => {
    stub({ USE_: 'FAM', DESCRIPTIO: 'Forest Agricultural Management', DIM: '2' });
    const result = await fetchZoning(
      { mode: 'live', http: client() } as never,
      target as never,
      layer,
    );
    expect(result.code).toBe('FAM');
    expect(result.description).toBe('Forest Agricultural Management');
    expect(result.available).toBe(true);
  });

  it('keeps the dimensional code verbatim rather than inventing a lot size', async () => {
    // DIM indexes a table of dimensional standards the layer does not publish.
    // Guessing that a 2 means five acres would put an invented number into the
    // one field that decides whether a parcel can be split.
    stub({ USE_: 'RES', DESCRIPTIO: 'Residential', DIM: '5' });
    const result = await fetchZoning(
      { mode: 'live', http: client() } as never,
      target as never,
      layer,
    );
    expect(result.dimensionalCode).toBe('5');
    expect(result).not.toHaveProperty('minimumLotSizeAcres');
  });

  it('does not turn "Non Jurisdiction Area" into a zoning code', async () => {
    // That phrase is how the layer records land the county does not zone — a
    // city, a reservation, a state forest. It is an answer, but it is not a
    // district, and every Duluth parcel in inventory returns it.
    stub({ USE_: null, DESCRIPTIO: 'Non Jurisdiction Area', DIM: null });
    const result = await fetchZoning(
      { mode: 'live', http: client() } as never,
      target as never,
      layer,
    );
    expect(result.code).toBeNull();
    expect(result.available).toBe(true);
    expect(result.note).toContain('outside the county zoning jurisdiction');
  });

  it('says so when the county publishes no zoning layer', async () => {
    const result = await fetchZoning(
      { mode: 'live', http: client() } as never,
      target as never,
      {},
    );
    expect(result.available).toBe(false);
    expect(result.note).toContain('no zoning layer');
  });

  it('reports an uncovered point as an answer, not a failure', async () => {
    stub(null);
    const result = await fetchZoning(
      { mode: 'live', http: client() } as never,
      target as never,
      layer,
    );
    expect(result.available).toBe(true);
    expect(result.code).toBeNull();
    expect(result.note).toContain('No zoning district covers');
  });
});
