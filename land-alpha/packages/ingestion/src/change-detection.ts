import type { ChangeKind } from '@land-alpha/shared';

/**
 * Change detection.
 *
 * This is where the long-term moat is actually built. A parcel that appeared at
 * $6,000, failed, reappeared at $3,900, failed again, and now sits at $3,140 is
 * telling you something no single snapshot can. The system records every such
 * transition from day one so that the history exists when there is finally
 * enough of it to learn from.
 */

export interface ComparableSnapshot {
  minimumBid: number | null;
  askingPrice: number | null;
  auctionDate: Date | null;
  offerDeadline: Date | null;
  saleStatus: string;
  acreage: number | null;
  taxesDue: number | null;
  legalDescription: string | null;
  currentOwner: string | null;
}

export interface DetectedChange {
  readonly kind: ChangeKind;
  readonly field: string | null;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}

/** Fields whose movement is materially interesting, and how to describe them. */
const TRACKED_MONEY_FIELDS: {
  key: keyof ComparableSnapshot;
  kind: ChangeKind;
  label: string;
}[] = [
  { key: 'minimumBid', kind: 'PRICE_CHANGED', label: 'minimumBid' },
  { key: 'askingPrice', kind: 'PRICE_CHANGED', label: 'askingPrice' },
  { key: 'taxesDue', kind: 'ATTRIBUTES_CHANGED', label: 'taxesDue' },
];

const TRACKED_DATE_FIELDS: {
  key: keyof ComparableSnapshot;
  kind: ChangeKind;
  label: string;
}[] = [
  { key: 'auctionDate', kind: 'AUCTION_DATE_CHANGED', label: 'auctionDate' },
  { key: 'offerDeadline', kind: 'AUCTION_DATE_CHANGED', label: 'offerDeadline' },
];

const TRACKED_TEXT_FIELDS: {
  key: keyof ComparableSnapshot;
  kind: ChangeKind;
  label: string;
}[] = [
  { key: 'saleStatus', kind: 'SALE_STATUS_CHANGED', label: 'saleStatus' },
  { key: 'legalDescription', kind: 'ATTRIBUTES_CHANGED', label: 'legalDescription' },
  { key: 'currentOwner', kind: 'ATTRIBUTES_CHANGED', label: 'currentOwner' },
];

export function detectChanges(
  previous: ComparableSnapshot,
  next: ComparableSnapshot,
): DetectedChange[] {
  const changes: DetectedChange[] = [];

  for (const field of TRACKED_MONEY_FIELDS) {
    const before = previous[field.key] as number | null;
    const after = next[field.key] as number | null;
    if (before == null && after == null) continue;
    if (before == null || after == null || before !== after) {
      changes.push({
        kind: field.kind,
        field: field.label,
        oldValue: before == null ? null : String(before),
        newValue: after == null ? null : String(after),
      });
    }
  }

  for (const field of TRACKED_DATE_FIELDS) {
    const before = previous[field.key] as Date | null;
    const after = next[field.key] as Date | null;
    if (before?.getTime() === after?.getTime()) continue;
    if (before == null && after == null) continue;
    changes.push({
      kind: field.kind,
      field: field.label,
      oldValue: before?.toISOString() ?? null,
      newValue: after?.toISOString() ?? null,
    });
  }

  for (const field of TRACKED_TEXT_FIELDS) {
    const before = previous[field.key] as string | null;
    const after = next[field.key] as string | null;
    if (normalizeText(before) === normalizeText(after)) continue;
    changes.push({
      kind: field.kind,
      field: field.label,
      oldValue: before,
      newValue: after,
    });
  }

  // Acreage is tracked separately: a change here is usually a data correction
  // rather than a real-world event, and it invalidates the valuation.
  if (
    previous.acreage != null &&
    next.acreage != null &&
    Math.abs(previous.acreage - next.acreage) / Math.max(previous.acreage, next.acreage) > 0.02
  ) {
    changes.push({
      kind: 'ATTRIBUTES_CHANGED',
      field: 'acreage',
      oldValue: previous.acreage.toFixed(4),
      newValue: next.acreage.toFixed(4),
    });
  }

  return changes;
}

/** True when any detected change invalidates the existing valuation and score. */
export function requiresRescore(changes: readonly DetectedChange[]): boolean {
  return changes.some(
    (change) =>
      change.kind === 'PRICE_CHANGED' ||
      change.field === 'acreage' ||
      change.kind === 'SALE_STATUS_CHANGED',
  );
}

/**
 * A price cut on inventory that has already failed is the strongest single
 * signal this product looks for, so it is surfaced explicitly rather than left
 * for someone to notice in a change log.
 */
export function isPriceReduction(changes: readonly DetectedChange[]): boolean {
  return changes.some((change) => {
    if (change.kind !== 'PRICE_CHANGED') return false;
    const before = change.oldValue == null ? null : Number(change.oldValue);
    const after = change.newValue == null ? null : Number(change.newValue);
    return before != null && after != null && after < before;
  });
}

function normalizeText(value: string | null): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}
