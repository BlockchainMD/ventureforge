import { type ComparableSummary, type ConfidenceLevel, type UsdCents } from '@land-alpha/shared';
import {
  adjustPricePerAcreForSize,
  DEFAULT_ACREAGE_CURVE,
  type AcreageCurveConfig,
} from './acreage-curve';

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
  /** The assessor's neighbourhood code, where the county publishes one. */
  readonly neighborhood?: string | null;
  readonly accessClass: string | null;
  readonly hasUtilities: boolean | null;
  readonly source: string;
  /**
   * True when this row is development fixture data rather than a recorded sale.
   * A valuation built on fixtures is a demonstration, not an underwriting
   * input, and the engine must say so rather than let the two look alike.
   */
  readonly isFixture?: boolean;
}

export interface SubjectProfile {
  readonly acreage: number;
  /** The assessor's neighbourhood code for the subject, where one exists. */
  readonly neighborhood?: string | null;
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
  /**
   * Radii tried in order, closest first. The first that holds at least
   * `preferredComps` sales wins; if none does, the widest is used.
   */
  readonly radiusTiers?: readonly number[];
  /** Enough comparables that widening the search would cost more than it adds. */
  readonly preferredComps?: number;
  /** Annual land-price drift applied to age-adjust older sales. */
  readonly annualAppreciation: number;
  readonly minComps: number;
  readonly targetComps: number;
}

