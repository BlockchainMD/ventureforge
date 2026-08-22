import type { UsdCents } from '@land-alpha/shared';

/**
 * Seller financing.
 *
 * The same parcel sold two ways. Cash: one payment, capital freed to buy the
 * next one. Financed: a deposit and a stream of monthly payments, a much larger
 * nominal total, a far wider pool of buyers — and capital locked up for years.
 *
 * Which is better is not obvious and is not the same answer for every parcel,
 * which is exactly why it belongs in the engine rather than in an analyst's
 * head. A $15,000 parcel sold outright returns $15,000 today. The same parcel
 * at $1,500 down and $299 a month for 84 months returns about $26,600 nominal —
 * but spread over seven years, during which that capital cannot buy anything
 * else. The comparison that settles it is the internal rate of return of the
 * payment stream against what the money would earn redeployed.
 *
 * Every figure here is integer cents. Amortisation is where rounding drift
 * shows up as a balance that never quite reaches zero, so the final payment
 * absorbs the remainder and the schedule is asserted to close exactly.
 *
 * This models money, not law. Seller-financed land sales are generally outside
 * the federal residential-mortgage rules that govern financing a home, but that
 * depends on the parcel, the buyer's intent and the state, and several states
 * regulate land-contract forfeiture closely. Nothing here is a legal opinion
 * and the terms it produces need review before they are offered.
 */

export interface FinanceTerms {
  readonly salePriceCents: UsdCents;
  readonly downPaymentCents: UsdCents;
  /** Nominal annual rate, e.g. 0.10 for 10%. */
  readonly annualRate: number;
  readonly termMonths: number;
  /** Charged at signing, not financed. */
  readonly documentFeeCents?: UsdCents;
  /** Added to each payment: taxes, insurance, servicing. */
  readonly monthlyFeeCents?: UsdCents;
}

export interface ScheduledPayment {
  readonly number: number;
  readonly dueDate: Date;
  readonly paymentCents: UsdCents;
  readonly principalCents: UsdCents;
  readonly interestCents: UsdCents;
  readonly feeCents: UsdCents;
  readonly balanceAfterCents: UsdCents;
}

export interface AmortizationSchedule {
  readonly financedCents: UsdCents;
  readonly monthlyPaymentCents: UsdCents;
  readonly payments: ScheduledPayment[];
  readonly totalInterestCents: UsdCents;
  readonly totalFeesCents: UsdCents;
  /** Down payment plus every scheduled payment plus the document fee. */
  readonly totalReceivedCents: UsdCents;
}

export interface FinanceComparison {
  readonly cashProceedsCents: UsdCents;
  readonly financedNominalCents: UsdCents;
  /** Nominal uplift of financing over a cash sale. */
  readonly upliftCents: UsdCents;
  readonly upliftRatio: number;
  /** Annualised return of the payment stream against the parcel's basis. */
  readonly financedIrr: number | null;
  /** Annualised return of selling for cash today. */
  readonly cashAnnualizedRoi: number | null;
  readonly recommendation: 'CASH' | 'FINANCE' | 'EITHER';
  readonly rationale: string;
  readonly warnings: string[];
}

/**
 * Standard amortisation, computed in cents.
 *
 * `payment = P · r / (1 − (1 + r)^−n)`, with a zero-rate special case because
 * that formula divides by zero when r is zero.
 */
