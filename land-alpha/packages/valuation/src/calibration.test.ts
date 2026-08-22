import { describe, expect, it } from 'vitest';
import {
  calibrateFromOutcomes,
  DEFAULT_CALIBRATION_CONFIG,
  type RealisedOutcome,
} from './calibration';

/**
 * The most important behaviour here is restraint: a model that corrects itself
 * from two data points is more dangerous than one that never corrects at all,
 * because it looks like it is learning.
 */

const outcome = (overrides: Partial<RealisedOutcome> = {}): RealisedOutcome => ({
  parcelId: Math.random().toString(36).slice(2),
  state: 'FL',
  county: 'Orange',
  acreage: 2,
  accessClass: 'A',
  predictedQuickSaleCents: 2_000_000, // predicted $20,000
  predictedHoldDays: 180,
  realisedSalePriceCents: 2_000_000,
  realisedHoldDays: 180,
  soldAt: new Date('2026-06-01T00:00:00Z'),
  ...overrides,
});

const many = (n: number, overrides: Partial<RealisedOutcome> = {}): RealisedOutcome[] =>
  Array.from({ length: n }, () => outcome(overrides));

describe('calibrateFromOutcomes', () => {
  it('says plainly that nothing has been checked when nothing has sold', () => {
    const report = calibrateFromOutcomes([]);
    expect(report.confidence).toBe('UNKNOWN');
    expect(report.valueCalibration).toEqual({});
    expect(report.warnings[0]).toContain('No parcel has been bought and sold');
  });

  it('refuses to correct on a sample too small to mean anything', () => {
    const report = calibrateFromOutcomes(many(3, { realisedSalePriceCents: 1_000_000 }));
    expect(report.valueCalibration).toEqual({});
    expect(report.holdCalibration).toEqual({});
    expect(report.groups[0]!.applied).toBe(false);
    expect(report.groups[0]!.note).toContain('fewer than the 5 needed');
  });

  it('corrects a market down when parcels there sell for less than predicted', () => {
    // Predicted $20,000, realised $14,000 — the engine is 30% optimistic here.
    const report = calibrateFromOutcomes(many(6, { realisedSalePriceCents: 1_400_000 }));
    expect(report.valueCalibration['FL/Orange']).toBeCloseTo(0.7, 2);
    expect(report.warnings.some((w) => w.includes('optimistic'))).toBe(true);
  });

  it('corrects a market up, and says bids may be leaving value behind', () => {
    const report = calibrateFromOutcomes(many(6, { realisedSalePriceCents: 2_600_000 }));
    expect(report.valueCalibration['FL/Orange']).toBeCloseTo(1.3, 2);
    expect(report.warnings.some((w) => w.includes('leaving value on the table'))).toBe(true);
  });

  it('learns that a market is slower than estimated', () => {
    const report = calibrateFromOutcomes(many(6, { realisedHoldDays: 360 }));
    expect(report.holdCalibration['FL/Orange']).toBeCloseTo(2.0, 2);
    expect(report.warnings.some((w) => w.includes('longer to sell'))).toBe(true);
  });

  it('is not dominated by one deal that went badly wrong', () => {
    // Five accurate sales and one catastrophe. A mean would report a 25%
    // optimism that does not exist; a median reports the truth.
    const outcomes = [...many(5), outcome({ realisedSalePriceCents: 100_000 })];
    const report = calibrateFromOutcomes(outcomes);
    expect(report.valueCalibration['FL/Orange']).toBeCloseTo(1.0, 2);
  });

  it('clamps a correction so one strange market cannot wreck the model', () => {
    const wild = calibrateFromOutcomes(many(6, { realisedSalePriceCents: 40_000_000 }));
    expect(wild.valueCalibration['FL/Orange']).toBe(DEFAULT_CALIBRATION_CONFIG.maxFactor);
    const collapse = calibrateFromOutcomes(many(6, { realisedSalePriceCents: 20_000 }));
    expect(collapse.valueCalibration['FL/Orange']).toBe(DEFAULT_CALIBRATION_CONFIG.minFactor);
  });

  it('keeps markets separate, and calibrates only the ones with evidence', () => {
    const report = calibrateFromOutcomes([
      ...many(6, { state: 'FL', county: 'Orange', realisedSalePriceCents: 1_400_000 }),
      ...many(2, { state: 'MN', county: 'St. Louis', realisedSalePriceCents: 3_000_000 }),
    ]);
    expect(report.valueCalibration['FL/Orange']).toBeCloseTo(0.7, 2);
    expect(report.valueCalibration['MN/St. Louis']).toBeUndefined();
    expect(report.groups).toHaveLength(2);
  });

  it('ignores an outcome with no prediction to compare against', () => {
    const report = calibrateFromOutcomes(
      many(6, { predictedQuickSaleCents: null, predictedHoldDays: null }),
    );
    expect(report.overall.valueRatio).toBeNull();
    expect(report.valueCalibration).toEqual({});
  });

  it('grows in confidence as evidence accumulates', () => {
    expect(calibrateFromOutcomes(many(2)).confidence).toBe('LOW');
    expect(calibrateFromOutcomes(many(20)).confidence).toBe('MEDIUM');
    const wide = [
      ...many(15, { county: 'Orange' }),
      ...many(15, { county: 'Lake' }),
      ...many(15, { county: 'Polk' }),
    ];
    expect(calibrateFromOutcomes(wide).confidence).toBe('HIGH');
  });

  it('reports how much the deals in a market disagree', () => {
    const spread = [
      outcome({ realisedSalePriceCents: 1_000_000 }),
      outcome({ realisedSalePriceCents: 1_500_000 }),
      outcome({ realisedSalePriceCents: 2_500_000 }),
      outcome({ realisedSalePriceCents: 3_000_000 }),
      outcome({ realisedSalePriceCents: 4_000_000 }),
      outcome({ realisedSalePriceCents: 5_000_000 }),
    ];
    const report = calibrateFromOutcomes(spread);
    expect(report.groups[0]!.valueDispersion).toBeGreaterThan(0.3);
  });
});
