import { describe, expect, it } from 'vitest';
import { adjustPricePerAcreForSize, acreageBandFor } from './acreage-curve';
import { analyzeComps, weightedMedian, type CompCandidate } from './comps';
import { valueParcel } from './valuation';
import { classifyTier, computeEconomics, maximumBidForTargetRatio } from './economics';
import type { EconomicsCostModel, EconomicsThresholds } from './economics';

const NOW = new Date('2026-08-18T00:00:00Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function comp(overrides: Partial<CompCandidate> = {}): CompCandidate {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    apn: null,
    saleDate: daysAgo(120),
    salePriceCents: 1_200_000, // $12,000
    acreage: 5,
    distanceMeters: 2000,
    zoning: 'RR',
    accessClass: 'A',
    hasUtilities: false,
    source: 'County recorder',
    ...overrides,
  };
}

const COSTS: EconomicsCostModel = {
  recordingCostCents: 6_000,
  titleCostCents: 45_000,
  curativeCostBaseCents: 0,
  marketingCostRate: 0.06,
  marketingCostMinCents: 25_000,
  annualCarryRate: 0.03,
  annualTaxFallbackCents: 12_000,
  expectedHoldDays: 180,
};

const THRESHOLDS: EconomicsThresholds = {
  exceptionalBasisToQsv: 0.1,
  strongBasisToQsv: 0.2,
  potentialBasisToQsv: 0.3,
};

describe('acreage curve', () => {
  it('prices smaller parcels at a higher rate per acre', () => {
    // A 25-acre comp at $2,000/ac implies materially more per acre for 5 acres.
    const result = adjustPricePerAcreForSize(200_000, 25, 5);
    expect(result).not.toBeNull();
    expect(result!.adjusted).toBeGreaterThan(200_000);
    expect(result!.multiplier).toBeGreaterThan(1);
  });

  it('prices larger parcels at a lower rate per acre', () => {
    const result = adjustPricePerAcreForSize(200_000, 2, 10);
    expect(result!.adjusted).toBeLessThan(200_000);
  });

  it('is the identity when sizes match', () => {
    const result = adjustPricePerAcreForSize(200_000, 5, 5);
    expect(result!.multiplier).toBeCloseTo(1, 10);
  });

  it('refuses to stretch a comp across an implausible size gap', () => {
    // 200 acres cannot inform a 1-acre subject.
    expect(adjustPricePerAcreForSize(100_000, 200, 1)).toBeNull();
  });

  it('derives the acceptable acreage band from the same ratio it enforces', () => {
    const band = acreageBandFor(5);
    expect(adjustPricePerAcreForSize(100_000, band.max * 0.99, 5)).not.toBeNull();
    expect(adjustPricePerAcreForSize(100_000, band.max * 1.5, 5)).toBeNull();
  });
});

describe('weightedMedian', () => {
  it('ignores an extreme outlier that would wreck a mean', () => {
    const points = [
      { value: 100, weight: 1 },
      { value: 110, weight: 1 },
      { value: 105, weight: 1 },
      { value: 1_000_000, weight: 1 },
    ];
    const median = weightedMedian(points)!;
    expect(median).toBeLessThan(300);
  });

  it('respects weights', () => {
    const points = [
      { value: 100, weight: 0.01 },
      { value: 500, weight: 10 },
    ];
    expect(weightedMedian(points)!).toBeGreaterThan(400);
  });

  it('returns null for an empty set', () => {
    expect(weightedMedian([])).toBeNull();
  });
});

describe('analyzeComps', () => {
  const subject = { acreage: 5, zoning: 'RR', accessClass: 'A', hasUtilities: false };

  it('produces a central price per acre from clean comps', () => {
    const result = analyzeComps(
      subject,
      [comp(), comp({ salePriceCents: 1_300_000 }), comp({ salePriceCents: 1_100_000 })],
      NOW,
    );
    expect(result.comps).toHaveLength(3);
    expect(result.pricePerAcre).toBeGreaterThan(200_000);
    expect(result.pricePerAcre).toBeLessThan(300_000);
  });

  it('drops sales that are too old or too far away, and says how many', () => {
    const result = analyzeComps(
      subject,
      [
        comp({ saleDate: daysAgo(4000) }),
        comp({ distanceMeters: 200_000 }),
        comp(),
        comp(),
        comp(),
      ],
      NOW,
    );
    expect(result.comps).toHaveLength(3);
    expect(result.rejectedCount).toBe(2);
  });

  it('discounts a comp with better access than the subject', () => {
    const landlocked = { ...subject, accessClass: 'D' };
    const result = analyzeComps(landlocked, [comp({ accessClass: 'A' })], NOW);
    const only = result.comps[0]!;
    expect(only.adjustedPricePerAcre).toBeLessThan(only.pricePerAcre);
    expect(only.adjustments.map((a) => a.factor)).toContain('access');
  });

  it('records the rationale for every adjustment it makes', () => {
    const result = analyzeComps(subject, [comp({ acreage: 12, hasUtilities: true })], NOW);
    const only = result.comps[0]!;
    expect(only.adjustments.length).toBeGreaterThanOrEqual(3);
    for (const adjustment of only.adjustments) {
      expect(adjustment.rationale.length).toBeGreaterThan(10);
      expect(Number.isFinite(adjustment.multiplier)).toBe(true);
    }
  });

  it('reports UNKNOWN confidence and a warning when there are no comps', () => {
    const result = analyzeComps(subject, [], NOW);
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.pricePerAcre).toBeNull();
    expect(result.warnings[0]).toContain('No recorded vacant-land sales');
  });

  it('warns when comps disagree wildly', () => {
    const result = analyzeComps(
      subject,
      [
        comp({ salePriceCents: 200_000 }),
        comp({ salePriceCents: 400_000 }),
        comp({ salePriceCents: 5_000_000 }),
        comp({ salePriceCents: 6_000_000 }),
      ],
      NOW,
    );
    expect(result.warnings.some((w) => w.includes('disagree widely'))).toBe(true);
  });
});

