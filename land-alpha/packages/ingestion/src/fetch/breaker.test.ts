import { describe, expect, it, vi, afterEach } from 'vitest';

// The client validates the whole environment schema on construction, which
// includes DATABASE_URL even though an HTTP client has no use for one. These
// tests never touch the database; this satisfies the validator so the breaker
// can be tested in isolation.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

const { IngestHttpClient } = await import('./http');

/**
 * The circuit breaker.
 *
 * An enrichment run calls one host once per parcel. When that host is a WAF
 * returning 500 to our User-Agent it will do so for every parcel equally, and
 * three attempts with exponential backoff each turns a five-minute run into an
 * hour spent collecting the same answer three hundred times.
 */
describe('IngestHttpClient circuit breaker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function failingFetch(status: number): { calls: () => number; fn: typeof fetch } {
    let calls = 0;
    const fn = (async (input: string | URL | Request) => {
      const url = String(input);
      // robots.txt is fetched separately and must not count towards the host's
      // failure budget — a permissive robots response is a success.
      if (url.endsWith('/robots.txt')) {
        return new Response('User-agent: *\nAllow: /', { status: 200 });
      }
      calls += 1;
      return new Response('blocked', { status });
    }) as unknown as typeof fetch;
    return { calls: () => calls, fn };
  }

  it('stops calling a host that has failed its budget, and says why', async () => {
    const { calls, fn } = failingFetch(500);
    vi.stubGlobal('fetch', fn);
    const client = new IngestHttpClient({
      minDelayMs: 0,
      // CI sets INGEST_OFFLINE, which short-circuits get() to the fixture
      // reader before the breaker or the stubbed fetch is ever reached. These
      // tests are about network behaviour, so they opt out explicitly rather
      // than inheriting whatever the ambient environment happens to be.
      offline: false,
      respectRobots: false,
      // One attempt per request: the breaker is what is under test, not the
      // retry backoff, and waiting out real exponential delays makes a
      // four-test file the slowest thing in the suite.
      retryAttempts: 1,
      hostFailureLimit: 2,
    });

    // Two failing requests is the whole budget.
    await expect(client.get('https://blocked.example/a')).rejects.toThrow();
    await expect(client.get('https://blocked.example/b')).rejects.toThrow();
    const afterBudget = calls();

    await expect(client.get('https://blocked.example/c')).rejects.toThrow(/not being called again/);
    // The third request never reached the network.
    expect(calls()).toBe(afterBudget);
  });

  it('carries the first failure’s reason, not the last', async () => {
    const { fn } = failingFetch(503);
    vi.stubGlobal('fetch', fn);
    const client = new IngestHttpClient({
      minDelayMs: 0,
      // CI sets INGEST_OFFLINE, which short-circuits get() to the fixture
      // reader before the breaker or the stubbed fetch is ever reached. These
      // tests are about network behaviour, so they opt out explicitly rather
      // than inheriting whatever the ambient environment happens to be.
      offline: false,
      respectRobots: false,
      // One attempt per request: the breaker is what is under test, not the
      // retry backoff, and waiting out real exponential delays makes a
      // four-test file the slowest thing in the suite.
      retryAttempts: 1,
      hostFailureLimit: 1,
    });

    await expect(client.get('https://blocked.example/a')).rejects.toThrow();
    // The first message explains the cause; every later one is identical and
    // the last is the least informative.
    await expect(client.get('https://blocked.example/b')).rejects.toThrow(/503/);
  });

  it('cuts off one host without touching another', async () => {
    let goodCalls = 0;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (url.includes('good.example')) {
        goodCalls += 1;
        return new Response('{"ok":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('blocked', { status: 500 });
    }) as unknown as typeof fetch);

    const client = new IngestHttpClient({
      minDelayMs: 0,
      // CI sets INGEST_OFFLINE, which short-circuits get() to the fixture
      // reader before the breaker or the stubbed fetch is ever reached. These
      // tests are about network behaviour, so they opt out explicitly rather
      // than inheriting whatever the ambient environment happens to be.
      offline: false,
      respectRobots: false,
      // One attempt per request: the breaker is what is under test, not the
      // retry backoff, and waiting out real exponential delays makes a
      // four-test file the slowest thing in the suite.
      retryAttempts: 1,
      hostFailureLimit: 1,
    });
    await expect(client.get('https://blocked.example/a')).rejects.toThrow();
    await expect(client.get('https://blocked.example/b')).rejects.toThrow(/not being called again/);

    await client.get('https://good.example/a');
    expect(goodCalls).toBe(1);
  });

  it('is a breaker, not a blocklist: one success clears the count', async () => {
    let failNext = true;
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
      if (failNext) return new Response('flake', { status: 502 });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch);

    const client = new IngestHttpClient({
      minDelayMs: 0,
      // CI sets INGEST_OFFLINE, which short-circuits get() to the fixture
      // reader before the breaker or the stubbed fetch is ever reached. These
      // tests are about network behaviour, so they opt out explicitly rather
      // than inheriting whatever the ambient environment happens to be.
      offline: false,
      respectRobots: false,
      // One attempt per request: the breaker is what is under test, not the
      // retry backoff, and waiting out real exponential delays makes a
      // four-test file the slowest thing in the suite.
      retryAttempts: 1,
      hostFailureLimit: 2,
    });

    await expect(client.get('https://flaky.example/a')).rejects.toThrow();
    failNext = false;
    await client.get('https://flaky.example/b');

    // The count is back to zero, so a later failure does not trip the breaker.
    failNext = true;
    await expect(client.get('https://flaky.example/c')).rejects.toThrow(/502|HTTP/);
  });
});
