import { buildWhere, prisma, toCents, type Prisma } from '@land-alpha/db';
import type { OpportunityFilter } from '@land-alpha/shared';
import { formatCents, formatPercent } from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * Alert evaluation, driven by what changed.
 *
 * An alert rule is a stored `OpportunityFilter`, and evaluation runs it through
 * exactly the same `buildWhere` the opportunity table uses. An alert that fired
 * on a different result set than the saved search it was created from would be
 * worse than no alert at all.
 *
 * What it fires *on* is the point. This used to notify only about parcels that
 * were new since the last run, which meant a parcel already notified could
 * never notify again — so a price cut on a parcel an analyst was watching was
 * silent. In this market that is the single most valuable event there is: a
 * parcel re-offered at a falling price is the strongest signal the product has,
 * and it was the one signal the alerts could not deliver.
 *
 * So evaluation reads the change log. Four events are time-critical:
 *
 *   CREATED        new inventory, first appearance
 *   PRICE_CHANGED  a reduction — an increase is noted, not alerted
 *   REAPPEARED     failed at auction and returned, usually cheaper
 *   AUCTION_DATE_CHANGED   the deadline moved, possibly closer
 *
 * Deduplication keys on the change rather than the parcel, so each distinct
 * event notifies once and no event is suppressed by an earlier one.
 */

const logger = createLogger({ component: 'alert-service' });

/** Ordered most urgent first; this is the analyst's queue order. */
export type AlertUrgency = 'IMMEDIATE' | 'HIGH' | 'NORMAL';

const ALERTING_KINDS = ['CREATED', 'PRICE_CHANGED', 'REAPPEARED', 'AUCTION_DATE_CHANGED'] as const;

/**
 * Most changes one rule will notify about in a single evaluation.
 *
 * A cap is right — a county publishing its whole roll for the first time
 * produced 14,220 change records here, and nobody wants that many
 * notifications. What was wrong was what happened to the remainder.
 */
const MAX_CHANGES_PER_RULE_PER_RUN = 200;

export interface AlertEvaluation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matched: number;
  readonly notified: number;
  readonly byKind: Record<string, number>;
  /**
   * True when more changes were waiting than one run will notify about. The
   * cursor stops where this run stopped, so the next run continues rather than
   * stepping over them.
   */
  readonly backlogged: boolean;
}

export async function evaluateAlertRules(
  options: { ruleId?: string; now?: Date } = {},
): Promise<AlertEvaluation[]> {
  const now = options.now ?? new Date();
  const rules = await prisma.alertRule.findMany({
    where: { enabled: true, ...(options.ruleId ? { id: options.ruleId } : {}) },
    include: { user: { select: { id: true, email: true } } },
  });

  const evaluations: AlertEvaluation[] = [];

  for (const rule of rules) {
    const filter = rule.filters as unknown as OpportunityFilter;
    const where = buildWhere(filter) as Prisma.ParcelOpportunityWhereInput;

    // Everything that happened to matching inventory since this rule last ran.
    // On a rule's first evaluation, look back a day rather than over the whole
    // history — a new rule should not deliver a year of old price changes.
    const since = rule.lastEvaluatedAt ?? new Date(now.getTime() - 86_400_000);

    // Oldest first, and one more than the cap so a backlog is detectable.
    //
    // This used to take the *newest* 200 and then advance the cursor to `now`
    // regardless, so any burst larger than the cap silently and permanently
    // discarded its oldest changes — the ones that had been waiting longest.
    // A county dumping new inventory is exactly when that happened, and
    // exactly when this product is supposed to be worth something.
    const changes = await prisma.parcelChange.findMany({
      where: {
        detectedAt: { gte: since },
        kind: { in: [...ALERTING_KINDS] },
        parcel: where,
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
      take: MAX_CHANGES_PER_RULE_PER_RUN + 1,
      include: {
        parcel: {
          select: {
            id: true,
            apn: true,
            county: true,
            state: true,
            acreage: true,
            alphaScore: true,
            askingPrice: true,
            minimumBid: true,
            basisToQsv: true,
            auctionDate: true,
            offerDeadline: true,
          },
        },
      },
    });

    const backlogged = changes.length > MAX_CHANGES_PER_RULE_PER_RUN;
    const batch = backlogged ? changes.slice(0, MAX_CHANGES_PER_RULE_PER_RUN) : changes;

    let notified = 0;
    const byKind: Record<string, number> = {};

    for (const change of batch) {
      const message = describeChange(change, now);
      if (!message) continue; // e.g. a price increase: recorded, not alerted

      // One notification per rule per change. The unique constraint makes the
      // race between two concurrent evaluations harmless rather than duplicated.
      try {
        await prisma.notification.create({
          data: {
            userId: rule.userId,
            alertRuleId: rule.id,
            parcelChangeId: change.id,
            channel: 'IN_APP',
            parcelId: change.parcelId,
            urgency: message.urgency,
            title: message.title,
            body: message.body,
            linkPath: `/opportunities/${change.parcelId}`,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      notified += 1;
      byKind[change.kind] = (byKind[change.kind] ?? 0) + 1;
    }

    // Advance only as far as we actually got. The query is `gte` and
    // notifications are unique per (rule, change), so re-reading the boundary
    // instant is harmless — which matters because a batched insert stamps many
    // changes with one timestamp, and a `gt` cursor would step over its
    // siblings.
    const lastProcessed = batch.at(-1)?.detectedAt;
    let cursor = backlogged && lastProcessed ? lastProcessed : now;

    if (backlogged && lastProcessed && lastProcessed.getTime() <= since.getTime()) {
      // The whole batch landed on one instant and there are still more at it,
      // so holding the cursor here would never progress. Stepping past it is
      // the only way forward and it does drop the remainder of that instant —
      // so say so, rather than losing them quietly the way this used to.
      cursor = new Date(since.getTime() + 1);
      logger.warn('alert backlog exceeded the cap within a single instant', {
        ruleId: rule.id,
        instant: since.toISOString(),
        cap: MAX_CHANGES_PER_RULE_PER_RUN,
      });
    }

    await prisma.alertRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: cursor,
        ...(notified > 0 ? { lastMatchAt: now, matchCount: { increment: notified } } : {}),
      },
    });

    if (backlogged) {
      logger.info('alert rule has a backlog; the next run continues from here', {
        ruleId: rule.id,
        notified,
        cursor: cursor.toISOString(),
      });
    }

    evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched: batch.length,
      notified,
      byKind,
      backlogged,
    });
  }

  logger.info('evaluated alert rules', {
    rules: evaluations.length,
    notified: evaluations.reduce((sum, evaluation) => sum + evaluation.notified, 0),
  });

  return evaluations;
}

