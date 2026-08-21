import { describe, expect, it } from 'vitest';
import { describeChange } from './services/alert.service';

/**
 * Which events are worth interrupting an analyst for, and how loudly.
 *
 * The judgement matters more than the wording: an alert that fires on
 * everything gets muted, and a muted alert is the same as no alert.
 */

const NOW = new Date('2026-08-21T00:00:00Z');

const change = (overrides: Record<string, unknown> = {}) =>
  ({
    kind: 'CREATED',
    oldValue: null,
    newValue: null,
    ...overrides,
    parcel: {
      apn: '010-0001-00010',
      county: 'St. Louis',
      state: 'MN',
      acreage: 5.23,
      alphaScore: 78,
      askingPrice: null,
      minimumBid: null,
      basisToQsv: 0.22,
      auctionDate: null,
      offerDeadline: null,
      ...((overrides.parcel as object) ?? {}),
    },
  }) as Parameters<typeof describeChange>[0];

describe('describeChange', () => {
  it('names the event before the parcel', () => {
    const message = describeChange(change({ kind: 'CREATED' }), NOW);
    expect(message!.title).toContain('New match');
    expect(message!.title).toContain('St. Louis County, MN');
  });

  it('alerts on a price cut, with both prices', () => {
    const message = describeChange(
      change({ kind: 'PRICE_CHANGED', oldValue: '4000', newValue: '3000' }),
      NOW,
    );
    expect(message!.title).toContain('Price cut 25%');
    expect(message!.body).toContain('$4,000');
    expect(message!.body).toContain('$3,000');
  });

  it('stays silent on a price increase', () => {
    // Change detection records it; nobody needs waking for it.
    expect(
      describeChange(change({ kind: 'PRICE_CHANGED', oldValue: '3000', newValue: '4000' }), NOW),
    ).toBeNull();
    expect(
      describeChange(change({ kind: 'PRICE_CHANGED', oldValue: '3000', newValue: '3000' }), NOW),
    ).toBeNull();
  });

  it('escalates with the size of the cut', () => {
    const small = describeChange(
      change({ kind: 'PRICE_CHANGED', oldValue: '10000', newValue: '9500' }),
      NOW,
    );
    const medium = describeChange(
      change({ kind: 'PRICE_CHANGED', oldValue: '10000', newValue: '8500' }),
      NOW,
    );
    const deep = describeChange(
      change({ kind: 'PRICE_CHANGED', oldValue: '10000', newValue: '6000' }),
      NOW,
    );
    expect(small!.urgency).toBe('NORMAL');
    expect(medium!.urgency).toBe('HIGH');
    expect(deep!.urgency).toBe('IMMEDIATE');
  });

  it('treats a reappearance as the strong signal it is', () => {
    const message = describeChange(change({ kind: 'REAPPEARED' }), NOW);
    expect(message!.urgency).toBe('HIGH');
    expect(message!.body).toContain('Failed to sell');
  });

  it('raises urgency as a sale date approaches', () => {
    const soon = describeChange(
      change({ parcel: { auctionDate: new Date('2026-08-23T00:00:00Z') } }),
      NOW,
    );
    const nearer = describeChange(
      change({ parcel: { auctionDate: new Date('2026-08-30T00:00:00Z') } }),
      NOW,
    );
    const distant = describeChange(
      change({ parcel: { auctionDate: new Date('2026-12-01T00:00:00Z') } }),
      NOW,
    );
    expect(soon!.urgency).toBe('IMMEDIATE');
    expect(soon!.body).toContain('Sale in 2 days');
    expect(nearer!.urgency).toBe('HIGH');
    expect(distant!.urgency).toBe('NORMAL');
  });

  it('uses whichever deadline comes first', () => {
    const message = describeChange(
      change({
        parcel: {
          auctionDate: new Date('2026-12-01T00:00:00Z'),
          offerDeadline: new Date('2026-08-22T00:00:00Z'),
        },
      }),
      NOW,
    );
    expect(message!.urgency).toBe('IMMEDIATE');
    expect(message!.body).toContain('Sale in 1 day');
  });

  it('only alerts on a moved sale date when the new date is close', () => {
    expect(
      describeChange(
        change({
          kind: 'AUCTION_DATE_CHANGED',
          parcel: { auctionDate: new Date('2027-01-01T00:00:00Z') },
        }),
        NOW,
      ),
    ).toBeNull();
    const close = describeChange(
      change({
        kind: 'AUCTION_DATE_CHANGED',
        parcel: { auctionDate: new Date('2026-08-24T00:00:00Z') },
      }),
      NOW,
    );
    expect(close!.urgency).toBe('IMMEDIATE');
  });

  it('ignores changes that are not time-critical', () => {
    expect(describeChange(change({ kind: 'ATTRIBUTES_CHANGED' }), NOW)).toBeNull();
    expect(describeChange(change({ kind: 'REMOVED_FROM_SOURCE' }), NOW)).toBeNull();
  });

  it('refuses to compute a cut from an unusable old price', () => {
    expect(
      describeChange(change({ kind: 'PRICE_CHANGED', oldValue: '0', newValue: '100' }), NOW),
    ).toBeNull();
    expect(
      describeChange(change({ kind: 'PRICE_CHANGED', oldValue: null, newValue: '100' }), NOW),
    ).toBeNull();
  });
});
