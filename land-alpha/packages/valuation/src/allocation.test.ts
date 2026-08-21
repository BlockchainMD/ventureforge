import { describe, expect, it } from 'vitest';
import { allocateCapital, DEFAULT_ALLOCATION_CONFIG, type AllocationCandidate } from './allocation';

/**
 * The behaviour worth testing is where the allocator disagrees with the ranked
 * list — which is the reason it exists.
 */

const candidate = (overrides: Partial<AllocationCandidate> = {}): AllocationCandidate => ({
  parcelId: Math.random().toString(36).slice(2),
  apn: 'TEST-1',
  state: 'FL',
  county: 'Orange',
  allInBasisCents: 500_000, // $5,000
  quickSaleValueCents: 1_500_000, // $15,000
  expectedHoldDays: 180,
  alphaScore: 70,
  valuationConfidence: 'MEDIUM',
  ...overrides,
});

const config = (overrides: Partial<Parameters<typeof allocateCapital>[1]> = {}) => ({
  budgetCents: 5_000_000, // $50,000
  ...DEFAULT_ALLOCATION_CONFIG,
  ...overrides,
});

describe('allocateCapital', () => {
  it('buys nine cheap parcels rather than two expensive ones', () => {
    // The ranked list would put the big parcel first on total profit. Per
    // dollar per year the small ones win, and nine of them fit.
    const plan = allocateCapital(
      [
        candidate({ allInBasisCents: 2_400_000, quickSaleValueCents: 4_000_000, apn: 'BIG' }),
        ...Array.from({ length: 9 }, (_, i) =>
          candidate({
            allInBasisCents: 500_000,
            quickSaleValueCents: 1_500_000,
            apn: `SMALL-${i}`,
            county: `C${i}`,
          }),
        ),
      ],
      config(),
    );
    expect(plan.picks.length).toBeGreaterThanOrEqual(9);
    expect(plan.picks.map((p) => p.apn)).not.toContain('BIG');
  });

  it('prefers a smaller return that comes back sooner', () => {
    const fast = candidate({ apn: 'FAST', quickSaleValueCents: 900_000, expectedHoldDays: 90 });
    const slow = candidate({
      apn: 'SLOW',
      quickSaleValueCents: 1_500_000,
      expectedHoldDays: 1000,
      county: 'Lake',
    });
    // Room for one, so the allocator has to choose. The slow parcel has the
    // bigger total profit and loses anyway.
    const plan = allocateCapital([slow, fast], config({ budgetCents: 2_000_000, maxParcels: 1 }));
    expect(plan.picks).toHaveLength(1);
    expect(plan.picks[0]!.apn).toBe('FAST');
  });

  it('refuses to put the whole budget in one county', () => {
    const plan = allocateCapital(
      Array.from({ length: 20 }, (_, i) => candidate({ apn: `P${i}` })),
      config(),
    );
    const orange = plan.byCounty.find((c) => c.county === 'FL/Orange');
    expect(orange!.committedCents).toBeLessThanOrEqual(5_000_000 * 0.4);
    expect(plan.skipped.some((s) => s.reason.includes('concentration limit'))).toBe(true);
  });

  it('refuses to put too much into a single parcel', () => {
    const plan = allocateCapital(
      [candidate({ apn: 'WHALE', allInBasisCents: 2_000_000, quickSaleValueCents: 9_000_000 })],
      config(),
    );
    expect(plan.picks).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('single-parcel limit');
  });

  it('will not spend money on a parcel that loses it', () => {
    const plan = allocateCapital(
      [candidate({ apn: 'LOSS', allInBasisCents: 1_600_000, quickSaleValueCents: 1_500_000 })],
      config(),
    );
    expect(plan.picks).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('less than it costs');
  });

  it('honours the confidence floor rather than buying on a guess', () => {
    const plan = allocateCapital(
      [
        candidate({ valuationConfidence: 'UNKNOWN' }),
        candidate({ valuationConfidence: 'LOW', county: 'Lake' }),
      ],
      config({ minConfidence: 'MEDIUM' }),
    );
    expect(plan.picks).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped[0]!.reason).toContain('below the floor');
  });

  it('skips a parcel that would take too long to come back', () => {
    const plan = allocateCapital(
      [candidate({ expectedHoldDays: 1500 })],
      config({ maxHoldDays: 730 }),
    );
    expect(plan.picks).toHaveLength(0);
    expect(plan.skipped[0]!.reason).toContain('beyond the horizon');
  });

  it('says when the constraint is the inventory rather than the capital', () => {
    const plan = allocateCapital(
      [candidate({ county: 'Orange' })],
      config({ budgetCents: 50_000_000 }),
    );
    expect(plan.uncommittedCents).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.includes('not because the money ran out'))).toBe(true);
  });

  it('says plainly when nothing qualifies', () => {
    const plan = allocateCapital([candidate({ quickSaleValueCents: null })], config());
    expect(plan.picks).toHaveLength(0);
    expect(plan.warnings[0]).toContain('the constraint is the inventory, not the capital');
  });

  it('warns that a single-county basket is one bet', () => {
    const plan = allocateCapital(
      Array.from({ length: 3 }, (_, i) => candidate({ apn: `P${i}`, allInBasisCents: 400_000 })),
      config({ maxCountyShare: 1 }),
    );
    expect(plan.picks.length).toBeGreaterThan(1);
    expect(plan.warnings.some((w) => w.includes('one bet on one county'))).toBe(true);
  });

  it('flags a basket resting on weak valuations', () => {
    const plan = allocateCapital(
      [candidate({ valuationConfidence: 'LOW' })],
      config({ minConfidence: 'LOW' }),
    );
    expect(plan.picks).toHaveLength(1);
    expect(plan.warnings.some((w) => w.includes('shortlist to verify, not a buy order'))).toBe(
      true,
    );
  });

  it('calls out a return too good to be true', () => {
    // A 20x annual return is a broken valuation, not a find.
    const plan = allocateCapital(
      [
        candidate({
          allInBasisCents: 300_000,
          quickSaleValueCents: 5_000_000,
          expectedHoldDays: 200,
        }),
      ],
      config(),
    );
    expect(plan.picks).toHaveLength(1);
    expect(plan.warnings.some((w) => w.includes('more likely a valuation error'))).toBe(true);
  });

  it('never commits more than the budget', () => {
    const plan = allocateCapital(
      Array.from({ length: 50 }, (_, i) =>
        candidate({ apn: `P${i}`, county: `County${i % 12}`, allInBasisCents: 900_000 }),
      ),
      config(),
    );
    expect(plan.committedCents).toBeLessThanOrEqual(plan.budgetCents);
    expect(plan.committedCents + plan.uncommittedCents).toBe(plan.budgetCents);
  });

  it('reports the expected return on what it actually deployed', () => {
    const plan = allocateCapital([candidate()], config({ budgetCents: 2_000_000 }));
    expect(plan.picks).toHaveLength(1);
    expect(plan.expectedProfitCents).toBe(1_000_000);
    expect(plan.expectedReturnOnDeployed).toBeCloseTo(2, 6);
  });
});
