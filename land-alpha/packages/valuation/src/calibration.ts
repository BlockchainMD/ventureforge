import type { ConfidenceLevel, UsdCents } from '@land-alpha/shared';

/**
 * Calibration against realised outcomes.
 *
 * Everything upstream of here is a prediction: a quick-sale value derived from
 * comparable sales, a hold period derived from named factors. Nothing in the
 * system has ever checked whether those predictions were right, which means the
 * model cannot improve and — worse — nobody knows in which direction it is
 * wrong. A valuation engine that is systematically 30% optimistic in one county
 * will keep being 30% optimistic there forever, and every parcel it ranks in
 * that county carries the error silently.
 *
 * This closes that loop. For each parcel actually bought and sold, it compares
 * what was predicted at the time of purchase against what happened, and reduces
 * the comparison to a correction factor per market.
 *
 * Four commitments keep it from doing harm:
 *
 *  1. **Compare against the prediction that informed the decision.** The
 *     valuation snapshot in force when the parcel was acquired, not today's.
 *  2. **Median, not mean.** One deal that went badly wrong should inform, not
 *     dominate. A handful of outcomes is a small sample and a mean of a small
 *     sample is mostly noise.
 *  3. **Silence below a minimum sample.** A factor is emitted only when enough
 *     deals support it; below that the observation is reported and not applied.
 *  4. **Bounded.** A correction is clamped, so one anomalous cluster cannot
 *     wreck the model that produced it.
 */

export interface RealisedOutcome {
  readonly parcelId: string;
  readonly state: string;
  readonly county: string;
  readonly acreage: number | null;
  readonly accessClass: string | null;
  /** Quick-sale value predicted by the snapshot in force at acquisition. */
  readonly predictedQuickSaleCents: UsdCents | null;
  /** Hold period predicted at acquisition, where one was recorded. */
  readonly predictedHoldDays: number | null;
  readonly realisedSalePriceCents: UsdCents;
  readonly realisedHoldDays: number;
  readonly soldAt: Date;
}

export interface CalibrationGroup {
  readonly key: string;
  readonly sampleSize: number;
  /** Realised ÷ predicted. Above 1 means the engine was pessimistic. */
  readonly valueRatio: number | null;
  readonly holdRatio: number | null;
  /** Spread of the value ratios, as a fraction of the median. */
  readonly valueDispersion: number | null;
  readonly applied: boolean;
  readonly note: string;
}

export interface CalibrationReport {
  readonly generatedFrom: number;
  readonly groups: CalibrationGroup[];
  /** Factors safe to apply, keyed `STATE/County`. */
  readonly holdCalibration: Record<string, number>;
  readonly valueCalibration: Record<string, number>;
  readonly overall: {
    readonly valueRatio: number | null;
    readonly holdRatio: number | null;
    readonly sampleSize: number;
  };
  readonly confidence: ConfidenceLevel;
  readonly warnings: string[];
}

export interface CalibrationConfig {
  /** Deals required in a market before its factor is applied. */
  readonly minSampleSize: number;
  readonly minFactor: number;
  readonly maxFactor: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  minSampleSize: 5,
  minFactor: 0.5,
  maxFactor: 2.0,
};

