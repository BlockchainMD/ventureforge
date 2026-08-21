import type { ConfidenceLevel, UsdCents } from '@land-alpha/shared';

/**
 * What to buy, given the money you actually have.
 *
 * A ranked list answers "which parcel is best". An investor with $50,000 has a
 * different question: *which set* of parcels should that money buy. Those are
 * not the same question, and the ranked list cannot answer the second one. Take
 * the top three by Alpha Score and you may have spent the whole budget on one
 * county, or on one parcel that ties the capital up for three years, or missed
 * that nine cheaper parcels would have returned more in total.
 *
 * This is a bounded-knapsack problem — maximise expected profit subject to a
 * budget — with two differences from the textbook version that matter here:
 *
 *  1. **Time is part of the return.** Capital returned in six months can buy
 *     something else; capital returned in three years cannot. Parcels are
 *     ranked on expected profit per dollar per year, not on profit.
 *  2. **Concentration is a real risk.** A basket of eight parcels in one
 *     county is one bet on one county's market, whatever the arithmetic says.
 *
 * The allocation is a proposal for a human to accept or reject. Nothing here
 * commits money, and the brief is explicit that this software must never
 * autonomously submit a bid.
 */

export interface AllocationCandidate {
  readonly parcelId: string;
  readonly apn: string | null;
  readonly state: string;
  readonly county: string;
  /** All-in cost to acquire and carry to sale. */
  readonly allInBasisCents: UsdCents;
  readonly quickSaleValueCents: UsdCents | null;
  readonly expectedHoldDays: number | null;
  readonly alphaScore: number | null;
  readonly valuationConfidence: ConfidenceLevel | null;
}

export interface AllocationPick extends AllocationCandidate {
  readonly expectedProfitCents: UsdCents;
  /** Expected profit per dollar of basis per year — the ranking metric. */
  readonly returnPerDollarYear: number;
  readonly reason: string;
}

export interface AllocationPlan {
  readonly picks: AllocationPick[];
  readonly budgetCents: UsdCents;
  readonly committedCents: UsdCents;
  readonly uncommittedCents: UsdCents;
  readonly expectedProfitCents: UsdCents;
  readonly expectedReturnOnDeployed: number | null;
  readonly byCounty: { county: string; parcels: number; committedCents: UsdCents }[];
  readonly skipped: { parcelId: string; apn: string | null; reason: string }[];
  readonly warnings: string[];
}

export interface AllocationConfig {
  readonly budgetCents: UsdCents;
  /** Never put more than this share of the budget into one county. */
  readonly maxCountyShare: number;
  /** Never put more than this share of the budget into one parcel. */
  readonly maxParcelShare: number;
  /** Confidence floor; parcels below it are reported, not bought. */
  readonly minConfidence: ConfidenceLevel;
  /** Ignore anything that would take longer than this to sell. */
  readonly maxHoldDays: number;
  readonly maxParcels: number;
}

export const DEFAULT_ALLOCATION_CONFIG: Omit<AllocationConfig, 'budgetCents'> = {
  maxCountyShare: 0.4,
  maxParcelShare: 0.25,
  minConfidence: 'LOW',
  maxHoldDays: 1095,
  maxParcels: 25,
};

const CONFIDENCE_RANK: Record<string, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  VERIFIED: 4,
};

