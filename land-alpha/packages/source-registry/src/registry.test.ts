import { describe, expect, it } from 'vitest';
import { SOURCE_REGISTRY, registryByKey } from './registry';

/**
 * The registry has two places a setting can live and only one of them works.
 *
 * `config` is an untyped bag the adapter reads; the entry itself is the typed
 * record the engines read. A setting the engines consume that is written into
 * `config` type-checks, reads as configured to anyone reviewing the diff, and
 * does nothing whatsoever.
 *
 * That is not hypothetical. Ottawa's `assessedValueMultiplier: 2` sat in
 * `config` and was never read, so every Michigan parcel was valued at 1.15×
 * its State Equalized Value instead of 2× — understating land the state
 * assesses at half of true cash value by very nearly half, which is the exact
 * error the setting was added to prevent.
 */
describe('settings the engines read live on the entry, not in config', () => {
  // Read by the valuation service through registryByKey(...), so a copy in
  // `config` is invisible to it.
  const ENGINE_READ_KEYS = ['assessedValueMultiplier'];

  it.each(ENGINE_READ_KEYS)('no source hides %s inside config', (key) => {
    const offenders = SOURCE_REGISTRY.filter(
      (entry) => (entry.config as Record<string, unknown>)[key] !== undefined,
    ).map((entry) => entry.key);
    expect(offenders).toEqual([]);
  });

  it('doubles Michigan assessed values, because the state assesses at half', () => {
    expect(registryByKey('mi-ottawa-treasurer-inventory')?.assessedValueMultiplier).toBe(2);
  });

  it('leaves Florida on the engine default, which suits full-value assessment', () => {
    for (const key of ['fl-orange-lands-available', 'fl-marion-lands-available']) {
      expect(registryByKey(key)?.assessedValueMultiplier).toBeNull();
    }
  });
});

describe('registry integrity', () => {
  it('gives every enabled source an adapter that exists in the entry', () => {
    for (const entry of SOURCE_REGISTRY.filter((source) => source.enabled)) {
      expect(entry.adapterKey, `${entry.key} has no adapterKey`).toBeTruthy();
    }
  });
});
