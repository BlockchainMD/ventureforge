import { describe, expect, it } from 'vitest';
import {
  buildAmortizationSchedule,
  compareCashVsFinanced,
  irr,
  suggestTerms,
  type FinanceTerms,
} from './owner-finance';

/**
 * Amortisation is where integer-cent arithmetic either holds or quietly drifts,
 * so most of these check that the schedule closes exactly — a note whose final
 * balance is three cents is a note nobody can close.
 */

const FIRST = new Date('2026-09-01T00:00:00Z');

const terms = (overrides: Partial<FinanceTerms> = {}): FinanceTerms => ({
  salePriceCents: 1_500_000, // $15,000
  downPaymentCents: 150_000, //  $1,500
  annualRate: 0.1,
  termMonths: 84,
  documentFeeCents: 25_000,
  monthlyFeeCents: 1_000,
  ...overrides,
});

describe('buildAmortizationSchedule', () => {
  it('pays the balance to exactly zero', () => {
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    expect(schedule.payments.at(-1)!.balanceAfterCents).toBe(0);
  });

  it('closes to zero across a wide range of terms and rates', () => {
    for (const rate of [0, 0.04, 0.075, 0.1, 0.155, 0.22]) {
      for (const months of [1, 6, 24, 36, 84, 120, 240]) {
        for (const price of [80_000, 1_500_000, 4_250_000, 19_999_99]) {
          const schedule = buildAmortizationSchedule(
            terms({
              salePriceCents: price,
              annualRate: rate,
              termMonths: months,
              downPaymentCents: 0,
            }),
            FIRST,
          );
          expect(
            schedule.payments.at(-1)!.balanceAfterCents,
            `rate ${rate} term ${months} price ${price}`,
          ).toBe(0);
        }
      }
    }
  });

  it('principal repaid equals the amount financed, to the cent', () => {
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    const principal = schedule.payments.reduce((sum, p) => sum + p.principalCents, 0);
    expect(principal).toBe(schedule.financedCents);
  });

  it('each payment is interest on the balance plus principal plus the fee', () => {
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    for (const payment of schedule.payments) {
      expect(payment.paymentCents).toBe(
        payment.principalCents + payment.interestCents + payment.feeCents,
      );
    }
  });

  it('shifts from interest to principal as the note matures', () => {
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    const first = schedule.payments[0]!;
    const last = schedule.payments.at(-1)!;
    expect(first.interestCents).toBeGreaterThan(last.interestCents);
    expect(first.principalCents).toBeLessThan(last.principalCents);
  });

  it('charges no interest at a zero rate', () => {
    const schedule = buildAmortizationSchedule(terms({ annualRate: 0 }), FIRST);
    expect(schedule.totalInterestCents).toBe(0);
    expect(schedule.payments.at(-1)!.balanceAfterCents).toBe(0);
  });

  it('turns a $15,000 cash parcel into about $21,400 nominal', () => {
    // $13,500 financed at 10% over 84 months is ~$224/month. With the deposit,
    // the document fee and the monthly servicing fee that is ~$21,400 against
    // $15,000 cash — a 43% uplift, paid out over seven years.
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    expect(schedule.totalReceivedCents).toBeGreaterThan(2_050_000);
    expect(schedule.totalReceivedCents).toBeLessThan(2_250_000);
    expect(schedule.monthlyPaymentCents).toBeGreaterThan(20_000);
    expect(schedule.monthlyPaymentCents).toBeLessThan(25_000);
  });

  it('does not roll a month-end due date into the following month', () => {
    const schedule = buildAmortizationSchedule(
      terms({ termMonths: 6 }),
      new Date('2026-01-31T00:00:00Z'),
    );
    // January 31 + 1 month is the end of February, not March 3.
    expect(schedule.payments[1]!.dueDate.getUTCMonth()).toBe(1);
    expect(schedule.payments[2]!.dueDate.getUTCMonth()).toBe(2);
  });

  it('ends early if the balance clears before the term does', () => {
    const schedule = buildAmortizationSchedule(
      terms({ salePriceCents: 100_000, downPaymentCents: 99_000, termMonths: 60 }),
      FIRST,
    );
    expect(schedule.payments.length).toBeLessThan(60);
    expect(schedule.payments.at(-1)!.balanceAfterCents).toBe(0);
  });
});

