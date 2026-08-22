import {
  minConfidence,
  type ConfidenceLevel,
  type UsdCents,
  type ValuationEstimate,
  type ValuationResult,
  formatCents,
} from '@land-alpha/shared';
import { MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS } from './acreage-curve';
import {
  analyzeComps,
  type CompCandidate,
  type CompsConfig,
  type SubjectProfile,
  DEFAULT_COMPS_CONFIG,
} from './comps';

/**
 * Three values, three different questions.
 *
 *  Retail (RV)  — what a patient seller reaches with full marketing exposure
 *                 over a normal marketing period.
 *  Quick Sale (QSV) — what is achievable when deliberately priced to move.
 *                 **This is the number Land Alpha underwrites against.**
 *  Investor Liquidation (ILV) — what another informed land investor pays
 *                 tomorrow. The floor, and the real downside case.
 *
 * Underwriting against QSV rather than retail is the core conservatism of the
 * product: the acquisition thesis must survive the assumption that we sell in a
 * hurry, because failed government inventory is exactly the kind of asset one
 * ends up needing to move.
 */

export interface ValuationConfig {
  readonly comps: CompsConfig;
  /** QSV as a discount from retail. */
  readonly quickSaleDiscount: number;
  /** ILV as a discount from retail. */
  readonly investorLiquidationDiscount: number;
  /**
   * Assessor-derived fallback multiplier. Applied to land assessed value when
   * no comps exist at all. Assessments lag and are frequently low on vacant
   * land, so this is a weak, clearly-labelled last resort.
   */
  readonly assessedValueMultiplier: number;
  /**
   * How far a comps valuation may sit above the assessor's land value before
   * it is treated as a disagreement rather than a lag.
   *
   * Assessors are consistently behind the market on vacant land — across
   * Orange County the median ratio here is 1.5 — so a valuation above the
   * assessment is expected and is not a fault. Several times above it is a
   * different claim: that the comparables describe land this parcel is not.
   */
  readonly assessedDisagreementWarn: number;
  /** Beyond this the two are not describing the same parcel. */
  readonly assessedDisagreementSevere: number;
  /** Below this multiple of the assessment the valuation is equally suspect. */
  readonly assessedDisagreementLow: number;
  /**
   * Correction learned from parcels actually sold in this market. 1 means the
   * engine has been accurate here, or that nothing has sold yet. Applied to the
   * price per acre rather than to the comparables: the comps are what the
   * market did, and any error is in how this engine reads them.
   */
  readonly marketCorrection?: number;
}

export const DEFAULT_VALUATION_CONFIG: ValuationConfig = {
  comps: DEFAULT_COMPS_CONFIG,
  quickSaleDiscount: 0.25,
  investorLiquidationDiscount: 0.5,
  assessedValueMultiplier: 1.15,
  assessedDisagreementWarn: 4,
  assessedDisagreementSevere: 10,
  assessedDisagreementLow: 0.25,
  marketCorrection: 1,
};

export interface ValuationInputs {
  readonly subject: SubjectProfile;
  readonly candidates: readonly CompCandidate[];
  /** Used only when comps are unavailable. */
  readonly landAssessedValueCents?: UsdCents | null;
  readonly now?: Date;
}

export function valueParcel(
  inputs: ValuationInputs,
  config: ValuationConfig = DEFAULT_VALUATION_CONFIG,
): ValuationResult {
  const now = inputs.now ?? new Date();
  const acreage = inputs.subject.acreage;
  const warnings: string[] = [];

  if (!Number.isFinite(acreage) || acreage <= 0) {
    return emptyResult(['Parcel acreage is unknown, so no value can be estimated.']);
  }

  const comps = analyzeComps(inputs.subject, inputs.candidates, now, config.comps);
  warnings.push(...comps.warnings);

  if (comps.pricePerAcre != null) {
    const correction =
      config.marketCorrection != null && config.marketCorrection > 0 ? config.marketCorrection : 1;
    const corrected = comps.pricePerAcre * correction;
    const retail = buildEstimate({
      midPerAcre: corrected,
      lowPerAcre: (comps.pricePerAcreLow ?? comps.pricePerAcre * 0.75) * correction,
      highPerAcre: (comps.pricePerAcreHigh ?? comps.pricePerAcre * 1.25) * correction,
      acreage,
      confidence: comps.confidence,
      method:
        correction === 1
          ? `Comparable sales (${comps.comps.length} recorded sales, size-adjusted)`
          : `Comparable sales (${comps.comps.length} recorded sales, size-adjusted, corrected ${correction.toFixed(2)}× against realised sales)`,
    });

    // Cross-check against the assessor.
    //
    // The assessment is a lagging indicator and never overrides comparables —
    // it is the number the county last agreed with the owner, not the market.
    // But it is an independent read on the same parcel, and it is free. When
    // it disagrees by an order of magnitude the likeliest explanation is not
    // that the assessor is behind; it is that the comparables describe land
    // somewhere else. Orange County holds a 0.07-acre parcel assessed at $100
    // that this engine valued at $206,986.
    const sanity = crossCheckAssessment(retail.mid, inputs.landAssessedValueCents ?? null, config);
    if (sanity.warning) warnings.push(sanity.warning);
    const confidence = sanity.cap ? minConfidence(comps.confidence, sanity.cap) : comps.confidence;

    // The capped estimate is what the discounts derive from, not the original:
    // discountEstimate carries confidence forward, and a quick-sale figure that
    // looked more certain than the retail value it came from would undo the
    // cross-check one line after applying it.
    const qualified: ValuationEstimate = { ...retail, confidence };

    return {
      retail: qualified,
      quickSale: discountEstimate(qualified, config.quickSaleDiscount, 'Quick-sale pricing'),
      investorLiquidation: discountEstimate(
        qualified,
        config.investorLiquidationDiscount,
        'Investor liquidation',
      ),
      compCount: comps.comps.length,
      comps: comps.comps,
      pricePerAcreUsed: corrected,
      confidence,
      warnings,
    };
  }

  // ---- Fallback: assessed land value ---------------------------------------
  if (inputs.landAssessedValueCents != null && inputs.landAssessedValueCents > 0) {
    const mid = Math.round(inputs.landAssessedValueCents * config.assessedValueMultiplier);
    warnings.push(
      'No usable comparable sales. Value is inferred from the assessor’s land value, which frequently lags the market on vacant land. Treat as indicative only.',
    );
    const retail: ValuationEstimate = {
      low: Math.max(MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS, Math.round(mid * 0.6)),
      mid: Math.max(MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS, mid),
      high: Math.max(MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS, Math.round(mid * 1.6)),
      confidence: 'LOW',
      method: 'Assessor land value × multiplier (no comparable sales available)',
      notes: 'Fallback method. Not a comparable-sales valuation.',
    };
    return {
      retail,
      quickSale: discountEstimate(retail, config.quickSaleDiscount, 'Quick-sale pricing'),
      investorLiquidation: discountEstimate(
        retail,
        config.investorLiquidationDiscount,
        'Investor liquidation',
      ),
      compCount: 0,
      comps: [],
      pricePerAcreUsed: null,
      confidence: 'LOW',
      warnings,
    };
  }

  warnings.push(
    'No comparable sales and no assessor land value. This parcel cannot be valued and must not be scored on economics.',
  );
  return emptyResult(warnings);
}

