import { describe, expect, it } from 'vitest';
import { actionableCoverage, classifyCoverage, type ComparableCoverage } from './comparables';

describe('comparable-sales coverage', () => {
  it('says nothing when a county is well covered', () => {
    const { status, diagnosis } = classifyCoverage('FL', 'Marion', 4883, 4787);
    expect(status).toBe('READY');
    expect(diagnosis).toBeNull();
  });

  // The case this whole report exists for. Marion sat here for a working
  // session and the only symptom in the product was LOW on every parcel.
  it('names the missing pass where a county has a pass to run', () => {
    const { status, diagnosis } = classifyCoverage('FL', 'Marion', 4883, 0);
    expect(status).toBe('UNLOCATED');
    expect(diagnosis).toContain('4,883');
    expect(diagnosis).toContain('pnpm comps --geocode-fl Marion');
  });

  // Michigan and Minnesota sales arrive already located. A county at 0% there
  // is a limit of the publisher, and sending an operator to run a Florida
  // command would be worse than saying nothing at all.
  it('does not invent a pass for a state that has none', () => {
    const { status, diagnosis } = classifyCoverage('MN', 'St. Louis', 880, 0);
    expect(status).toBe('UNLOCATED');
    expect(diagnosis).not.toContain('geocode-fl');
    expect(diagnosis).not.toContain('Run:');
    expect(diagnosis).toContain('limit of the source');
  });

  it('flags a partially located county without calling it unlocated', () => {
    const { status, diagnosis } = classifyCoverage('FL', 'Orange', 1000, 500);
    expect(status).toBe('PARTIAL');
    expect(diagnosis).toContain('500 of 1,000');
    expect(diagnosis).toContain('pnpm comps --geocode-fl Orange');
  });

  it('treats a county too thin to value as thin, not unlocated', () => {
    // Two sales that happen to be located is still not a valuation. Reporting
    // this as a geocoding problem would send an operator to fix the wrong thing.
    const { status, diagnosis } = classifyCoverage('FL', 'Citrus', 2, 2);
    expect(status).toBe('THIN');
    expect(diagnosis).toContain('only 2 comparable sales');
    expect(diagnosis).not.toContain('geocode-fl');
  });

  it('reports an empty county as empty', () => {
    const { status, diagnosis } = classifyCoverage('FL', 'Levy', 0, 0);
    expect(status).toBe('THIN');
    expect(diagnosis).toContain('No comparable sales have been imported');
  });

  it('does not let a handful of stray coordinates hide a missed pass', () => {
    // 1% located is a rounding artefact, not a partially completed pass.
    const { status } = classifyCoverage('FL', 'Marion', 1000, 10);
    expect(status).toBe('UNLOCATED');
  });

  it('counts a single sale in the singular', () => {
    expect(classifyCoverage('FL', 'Levy', 1, 1).diagnosis).toContain('only 1 comparable sale;');
  });
});

describe('actionableCoverage', () => {
  const row = (over: Partial<ComparableCoverage>): ComparableCoverage =>
    ({
      state: 'FL',
      county: 'X',
      total: 100,
      geocoded: 100,
      geocodedShare: 1,
      neighborhoodCoded: 0,
      neighborhoodShare: 0,
      earliestSale: null,
      latestSale: null,
      status: 'READY',
      diagnosis: null,
      ...over,
    }) as ComparableCoverage;

  it('drops the counties with nothing to do', () => {
    const rows = [row({}), row({ county: 'Y', status: 'UNLOCATED', diagnosis: 'do something' })];
    expect(actionableCoverage(rows).map((r) => r.county)).toEqual(['Y']);
  });

  it('puts unlocated counties above partial ones, and the biggest waste first', () => {
    const rows = [
      row({ county: 'Partial', status: 'PARTIAL', diagnosis: 'x', total: 9000 }),
      row({ county: 'SmallUnlocated', status: 'UNLOCATED', diagnosis: 'x', total: 50 }),
      row({ county: 'BigUnlocated', status: 'UNLOCATED', diagnosis: 'x', total: 5000 }),
    ];
    expect(actionableCoverage(rows).map((r) => r.county)).toEqual([
      'BigUnlocated',
      'SmallUnlocated',
      'Partial',
    ]);
  });
});