export const DEFAULT_COMPS_CONFIG: CompsConfig = {
  curve: DEFAULT_ACREAGE_CURVE,
  maxAgeDays: 365 * 3,
  maxDistanceMeters: 40_000,
  // 3km is a neighbourhood, 10km a town and its edge, 40km a metropolitan area.
  radiusTiers: [3_000, 10_000, 40_000],
  preferredComps: 8,
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
 * Comparables inside the subject's own assessor neighbourhood.
 *
 * A radius is a poor proxy for comparability in a metropolitan county. Orange
 * County's vacant-land sales span $166k to $6.3M per acre inside ten
 * kilometres, so widening a circle until eight sales fall in it reliably
 * collects land that has nothing to do with the subject — which is how a
 * half-acre parcel assessed at $65,000 came to be valued at $821,404.
 *
 * The assessor already drew the right boundary. Neighbourhood codes exist to
 * group land that trades alike, and they follow subdivisions and corridors
 * rather than distance. Where both the subject and enough sales carry one,
 * that beats any circle.
 *
 * Returns null when the neighbourhood cannot decide it — no code on the
 * subject, or too few sales sharing it — and the caller falls back to radius.
 * A subject that has a code but finds no sales in it is worth noticing: it
 * usually means the two sides were coded by different offices.
 */
export function selectByNeighborhood(
  candidates: readonly CompCandidate[],
  subjectNeighborhood: string | null | undefined,
  config: CompsConfig,
): { pool: readonly CompCandidate[]; matched: number } | null {
  const code = subjectNeighborhood?.trim();
  if (!code) return null;
  const pool = candidates.filter((candidate) => candidate.neighborhood?.trim() === code);
  // A higher bar than minComps, deliberately.
  //
  // Overriding distance is a strong claim and needs a solid sample behind it.
  // Measured on Orange County: 655 sales spread across 184 neighbourhoods, so
  // most neighbourhoods are thin, and letting three sales decide produced
  // valuations wilder than the radius set they replaced — one parcel went from
  // nine times the county's assessment to seventy-two. A thin neighbourhood is
  // noisier than a broader ring, not tighter.
  const required = config.preferredComps ?? config.minComps;
  if (pool.length < required) return { pool: [], matched: pool.length };
  return { pool, matched: pool.length };
}

/**
 * Rings are measured with located sales only.
 *
 * A sale with no coordinates used to satisfy every radius, on the reasoning
 * that dropping it would discard an entire ungeocoded source the moment one
 * located sale existed. The reasoning held when little was geocoded. It stopped
 * holding at 97% coverage in Florida, and by then it was doing real damage:
 * because an unlocated sale counted as inside the 3km ring, the tightest ring
 * always looked full, so the search never widened, never warned, and reported a
 * 3km radius while valuing off sales from anywhere in the county.
 *
 * It bit hardest exactly where the money is. Large rural parcels have few
 * neighbours, so their rings could only fill through the escape hatch: the two
 * highest-value parcels in Orange County drew nine of their twelve comparables
 * from sales whose location nobody knows.
 *
 * So located sales build the rings. Unlocated ones are admitted only when even
 * the widest ring cannot be filled without them — the case the original
 * reasoning was about — and the caller is told, so the valuation can be marked
 * down for it instead of quietly inheriting a radius it never satisfied.
 */
export function selectByRadius(
  candidates: readonly CompCandidate[],
  config: CompsConfig,
): {
  pool: readonly CompCandidate[];
  radiusMeters: number;
  widened: number | null;
  unlocatedUsed: number;
} {
  const tiers = config.radiusTiers ?? [config.maxDistanceMeters];
  const preferred = config.preferredComps ?? config.minComps;
  const widest = tiers[tiers.length - 1] ?? config.maxDistanceMeters;

  const located = candidates.filter((candidate) => candidate.distanceMeters != null);
  const unlocated = candidates.filter((candidate) => candidate.distanceMeters == null);
  const within = (radius: number): CompCandidate[] =>
    located.filter((candidate) => candidate.distanceMeters! <= radius);

  let tightestCount: number | null = null;
  for (const [index, radius] of tiers.entries()) {
    const pool = within(radius);
    if (index === 0) tightestCount = pool.length;
    if (pool.length >= preferred) {
      return {
        pool,
        radiusMeters: radius,
        widened: index === 0 ? null : tightestCount,
        unlocatedUsed: 0,
      };
    }
  }

  // Even the widest ring is short. Unlocated sales are better than nothing, but
  // only just, and only because the alternative is refusing to value a parcel
  // in a county that has not finished geocoding its roll.
  const widestPool = within(widest);
  if (widestPool.length >= preferred || unlocated.length === 0) {
    return { pool: widestPool, radiusMeters: widest, widened: tightestCount, unlocatedUsed: 0 };
  }
  return {
    pool: [...widestPool, ...unlocated],
    radiusMeters: widest,
    widened: tightestCount,
    unlocatedUsed: unlocated.length,
  };
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

  // Prefer the tightest ring of comparables that still has enough sales in it.
  //
  // A single wide radius was the only option while comparables had no
  // coordinates. Now that they do, taking every sale within forty kilometres is
  // actively harmful in a metropolitan county: forty kilometres spans the whole
  // of greater Orlando, so a downtown infill lot and a rural parcel east of the
  // Econlockhatchee end up in the same comp set, and the resulting spread makes
  // an honest valuation impossible. Appraisal practice is to start close and
  // widen only when forced to, which is what this does.
  // The assessor's neighbourhood beats any circle where it can decide, because
  // it is a boundary drawn around land that trades alike rather than land that
  // happens to be nearby.
  const byNeighborhood = selectByNeighborhood(candidates, subject.neighborhood, config);
  let pool: readonly CompCandidate[];
  // Null when the neighbourhood decided the set: distance is then not the
  // criterion, and a sale two towns over inside the same coded neighbourhood
  // is a better comparable than one across the street outside it.
  let selectionRadius: number | null = null;
  if (byNeighborhood && byNeighborhood.pool.length > 0) {
    pool = byNeighborhood.pool;
    warnings.push(
      `Comparables restricted to assessor neighbourhood ${subject.neighborhood}: ${byNeighborhood.pool.length} sales. This is a tighter test of comparability than distance.`,
    );
  } else {
    if (byNeighborhood) {
      // The subject has a code and no sale shares it. Usually that means the
      // two sides were coded by different offices, which is worth saying out
      // loud rather than silently falling back and looking like it worked.
      warnings.push(
        `Too few comparable sales share the subject's assessor neighbourhood (${subject.neighborhood}) to value on them alone, so selection fell back to distance.`,
      );
    }
    const byRadius = selectByRadius(candidates, config);
    pool = byRadius.pool;
    selectionRadius = byRadius.radiusMeters;
    if (byRadius.widened != null) {
      warnings.push(
        `Only ${byRadius.widened} comparable sales within ${(config.radiusTiers?.[0] ?? 0) / 1000}km, so the search was widened to ${Math.round(byRadius.radiusMeters / 1000)}km. Sales further away are less like the subject.`,
      );
    }
    if (byRadius.unlocatedUsed > 0) {
      warnings.push(
        `Too few located sales within ${Math.round(byRadius.radiusMeters / 1000)}km, so ${byRadius.unlocatedUsed} sales with no recorded coordinates were included. They could be anywhere in the county, and in a county spanning a city and its farmland that is the difference between land worth $166,000 an acre and land worth $6.3m.`,
      );
    }
  }
  // Sales outside the chosen set were still considered and dropped, and the
  // count of what was dropped is part of what makes a valuation auditable.
  rejectedCount += candidates.length - pool.length;

  for (const candidate of pool) {
    if (candidate.acreage <= 0 || candidate.salePriceCents <= 0) {
      rejectedCount += 1;
      continue;
    }

    const ageDays = (now.getTime() - candidate.saleDate.getTime()) / 86_400_000;
    if (ageDays > config.maxAgeDays || ageDays < -1) {
      rejectedCount += 1;
      continue;
    }
    if (
      selectionRadius != null &&
      candidate.distanceMeters != null &&
      candidate.distanceMeters > selectionRadius
    ) {
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
      isFixture: candidate.isFixture ?? false,
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

  const dispersion =
    central && central > 0 && low != null && high != null ? (high - low) / central : null;

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

  const fixtureCount = candidates.filter((candidate) => candidate.isFixture).length;
  const usedFixtures = selected.some((comp) => comp.isFixture);
  if (usedFixtures) {
    warnings.push(
      `This valuation uses development fixture data, not recorded sales. ${fixtureCount} of the ${candidates.length} candidate sales for this area are synthetic. Do not underwrite an acquisition against it.`,
    );
  }

  return {
    comps: selected,
    pricePerAcre: central == null ? null : Math.round(central),
    pricePerAcreLow: low == null ? null : Math.round(low),
    pricePerAcreHigh: high == null ? null : Math.round(high),
    dispersion,
    // Fixture-backed valuations are capped at LOW no matter how tight the
    // comps look — synthetic data agreeing with itself is not evidence.
    confidence: usedFixtures ? 'LOW' : compsConfidence(selected, dispersion),
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
    Math.max(candidate.acreage, subject.acreage) /
    Math.max(Math.min(candidate.acreage, subject.acreage), 0.01);
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
  // Comps that cannot be placed cannot be checked for proximity, and in a
  // county spanning a city and its farmland that is the difference between a
  // $2m-per-acre infill lot and a $20k-per-acre field. Plenty of agreeing
  // sales is not the same as plenty of nearby ones.
  if (geolocated === 0) return 'LOW';
  return 'MEDIUM';
}

/**
 * Weighted median rather than weighted mean.
 *
 * County sale files contain $1 family transfers, estate clean-outs and
 * occasional wild outliers. A mean chases them; a median does not. Robustness
 * matters more than efficiency when the data is this messy.
 */
export function weightedMedian(
  points: readonly { value: number; weight: number }[],
): number | null {
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
