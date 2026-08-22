import { addCents, ratio, type OpportunityEconomics, type UsdCents } from '@land-alpha/shared';

/**
 * Opportunity economics.
 *
 * Acquisition price alone is not the cost of a parcel. The all-in basis adds
 * every dollar that must be spent before the land can be resold, and it is the
 * basis — never the bid — that is compared against value.
 *
 *   Acquisition + Government fees + Recording + Title + Curative
 *              + Carrying + Marketing = All-in basis
 */

export interface EconomicsCostModel {
  readonly recordingCostCents: UsdCents;
  readonly titleCostCents: UsdCents;
  readonly curativeCostBaseCents: UsdCents;
  readonly marketingCostRate: number;
  readonly marketingCostMinCents: UsdCents;
  readonly annualCarryRate: number;
  readonly annualTaxFallbackCents: UsdCents;
  readonly expectedHoldDays: number;
}

export interface EconomicsThresholds {
  readonly exceptionalBasisToQsv: number;
  readonly strongBasisToQsv: number;
  readonly potentialBasisToQsv: number;
}

export interface EconomicsInputs {
  /**
   * What the parcel costs to acquire, or null when no price is published.
   *
   * Null is not zero. A tax-deed parcel whose payoff figure is only obtainable
   * by ringing the Comptroller has an unknown cost, and treating that as free
   * produces a basis of pure closing costs, a ratio near zero, and a tier of
   * EXCEPTIONAL — which is how an unpriced parcel ends up at the top of a buy
   * list with a fabricated 1,289% return.
   */
  readonly acquisitionPriceCents: UsdCents | null;
  readonly governmentFeesCents?: UsdCents | null;
  readonly annualTaxCents?: UsdCents | null;
  /** Extra curative cost implied by title findings, on top of the base. */
  readonly titleCurativeCents?: UsdCents | null;
  readonly quickSaleValueCents?: UsdCents | null;
  readonly retailValueCents?: UsdCents | null;
  readonly holdDaysOverride?: number | null;
}

export function computeEconomics(
  inputs: EconomicsInputs,
  costs: EconomicsCostModel,
  thresholds: EconomicsThresholds,
): OpportunityEconomics {
  const holdDays = inputs.holdDaysOverride ?? costs.expectedHoldDays;
  const holdYears = holdDays / 365;

  const priced = inputs.acquisitionPriceCents != null;
  const acquisitionPrice = Math.max(0, inputs.acquisitionPriceCents ?? 0);
  const governmentFees = Math.max(0, inputs.governmentFeesCents ?? 0);
  const recordingCost = costs.recordingCostCents;
  const titleCost = costs.titleCostCents;
  const curativeCost = addCents(costs.curativeCostBaseCents, inputs.titleCurativeCents ?? 0);

  // Carrying = property taxes for the hold period plus a rate on capital
  // employed (insurance, mowing, admin, opportunity cost).
  const annualTax = inputs.annualTaxCents ?? costs.annualTaxFallbackCents;
  const capitalEmployed = addCents(acquisitionPrice, governmentFees, recordingCost, titleCost);
  const carryingCost = Math.round(
    annualTax * holdYears + capitalEmployed * costs.annualCarryRate * holdYears,
  );

  // Marketing scales with the resale price we expect to achieve.
  const expectedResale = inputs.quickSaleValueCents ?? inputs.retailValueCents ?? 0;
  const marketingCost = Math.max(
    costs.marketingCostMinCents,
    Math.round(expectedResale * costs.marketingCostRate),
  );

  const allInBasis = addCents(
    acquisitionPrice,
    governmentFees,
    recordingCost,
    titleCost,
    curativeCost,
    carryingCost,
    marketingCost,
  );

  // Without a price, `allInBasis` is a floor — the costs of owning the parcel
  // before paying for it — and every ratio derived from it would overstate the
  // opportunity by exactly the amount nobody knows. So the floor is reported
  // and the ratios are not; `classifyTier` returns UNKNOWN on a null ratio,
  // which is the honest tier for a parcel whose price has not been obtained.
  const basisToQsv = priced ? ratio(allInBasis, inputs.quickSaleValueCents ?? null) : null;
  // Always computed. Suppressing every ratio when the price is unknown would
  // also suppress the one conclusion that needs no price: a parcel whose
  // costs-only floor already exceeds its quick-sale value cannot be bought
  // profitably at any figure, and the rejection rule has to keep firing.
  const basisFloorToQsv = ratio(allInBasis, inputs.quickSaleValueCents ?? null);
  const basisToRetail = priced ? ratio(allInBasis, inputs.retailValueCents ?? null) : null;

  const grossProfitAtQsv =
    !priced || inputs.quickSaleValueCents == null ? null : inputs.quickSaleValueCents - allInBasis;
  const roiAtQsv =
    grossProfitAtQsv == null || allInBasis === 0 ? null : grossProfitAtQsv / allInBasis;

  // Annualised return, scaled by time rather than compounded.
  //
  // Compounding answers "what if I did this deal, then immediately did it
  // again, and again, all year" — which is not a thing land does. Inventory is
  // the binding constraint, not capital: there is no queue of identical parcels
  // to roll into, and a 4-month flip cannot be assumed to repeat twice more.
  // Compounding a 225% four-month gain reported 2,560% on the buy list, a
  // figure the product cannot defend to anyone about to wire money.
  //
  // It also broke the ranking, and that is the part that costs money. This
  // field is sortable and filterable, and the exponent rewards short holds
  // superlinearly: 50% over three months compounded to 406% and outranked 200%
  // over a year, though the second earns four times as much per dollar
  // deployed. Scaling by time makes both 200%/yr, which is the honest
  // comparison of capital efficiency and the one an allocator needs.
  //
  // Losses were already scaled rather than compounded. Gains now match, so the
  // number means the same thing in both directions.
  const annualizedRoiAtQsv =
    roiAtQsv != null && holdYears > 0 ? roiAtQsv / holdYears : null;

  return {
    acquisitionPrice,
    priced,
    governmentFees,
    recordingCost,
    titleCost,
    curativeCost,
    carryingCost,
    marketingCost,
    allInBasis,
    basisToQsv,
    basisToRetail,
    basisFloorToQsv,
    grossProfitAtQsv,
    roiAtQsv,
    annualizedRoiAtQsv,
    expectedHoldDays: holdDays,
    tier: classifyTier(basisToQsv, thresholds),
  };
}

