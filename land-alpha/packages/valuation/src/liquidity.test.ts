import { describe, expect, it } from 'vitest';
import { annualize, estimateHoldDays, type LiquidityInputs } from './liquidity';

/**
 * The point of this engine is that it changes the order of the ranked list.
 * These tests are mostly about that: not whether a number is right in the
 * abstract, but whether two parcels come out in the order an investor would
 * put them in.
 */

const base: LiquidityInputs = {
  acreage: 5,
  quickSaleValueCents: 2_000_000, // $20,000
  accessClass: 'A',
  buildability: 'GREEN',
  hasUtilities: null,
  comparableCount: 12,
};

const at = (overrides: Partial<LiquidityInputs> = {}): number =>
  estimateHoldDays({ ...base, ...overrides }).holdDays;

describe('estimateHoldDays', () => {
  it('names every adjustment it makes and explains it', () => {
    const estimate = estimateHoldDays(base);
    expect(estimate.factors.length).toBeGreaterThanOrEqual(4);
    for (const factor of estimate.factors) {
      expect(factor.rationale.length).toBeGreaterThan(15);
      expect(Number.isFinite(factor.multiplier)).toBe(true);
      expect(factor.multiplier).toBeGreaterThan(0);
    }
  });

  it('sells a cheap accessible building lot fastest', () => {
    const easy = at({ acreage: 1, quickSaleValueCents: 1_200_000, hasUtilities: true });
    expect(easy).toBeLessThan(at());
    expect(easy).toBeLessThan(120);
  });

  it('treats no legal access as the largest single drag', () => {
    expect(at({ accessClass: 'D' })).toBeGreaterThan(at({ accessClass: 'A' }) * 2);
    expect(at({ accessClass: 'C' })).toBeGreaterThan(at({ accessClass: 'B' }));
  });

  it('slows large acreage and tiny remnants alike', () => {
    expect(at({ acreage: 200 })).toBeGreaterThan(at({ acreage: 10 }));
    expect(at({ acreage: 0.05 })).toBeGreaterThan(at({ acreage: 1 }));
  });

  it('slows an expensive parcel, because the buyer needs financing', () => {
    expect(at({ quickSaleValueCents: 30_000_000 })).toBeGreaterThan(
      at({ quickSaleValueCents: 1_000_000 }),
    );
  });

  it('slows a thin market and rewards an active one', () => {
    expect(at({ comparableCount: 0 })).toBeGreaterThan(at({ comparableCount: 3 }));
    expect(at({ comparableCount: 3 })).toBeGreaterThan(at({ comparableCount: 40 }));
  });

  it('penalises unknowns rather than treating them as fine', () => {
    expect(at({ accessClass: null })).toBeGreaterThan(at({ accessClass: 'B' }));
    expect(at({ buildability: null })).toBeGreaterThan(at({ buildability: 'GREEN' }));
    expect(estimateHoldDays({ ...base, accessClass: null }).warnings.length).toBeGreaterThan(0);
  });

  it('keeps the estimate inside defensible bounds', () => {
    const worst = estimateHoldDays({
      acreage: 500,
      quickSaleValueCents: 90_000_000,
      accessClass: 'D',
      buildability: 'RED',
      hasUtilities: null,
      comparableCount: 0,
    });
    expect(worst.holdDays).toBeLessThanOrEqual(1095);
    const best = estimateHoldDays({
      acreage: 1,
      quickSaleValueCents: 500_000,
      accessClass: 'A',
      buildability: 'GREEN',
      hasUtilities: true,
      comparableCount: 60,
    });
    expect(best.holdDays).toBeGreaterThanOrEqual(30);
  });

  it('applies a calibration factor only for the market it was learned in', () => {
    const config = {
      baselineDays: 180,
      minDays: 30,
      maxDays: 1095,
      calibration: { 'FL/Orange': 1.5 },
    };
    const orange = estimateHoldDays(base, config, 'FL/Orange');
    const grant = estimateHoldDays(base, config, 'MN/Grant');
    expect(orange.holdDays).toBeGreaterThan(grant.holdDays);
    expect(orange.factors.map((f) => f.factor)).toContain('calibration');
    expect(grant.factors.map((f) => f.factor)).not.toContain('calibration');
  });
});

describe('liquidity confidence', () => {
  it('will not exceed MEDIUM before the model has been calibrated', () => {
    const estimate = estimateHoldDays({ ...base, comparableCount: 40 });
    expect(estimate.confidence).toBe('MEDIUM');
  });

  it('reaches HIGH only with calibration and a full set of facts', () => {
    const config = {
      baselineDays: 180,
      minDays: 30,
      maxDays: 1095,
      calibration: { 'FL/Orange': 1.1 },
    };
    const estimate = estimateHoldDays({ ...base, comparableCount: 30 }, config, 'FL/Orange');
    expect(estimate.confidence).toBe('HIGH');
  });

  it('drops to LOW when the parcel is mostly unknown', () => {
    const estimate = estimateHoldDays({
      acreage: null,
      quickSaleValueCents: null,
      accessClass: null,
      buildability: null,
      hasUtilities: null,
      comparableCount: 0,
    });
    expect(estimate.confidence).toBe('LOW');
  });
});

describe('annualize', () => {
  it('makes a fast small return beat a slow large one', () => {
    // 20% in six months is a better business than 50% in three years, and
    // ranking on total return cannot see it.
    expect(annualize(0.2, 182)).toBeGreaterThan(annualize(0.5, 1095));
  });

  it('leaves a one-year return unchanged', () => {
    expect(annualize(0.3, 365)).toBeCloseTo(0.3, 6);
  });

  it('is zero rather than infinite for a nonsensical hold', () => {
    expect(annualize(0.3, 0)).toBe(0);
  });
});