describe('valueParcel', () => {
  const subject = { acreage: 5, zoning: 'RR', accessClass: 'A', hasUtilities: false };

  it('orders retail above quick sale above investor liquidation', () => {
    const result = valueParcel({
      subject,
      candidates: [comp(), comp(), comp(), comp(), comp()],
      now: NOW,
    });
    expect(result.retail!.mid).toBeGreaterThan(result.quickSale!.mid);
    expect(result.quickSale!.mid).toBeGreaterThan(result.investorLiquidation!.mid);
  });

  it('keeps low <= mid <= high for every estimate', () => {
    const result = valueParcel({
      subject,
      candidates: [comp(), comp({ salePriceCents: 900_000 }), comp({ salePriceCents: 1_800_000 })],
      now: NOW,
    });
    for (const estimate of [result.retail!, result.quickSale!, result.investorLiquidation!]) {
      expect(estimate.low).toBeLessThanOrEqual(estimate.mid);
      expect(estimate.mid).toBeLessThanOrEqual(estimate.high);
    }
  });

  it('falls back to assessed land value only when no comps exist, and labels it', () => {
    const result = valueParcel({
      subject,
      candidates: [],
      landAssessedValueCents: 800_000,
      now: NOW,
    });
    expect(result.compCount).toBe(0);
    expect(result.confidence).toBe('LOW');
    expect(result.retail!.method).toContain('Assessor land value');
    expect(result.warnings.some((w) => w.includes('assessor'))).toBe(true);
  });

  it('returns nothing rather than inventing a value when it knows nothing', () => {
    const result = valueParcel({ subject, candidates: [], now: NOW });
    expect(result.retail).toBeNull();
    expect(result.quickSale).toBeNull();
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.warnings.some((w) => w.includes('must not be scored'))).toBe(true);
  });

  it('refuses to value a parcel of unknown acreage', () => {
    const result = valueParcel({
      subject: { ...subject, acreage: 0 },
      candidates: [comp()],
      now: NOW,
    });
    expect(result.retail).toBeNull();
    expect(result.warnings[0]).toContain('acreage is unknown');
  });
});

describe('computeEconomics', () => {
  it('builds an all-in basis that exceeds the acquisition price', () => {
    const economics = computeEconomics(
      { acquisitionPriceCents: 314_000, quickSaleValueCents: 2_600_000 },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.allInBasis).toBeGreaterThan(economics.acquisitionPrice);
    expect(economics.allInBasis).toBe(
      economics.acquisitionPrice +
        economics.governmentFees +
        economics.recordingCost +
        economics.titleCost +
        economics.curativeCost +
        economics.carryingCost +
        economics.marketingCost,
    );
  });

  it('computes the brief’s worked example to the right tier', () => {
    // $3,140 acquisition against a $26,000 QSV should land near 19% and STRONG.
    const economics = computeEconomics(
      { acquisitionPriceCents: 314_000, quickSaleValueCents: 2_600_000, retailValueCents: 3_400_000 },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.basisToQsv).toBeGreaterThan(0.12);
    expect(economics.basisToQsv).toBeLessThan(0.3);
    expect(['STRONG', 'POTENTIAL']).toContain(economics.tier);
    expect(economics.grossProfitAtQsv).toBeGreaterThan(1_500_000);
  });

  it('returns null ratios rather than Infinity when value is unknown', () => {
    const economics = computeEconomics({ acquisitionPriceCents: 100_000 }, COSTS, THRESHOLDS);
    expect(economics.basisToQsv).toBeNull();
    expect(economics.roiAtQsv).toBeNull();
    expect(economics.tier).toBe('UNKNOWN');
  });

  it('does not report a fantasy annualised return on a loss', () => {
    const economics = computeEconomics(
      { acquisitionPriceCents: 5_000_000, quickSaleValueCents: 1_000_000 },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.roiAtQsv).toBeLessThan(0);
    expect(economics.annualizedRoiAtQsv).toBeLessThan(0);
    expect(Number.isFinite(economics.annualizedRoiAtQsv!)).toBe(true);
  });
});

describe('classifyTier', () => {
  it('maps the brief’s thresholds', () => {
    expect(classifyTier(0.08, THRESHOLDS)).toBe('EXCEPTIONAL');
    expect(classifyTier(0.18, THRESHOLDS)).toBe('STRONG');
    expect(classifyTier(0.28, THRESHOLDS)).toBe('POTENTIAL');
    expect(classifyTier(0.55, THRESHOLDS)).toBe('WEAK');
    expect(classifyTier(null, THRESHOLDS)).toBe('UNKNOWN');
  });
});

describe('maximumBidForTargetRatio', () => {
  it('produces a bid that actually achieves the target ratio', () => {
    const qsv = 2_600_000;
    const bid = maximumBidForTargetRatio({
      quickSaleValueCents: qsv,
      targetBasisToQsv: 0.2,
      costs: COSTS,
    });
    const economics = computeEconomics(
      { acquisitionPriceCents: bid, quickSaleValueCents: qsv },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.basisToQsv).toBeLessThanOrEqual(0.2 + 1e-6);
    expect(economics.basisToQsv).toBeGreaterThan(0.19);
  });

  it('never returns a negative bid when costs exceed the target basis', () => {
    const bid = maximumBidForTargetRatio({
      quickSaleValueCents: 100_000,
      targetBasisToQsv: 0.05,
      costs: COSTS,
    });
    expect(bid).toBe(0);
  });
});
