import { describe, expect, it } from 'vitest';
import { adjustPricePerAcreForSize, acreageBandFor } from './acreage-curve';
import {
  analyzeComps,
  DEFAULT_COMPS_CONFIG,
  selectByRadius,
  weightedMedian,
  type CompCandidate,
  selectByNeighborhood,
} from './comps';
import { valueParcel, DEFAULT_VALUATION_CONFIG, crossCheckAssessment } from './valuation';
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

describe('analyzeComps — fixture provenance', () => {
  const subject = { acreage: 5, zoning: 'RR', accessClass: 'A', hasUtilities: false };
  const clean = [comp(), comp(), comp(), comp(), comp(), comp()];

  it('reaches its normal confidence on recorded sales', () => {
    const result = analyzeComps(subject, clean, NOW);
    expect(result.confidence).not.toBe('LOW');
    expect(result.warnings.some((w) => w.includes('fixture'))).toBe(false);
  });

  it('caps confidence at LOW as soon as one selected comp is a fixture', () => {
    // Same six tight comps; one is synthetic. Tightness must not buy confidence
    // that the underlying data does not support.
    const withFixture = [comp({ isFixture: true }), ...clean.slice(1)];
    const result = analyzeComps(subject, withFixture, NOW);
    expect(result.confidence).toBe('LOW');
  });

  it('says plainly that the number is not underwritable', () => {
    const result = analyzeComps(
      subject,
      clean.map(() => comp({ isFixture: true })),
      NOW,
    );
    const warning = result.warnings.find((w) => w.includes('fixture'));
    expect(warning).toBeDefined();
    expect(warning).toContain('not recorded sales');
    expect(warning).toContain('Do not underwrite');
    expect(warning).toContain('6 of the 6');
  });

  it('marks the individual comps so the UI can flag each row', () => {
    const result = analyzeComps(subject, [comp({ isFixture: true }), ...clean.slice(1)], NOW);
    expect(result.comps.filter((c) => c.isFixture)).toHaveLength(1);
    expect(result.comps.filter((c) => !c.isFixture)).toHaveLength(5);
  });

  it('carries the cap and the warning through valueParcel', () => {
    const result = valueParcel(
      {
        subject,
        candidates: clean.map(() => comp({ isFixture: true })),
        landAssessedValueCents: null,
      },
      {
        ...DEFAULT_VALUATION_CONFIG,
        comps: DEFAULT_COMPS_CONFIG,
        quickSaleDiscount: 0.25,
        investorLiquidationDiscount: 0.45,
      },
    );
    expect(result.confidence).toBe('LOW');
    expect(result.warnings.some((w) => w.includes('Do not underwrite'))).toBe(true);
  });
});

