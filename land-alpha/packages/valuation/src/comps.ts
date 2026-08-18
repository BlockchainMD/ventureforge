import {
  type ComparableSummary,
  type ConfidenceLevel,
  type UsdCents,
} from '@land-alpha/shared';
import {
  adjustPricePerAcreForSize,
  DEFAULT_ACREAGE_CURVE,
  type AcreageCurveConfig,
} from './acreage-curve.js';

/**
 * Comparable selection, adjustment and weighting.
 *
 * Explicitly not a Zillow scraper. Inputs are recorded sales — county deed
 * files, assessor sale extracts, state transfer datasets, analyst imports.
 * The engine's contract is: given a set of recorded sales, produce a defensible
 * central estimate of price per acre for the subject, plus the workings.
 */

export interface CompCandidate {
  readonly id: string;
  readonly apn: string | null;
  readonly saleDate: Date;
  readonly salePriceCents: UsdCents;
  readonly acreage: number;
  readonly distanceMeters: number | null;
  readonly zoning: string | null;
  readonly accessClass: string | null;
  readonly hasUtilities: boolean | null;
  readonly source: string;
}

export interface SubjectProfile {
  readonly acreage: number;
  readonly zoning: string | null;
  readonly accessClass: string | null;
  readonly hasUtilities: boolean | null;
}

export interface CompsConfig {
  readonly curve: AcreageCurveConfig;
  /** Comps older than this are dropped entirely. */
  readonly maxAgeDays: number;
  /** Comps beyond this are dropped entirely. */
  readonly maxDistanceMeters: number;
  /** Annual land-price drift applied to age-adjust older sales. */
  readonly annualAppreciation: number;
  readonly minComps: number;
  readonly targetComps: number;
}

export const DEFAULT_COMPS_CONFIG: CompsConfig = {
  curve: DEFAULT_ACREAGE_CURVE,
  maxAgeDays: 365 * 3,
  maxDistanceMeters: 40_000,
  annualAppreciation: 0.03,
  minComps: 3,
  targetComps: 12,
};

export interface CompsResult {
  readonly comps: ComparableSummary[];
  readonly pricePerAcre: UsdCents | null;
  readonly pricePerAcreLow: UsdCents | null;
  readonly pricePerAcreHigh: UsdCents | null;
  readonly dispersion: number | null;
  readonly confidence: ConfidenceLevel;
  readonly warnings: string[];
  readonly rejectedCount: number;
}

/**
 * Adjust and weight a candidate set.
 *
 * Adjustments are multiplicative and each one is recorded with its rationale,
 * so the parcel detail page can show *why* a $12,000 sale down the road implies
 * $8,400 for the subject.
 */
