/**
 * The acreage curve.
 *
 * Price per acre is not constant across parcel sizes, and averaging raw $/acre
 * across comps is the single most common way land valuations go badly wrong.
 * A 0.5-acre lot might trade at $20,000/acre while a 40-acre tract in the same
 * township trades at $2,000/acre — not because the land differs, but because
 * the buyer pool, the use, and the financing differ.
 *
 * Land Alpha models this with a power law:
 *
 *     PPA(a) = PPA(a_ref) × (a_ref / a) ^ k
 *
 * `k` (the "size elasticity") is between 0 and 1. k = 0 means price scales
 * linearly with acreage; k = 1 means total price is independent of size. Real
 * vacant-land markets sit around 0.30-0.45.
 *
 * The brief's instruction — "adjust intelligently for acreage, do not merely
 * use average price per acre" — is implemented here, and it is the reason a
 * 25-acre comp can legitimately inform a 5-acre subject's value. Beyond
 * `maxSizeRatio` (6x by default) the extrapolation stops being credible and the
 * comp is dropped instead of stretched.
 */

export interface AcreageCurveConfig {
  /** Size elasticity. Higher = stronger discount for larger parcels. */
  readonly elasticity: number;
  /**
   * Beyond this ratio between comp and subject acreage, the extrapolation is
   * no longer trustworthy and the comp is dropped rather than stretched.
   */
  readonly maxSizeRatio: number;
  /** Below this acreage the curve flattens: tiny lots are priced as lots. */
  readonly minMeaningfulAcres: number;
}

export const DEFAULT_ACREAGE_CURVE: AcreageCurveConfig = {
  elasticity: 0.35,
  maxSizeRatio: 6,
  minMeaningfulAcres: 0.1,
};

/**
 * Convert a comparable's price-per-acre to what it implies for a subject of a
 * different size. Returns null when the size gap is too large to bridge.
 */
export function adjustPricePerAcreForSize(
  compPricePerAcre: number,
  compAcreage: number,
  subjectAcreage: number,
  config: AcreageCurveConfig = DEFAULT_ACREAGE_CURVE,
): { adjusted: number; multiplier: number } | null {
  const comp = Math.max(compAcreage, config.minMeaningfulAcres);
  const subject = Math.max(subjectAcreage, config.minMeaningfulAcres);
  const ratio = comp > subject ? comp / subject : subject / comp;
  if (!Number.isFinite(ratio) || ratio > config.maxSizeRatio) return null;

  const multiplier = Math.pow(comp / subject, config.elasticity);
  return { adjusted: compPricePerAcre * multiplier, multiplier };
}

/**
 * The acreage band a comp must fall in to be usable for a subject.
 * Derived from `maxSizeRatio` so the two can never disagree.
 */
export function acreageBandFor(
  subjectAcreage: number,
  config: AcreageCurveConfig = DEFAULT_ACREAGE_CURVE,
): { min: number; max: number } {
  const subject = Math.max(subjectAcreage, config.minMeaningfulAcres);
  return {
    min: subject / config.maxSizeRatio,
    max: subject * config.maxSizeRatio,
  };
}

/**
 * Total-price sanity floor.
 *
 * Applying a $/acre figure to a 0.15-acre parcel produces absurdly small
 * numbers; in practice any recordable vacant parcel in a functioning market has
 * a floor value driven by transaction mechanics rather than by land area.
 */
export const MINIMUM_PLAUSIBLE_PARCEL_VALUE_CENTS = 75_000; // $750
