import { prisma } from '../client';

/**
 * Comparable-sales coverage, per county.
 *
 * Valuation confidence already degrades correctly when comparable sales cannot
 * be placed on a map — `compsConfidence` caps at LOW when nothing is
 * geolocated, which is the right call, because a sale that could be anywhere in
 * a county spanning a city and its farmland tells you almost nothing.
 *
 * What was missing is *why*. Marion County sat at 0% geocoded for a whole
 * working session, and the only symptom anywhere in the product was a LOW on
 * every Florida parcel. "We looked and could not value it" and "an import step
 * was never run" are different situations that need different responses, and
 * the product could not tell them apart. This is the same failure as ADR 0013's
 * dark list: reporting a consequence where a diagnosis was available.
 *
 * The distinction that makes the diagnosis honest is per-state. In Florida
 * coordinates come from a *second* pass over the statewide parcel centroids
 * (`pnpm comps --geocode-fl <County>`), so a county at 0% is a missed step with
 * a one-line fix. Michigan and Minnesota sales arrive already located, so a
 * county at 0% there means the publisher does not give coordinates — a fact
 * about the source, not a task for the operator. Telling a Minnesota operator
 * to run a Florida command would be worse than saying nothing.
 */

export type CoverageStatus =
  /** Enough located sales to value against. */
  | 'READY'
  /** Some located, but enough gaps to weaken valuations. */
  | 'PARTIAL'
  /** Sales exist and essentially none can be placed. */
  | 'UNLOCATED'
  /** Too few sales to value against at all, located or not. */
  | 'THIN';

export interface ComparableCoverage {
  readonly state: string;
  readonly county: string;
  readonly total: number;
  readonly geocoded: number;
  /** 0–1. Zero when there are no sales at all. */
  readonly geocodedShare: number;
  readonly neighborhoodCoded: number;
  readonly neighborhoodShare: number;
  readonly earliestSale: Date | null;
  readonly latestSale: Date | null;
  readonly status: CoverageStatus;
  /**
   * What an operator should do about it, or null when there is nothing to do.
   * Names the command only where a command exists.
   */
  readonly diagnosis: string | null;
}

/**
 * `compsConfidence` needs three comparables before it will do anything but
 * return LOW, so a county under that cannot produce a usable valuation however
 * well located its sales are.
 */
const MIN_USABLE_SALES = 3;

/** Below this share the located sales are too sparse to trust proximity. */
const PARTIAL_THRESHOLD = 0.8;

/**
 * Rounding, not a judgement about what counts as zero. A county at 0.4% has had
 * a handful of sales located by some other route and still needs the pass run.
 */
const EFFECTIVELY_NONE = 0.05;

/** States where coordinates come from a separate, skippable import step. */
const GEOCODE_PASS_BY_STATE: Record<string, (county: string) => string> = {
  FL: (county) => `pnpm comps --geocode-fl ${county}`,
};

export interface CoverageVerdict {
  readonly status: CoverageStatus;
  readonly diagnosis: string | null;
}

/**
 * The whole judgement, as a pure function of four numbers.
 *
 * Exported because the branches that matter are the ones the live database
 * does not currently exhibit: a county at 0% located, and the difference
 * between a state with a geocode pass and one without. Testing those through a
 * seeded database would mean fabricating a county per case.
 */
export function classifyCoverage(
  state: string,
  county: string,
  total: number,
  geocoded: number,
): CoverageVerdict {
  const geocodedShare = total > 0 ? geocoded / total : 0;
  const status = classify(total, geocodedShare);
  return { status, diagnosis: diagnose(status, state, county, total, geocoded) };
}

function classify(total: number, geocodedShare: number): CoverageStatus {
  if (total < MIN_USABLE_SALES) return 'THIN';
  if (geocodedShare <= EFFECTIVELY_NONE) return 'UNLOCATED';
  if (geocodedShare < PARTIAL_THRESHOLD) return 'PARTIAL';
  return 'READY';
}

