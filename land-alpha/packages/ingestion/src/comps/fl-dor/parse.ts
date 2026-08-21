import { dollarsToCents } from '@land-alpha/shared';

/**
 * Florida roll-file classification.
 *
 * Four independent gates stand between a recorded transfer and a comparable,
 * and a row must clear all of them:
 *
 *   1. `VI_CD = V`      the property appraiser says the parcel was vacant at sale
 *   2. `QUAL_CD`        the property appraiser qualified the sale as market-rate
 *   3. `MULTI_PAR_SAL`  empty — the price covers this parcel and no other
 *   4. NAL `NO_BULDNG`  zero — the roll independently agrees there is no building
 *
 * The fourth gate is not redundant. Against Orange County's 2026 preliminary
 * roll it vetoed 166 of 845 rows that the SDF had marked vacant — a fifth of
 * them — because the parcel carries a building on the assessment roll. Each of
 * those would have been an improved-property sale inflating a land valuation.
 *
 * The remaining judgement is which qualification codes mean "market sale", and
 * that is deliberately narrow. PTO does not publish the code dictionary in the
 * data library (the only user guide there covers navigation), so rather than
 * assume a meaning for forty codes this accepts one: `01`. In Orange County's
 * file that code covers 28,835 sales at a median of $430,000, while the next
 * most common codes — `11`, `14`, `19` — sit at a median of $100 and are plainly
 * nominal conveyances. Widening the set is a configuration change to be made
 * against the authority, not a guess made here.
 */

/** Codes accepted as an arm's-length market sale. See the note above. */
export const DEFAULT_QUALIFIED_SALE_CODES = ['01'] as const;

/** Square feet in an acre. */
const SQFT_PER_ACRE = 43_560;

export interface SdfRow {
  readonly CO_NO?: string;
  readonly PARCEL_ID?: string;
  readonly DOR_UC?: string;
  readonly VI_CD?: string;
  readonly QUAL_CD?: string;
  readonly SALE_PRC?: string;
  readonly SALE_YR?: string;
  readonly SALE_MO?: string;
  readonly MULTI_PAR_SAL?: string;
  readonly OR_BOOK?: string;
  readonly OR_PAGE?: string;
  readonly CLERK_NO?: string;
  readonly MKT_AR?: string;
  readonly NBRHD_CD?: string;
}

export interface NalRow {
  readonly PARCEL_ID?: string;
  readonly DOR_UC?: string;
  readonly LND_SQFOOT?: string;
  readonly NO_LND_UNTS?: string;
  readonly LND_UNTS_CD?: string;
  readonly NO_BULDNG?: string;
  readonly TOT_LVG_AREA?: string;
  readonly LND_VAL?: string;
}

/** A sale that cleared the SDF-side gates, awaiting its parcel facts. */
export interface QualifiedSale {
  readonly parcelId: string;
  readonly salePriceCents: number;
  readonly saleDate: Date;
  readonly dorUseCode: string | null;
  readonly marketArea: string | null;
  readonly neighborhood: string | null;
  readonly instrument: string | null;
}

/** Parcel facts the SDF does not carry. */
export interface ParcelFacts {
  readonly acreage: number | null;
  readonly buildingCount: number;
  readonly livingArea: number;
  readonly dorUseCode: string | null;
}

export interface SdfFilterOptions {
  readonly qualifiedSaleCodes?: readonly string[];
  /** Ignore sales before this date; undefined keeps everything. */
  readonly soldSince?: Date;
}

/**
 * The SDF records a sale year and month but no day, so every Florida
 * comparable is dated to the first of its month. Month precision is ample for
 * age-weighting a comp and pretending to more would be a fabrication.
 */
export function saleDateFrom(year: string | undefined, month: string | undefined): Date | null {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return null;
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return new Date(Date.UTC(y, m - 1, 1));
}

export function qualifySdfRow(row: SdfRow, options: SdfFilterOptions = {}): QualifiedSale | null {
  const parcelId = (row.PARCEL_ID ?? '').trim();
  if (!parcelId) return null;

  // Gate 1 — the appraiser's vacant/improved determination.
  if ((row.VI_CD ?? '').trim().toUpperCase() !== 'V') return null;

  // Gate 2 — the appraiser's sale qualification.
  const codes = options.qualifiedSaleCodes ?? DEFAULT_QUALIFIED_SALE_CODES;
  const qualCode = (row.QUAL_CD ?? '').trim();
  if (!codes.includes(qualCode)) return null;

  // Gate 3 — a multi-parcel sale's price is spread over parcels we cannot see,
  // so its price per acre is meaningless however sound the sale.
  if ((row.MULTI_PAR_SAL ?? '').trim() !== '') return null;

  const saleDate = saleDateFrom(row.SALE_YR, row.SALE_MO);
  if (!saleDate) return null;
  if (options.soldSince && saleDate < options.soldSince) return null;

  const price = Number((row.SALE_PRC ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    parcelId,
    salePriceCents: dollarsToCents(price),
    saleDate,
    dorUseCode: trimmed(row.DOR_UC),
    marketArea: trimmed(row.MKT_AR),
    neighborhood: trimmed(row.NBRHD_CD),
    instrument: instrumentReference(row),
  };
}

/**
 * Acreage from the roll.
 *
 * `LND_SQFOOT` is the common case. Where it is absent the roll may still carry
 * a land-unit count with a unit code, and code `1` is acres — rural parcels are
 * frequently expressed that way rather than in square feet.
 */
export function parcelFactsFrom(row: NalRow): ParcelFacts {
  const squareFeet = Number((row.LND_SQFOOT ?? '').replace(/[^0-9.]/g, ''));
  let acreage: number | null = null;
  if (Number.isFinite(squareFeet) && squareFeet > 0) {
    acreage = squareFeet / SQFT_PER_ACRE;
  } else {
    const units = Number((row.NO_LND_UNTS ?? '').replace(/[^0-9.]/g, ''));
    if ((row.LND_UNTS_CD ?? '').trim() === '1' && Number.isFinite(units) && units > 0) {
      acreage = units;
    }
  }
  return {
    acreage,
    buildingCount: intOr(row.NO_BULDNG, 0),
    livingArea: intOr(row.TOT_LVG_AREA, 0),
    dorUseCode: trimmed(row.DOR_UC),
  };
}

/**
 * Gate 4 — the roll's own view of whether anything is built on the parcel.
 *
 * A building count or a living area above zero contradicts the sale file, and
 * when two county records disagree about whether a sale included a house, the
 * safe reading is that it did.
 */
export function agreesVacant(facts: ParcelFacts): boolean {
  return facts.buildingCount === 0 && facts.livingArea === 0;
}

function instrumentReference(row: SdfRow): string | null {
  const book = trimmed(row.OR_BOOK);
  const page = trimmed(row.OR_PAGE);
  if (book && page) return `OR ${book}/${page}`;
  return trimmed(row.CLERK_NO);
}

function trimmed(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

function intOr(value: string | undefined, fallback: number): number {
  const parsed = Number((value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}