export function buildAmortizationSchedule(
  terms: FinanceTerms,
  firstPaymentDate: Date,
): AmortizationSchedule {
  const financed = Math.max(0, terms.salePriceCents - terms.downPaymentCents);
  const n = Math.max(1, Math.trunc(terms.termMonths));
  const monthlyRate = terms.annualRate / 12;
  const monthlyFee = terms.monthlyFeeCents ?? 0;

  const basePayment =
    monthlyRate === 0
      ? Math.ceil(financed / n)
      : Math.ceil((financed * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n)));

  const payments: ScheduledPayment[] = [];
  let balance = financed;
  let totalInterest = 0;

  for (let i = 1; i <= n; i += 1) {
    const interest = Math.round(balance * monthlyRate);
    let principal = basePayment - interest;
    // The last payment settles whatever is left, which is what keeps a schedule
    // of rounded cents from ending a few pennies above or below zero.
    if (i === n || principal >= balance) principal = balance;
    const payment = principal + interest;
    balance -= principal;
    totalInterest += interest;

    payments.push({
      number: i,
      dueDate: addMonths(firstPaymentDate, i - 1),
      paymentCents: payment + monthlyFee,
      principalCents: principal,
      interestCents: interest,
      feeCents: monthlyFee,
      balanceAfterCents: balance,
    });

    if (balance === 0) break;
  }

  const totalFees = payments.length * monthlyFee + (terms.documentFeeCents ?? 0);
  const scheduled = payments.reduce((sum, payment) => sum + payment.paymentCents, 0);

  return {
    financedCents: financed,
    monthlyPaymentCents: basePayment + monthlyFee,
    payments,
    totalInterestCents: totalInterest,
    totalFeesCents: totalFees,
    totalReceivedCents: terms.downPaymentCents + scheduled + (terms.documentFeeCents ?? 0),
  };
}

export interface ComparisonInputs {
  readonly allInBasisCents: UsdCents;
  /** What a cash sale is expected to fetch. */
  readonly cashSalePriceCents: UsdCents;
  /** Expected days to sell for cash; financing usually sells faster. */
  readonly cashHoldDays: number;
  readonly terms: FinanceTerms;
  readonly schedule: AmortizationSchedule;
  /**
   * Share of financed sales expected to stop paying. The parcel usually comes
   * back and the deposit and payments are kept, so a default is not a total
   * loss — but it is not the clean outcome the schedule describes either.
   */
  readonly expectedDefaultRate?: number;
}

export function compareCashVsFinanced(inputs: ComparisonInputs): FinanceComparison {
  const warnings: string[] = [];
  const { schedule, terms } = inputs;

  const defaultRate = inputs.expectedDefaultRate ?? 0.2;
  const nominal = schedule.totalReceivedCents;
  const uplift = nominal - inputs.cashSalePriceCents;

  // The stream, from the seller's side: basis out at month zero, deposit in
  // immediately, then the scheduled payments.
  const flows: number[] = [
    -inputs.allInBasisCents + terms.downPaymentCents + (terms.documentFeeCents ?? 0),
  ];
  for (const payment of schedule.payments) flows.push(payment.paymentCents);

  const monthlyIrr = irr(flows);
  const financedIrr = monthlyIrr == null ? null : Math.pow(1 + monthlyIrr, 12) - 1;

  const cashProfit = inputs.cashSalePriceCents - inputs.allInBasisCents;
  const cashAnnualizedRoi =
    inputs.allInBasisCents > 0 && inputs.cashHoldDays > 0
      ? cashProfit / inputs.allInBasisCents / (inputs.cashHoldDays / 365)
      : null;

  if (terms.downPaymentCents < inputs.allInBasisCents) {
    warnings.push(
      'The deposit does not cover the all-in basis, so capital stays at risk until the note has amortised past it.',
    );
  }
  if (terms.termMonths > 120) {
    warnings.push('A term beyond ten years is a long time to carry collection risk on one parcel.');
  }
  if (terms.annualRate > 0.18) {
    warnings.push(
      'Rates above 18% attract usury limits in several states. Have the terms reviewed before offering them.',
    );
  }
  warnings.push(
    `Assumes ${(defaultRate * 100).toFixed(0)}% of financed buyers stop paying. On default the parcel is normally recovered and the payments kept, but that is a legal process with its own cost and it varies by state.`,
  );

  let recommendation: FinanceComparison['recommendation'] = 'EITHER';
  let rationale: string;

  if (financedIrr != null && cashAnnualizedRoi != null) {
    if (financedIrr > cashAnnualizedRoi * 1.15) {
      recommendation = 'FINANCE';
      rationale = `Financing returns about ${(financedIrr * 100).toFixed(0)}% a year against ${(cashAnnualizedRoi * 100).toFixed(0)}% for a cash sale, and reaches a much wider pool of buyers.`;
    } else if (cashAnnualizedRoi > financedIrr * 1.15) {
      recommendation = 'CASH';
      rationale = `A cash sale returns about ${(cashAnnualizedRoi * 100).toFixed(0)}% a year against ${(financedIrr * 100).toFixed(0)}% financed, and frees the capital to buy the next parcel.`;
    } else {
      rationale = `Both exits return roughly the same annualised rate. Financing raises the nominal total by ${((uplift / Math.max(1, inputs.cashSalePriceCents)) * 100).toFixed(0)}% and widens the buyer pool; cash frees the capital sooner.`;
    }
  } else {
    rationale = 'Not enough is known about the cash exit to compare the two.';
  }

  return {
    cashProceedsCents: inputs.cashSalePriceCents,
    financedNominalCents: nominal,
    upliftCents: uplift,
    upliftRatio: inputs.cashSalePriceCents > 0 ? uplift / inputs.cashSalePriceCents : 0,
    financedIrr,
    cashAnnualizedRoi,
    recommendation,
    rationale,
    warnings,
  };
}