export function allocateCapital(
  candidates: readonly AllocationCandidate[],
  config: AllocationConfig,
): AllocationPlan {
  const warnings: string[] = [];
  const skipped: AllocationPlan['skipped'] = [];

  const minRank = CONFIDENCE_RANK[config.minConfidence] ?? 0;
  const maxParcelCents = Math.floor(config.budgetCents * config.maxParcelShare);
  const maxCountyCents = Math.floor(config.budgetCents * config.maxCountyShare);

  // ---- Score each candidate on return per dollar per year -------------------
  const scored: AllocationPick[] = [];
  for (const candidate of candidates) {
    const skip = (reason: string): void => {
      skipped.push({ parcelId: candidate.parcelId, apn: candidate.apn, reason });
    };

    if (candidate.quickSaleValueCents == null || candidate.quickSaleValueCents <= 0) {
      skip('No quick-sale value has been established.');
      continue;
    }
    if (candidate.allInBasisCents <= 0) {
      skip('No acquisition cost is known, so return cannot be computed.');
      continue;
    }
    if ((CONFIDENCE_RANK[candidate.valuationConfidence ?? 'UNKNOWN'] ?? 0) < minRank) {
      skip(
        `Valuation confidence is ${candidate.valuationConfidence ?? 'UNKNOWN'}, below the floor for committing money.`,
      );
      continue;
    }
    const holdDays = candidate.expectedHoldDays ?? 180;
    if (holdDays > config.maxHoldDays) {
      skip(`Expected to take ${Math.round(holdDays / 30.4)} months to sell, beyond the horizon.`);
      continue;
    }
    const profit = candidate.quickSaleValueCents - candidate.allInBasisCents;
    if (profit <= 0) {
      skip('Expected to sell for less than it costs to acquire and carry.');
      continue;
    }
    if (candidate.allInBasisCents > maxParcelCents) {
      skip(
        `Would take ${((candidate.allInBasisCents / config.budgetCents) * 100).toFixed(0)}% of the budget, above the ${(config.maxParcelShare * 100).toFixed(0)}% single-parcel limit.`,
      );
      continue;
    }

    const years = holdDays / 365;
    const returnPerDollarYear = profit / candidate.allInBasisCents / years;

    scored.push({
      ...candidate,
      expectedProfitCents: profit,
      returnPerDollarYear,
      reason: '',
    });
  }

  // ---- Greedy fill, best return per dollar-year first -----------------------
  //
  // Greedy is exact for the fractional knapsack and near-optimal here because
  // parcel costs are small relative to the budget — the classic greedy failure
  // is one item that consumes most of the capacity, which the single-parcel
  // limit already excludes.
  scored.sort((a, b) => b.returnPerDollarYear - a.returnPerDollarYear);

  const picks: AllocationPick[] = [];
  const countyCommitted = new Map<string, number>();
  let committed = 0;

  for (const candidate of scored) {
    if (picks.length >= config.maxParcels) {
      skipped.push({
        parcelId: candidate.parcelId,
        apn: candidate.apn,
        reason: `Basket already holds ${config.maxParcels} parcels.`,
      });
      continue;
    }
    if (committed + candidate.allInBasisCents > config.budgetCents) {
      skipped.push({
        parcelId: candidate.parcelId,
        apn: candidate.apn,
        reason: 'Budget exhausted before reaching this parcel.',
      });
      continue;
    }
    const countyKey = `${candidate.state}/${candidate.county}`;
    const inCounty = countyCommitted.get(countyKey) ?? 0;
    if (inCounty + candidate.allInBasisCents > maxCountyCents) {
      skipped.push({
        parcelId: candidate.parcelId,
        apn: candidate.apn,
        reason: `${countyKey} is already at the ${(config.maxCountyShare * 100).toFixed(0)}% concentration limit.`,
      });
      continue;
    }

    committed += candidate.allInBasisCents;
    countyCommitted.set(countyKey, inCounty + candidate.allInBasisCents);
    picks.push({
      ...candidate,
      reason: `${(candidate.returnPerDollarYear * 100).toFixed(0)}% per year over ${Math.round((candidate.expectedHoldDays ?? 180) / 30.4)} months.`,
    });
  }

  const expectedProfit = picks.reduce((sum, pick) => sum + pick.expectedProfitCents, 0);
  const byCounty = [...countyCommitted]
    .map(([county, cents]) => ({
      county,
      parcels: picks.filter((p) => `${p.state}/${p.county}` === county).length,
      committedCents: cents,
    }))
    .sort((a, b) => b.committedCents - a.committedCents);

  if (picks.length === 0) {
    warnings.push(
      'No parcel currently clears the bar for committing money. Raising the budget will not change that; the constraint is the inventory, not the capital.',
    );
  }
  const uncommitted = config.budgetCents - committed;
  if (picks.length > 0 && uncommitted > config.budgetCents * 0.25) {
    warnings.push(
      `${((uncommitted / config.budgetCents) * 100).toFixed(0)}% of the budget is unspent because too little inventory qualifies, not because the money ran out.`,
    );
  }
  if (byCounty.length === 1 && picks.length > 1) {
    warnings.push(
      `Every parcel is in ${byCounty[0]!.county}. This is one bet on one county's market, whatever the arithmetic says.`,
    );
  }
  // A return this large is far more likely to be a valuation error than an
  // opportunity, and the allocator is the last place it can be caught before
  // someone acts on it. Government surplus land is genuinely underpriced;
  // it is not underpriced by a factor of twenty.
  const implausible = picks.filter((pick) => pick.returnPerDollarYear > 5).length;
  if (implausible > 0) {
    warnings.push(
      `${implausible} of ${picks.length} picks imply a return above 500% a year. That is more likely a valuation error than an opportunity — check the comparables behind them before acting.`,
    );
  }

  const lowConfidence = picks.filter(
    (pick) => (CONFIDENCE_RANK[pick.valuationConfidence ?? 'UNKNOWN'] ?? 0) <= 1,
  ).length;
  if (lowConfidence > 0) {
    warnings.push(
      `${lowConfidence} of ${picks.length} picks rest on a LOW-confidence valuation. This is a shortlist to verify, not a buy order.`,
    );
  }

  return {
    picks,
    budgetCents: config.budgetCents,
    committedCents: committed,
    uncommittedCents: uncommitted,
    expectedProfitCents: expectedProfit,
    expectedReturnOnDeployed: committed > 0 ? expectedProfit / committed : null,
    byCounty,
    skipped,
    warnings,
  };
}
