import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';
import { ConfigurationError } from './errors';

const BASE = { DATABASE_URL: 'postgresql://localhost:5432/x' } as NodeJS.ProcessEnv;

const withEnv = (extra: Record<string, string>): NodeJS.ProcessEnv =>
  ({ ...BASE, ...extra }) as NodeJS.ProcessEnv;

describe('environment booleans', () => {
  // The bug this guards against: `z.coerce.boolean()` is `Boolean(value)`, so
  // the string 'false' parsed as true and the listing site stayed public on a
  // deployment that had explicitly asked for it to be off.
  it('reads false from every spelling an operator would reach for', () => {
    for (const spelling of ['false', 'FALSE', 'False', '0', 'no', 'off', ' false ', '']) {
      expect(
        loadEnv(withEnv({ PUBLIC_SITE_ENABLED: spelling })).PUBLIC_SITE_ENABLED,
        spelling,
      ).toBe(false);
    }
  });

  it('reads true from every spelling an operator would reach for', () => {
    for (const spelling of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(loadEnv(withEnv({ INGEST_OFFLINE: spelling })).INGEST_OFFLINE, spelling).toBe(true);
    }
  });

  it('rejects a value it cannot interpret rather than defaulting', () => {
    // A typo in a safety switch must stop the boot, not pick a side.
    expect(() => loadEnv(withEnv({ PUBLIC_SITE_ENABLED: 'flase' }))).toThrow(ConfigurationError);
    expect(() => loadEnv(withEnv({ INGEST_RESPECT_ROBOTS: 'maybe' }))).toThrow(ConfigurationError);
  });

  it('keeps its defaults when the variable is absent', () => {
    const parsed = loadEnv(BASE);
    expect(parsed.PUBLIC_SITE_ENABLED).toBe(true);
    expect(parsed.INGEST_RESPECT_ROBOTS).toBe(true);
    expect(parsed.INGEST_OFFLINE).toBe(false);
    expect(parsed.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('turns ingestion politeness off only when asked explicitly', () => {
    expect(loadEnv(withEnv({ INGEST_RESPECT_ROBOTS: 'false' })).INGEST_RESPECT_ROBOTS).toBe(false);
    expect(loadEnv(withEnv({ INGEST_RESPECT_ROBOTS: 'true' })).INGEST_RESPECT_ROBOTS).toBe(true);
  });
});

describe('production requirements', () => {
  it('refuses to boot without a session secret', () => {
    expect(() => loadEnv(withEnv({ NODE_ENV: 'production' }))).toThrow(/AUTH_SECRET/);
  });

  it('boots with one', () => {
    const parsed = loadEnv(withEnv({ NODE_ENV: 'production', AUTH_SECRET: 'x'.repeat(32) }));
    expect(parsed.NODE_ENV).toBe('production');
  });
});