export function analyzeComps(
  subject: SubjectProfile,
  candidates: readonly CompCandidate[],
  now: Date = new Date(),
  config: CompsConfig = DEFAULT_COMPS_CONFIG,
): CompsResult {
  const warnings: string[] = [];
  const summaries: ComparableSummary[] = [];
  let rejectedCount = 0;

  for (const candidate of candidates) {
    if (candidate.acreage <= 0 || candidate.salePriceCents <= 0) {
      rejectedCount += 1;
      continue;
    }

    const ageDays = (now.getTime() - candidate.saleDate.getTime()) / 86_400_000;
    if (ageDays > config.maxAgeDays || ageDays < -1) {
      rejectedCount += 1;
      continue;
    }
    if (candidate.distanceMeters != null && candidate.distanceMeters > config.maxDistanceMeters) {
      rejectedCount += 1;
      continue;
    }

    const rawPricePerAcre = candidate.salePriceCents / candidate.acreage;
    const sizeAdjustment = adjustPricePerAcreForSize(
      rawPricePerAcre,
      candidate.acreage,
      subject.acreage,
      config.curve,
    );
    if (!sizeAdjustment) {
      rejectedCount += 1;
      continue;
    }

    const adjustments: { factor: string; multiplier: number; rationale: string }[] = [
      {
        factor: 'size',
        multiplier: sizeAdjustment.multiplier,
        rationale: `Comp is ${candidate.acreage.toFixed(2)} ac against a ${subject.acreage.toFixed(2)} ac subject; size elasticity ${config.curve.elasticity}.`,
      },
    ];

    // Time: bring an older sale forward to today's money.
    const timeMultiplier = Math.pow(1 + config.annualAppreciation, ageDays / 365);
    adjustments.push({
      factor: 'time',
      multiplier: timeMultiplier,
      rationale: `Sold ${Math.round(ageDays)} days ago; ${(config.annualAppreciation * 100).toFixed(1)}%/yr drift applied.`,
    });

    // Access: a comp with better access than the subject overstates the subject.
    const accessMultiplier = accessAdjustment(subject.accessClass, candidate.accessClass);
    if (accessMultiplier !== 1) {
      adjustments.push({
        factor: 'access',
        multiplier: accessMultiplier,
        rationale: `Comp access ${candidate.accessClass ?? 'unknown'} vs subject ${subject.accessClass ?? 'unknown'}.`,
      });
    }

    // Utilities: a serviced comp is not a proxy for a raw subject.
    const utilitiesMultiplier = utilitiesAdjustment(subject.hasUtilities, candidate.hasUtilities);
    if (utilitiesMultiplier !== 1) {
      adjustments.push({
        factor: 'utilities',
        multiplier: utilitiesMultiplier,
        rationale: `Comp utilities ${describeUtilities(candidate.hasUtilities)} vs subject ${describeUtilities(subject.hasUtilities)}.`,
      });
    }

    const zoningMultiplier = zoningAdjustment(subject.zoning, candidate.zoning);
    if (zoningMultiplier !== 1) {
      adjustments.push({
        factor: 'zoning',
        multiplier: zoningMultiplier,
        rationale: `Comp zoned ${candidate.zoning ?? 'unknown'} vs subject ${subject.zoning ?? 'unknown'}.`,
      });
    }

    const adjustedPricePerAcre = adjustments.reduce(
      (value, adjustment) => value * adjustment.multiplier,
      rawPricePerAcre,
    );

    summaries.push({
      id: candidate.id,
      apn: candidate.apn,
      saleDate: candidate.saleDate,
      salePrice: candidate.salePriceCents,
      acreage: candidate.acreage,
      distanceMeters: candidate.distanceMeters,
      pricePerAcre: Math.round(rawPricePerAcre),
      adjustedPricePerAcre: Math.round(adjustedPricePerAcre),
      weight: compWeight(candidate, subject, ageDays, config),
      adjustments,
      source: candidate.source,
    });
  }

  if (summaries.length === 0) {
    return {
      comps: [],
      pricePerAcre: null,
      pricePerAcreLow: null,
      pricePerAcreHigh: null,
      dispersion: null,
      confidence: 'UNKNOWN',
      warnings: [
        candidates.length === 0
          ? 'No recorded vacant-land sales available for this area.'
          : `All ${candidates.length} candidate sales were rejected as non-comparable.`,
      ],
      rejectedCount: rejectedCount || candidates.length,
    };
  }

  // Keep the best-weighted comps; more is not better once quality drops.
  summaries.sort((a, b) => b.weight - a.weight);
  const selected = summaries.slice(0, config.targetComps);

  const central = weightedMedian(
    selected.map((comp) => ({ value: comp.adjustedPricePerAcre, weight: comp.weight })),
  );
  const low = weightedQuantile(
    selected.map((comp) => ({ value: comp.adjustedPricePerAcre, weight: comp.weight })),
    0.25,
  );
  const high = weightedQuantile(
    selected.map((comp) => ({ value: comp.adjustedPricePerAcre, weight: comp.weight })),
    0.75,
  );

  const dispersion = central && central > 0 && low != null && high != null ? (high - low) / central : null;

  if (selected.length < config.minComps) {
    warnings.push(
      `Only ${selected.length} usable comparable ${selected.length === 1 ? 'sale' : 'sales'} — valuation is indicative only.`,
    );
  }
  if (dispersion != null && dispersion > 1.2) {
    warnings.push(
      `Comparable sales disagree widely (interquartile spread is ${(dispersion * 100).toFixed(0)}% of the midpoint).`,
    );
  }
  if (selected.every((comp) => comp.distanceMeters == null)) {
    warnings.push('No comparable sale could be geolocated; proximity was not verified.');
  }

  return {
    comps: selected,
    pricePerAcre: central == null ? null : Math.round(central),
    pricePerAcreLow: low == null ? null : Math.round(low),
    pricePerAcreHigh: high == null ? null : Math.round(high),
    dispersion,
    confidence: compsConfidence(selected, dispersion),
    warnings,
    rejectedCount,
  };
}

/**
 * Weighting: proximity, recency and similarity, multiplied together.
 * Each factor is in (0, 1], so one bad dimension cannot be hidden by two good
 * ones — a 5-year-old sale 30 km away is heavily discounted no matter how
 * similar the parcel is.
 */