/**
 * Acquisition preference tiers from the brief. Configurable via ScoringConfig,
 * defaulting to 10% / 20% / 30% of quick-sale value.
 */
export function classifyTier(
  basisToQsv: number | null,
  thresholds: EconomicsThresholds,
): OpportunityEconomics['tier'] {
  if (basisToQsv == null || !Number.isFinite(basisToQsv)) return 'UNKNOWN';
  if (basisToQsv <= thresholds.exceptionalBasisToQsv) return 'EXCEPTIONAL';
  if (basisToQsv <= thresholds.strongBasisToQsv) return 'STRONG';
  if (basisToQsv <= thresholds.potentialBasisToQsv) return 'POTENTIAL';
  return 'WEAK';
}

/**
 * Solve for the highest bid that still leaves the position inside a target
 * basis/QSV ratio. This is what the "Recommended maximum bid" figure means:
 * not a guess, but the arithmetic inverse of the underwriting standard.
 */
export function maximumBidForTargetRatio(params: {
  quickSaleValueCents: UsdCents;
  targetBasisToQsv: number;
  costs: EconomicsCostModel;
  governmentFeesCents?: UsdCents;
  annualTaxCents?: UsdCents | null;
  titleCurativeCents?: UsdCents | null;
  holdDaysOverride?: number | null;
}): UsdCents {
  const targetBasis = params.quickSaleValueCents * params.targetBasisToQsv;
  const holdDays = params.holdDaysOverride ?? params.costs.expectedHoldDays;
  const holdYears = holdDays / 365;

  const fixed = addCents(
    params.governmentFeesCents ?? 0,
    params.costs.recordingCostCents,
    params.costs.titleCostCents,
    params.costs.curativeCostBaseCents,
    params.titleCurativeCents ?? 0,
    Math.max(
      params.costs.marketingCostMinCents,
      Math.round(params.quickSaleValueCents * params.costs.marketingCostRate),
    ),
    Math.round((params.annualTaxCents ?? params.costs.annualTaxFallbackCents) * holdYears),
  );

  // Carrying cost on capital scales with the bid itself, so solve:
  //   basis = bid + fixed + (bid + feeBase) * carryRate * years
  const carryFactor = params.costs.annualCarryRate * holdYears;
  const feeBase = addCents(
    params.governmentFeesCents ?? 0,
    params.costs.recordingCostCents,
    params.costs.titleCostCents,
  );
  const bid = (targetBasis - fixed - feeBase * carryFactor) / (1 + carryFactor);

  return Math.max(0, Math.floor(bid));
}