interface ChangeWithParcel {
  kind: string;
  oldValue: string | null;
  newValue: string | null;
  parcel: {
    apn: string | null;
    county: string;
    state: string;
    acreage: number | null;
    alphaScore: number | null;
    askingPrice: Prisma.Decimal | null;
    minimumBid: Prisma.Decimal | null;
    basisToQsv: number | null;
    auctionDate: Date | null;
    offerDeadline: Date | null;
  };
}

/**
 * What to say, and how loudly.
 *
 * The title names the event rather than the parcel, because an analyst
 * scanning a queue needs to know what happened before they need to know where.
 */
export function describeChange(
  change: ChangeWithParcel,
  now: Date,
): { title: string; body: string; urgency: AlertUrgency } | null {
  const parcel = change.parcel;
  const where = `${parcel.county} County, ${parcel.state}`;
  const price = toCents(parcel.askingPrice) ?? toCents(parcel.minimumBid);

  const facts = [
    parcel.alphaScore == null ? null : `Alpha ${Math.round(parcel.alphaScore)}`,
    parcel.acreage == null ? null : `${parcel.acreage.toFixed(2)} ac`,
    price == null ? null : formatCents(price),
    parcel.basisToQsv == null ? null : `basis ${formatPercent(parcel.basisToQsv, 0)} of QSV`,
    parcel.apn ? `APN ${parcel.apn}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const deadline = soonestDeadline(parcel, now);
  const deadlineUrgency: AlertUrgency =
    deadline == null ? 'NORMAL' : deadline <= 3 ? 'IMMEDIATE' : deadline <= 14 ? 'HIGH' : 'NORMAL';
  const deadlineNote =
    deadline == null
      ? ''
      : deadline <= 0
        ? ' Sale date has passed.'
        : ` Sale in ${deadline} day${deadline === 1 ? '' : 's'}.`;

  switch (change.kind) {
    case 'PRICE_CHANGED': {
      const before = Number(change.oldValue);
      const after = Number(change.newValue);
      if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return null;
      // A price rise is recorded by change detection but is not news worth
      // interrupting anyone for.
      if (after >= before) return null;
      const cut = (before - after) / before;
      return {
        title: `Price cut ${formatPercent(cut, 0)} — ${where}`,
        body: `${formatCents(Math.round(before * 100))} → ${formatCents(Math.round(after * 100))}. ${facts}${deadlineNote}`,
        // A deep cut is how these parcels finally clear, and it does not last.
        urgency:
          cut >= 0.25 ? 'IMMEDIATE' : cut >= 0.1 ? 'HIGH' : maxUrgency('NORMAL', deadlineUrgency),
      };
    }
    case 'REAPPEARED':
      return {
        title: `Back on the list — ${where}`,
        body: `Failed to sell and has returned to inventory, usually at a lower price. ${facts}${deadlineNote}`,
        urgency: maxUrgency('HIGH', deadlineUrgency),
      };
    case 'AUCTION_DATE_CHANGED':
      // Only worth an alert if the new date is close.
      if (deadlineUrgency === 'NORMAL') return null;
      return {
        title: `Sale date moved — ${where}`,
        body: `${facts}${deadlineNote}`,
        urgency: deadlineUrgency,
      };
    case 'CREATED':
      return {
        title: `New match — ${where}`,
        body: `${facts}${deadlineNote}`,
        urgency: maxUrgency('NORMAL', deadlineUrgency),
      };
    default:
      return null;
  }
}

function soonestDeadline(
  parcel: { auctionDate: Date | null; offerDeadline: Date | null },
  now: Date,
): number | null {
  const dates = [parcel.auctionDate, parcel.offerDeadline].filter(
    (date): date is Date => date != null,
  );
  if (dates.length === 0) return null;
  const soonest = dates.reduce((a, b) => (a < b ? a : b));
  return Math.ceil((soonest.getTime() - now.getTime()) / 86_400_000);
}

const URGENCY_RANK: Record<AlertUrgency, number> = { NORMAL: 0, HIGH: 1, IMMEDIATE: 2 };

function maxUrgency(a: AlertUrgency, b: AlertUrgency): AlertUrgency {
  return URGENCY_RANK[a] >= URGENCY_RANK[b] ? a : b;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error != null && (error as { code?: string }).code === 'P2002'
  );
}