function compWeight(
  candidate: CompCandidate,
  subject: SubjectProfile,
  ageDays: number,
  config: CompsConfig,
): number {
  const distance = candidate.distanceMeters ?? config.maxDistanceMeters * 0.75;
  const proximity = 1 / (1 + distance / 3000);
  const recency = Math.exp(-ageDays / 540);

  const sizeRatio =
    Math.max(candidate.acreage, subject.acreage) / Math.max(Math.min(candidate.acreage, subject.acreage), 0.01);
  const sizeSimilarity = 1 / (1 + Math.log10(Math.max(sizeRatio, 1)) * 2);

  const zoningSimilarity =
    subject.zoning && candidate.zoning
      ? subject.zoning.toUpperCase() === candidate.zoning.toUpperCase()
        ? 1
        : 0.7
      : 0.85;

  return proximity * recency * sizeSimilarity * zoningSimilarity;
}

const ACCESS_RANK: Record<string, number> = { A: 4, B: 3, C: 2, D: 1 };

/**
 * Access differences are large value drivers in vacant land — a landlocked
 * parcel routinely trades at a fraction of an identical parcel with frontage.
 */
function accessAdjustment(subjectClass: string | null, compClass: string | null): number {
  if (!subjectClass || !compClass) return 1;
  const subject = ACCESS_RANK[subjectClass];
  const comp = ACCESS_RANK[compClass];
  if (subject == null || comp == null) return 1;
  const steps = subject - comp;
  if (steps === 0) return 1;
  // ~18% per class step, capped so a D-vs-A comparison does not invent a 90% swing.
  return Math.max(0.45, Math.min(1.6, Math.pow(1.18, steps)));
}

function utilitiesAdjustment(subject: boolean | null, comp: boolean | null): number {
  if (subject == null || comp == null) return 1;
  if (subject === comp) return 1;
  return subject ? 1.2 : 0.82;
}

function zoningAdjustment(subject: string | null, comp: string | null): number {
  if (!subject || !comp) return 1;
  if (subject.toUpperCase() === comp.toUpperCase()) return 1;
  // Different zoning is a similarity penalty, not a directional value claim —
  // we do not know which zone is worth more without local knowledge.
  return 0.95;
}

function describeUtilities(value: boolean | null): string {
  if (value == null) return 'unknown';
  return value ? 'available' : 'not available';
}

function compsConfidence(
  comps: readonly ComparableSummary[],
  dispersion: number | null,
): ConfidenceLevel {
  if (comps.length === 0) return 'UNKNOWN';
  if (comps.length < 3) return 'LOW';

  const geolocated = comps.filter((comp) => comp.distanceMeters != null).length;
  const closeCount = comps.filter(
    (comp) => comp.distanceMeters != null && comp.distanceMeters < 8000,
  ).length;
  const tight = dispersion != null && dispersion < 0.5;

  if (comps.length >= 8 && closeCount >= 5 && tight) return 'HIGH';
  if (comps.length >= 5 && geolocated >= 3 && (tight || dispersion == null)) return 'MEDIUM';
  if (dispersion != null && dispersion > 1.2) return 'LOW';
  return 'MEDIUM';
}

/**
 * Weighted median rather than weighted mean.
 *
 * County sale files contain $1 family transfers, estate clean-outs and
 * occasional wild outliers. A mean chases them; a median does not. Robustness
 * matters more than efficiency when the data is this messy.
 */
export function weightedMedian(points: readonly { value: number; weight: number }[]): number | null {
  return weightedQuantile(points, 0.5);
}

export function weightedQuantile(
  points: readonly { value: number; weight: number }[],
  quantile: number,
): number | null {
  const usable = points.filter((point) => Number.isFinite(point.value) && point.weight > 0);
  if (usable.length === 0) return null;
  if (usable.length === 1) return usable[0]!.value;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, point) => sum + point.weight, 0);

  // Each observation is placed at the midpoint of the weight interval it
  // occupies, then the requested quantile is linearly interpolated between
  // neighbouring observations. Using midpoints rather than interval edges keeps
  // the estimator symmetric: with equal weights it reduces to the ordinary
  // median, whereas an edge-based rule biases toward the upper neighbour
  // whenever the target lands exactly on a boundary.
  const positions: number[] = [];
  let cumulative = 0;
  for (const point of sorted) {
    cumulative += point.weight;
    positions.push((cumulative - point.weight / 2) / totalWeight);
  }

  if (quantile <= positions[0]!) return sorted[0]!.value;
  const lastIndex = sorted.length - 1;
  if (quantile >= positions[lastIndex]!) return sorted[lastIndex]!.value;

  for (let i = 0; i < lastIndex; i += 1) {
    const lower = positions[i]!;
    const upper = positions[i + 1]!;
    if (quantile >= lower && quantile <= upper) {
      const span = upper - lower;
      const fraction = span === 0 ? 0 : (quantile - lower) / span;
      return sorted[i]!.value + (sorted[i + 1]!.value - sorted[i]!.value) * fraction;
    }
  }
  return sorted[lastIndex]!.value;
}