describe('irr', () => {
  it('recovers a known rate', () => {
    // $1,000 out, $1,100 back in one period: 10%.
    expect(irr([-1000, 1100])!).toBeCloseTo(0.1, 6);
  });

  it('returns null when no rate explains the flows', () => {
    expect(irr([100, 200, 300])).toBeNull();
    expect(irr([-100])).toBeNull();
  });

  it('handles a long amortising stream', () => {
    const schedule = buildAmortizationSchedule(terms(), FIRST);
    const flows = [-1_000_000, ...schedule.payments.map((p) => p.paymentCents)];
    const monthly = irr(flows);
    expect(monthly).not.toBeNull();
    expect(monthly!).toBeGreaterThan(0);
  });
});

describe('compareCashVsFinanced', () => {
  const schedule = buildAmortizationSchedule(terms(), FIRST);

  it('prefers financing when the stream out-earns a slow cash sale', () => {
    // A parcel that would take two and a half years to move for cash. The
    // financed stream returns ~130% a year against ~81% for the cash exit.
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 900,
      terms: terms(),
      schedule,
    });
    expect(comparison.recommendation).toBe('FINANCE');
    expect(comparison.upliftCents).toBeGreaterThan(0);
    expect(comparison.rationale).toMatch(/wider pool|a year/);
  });

  it('prefers cash when the parcel would sell quickly anyway', () => {
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 45,
      terms: terms(),
      schedule,
    });
    expect(comparison.recommendation).toBe('CASH');
    expect(comparison.rationale).toContain('frees the capital');
  });

  it('says either exit will do when the two return about the same', () => {
    // At a 540-day cash hold the two are within a few percent of each other,
    // and claiming a winner there would be false precision.
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 540,
      terms: terms(),
      schedule,
    });
    expect(comparison.recommendation).toBe('EITHER');
    expect(comparison.rationale).toContain('roughly the same');
  });

  it('reports the nominal uplift financing produces', () => {
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 180,
      terms: terms(),
      schedule,
    });
    expect(comparison.upliftRatio).toBeGreaterThan(0.35);
  });

  it('warns when the deposit leaves capital exposed', () => {
    const comparison = compareCashVsFinanced({
      allInBasisCents: 900_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 180,
      terms: terms(),
      schedule,
    });
    expect(comparison.warnings.some((w) => w.includes('does not cover the all-in basis'))).toBe(
      true,
    );
  });

  it('always says that default risk is assumed, and at what rate', () => {
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 180,
      terms: terms(),
      schedule,
    });
    expect(comparison.warnings.some((w) => w.includes('stop paying'))).toBe(true);
  });

  it('flags a rate that could run into usury limits', () => {
    const hot = terms({ annualRate: 0.24 });
    const comparison = compareCashVsFinanced({
      allInBasisCents: 500_000,
      cashSalePriceCents: 1_500_000,
      cashHoldDays: 180,
      terms: hot,
      schedule: buildAmortizationSchedule(hot, FIRST),
    });
    expect(comparison.warnings.some((w) => w.includes('usury'))).toBe(true);
  });
});

describe('suggestTerms', () => {
  it('asks about a tenth down, with a floor that covers closing', () => {
    expect(suggestTerms(2_000_000).downPaymentCents).toBe(200_000);
    expect(suggestTerms(100_000).downPaymentCents).toBe(50_000);
  });

  it('lengthens the term as the balance grows, to keep the payment reachable', () => {
    expect(suggestTerms(400_000).termMonths).toBeLessThan(suggestTerms(9_000_000).termMonths);
  });

  it('produces terms that amortise cleanly', () => {
    for (const price of [80_000, 750_000, 3_000_000, 12_000_000]) {
      const schedule = buildAmortizationSchedule(suggestTerms(price), FIRST);
      expect(schedule.payments.at(-1)!.balanceAfterCents).toBe(0);
    }
  });
});
