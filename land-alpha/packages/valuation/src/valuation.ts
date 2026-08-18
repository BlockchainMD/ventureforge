import {
  minConfidence,
  type ConfidenceLevel,
  type UsdCents,
  type ValuationEstimate,
  type ValuationResult,
} from '@land-alpha/shared';
import { MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS } from './acreage-curve.js';
import { analyzeComps, type CompCandidate, type CompsConfig, type SubjectProfile, DEFAULT_COMPS_CONFIG } from './comps.js';

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
}

export const DEFAULT_VALUATION_CONFIG: ValuationConfig = {
  comps: DEFAULT_COMPS_CONFIG,
  quickSaleDiscount: 0.25,
  investorLiquidationDiscount: 0.5,
  assessedValueMultiplier: 1.15,
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
    const retail = buildEstimate({
      midPerAcre: comps.pricePerAcre,
      lowPerAcre: comps.pricePerAcreLow ?? comps.pricePerAcre * 0.75,
      highPerAcre: comps.pricePerAcreHigh ?? comps.pricePerAcre * 1.25,
      acreage,
      confidence: comps.confidence,
      method: `Comparable sales (${comps.comps.length} recorded sales, size-adjusted)`,
    });

    return {
      retail,
      quickSale: discountEstimate(retail, config.quickSaleDiscount, 'Quick-sale pricing'),
      investorLiquidation: discountEstimate(
        retail,
        config.investorLiquidationDiscount,
        'Investor liquidation',
      ),
      compCount: comps.comps.length,
      comps: comps.comps,
      pricePerAcreUsed: comps.pricePerAcre,
      confidence: comps.confidence,
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