export function calibrateFromOutcomes(
  outcomes: readonly RealisedOutcome[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG,
): CalibrationReport {
  const warnings: string[] = [];
  if (outcomes.length === 0) {
    return {
      generatedFrom: 0,
      groups: [],
      holdCalibration: {},
      valueCalibration: {},
      overall: { valueRatio: null, holdRatio: null, sampleSize: 0 },
      confidence: 'UNKNOWN',
      warnings: [
        'No parcel has been bought and sold yet, so no prediction has been checked against an outcome. Every valuation and hold estimate is currently uncalibrated.',
      ],
    };
  }

  const byMarket = new Map<string, RealisedOutcome[]>();
  for (const outcome of outcomes) {
    const key = `${outcome.state}/${outcome.county}`;
    const bucket = byMarket.get(key);
    if (bucket) bucket.push(outcome);
    else byMarket.set(key, [outcome]);
  }

  const groups: CalibrationGroup[] = [];
  const holdCalibration: Record<string, number> = {};
  const valueCalibration: Record<string, number> = {};

  for (const [key, market] of [...byMarket].sort((a, b) => b[1].length - a[1].length)) {
    const valueRatios = market
      .filter((o) => o.predictedQuickSaleCents != null && o.predictedQuickSaleCents > 0)
      .map((o) => o.realisedSalePriceCents / o.predictedQuickSaleCents!);
    const holdRatios = market
      .filter((o) => o.predictedHoldDays != null && o.predictedHoldDays > 0)
      .map((o) => o.realisedHoldDays / o.predictedHoldDays!);

    const valueRatio = median(valueRatios);
    const holdRatio = median(holdRatios);
    const valueDispersion = dispersionOf(valueRatios, valueRatio);
    const applied = market.length >= config.minSampleSize;

    if (applied) {
      if (valueRatio != null) valueCalibration[key] = clampFactor(valueRatio, config);
      if (holdRatio != null) holdCalibration[key] = clampFactor(holdRatio, config);
    }

    groups.push({
      key,
      sampleSize: market.length,
      valueRatio,
      holdRatio,
      valueDispersion,
      applied,
      note: describe(key, market.length, valueRatio, holdRatio, applied, config),
    });
  }

  const allValue = outcomes
    .filter((o) => o.predictedQuickSaleCents != null && o.predictedQuickSaleCents > 0)
    .map((o) => o.realisedSalePriceCents / o.predictedQuickSaleCents!);
  const allHold = outcomes
    .filter((o) => o.predictedHoldDays != null && o.predictedHoldDays > 0)
    .map((o) => o.realisedHoldDays / o.predictedHoldDays!);

  const overallValue = median(allValue);
  const overallHold = median(allHold);

  if (overallValue != null && overallValue < 0.85) {
    warnings.push(
      `Across all sales the engine has been optimistic: parcels fetched ${((1 - overallValue) * 100).toFixed(0)}% less than the quick-sale value predicted at purchase.`,
    );
  }
  if (overallValue != null && overallValue > 1.15) {
    warnings.push(
      `Across all sales the engine has been conservative: parcels fetched ${((overallValue - 1) * 100).toFixed(0)}% more than predicted. Bids may be leaving value on the table.`,
    );
  }
  if (overallHold != null && overallHold > 1.25) {
    warnings.push(
      `Parcels are taking ${((overallHold - 1) * 100).toFixed(0)}% longer to sell than estimated, so annualised returns have been overstated.`,
    );
  }
  if (Object.keys(valueCalibration).length === 0) {
    warnings.push(
      `No market yet has the ${config.minSampleSize} closed sales needed to justify a correction, so nothing has been applied.`,
    );
  }

  return {
    generatedFrom: outcomes.length,
    groups,
    holdCalibration,
    valueCalibration,
    overall: { valueRatio: overallValue, holdRatio: overallHold, sampleSize: outcomes.length },
    confidence: calibrationConfidence(outcomes.length, Object.keys(valueCalibration).length),
    warnings,
  };
}

function describe(
  key: string,
  n: number,
  valueRatio: number | null,
  holdRatio: number | null,
  applied: boolean,
  config: CalibrationConfig,
): string {
  if (!applied) {
    return `${n} closed ${n === 1 ? 'sale' : 'sales'} in ${key} — fewer than the ${config.minSampleSize} needed before a correction is trusted.`;
  }
  const parts: string[] = [];
  if (valueRatio != null) {
    const pct = Math.abs(1 - valueRatio) * 100;
    parts.push(
      valueRatio >= 1
        ? `sold for ${pct.toFixed(0)}% above predicted value`
        : `sold for ${pct.toFixed(0)}% below predicted value`,
    );
  }
  if (holdRatio != null) {
    const pct = Math.abs(1 - holdRatio) * 100;
    parts.push(
      holdRatio >= 1 ? `took ${pct.toFixed(0)}% longer to sell` : `sold ${pct.toFixed(0)}% faster`,
    );
  }
  return `${n} closed sales in ${key}: ${parts.join(', ')}.`;
}

function calibrationConfidence(sampleSize: number, marketsCalibrated: number): ConfidenceLevel {
  if (sampleSize >= 40 && marketsCalibrated >= 3) return 'HIGH';
  if (sampleSize >= 15 && marketsCalibrated >= 1) return 'MEDIUM';
  if (sampleSize >= 1) return 'LOW';
  return 'UNKNOWN';
}

function clampFactor(value: number, config: CalibrationConfig): number {
  return Math.min(config.maxFactor, Math.max(config.minFactor, value));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Interquartile spread relative to the midpoint — how much the deals disagree. */
function dispersionOf(values: readonly number[], mid: number | null): number | null {
  if (values.length < 4 || mid == null || mid === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  return (q3 - q1) / mid;
}
