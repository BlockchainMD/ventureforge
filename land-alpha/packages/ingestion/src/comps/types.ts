import { z } from 'zod';
import type { UsdCents } from '@land-alpha/shared';

/**
 * Comparable-sales ingestion.
 *
 * Separate from parcel ingestion because the two answer different questions and
 * fail differently: parcel inventory is "what could I buy", comparable sales are
 * "what is it worth". They share the polite HTTP client and the ArcGIS client,
 * and nothing else.
 *
 * The bar for a comparable is deliberately high. A recorded transfer is only
 * usable as evidence of market value if it was an arm's-length sale of vacant
 * land, and county files are full of transfers that are neither. Every adapter
 * must decide both, explicitly, per row.
 */

export const compsSourceSchema = z.object({
  key: z.string().regex(/^[a-z]{2}-[a-z0-9-]+-sales$/),
  state: z.string().length(2),
  county: z.string(),
  name: z.string(),
  /** Which comps adapter handles this source. */
  adapterKey: z.string(),
  sourceUrl: z.string().url(),
  status: z.enum(['ACTIVE', 'CANDIDATE', 'TOKEN_REQUIRED', 'MANUAL_ONLY', 'UNAVAILABLE']),
  enabled: z.boolean().default(false),
  attribution: z.string().nullable().default(null),
  /** Why this source is not automated, when it is not. */
  notes: z.string().nullable().default(null),
  config: z.record(z.unknown()).default({}),
});

export type CompsSource = z.infer<typeof compsSourceSchema>;
export type CompsSourceInput = z.input<typeof compsSourceSchema>;

export function defineCompsSources(entries: CompsSourceInput[]): CompsSource[] {
  const parsed = entries.map((entry) => compsSourceSchema.parse(entry));
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (seen.has(entry.key)) throw new Error(`Duplicate comps source key: ${entry.key}`);
    seen.add(entry.key);
  }
  return parsed;
}

/** A recorded sale, normalised. Mirrors the ComparableSale table. */
export interface ComparableSaleInput {
  readonly state: string;
  readonly county: string;
  readonly apn: string | null;
  readonly saleDate: Date;
  readonly salePriceCents: UsdCents;
  readonly acreage: number;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly zoning: string | null;
  readonly landUse: string | null;
  readonly hasUtilities: boolean | null;
  /** Both must be true for the sale to inform a valuation. */
  readonly isVacantLand: boolean;
  readonly isArmsLength: boolean;
  readonly deedType: string | null;
  readonly source: string;
  readonly sourceUrl: string | null;
}

export interface CompsImportResult {
  readonly discovered: number;
  readonly accepted: number;
  readonly rejected: { reason: string; count: number }[];
  readonly warnings: string[];
}

/**
 * Validation shared by every comps adapter.
 *
 * A bad comparable is worse than a missing one: it does not merely add noise,
 * it moves the median that an acquisition decision is made against.
 */
export function validateComparables(
  rows: readonly ComparableSaleInput[],
  now = new Date(),
): { accepted: ComparableSaleInput[]; rejected: { reason: string; count: number }[] } {
  const accepted: ComparableSaleInput[] = [];
  const rejectionCounts = new Map<string, number>();
  const reject = (reason: string): void => {
    rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  };

  for (const row of rows) {
    if (!row.isVacantLand) {
      reject('not vacant land');
      continue;
    }
    if (!row.isArmsLength) {
      reject('not an arm’s-length sale');
      continue;
    }
    if (!Number.isFinite(row.acreage) || row.acreage <= 0) {
      reject('missing or invalid acreage');
      continue;
    }
    if (!Number.isFinite(row.salePriceCents) || row.salePriceCents < 100_000) {
      // Below $1,000 a recorded transfer is a nominal conveyance, not a sale.
      reject('price below the nominal-transfer floor');
      continue;
    }
    if (Number.isNaN(row.saleDate.getTime())) {
      reject('invalid sale date');
      continue;
    }
    if (row.saleDate.getTime() > now.getTime() + 86_400_000) {
      reject('sale date in the future');
      continue;
    }
    if (row.saleDate.getUTCFullYear() < 1970) {
      reject('sale date implausibly old');
      continue;
    }

    // A price per acre outside these bounds is a data error, not a market
    // signal — usually a price that includes buildings, or an acreage that is
    // the whole section rather than the parcel.
    //
    // The ceiling is deliberately far above rural land. Price per acre is a
    // ratio, so a small parcel reaches an enormous one honestly: a $250,000
    // eighth-of-an-acre infill lot in Orlando is $2m per acre and a perfectly
    // real sale. Orange County's 2026 roll puts the ninetieth percentile of
    // qualified vacant sales at $1.6m per acre. A tighter bound would not catch
    // errors, it would discard the urban market — and bias every valuation
    // there downwards. Size comparability is enforced by the acreage band and
    // the acreage curve, which is the right place for it; this is only a check
    // for figures no land sale can produce.
    const pricePerAcre = row.salePriceCents / row.acreage;
    if (pricePerAcre < 10_000) {
      reject('price per acre implausibly low (<$100/ac)');
      continue;
    }
    if (pricePerAcre > 20_000_000_00) {
      reject('price per acre implausibly high (>$20m/ac)');
      continue;
    }
    if (row.salePriceCents > 25_000_000_00) {
      // Not an error necessarily, but not a comparable for government surplus
      // land either; a $25m transaction is a different market.
      reject('sale price beyond the comparable range (>$25m)');
      continue;
    }

    accepted.push(row);
  }

  return {
    accepted,
    rejected: [...rejectionCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
