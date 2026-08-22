import { daysUntil } from './format';

/**
 * How close a sale date is, and whether it has already gone.
 *
 * The product had the vocabulary for this and never used it. `SALE_STATUSES`
 * declares `EXPIRED` and nothing has ever written it; the alert engine knows
 * the phrase "Sale date has passed" but only reaches it when a change event
 * happens to fire for that parcel. Meanwhile the ranked list rendered a passed
 * auction date as a plain date, so eight Orange County parcels whose auction
 * ran on 20 August were still sitting in the buy list on the 22nd.
 *
 * Sorting made it worse rather than better. Deadline ascending puts the
 * earliest date first, which means the parcels that are furthest *past* their
 * auction sort above every parcel you can still bid on — the top of the list,
 * the position that reads as most urgent, reserved for the ones that are gone.
 *
 * What this deliberately does NOT do is decide the parcel's fate. A passed
 * auction date means the date has passed; it does not mean the parcel sold. It
 * may have gone unsold and moved to a lands-available list, which in Florida is
 * exactly how the best inventory appears — Marion's two priced parcels reached
 * us that way. Writing `saleStatus = 'EXPIRED'` from a clock would be the
 * system inventing a fact about the world that only the county can settle. So
 * this reports staleness and asks for re-confirmation, and nothing here mutates
 * a parcel.
 */

export type DeadlineState =
  /** No sale date is published for this parcel. */
  | 'NONE'
  /** The date has gone by. What happened at it is unknown until the source says. */
  | 'PASSED'
  /** Today or tomorrow. */
  | 'IMMINENT'
  /** Within a fortnight — the window the dashboard counts. */
  | 'SOON'
  /** Further out than a fortnight. */
  | 'DISTANT';

export interface DeadlineStatus {
  readonly state: DeadlineState;
  /** Negative once the date has gone by. Null when there is no date. */
  readonly days: number | null;
  /** Short label for a dense table cell. */
  readonly label: string;
}

/** The window the dashboard's "auctions in 14 days" metric counts. */
export const DEADLINE_SOON_DAYS = 14;
const DEADLINE_IMMINENT_DAYS = 1;

/**
 * The nearer of the two dates a parcel can carry.
 *
 * An offer deadline and an auction date are different events and a parcel can
 * have both; whichever comes first is the one that constrains you.
 */
export function soonestDeadline(parcel: {
  readonly auctionDate?: Date | null;
  readonly offerDeadline?: Date | null;
}): Date | null {
  const dates = [parcel.offerDeadline, parcel.auctionDate].filter(
    (value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()),
  );
  if (dates.length === 0) return null;
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest));
}

export function deadlineStatus(
  value: Date | string | null | undefined,
  now = new Date(),
): DeadlineStatus {
  const days = daysUntil(value, now);
  if (days == null) return { state: 'NONE', days: null, label: '—' };

  // `daysUntil` rounds up, so a sale later today is 1 and a sale that ran
  // yesterday is 0 or below. Zero is therefore already in the past, not "today".
  if (days <= 0) {
    const ago = Math.abs(days);
    return {
      state: 'PASSED',
      days,
      label: ago === 0 ? 'passed today' : `passed ${ago}d ago`,
    };
  }
  if (days <= DEADLINE_IMMINENT_DAYS) return { state: 'IMMINENT', days, label: `${days}d` };
  if (days <= DEADLINE_SOON_DAYS) return { state: 'SOON', days, label: `${days}d` };
  return { state: 'DISTANT', days, label: `${days}d` };
}

/**
 * True when a parcel is still being presented as buyable after its sale date.
 *
 * The condition that matters operationally: it is not that the date passed, it
 * is that the date passed *and nobody has been back to the source since*. A
 * parcel the county has already moved to SOLD or WITHDRAWN is correctly
 * resolved and needs no attention.
 */
export function needsDeadlineRecheck(parcel: {
  readonly auctionDate?: Date | null;
  readonly offerDeadline?: Date | null;
  readonly saleStatus?: string | null;
}): boolean {
  const resolved = new Set(['SOLD', 'WITHDRAWN', 'EXPIRED']);
  if (parcel.saleStatus && resolved.has(parcel.saleStatus)) return false;
  return deadlineStatus(soonestDeadline(parcel)).state === 'PASSED';
}