describe('selectByRadius', () => {
  const config = { ...DEFAULT_COMPS_CONFIG };
  const at = (metres: number | null) => comp({ distanceMeters: metres });

  it('stays in the neighbourhood when the neighbourhood has enough sales', () => {
    const near = Array.from({ length: 10 }, () => at(1500));
    const far = Array.from({ length: 30 }, () => at(30_000));
    const result = selectByRadius([...near, ...far], config);
    expect(result.radiusMeters).toBe(3000);
    expect(result.pool).toHaveLength(10);
    expect(result.widened).toBeNull();
  });

  it('widens only as far as it must', () => {
    const result = selectByRadius(
      [...Array.from({ length: 2 }, () => at(1500)), ...Array.from({ length: 9 }, () => at(8000))],
      config,
    );
    expect(result.radiusMeters).toBe(10_000);
    expect(result.pool).toHaveLength(11);
    expect(result.widened).toBe(2);
  });

  it('falls back to the widest ring rather than returning nothing', () => {
    const result = selectByRadius([at(35_000), at(38_000)], config);
    expect(result.radiusMeters).toBe(40_000);
    expect(result.pool).toHaveLength(2);
    expect(result.widened).toBe(0);
  });

  it('leaves unlocated sales out of a ring that fills without them', () => {
    // An unlocated sale used to satisfy every radius, so the tightest ring
    // always looked full: the search never widened, never warned, and reported
    // 3km while valuing off sales from anywhere in the county.
    const result = selectByRadius(
      [...Array.from({ length: 9 }, () => at(1000)), at(null), at(null)],
      config,
    );
    expect(result.radiusMeters).toBe(3000);
    expect(result.pool).toHaveLength(9);
    expect(result.unlocatedUsed).toBe(0);
  });

  it('falls back to unlocated sales rather than refusing to value', () => {
    // The case the old rule was written for, and the only one it was right
    // about: a county part-way through geocoding its roll. Two located sales
    // cannot carry a valuation, so the unlocated ones are taken — and counted,
    // so the caller can say so and mark the valuation down.
    const result = selectByRadius([at(1000), at(35_000), at(null), at(null), at(null)], config);
    expect(result.pool).toHaveLength(5);
    expect(result.unlocatedUsed).toBe(3);
  });

  it('does not reach for unlocated sales once the widest ring is full', () => {
    const result = selectByRadius(
      [...Array.from({ length: 8 }, () => at(35_000)), at(null)],
      config,
    );
    expect(result.radiusMeters).toBe(40_000);
    expect(result.unlocatedUsed).toBe(0);
    expect(result.pool).toHaveLength(8);
  });

  it('keeps a metropolitan lot away from rural sales forty kilometres off', () => {
    // The case this exists for: 40km spans greater Orlando, and a downtown
    // infill lot has nothing in common with a parcel east of the river.
    const urban = Array.from({ length: 8 }, () =>
      comp({ distanceMeters: 2000, salePriceCents: 8_000_000 }),
    );
    const rural = Array.from({ length: 40 }, () =>
      comp({ distanceMeters: 35_000, salePriceCents: 300_000 }),
    );
    const result = selectByRadius([...urban, ...rural], config);
    expect(result.pool).toHaveLength(8);
    expect(result.pool.every((c) => c.salePriceCents === 8_000_000)).toBe(true);
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

  it('uses the assessor when the comparables disagree by an order of magnitude', () => {
    // Orange County's top-ranked parcel: half an acre assessed at $65,000,
    // valued from comparables at $821,408. Capping confidence was not enough —
    // the worklist sorts by quick-sale value and the maximum bid is solved from
    // it, so the parcel led the buy list at a figure the engine disowned.
    const result = valueParcel({
      subject: { ...subject, acreage: 0.51 },
      candidates: [
        comp({ acreage: 0.5, salePriceCents: 750_000_00 }),
        comp({ acreage: 0.5, salePriceCents: 750_000_00 }),
        comp({ acreage: 0.5, salePriceCents: 750_000_00 }),
        comp({ acreage: 0.5, salePriceCents: 750_000_00 }),
      ],
      landAssessedValueCents: 65_000_00,
      now: NOW,
    });
    expect(result.retail!.method).toContain('Assessor land value');
    // The label has to say which fallback this is. "No comparable sales
    // available" would be a lie: there were four, and they were rejected.
    expect(result.retail!.method).toContain('rejected as describing other land');
    // The comparables would have produced roughly $765,000 against an
    // assessment of $65,000. Whatever the parcel is worth, it is not that.
    expect(result.retail!.mid).toBeLessThan(200_000_00);
    expect(result.warnings.some((w) => w.includes('describing a different location'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('a floor and a placeholder'))).toBe(true);
  });

  it('keeps the comparables when the assessment merely lags', () => {
    // A 2× gap is ordinary on vacant land and must not trigger the fallback,
    // or every parcel in the product reverts to the assessor's number.
    const result = valueParcel({
      subject,
      candidates: [comp(), comp(), comp(), comp()],
      landAssessedValueCents: 3_000_00,
      now: NOW,
    });
    expect(result.retail!.method).toContain('Comparable sales');
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
  it('refuses to price a parcel whose cost nobody knows', () => {
    // Tax-deed inventory is published without a price. Coercing that to zero
    // yields a basis of pure closing costs, a basis/QSV ratio near zero and a
    // tier of EXCEPTIONAL — which is how an unpriced parcel reaches the top of
    // a buy list carrying a fabricated four-figure return.
    const economics = computeEconomics(
      { acquisitionPriceCents: null, quickSaleValueCents: 4_584_038 },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.priced).toBe(false);
    expect(economics.tier).toBe('UNKNOWN');
    expect(economics.basisToQsv).toBeNull();
    expect(economics.basisToRetail).toBeNull();
    expect(economics.roiAtQsv).toBeNull();
    expect(economics.annualizedRoiAtQsv).toBeNull();
    expect(economics.grossProfitAtQsv).toBeNull();
    // The basis is still reported: it is a genuine floor, and knowing that
    // owning the parcel costs $3,300 before you have paid for it is useful.
    expect(economics.allInBasis).toBeGreaterThan(0);
  });

  it('still measures the cost floor against value when there is no price', () => {
    // Suppressing every ratio would suppress the one conclusion that needs no
    // price: if closing and holding already cost more than the parcel is
    // worth, no purchase figure rescues it. That rejection has to keep firing.
    const economics = computeEconomics(
      { acquisitionPriceCents: null, quickSaleValueCents: 56_250 },
      COSTS,
      THRESHOLDS,
    );
    expect(economics.basisToQsv).toBeNull();
    expect(economics.basisFloorToQsv).not.toBeNull();
    expect(economics.basisFloorToQsv!).toBeGreaterThan(1);
  });

  it('treats a genuinely free parcel differently from an unpriced one', () => {
    const free = computeEconomics(
      { acquisitionPriceCents: 0, quickSaleValueCents: 4_584_038 },
      COSTS,
      THRESHOLDS,
    );
    expect(free.priced).toBe(true);
    expect(free.basisToQsv).not.toBeNull();
    expect(free.tier).not.toBe('UNKNOWN');
  });

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
      {
        acquisitionPriceCents: 314_000,
        quickSaleValueCents: 2_600_000,
        retailValueCents: 3_400_000,
      },
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

describe('crossCheckAssessment', () => {
  const config = DEFAULT_VALUATION_CONFIG;

  it('says nothing about the ordinary gap between market and assessment', () => {
    // Across Orange County the median ratio is 1.5. Assessors lag the market
    // on vacant land; that is expected and is not a fault.
    expect(crossCheckAssessment(150_000, 100_000, config)).toEqual({
      warning: null,
      cap: null,
      severe: false,
    });
  });

  it('caps confidence when the valuation runs well ahead of the assessment', () => {
    const result = crossCheckAssessment(500_000, 100_000, config);
    expect(result.cap).toBe('LOW');
    expect(result.warning).toContain('5.0×');
  });

  it('treats an order-of-magnitude gap as a disagreement, not a lag', () => {
    // Orange County holds a 0.07-acre parcel assessed at $100 that the engine
    // valued at $206,986. That is not the assessor being behind the market.
    const result = crossCheckAssessment(20_698_643, 10_000, config);
    expect(result.cap).toBe('UNKNOWN');
    expect(result.severe).toBe(true);
    expect(result.warning).toContain('different location');
  });

  it('is equally suspicious of a valuation far below the assessment', () => {
    const result = crossCheckAssessment(10_000, 100_000, config);
    expect(result.cap).toBe('LOW');
    expect(result.warning).toContain('weaker land');
  });

  it('stays silent when the county publishes no land value', () => {
    expect(crossCheckAssessment(150_000, null, config)).toEqual({
      warning: null,
      cap: null,
      severe: false,
    });
    expect(crossCheckAssessment(150_000, 0, config)).toEqual({
      warning: null,
      cap: null,
      severe: false,
    });
  });

  it('reports a verdict rather than a replacement value', () => {
    // The check does not price the parcel. At the severe threshold it says the
    // comparables are unusable and leaves the caller to fall back to the
    // assessor; short of that it qualifies the comps valuation and nothing
    // more. Either way the number it returns is a confidence, never a price.
    const result = crossCheckAssessment(20_000_000, 10_000, config);
    expect(result).not.toHaveProperty('value');
    expect(Object.keys(result).sort()).toEqual(['cap', 'severe', 'warning']);
  });

  it('leaves an assessment that merely lags in charge of nothing', () => {
    // Two thresholds, and only the far one displaces the comparables. A 2× gap
    // is the median across Orange County; treating that as a disagreement would
    // revert the whole product to assessor values.
    expect(crossCheckAssessment(200_000, 100_000, config).severe).toBe(false);
    expect(crossCheckAssessment(500_000, 100_000, config).severe).toBe(false);
    expect(crossCheckAssessment(1_000_000, 100_000, config).severe).toBe(true);
  });
});

describe('selectByNeighborhood', () => {
  const config = { ...DEFAULT_COMPS_CONFIG, minComps: 3, preferredComps: 4 };
  const inHood = (n: number) =>
    Array.from({ length: n }, () => comp({ neighborhood: '04490123', distanceMeters: 38_000 }));
  const elsewhere = (n: number) =>
    Array.from({ length: n }, () => comp({ neighborhood: '09112277', distanceMeters: 200 }));

  it('prefers the assessor’s boundary over proximity', () => {
    // A sale two towns over inside the same coded neighbourhood is a better
    // comparable than one across the street outside it. Orange County's sales
    // span $166k to $6.3M per acre inside ten kilometres, so distance alone
    // reliably collects land that has nothing to do with the subject.
    const result = selectByNeighborhood([...inHood(4), ...elsewhere(9)], '04490123', config);
    expect(result?.pool).toHaveLength(4);
    expect(result?.pool.every((c) => c.neighborhood === '04490123')).toBe(true);
  });

  it('declines to decide when too few sales share the neighbourhood', () => {
    // A thin neighbourhood is noisier than a broader ring, not tighter. On
    // Orange County's 655 sales across 184 neighbourhoods, letting three
    // decide moved one parcel from nine times the county's assessment to
    // seventy-two.
    const result = selectByNeighborhood([...inHood(3), ...elsewhere(9)], '04490123', config);
    expect(result?.pool).toHaveLength(0);
    // Reported rather than silently zero, so the caller can say the fallback
    // happened instead of implying the neighbourhood was used.
    expect(result?.matched).toBe(3);
  });

  it('returns null when the subject has no neighbourhood at all', () => {
    expect(selectByNeighborhood(inHood(9), null, config)).toBeNull();
    expect(selectByNeighborhood(inHood(9), '   ', config)).toBeNull();
  });
});
