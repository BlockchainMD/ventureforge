import type {
  AccessClass,
  BuildabilityRating,
  ConfidenceLevel,
  UsdCents,
} from '@land-alpha/shared';

/**
 * How long the parcel takes to sell.
 *
 * Return on this asset class is annualised, so time to exit is not a detail of
 * the cost model — it is half the answer. A parcel that clears in sixty days at
 * $14,000 beats one that sits for four hundred at $20,000, and a pipeline that
 * assumes a single hold period for every parcel cannot see the difference. It
 * will rank the slow one first, because the slow one has the bigger margin.
 *
 * The estimate is a baseline adjusted by multiplicative factors, in the same
 * spirit as the acreage curve: every adjustment is named, bounded and carries
 * its reasoning, so a number an analyst disagrees with can be argued with
 * rather than merely overridden.
 *
 * On honesty about what this is. Government roll files record that a sale
 * happened, not how long the parcel was listed first, so days-on-market cannot
 * be derived from the comparables we hold. The baseline is therefore an
 * assumption, not a measurement, and the factors below adjust it by
 * relationships that hold in this asset class rather than by fitted
 * coefficients. Confidence is capped accordingly, and stays capped until the
 * calibration loop has enough closed deals to replace the baseline with the
 * portfolio's own realised hold times. Until then this reorders the list — which
 * is its main job — without claiming to forecast a closing date.
 */

export interface LiquidityInputs {
  readonly acreage: number | null;
  /** What we expect to sell it for; the buyer pool narrows as this rises. */
  readonly quickSaleValueCents: UsdCents | null;
  readonly accessClass: AccessClass | null;
  readonly buildability: BuildabilityRating | null;
  readonly hasUtilities: boolean | null;
  /**
   * Qualified vacant-land sales seen in this county and size band. A thin
   * market is a slow one, whatever the parcel looks like.
   */
  readonly comparableCount: number;
}

export interface LiquidityFactor {
  readonly factor: string;
  readonly multiplier: number;
  readonly rationale: string;
}

export interface LiquidityEstimate {
  readonly holdDays: number;
  readonly baselineDays: number;
  readonly factors: LiquidityFactor[];
  readonly confidence: ConfidenceLevel;
  readonly warnings: string[];
}

export interface LiquidityConfig {
  /** Hold period for an unremarkable parcel before any adjustment. */
  readonly baselineDays: number;
  readonly minDays: number;
  readonly maxDays: number;
  /**
   * Per-county-and-band multipliers learned from realised hold times, keyed
   * `STATE/County`. Empty until the calibration loop has evidence.
   */
  readonly calibration?: Readonly<Record<string, number>>;
}

export const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = {
  baselineDays: 180,
  minDays: 30,
  maxDays: 1095,
  calibration: {},
};