/**
 * Terms a parcel at this price can plausibly carry.
 *
 * Deliberately conservative and round: a deposit around a tenth of the price
 * with a floor that covers closing, and a term chosen so the payment lands in
 * the range this market actually pays.
 */
export function suggestTerms(
  salePriceCents: UsdCents,
  options: { annualRate?: number; minDownCents?: UsdCents } = {},
): FinanceTerms {
  const annualRate = options.annualRate ?? 0.1;
  const downPayment = Math.max(options.minDownCents ?? 50_000, Math.round(salePriceCents * 0.1));
  const financed = Math.max(0, salePriceCents - downPayment);

  // Longer terms for larger balances, so the monthly payment stays reachable.
  const termMonths =
    financed <= 500_000 ? 36 : financed <= 1_500_000 ? 60 : financed <= 4_000_000 ? 84 : 120;

  return {
    salePriceCents,
    downPaymentCents: downPayment,
    annualRate,
    termMonths,
    documentFeeCents: 25_000,
    monthlyFeeCents: 1_000,
  };
}

/**
 * Internal rate of return by bisection.
 *
 * Bisection rather than Newton's method because it cannot diverge: the sign
 * change is bracketed up front, so it either converges or reports that no rate
 * explains the flows. A financing decision is not the place for a root-finder
 * that occasionally returns nonsense.
 */
export function irr(flows: readonly number[], tolerance = 1e-9): number | null {
  if (flows.length < 2) return null;
  const npv = (rate: number): number =>
    flows.reduce((sum, flow, index) => sum + flow / Math.pow(1 + rate, index), 0);

  // Bracket by scanning candidate rates rather than assuming an interval.
  // A near -100% rate raised to the power of an eighty-four month term
  // overflows to infinity, which silently defeats a fixed [-0.9999, 10]
  // bracket and makes the function return null for exactly the long
  // amortising notes it exists to evaluate.
  const candidates = [
    -0.9, -0.5, -0.2, -0.05, 0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10,
  ];
  let low: number | null = null;
  let high: number | null = null;
  let npvLow = 0;

  let previousRate: number | null = null;
  let previousNpv = 0;
  for (const rate of candidates) {
    const value = npv(rate);
    if (!Number.isFinite(value)) continue;
    if (Math.abs(value) < tolerance) return rate;
    if (previousRate != null && previousNpv * value < 0) {
      low = previousRate;
      high = rate;
      npvLow = previousNpv;
      break;
    }
    previousRate = rate;
    previousNpv = value;
  }
  if (low == null || high == null) return null; // no sign change: no rate explains these flows

  let lower = low;
  let upper = high;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lower + upper) / 2;
    const value = npv(mid);
    if (Math.abs(value) < tolerance || upper - lower < tolerance) return mid;
    if (value * npvLow > 0) {
      lower = mid;
      npvLow = value;
    } else {
      upper = mid;
    }
  }
  return (lower + upper) / 2;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  // Rolling 31 January forward a month must not land in March.
  if (result.getUTCDate() < day) result.setUTCDate(0);
  return result;
}