function diagnose(
  status: CoverageStatus,
  state: string,
  county: string,
  total: number,
  geocoded: number,
): string | null {
  if (status === 'READY') return null;

  if (status === 'THIN') {
    return total === 0
      ? `No comparable sales have been imported for ${county}, ${state}. Nothing there can be valued by comparison.`
      : `${county}, ${state} has only ${total} comparable ${total === 1 ? 'sale' : 'sales'}; at least ${MIN_USABLE_SALES} are needed before a valuation rises above LOW.`;
  }

  const command = GEOCODE_PASS_BY_STATE[state]?.(county);
  const scale =
    status === 'UNLOCATED'
      ? `None of the ${total.toLocaleString()} comparable sales in ${county}, ${state} have coordinates`
      : `Only ${geocoded.toLocaleString()} of ${total.toLocaleString()} comparable sales in ${county}, ${state} have coordinates`;

  // Where a pass exists, the fix is one command and saying so is the entire
  // point of this report. Where it does not, inventing one would send an
  // operator looking for a step that was never skipped.
  return command
    ? `${scale}, so proximity cannot be checked and valuations there are capped. Run: ${command}`
    : `${scale}. ${state} sales are published without them, so this is a limit of the source rather than a missed import step.`;
}

interface CoverageRow {
  readonly state: string;
  readonly county: string;
  readonly total: bigint;
  readonly geocoded: bigint;
  readonly neighborhood_coded: bigint;
  readonly earliest_sale: Date | null;
  readonly latest_sale: Date | null;
}

/**
 * One row per county that has any comparable sales at all.
 *
 * Aggregated in SQL rather than by loading sales into memory: this runs on a
 * screen an operator refreshes, and Marion alone is 4,883 rows.
 */
export async function comparableCoverage(): Promise<ComparableCoverage[]> {
  const rows = await prisma.$queryRaw<CoverageRow[]>`
    SELECT state,
           county,
           COUNT(*)                AS total,
           COUNT(latitude)         AS geocoded,
           COUNT(neighborhood)     AS neighborhood_coded,
           MIN("saleDate")         AS earliest_sale,
           MAX("saleDate")         AS latest_sale
    FROM "ComparableSale"
    GROUP BY state, county
    ORDER BY state, county
  `;

  return rows.map((row) => {
    const total = Number(row.total);
    const geocoded = Number(row.geocoded);
    const neighborhoodCoded = Number(row.neighborhood_coded);
    // Guard the divide rather than relying on the GROUP BY never producing a
    // zero-count row: this function is also the obvious place to add a filter.
    const geocodedShare = total > 0 ? geocoded / total : 0;
    const verdict = classifyCoverage(row.state, row.county, total, geocoded);

    return {
      state: row.state,
      county: row.county,
      total,
      geocoded,
      geocodedShare,
      neighborhoodCoded,
      neighborhoodShare: total > 0 ? neighborhoodCoded / total : 0,
      earliestSale: row.earliest_sale,
      latestSale: row.latest_sale,
      status: verdict.status,
      diagnosis: verdict.diagnosis,
    };
  });
}

/**
 * Coverage for one county, or null when it has no sales at all.
 *
 * Used by the valuation service to turn "no comparable sale could be
 * geolocated" into a statement about why.
 */
export async function comparableCoverageFor(
  state: string,
  county: string,
): Promise<ComparableCoverage | null> {
  const all = await comparableCoverage();
  return (
    all.find(
      (row) =>
        row.state.toUpperCase() === state.toUpperCase() &&
        row.county.toLowerCase() === county.toLowerCase(),
    ) ?? null
  );
}

/** Counties an operator can actually fix, worst first. */
export function actionableCoverage(rows: readonly ComparableCoverage[]): ComparableCoverage[] {
  return rows
    .filter((row) => row.diagnosis != null)
    .sort((a, b) => {
      const rank = (row: ComparableCoverage): number =>
        row.status === 'UNLOCATED' ? 0 : row.status === 'PARTIAL' ? 1 : 2;
      // Within a status, the county with the most sales going to waste first.
      return rank(a) - rank(b) || b.total - a.total;
    });
}

export const COVERAGE_THRESHOLDS = {
  MIN_USABLE_SALES,
  PARTIAL_THRESHOLD,
  EFFECTIVELY_NONE,
} as const;
