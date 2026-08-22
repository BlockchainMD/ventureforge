import { describe, expect, it } from 'vitest';
import {
  deadlineStatus,
  needsDeadlineRecheck,
  soonestDeadline,
  DEADLINE_SOON_DAYS,
} from './deadline';

const NOW = new Date('2026-08-22T12:00:00Z');
const at = (iso: string): Date => new Date(iso);

describe('deadlineStatus', () => {
  it('reports no date as no date rather than as urgent', () => {
    expect(deadlineStatus(null, NOW)).toEqual({ state: 'NONE', days: null, label: '—' });
  });

  // The case that put eight Orange County parcels in the buy list two days
  // after their auction ran.
  it('marks a date that has gone by as passed, with how long ago', () => {
    const status = deadlineStatus(at('2026-08-20T12:00:00Z'), NOW);
    expect(status.state).toBe('PASSED');
    expect(status.days).toBe(-2);
    expect(status.label).toBe('passed 2d ago');
  });

  it('treats today as already passed, not as tomorrow', () => {
    // An auction this morning is over. Rounding it up to "1 day" would put it
    // at the top of a deadline-ascending sort as the most urgent thing to bid on.
    const status = deadlineStatus(at('2026-08-22T09:00:00Z'), NOW);
    expect(status.state).toBe('PASSED');
    expect(status.label).toBe('passed today');
  });

  it('separates imminent from merely soon', () => {
    expect(deadlineStatus(at('2026-08-23T09:00:00Z'), NOW).state).toBe('IMMINENT');
    expect(deadlineStatus(at('2026-08-30T12:00:00Z'), NOW).state).toBe('SOON');
  });

  it('uses the same fortnight the dashboard counts', () => {
    const edge = new Date(NOW.getTime() + DEADLINE_SOON_DAYS * 86_400_000);
    expect(deadlineStatus(edge, NOW).state).toBe('SOON');
    expect(deadlineStatus(new Date(edge.getTime() + 86_400_000), NOW).state).toBe('DISTANT');
  });

  it('accepts an ISO string, since that is what crosses a server boundary', () => {
    expect(deadlineStatus('2026-08-20T12:00:00Z', NOW).state).toBe('PASSED');
  });

  it('does not treat an unparseable date as urgent', () => {
    expect(deadlineStatus('not a date', NOW).state).toBe('NONE');
  });
});

describe('soonestDeadline', () => {
  it('takes whichever of the two events comes first', () => {
    expect(
      soonestDeadline({ auctionDate: at('2026-09-01'), offerDeadline: at('2026-08-25') }),
    ).toEqual(at('2026-08-25'));
    expect(
      soonestDeadline({ auctionDate: at('2026-08-25'), offerDeadline: at('2026-09-01') }),
    ).toEqual(at('2026-08-25'));
  });

  it('is null when a parcel publishes neither', () => {
    expect(soonestDeadline({ auctionDate: null, offerDeadline: null })).toBeNull();
  });

  it('ignores an invalid date rather than returning one', () => {
    expect(
      soonestDeadline({ auctionDate: new Date('nonsense'), offerDeadline: at('2026-09-01') }),
    ).toEqual(at('2026-09-01'));
  });
});

describe('needsDeadlineRecheck', () => {
  it('flags a parcel still on offer after its sale date', () => {
    expect(needsDeadlineRecheck({ auctionDate: at('2026-08-20'), saleStatus: 'UNKNOWN' })).toBe(
      true,
    );
  });

  // A passed date is not a verdict. The county may have sold it, withdrawn it,
  // or left it unsold and moved it to a lands-available list — which in Florida
  // is exactly how the best inventory appears. Only the source settles that.
  it('says nothing about a parcel the source has already resolved', () => {
    for (const saleStatus of ['SOLD', 'WITHDRAWN', 'EXPIRED']) {
      expect(needsDeadlineRecheck({ auctionDate: at('2026-08-20'), saleStatus })).toBe(false);
    }
  });

  it('leaves a future sale alone', () => {
    expect(needsDeadlineRecheck({ auctionDate: at('2027-01-01'), saleStatus: 'SCHEDULED' })).toBe(
      false,
    );
  });

  it('leaves a parcel with no published date alone', () => {
    // 14,220 St. Louis parcels publish no date. Treating "no date" as "overdue"
    // would bury the handful that genuinely need chasing.
    expect(needsDeadlineRecheck({ auctionDate: null, saleStatus: 'UNKNOWN' })).toBe(false);
  });
});