export function estimateHoldDays(
  inputs: LiquidityInputs,
  config: LiquidityConfig = DEFAULT_LIQUIDITY_CONFIG,
  calibrationKey?: string,
): LiquidityEstimate {
  const factors: LiquidityFactor[] = [];
  const warnings: string[] = [];

  // ---- Size ---------------------------------------------------------------
  // The buyer pool for a quarter-acre residential lot is everyone who wants to
  // build a house. The pool for eighty acres is investors and developers, and
  // it is much smaller. Very small remnants slow down again: under a tenth of
  // an acre a lot is often unbuildable on its own and only the neighbour wants
  // it.
  if (inputs.acreage == null || inputs.acreage <= 0) {
    warnings.push('Parcel size is unknown, so the buyer pool could not be judged.');
  } else if (inputs.acreage < 0.1) {
    factors.push({
      factor: 'size',
      multiplier: 1.5,
      rationale: `At ${inputs.acreage.toFixed(2)} ac this is a remnant; realistically the adjoining owner is the market.`,
    });
  } else if (inputs.acreage <= 2) {
    factors.push({
      factor: 'size',
      multiplier: 0.8,
      rationale: `At ${inputs.acreage.toFixed(2)} ac this is a single-home lot, the deepest buyer pool in vacant land.`,
    });
  } else if (inputs.acreage <= 20) {
    factors.push({
      factor: 'size',
      multiplier: 1.0,
      rationale: `At ${inputs.acreage.toFixed(1)} ac this is ordinary rural acreage with a steady if unhurried market.`,
    });
  } else if (inputs.acreage <= 80) {
    factors.push({
      factor: 'size',
      multiplier: 1.35,
      rationale: `At ${inputs.acreage.toFixed(0)} ac the pool narrows to buyers financing a larger purchase.`,
    });
  } else {
    factors.push({
      factor: 'size',
      multiplier: 1.7,
      rationale: `At ${inputs.acreage.toFixed(0)} ac the buyers are investors and developers, and there are few of them.`,
    });
  }

  // ---- Price --------------------------------------------------------------
  // Cheap land moves because a retail buyer can pay cash. Above roughly fifty
  // thousand a buyer usually needs financing, which land lenders are reluctant
  // to provide, and the sale slows to the pace of that problem.
  if (inputs.quickSaleValueCents == null) {
    warnings.push('No expected sale price, so the effect of price on liquidity is unknown.');
  } else {
    const dollars = inputs.quickSaleValueCents / 100;
    if (dollars <= 15_000) {
      factors.push({
        factor: 'price',
        multiplier: 0.75,
        rationale: 'Under $15,000 a retail buyer can pay cash, which is the fastest sale there is.',
      });
    } else if (dollars <= 50_000) {
      factors.push({
        factor: 'price',
        multiplier: 0.95,
        rationale: 'Under $50,000 remains within reach of a cash buyer.',
      });
    } else if (dollars <= 150_000) {
      factors.push({
        factor: 'price',
        multiplier: 1.25,
        rationale: 'Above $50,000 most buyers need financing, and land lending is thin.',
      });
    } else {
      factors.push({
        factor: 'price',
        multiplier: 1.6,
        rationale: 'Above $150,000 the buyer pool is small and every sale is negotiated.',
      });
    }
  }

  // ---- Access -------------------------------------------------------------
  // Nothing slows a land sale like the buyer discovering they cannot drive to
  // it. This is the largest single factor here, and deliberately so.
  switch (inputs.accessClass) {
    case 'A':
      factors.push({
        factor: 'access',
        multiplier: 0.85,
        rationale: 'Frontage on a maintained public road is the first thing a buyer checks.',
      });
      break;
    case 'B':
      factors.push({
        factor: 'access',
        multiplier: 1.0,
        rationale: 'Access is workable but will need explaining to a buyer.',
      });
      break;
    case 'C':
      factors.push({
        factor: 'access',
        multiplier: 1.45,
        rationale: 'Uncertain access narrows the pool to buyers willing to do their own diligence.',
      });
      break;
    case 'D':
      factors.push({
        factor: 'access',
        multiplier: 2.2,
        rationale:
          'No established access; realistically only an adjoining owner or a speculator buys this.',
      });
      break;
    default:
      warnings.push('Access class is unknown, which is itself a delay: buyers ask first.');
      factors.push({
        factor: 'access',
        multiplier: 1.3,
        rationale: 'Access is unestablished, and an unanswered access question stalls a sale.',
      });
  }

  // ---- Buildability -------------------------------------------------------
  switch (inputs.buildability) {
    case 'GREEN':
      factors.push({
        factor: 'buildability',
        multiplier: 0.9,
        rationale: 'No identified obstacle to building, which is what most buyers are buying.',
      });
      break;
    case 'YELLOW':
      factors.push({
        factor: 'buildability',
        multiplier: 1.15,
        rationale: 'Open buildability questions give a buyer a reason to keep looking.',
      });
      break;
    case 'RED':
      factors.push({
        factor: 'buildability',
        multiplier: 1.9,
        rationale: 'Serious constraints leave only buyers who want land they cannot build on.',
      });
      break;
    default:
      factors.push({
        factor: 'buildability',
        multiplier: 1.15,
        rationale:
          'Buildability is unestablished, and the buyer will price that uncertainty as delay.',
      });
  }

  // ---- Utilities ----------------------------------------------------------
  if (inputs.hasUtilities === true) {
    factors.push({
      factor: 'utilities',
      multiplier: 0.9,
      rationale: 'Utilities at the boundary remove the buyer’s largest unknown cost.',
    });
  }

  // ---- Market depth -------------------------------------------------------
  // The most direct evidence available: if the county and size band produced
  // almost no qualified sales, that is a market with almost no buyers.
  if (inputs.comparableCount <= 0) {
    factors.push({
      factor: 'market-depth',
      multiplier: 2.0,
      rationale:
        'No comparable sale in this county and size band; there is no demonstrated market.',
    });
    warnings.push('No comparable sales, so the hold estimate rests on the parcel alone.');
  } else if (inputs.comparableCount < 5) {
    factors.push({
      factor: 'market-depth',
      multiplier: 1.5,
      rationale: `Only ${inputs.comparableCount} comparable sales; a thin market is a slow one.`,
    });
  } else if (inputs.comparableCount >= 25) {
    factors.push({
      factor: 'market-depth',
      multiplier: 0.85,
      rationale: `${inputs.comparableCount} comparable sales indicate an active market for this size.`,
    });
  }

  // ---- Calibration --------------------------------------------------------
  const calibration = calibrationKey ? config.calibration?.[calibrationKey] : undefined;
  if (calibration != null && Number.isFinite(calibration) && calibration > 0) {
    factors.push({
      factor: 'calibration',
      multiplier: calibration,
      rationale: `Adjusted by ${calibration.toFixed(2)}× from hold times actually realised in ${calibrationKey}.`,
    });
  }

  const raw = factors.reduce((days, factor) => days * factor.multiplier, config.baselineDays);
  const holdDays = Math.round(Math.min(config.maxDays, Math.max(config.minDays, raw)));

  return {
    holdDays,
    baselineDays: config.baselineDays,
    factors,
    confidence: liquidityConfidence(inputs, warnings.length, calibration != null),
    warnings,
  };
}