function buildEstimate(input: {
  midPerAcre: UsdCents;
  lowPerAcre: UsdCents;
  highPerAcre: UsdCents;
  acreage: number;
  confidence: ConfidenceLevel;
  method: string;
}): ValuationEstimate {
  const floor = MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS;
  const mid = Math.max(floor, Math.round(input.midPerAcre * input.acreage));
  const low = Math.max(floor, Math.round(input.lowPerAcre * input.acreage));
  const high = Math.max(mid, Math.round(input.highPerAcre * input.acreage));
  return {
    low: Math.min(low, mid),
    mid,
    high,
    confidence: input.confidence,
    method: input.method,
  };
}

function discountEstimate(
  retail: ValuationEstimate,
  discount: number,
  label: string,
): ValuationEstimate {
  const factor = 1 - discount;
  return {
    low: Math.max(0, Math.round(retail.low * factor)),
    mid: Math.max(0, Math.round(retail.mid * factor)),
    high: Math.max(0, Math.round(retail.high * factor)),
    // A derived value can never be more certain than what it derives from.
    confidence: minConfidence(retail.confidence, 'HIGH'),
    method: `${label}: retail less ${(discount * 100).toFixed(0)}%`,
  };
}

function emptyResult(warnings: string[]): ValuationResult {
  return {
    retail: null,
    quickSale: null,
    investorLiquidation: null,
    compCount: 0,
    comps: [],
    pricePerAcreUsed: null,
    confidence: 'UNKNOWN',
    warnings,
  };
}

/**
 * Reads a comps valuation against the county's own land assessment.
 *
 * Returns a warning and a confidence ceiling, never a replacement value. An
 * assessment that is half the market is ordinary on vacant land; one that is a
 * twentieth of it means one of the two numbers is about a different piece of
 * ground, and the honest response is to say so rather than to pick a side.
 */
export function crossCheckAssessment(
  retailCents: UsdCents,
  landAssessedCents: UsdCents | null,
  config: ValuationConfig,
): { warning: string | null; cap: ConfidenceLevel | null } {
  if (landAssessedCents == null || landAssessedCents <= 0 || retailCents <= 0) {
    return { warning: null, cap: null };
  }
  const ratio = retailCents / landAssessedCents;

  if (ratio >= config.assessedDisagreementSevere) {
    return {
      warning:
        `This valuation is ${ratio.toFixed(0)}× the county's assessed land value ` +
        `(${formatCents(landAssessedCents)}). Assessments lag the market on vacant land, but not by ` +
        `this much — treat the comparables as describing a different location until an analyst ` +
        `confirms otherwise.`,
      cap: 'UNKNOWN',
    };
  }
  if (ratio >= config.assessedDisagreementWarn) {
    return {
      warning:
        `This valuation is ${ratio.toFixed(1)}× the county's assessed land value ` +
        `(${formatCents(landAssessedCents)}), which is high even allowing for the lag typical of ` +
        `vacant-land assessments.`,
      cap: 'LOW',
    };
  }
  if (ratio <= config.assessedDisagreementLow) {
    return {
      warning:
        `This valuation is only ${(ratio * 100).toFixed(0)}% of the county's assessed land value ` +
        `(${formatCents(landAssessedCents)}). An assessment above the market is unusual and may ` +
        `indicate the comparables are drawn from weaker land than this parcel.`,
      cap: 'LOW',
    };
  }
  return { warning: null, cap: null };
}