/**
 * Confidence in the hold estimate.
 *
 * Capped at MEDIUM without calibration, because until realised hold times exist
 * the baseline is an assumption however well-reasoned the adjustments to it.
 */
function liquidityConfidence(
  inputs: LiquidityInputs,
  warningCount: number,
  calibrated: boolean,
): ConfidenceLevel {
  const known =
    (inputs.acreage != null && inputs.acreage > 0 ? 1 : 0) +
    (inputs.quickSaleValueCents != null ? 1 : 0) +
    (inputs.accessClass != null && inputs.accessClass !== 'UNKNOWN' ? 1 : 0) +
    (inputs.buildability != null && inputs.buildability !== 'UNKNOWN' ? 1 : 0);

  if (warningCount >= 2 || known <= 1) return 'LOW';
  if (calibrated && known === 4 && inputs.comparableCount >= 10) return 'HIGH';
  if (known >= 3 && inputs.comparableCount >= 5) return 'MEDIUM';
  return 'LOW';
}

/**
 * Annualised return, which is the number the hold estimate exists to make
 * meaningful. A 50% return over three years is a worse business than 20% over
 * six months, and only this comparison shows it.
 */
export function annualize(totalReturn: number, holdDays: number): number {
  if (holdDays <= 0) return 0;
  const years = holdDays / 365;
  // Simple annualisation rather than compounding: the capital is not
  // continuously reinvested at this rate, and compounding a single flip's
  // return would overstate what the strategy actually earns.
  return totalReturn / years;
}
