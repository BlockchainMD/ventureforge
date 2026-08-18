import { buildWhere, prisma, type Prisma } from '@land-alpha/db';
import type { OpportunityFilter } from '@land-alpha/shared';
import { formatCents, formatPercent } from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * Alert evaluation.
 *
 * An alert rule is a stored `OpportunityFilter`, and evaluation runs it through
 * exactly the same `buildWhere` the opportunity table uses. That is deliberate:
 * an alert that fires on a different result set than the saved search it was
 * created from would be worse than no alert at all.
 *
 * Only parcels that became matches *since the last evaluation* notify, so a
 * standing rule does not re-alert on the same inventory every hour.
 */

const logger = createLogger({ component: 'alert-service' });

export interface AlertEvaluation {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly matched: number;
  readonly notified: number;
}

export async function evaluateAlertRules(
  options: { ruleId?: string } = {},
): Promise<AlertEvaluation[]> {
  const rules = await prisma.alertRule.findMany({
    where: { enabled: true, ...(options.ruleId ? { id: options.ruleId } : {}) },
    include: { user: { select: { id: true, email: true } } },
  });

  const evaluations: AlertEvaluation[] = [];

  for (const rule of rules) {
    const filter = rule.filters as unknown as OpportunityFilter;
    const where = buildWhere(filter) as Prisma.ParcelOpportunityWhereInput;

    // Only parcels first seen (or re-scored) since the last evaluation can be
    // new matches; everything older has already been considered.
    const since = rule.lastEvaluatedAt;
    const freshWhere: Prisma.ParcelOpportunityWhereInput = since
      ? {
          AND: [where, { OR: [{ firstSeenAt: { gte: since } }, { scoredAt: { gte: since } }] }],
        }
      : where;

    const matches = await prisma.parcelOpportunity.findMany({
      where: freshWhere,
      orderBy: { alphaScore: 'desc' },
      take: 25,
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
      },
    });

    let notified = 0;
    for (const parcel of matches) {
      // A parcel already notified for this rule is not notified again.
      const existing = await prisma.notification.findFirst({
        where: { alertRuleId: rule.id, parcelId: parcel.id },
        select: { id: true },
      });
      if (existing) continue;

      const price = parcel.askingPrice ?? parcel.minimumBid;
      await prisma.notification.create({
        data: {
          userId: rule.userId,
          alertRuleId: rule.id,
          channel: 'IN_APP',
          parcelId: parcel.id,
          title: `${rule.name}: ${parcel.county} County, ${parcel.state}`,
          body: [
            parcel.alphaScore == null ? null : `Alpha ${Math.round(parcel.alphaScore)}`,
            parcel.acreage == null ? null : `${parcel.acreage.toFixed(2)} ac`,
            price == null ? null : formatCents(Math.round(Number(price) * 100)),
            parcel.basisToQsv == null
              ? null
              : `basis ${formatPercent(parcel.basisToQsv, 0)} of QSV`,
          ]
            .filter(Boolean)
            .join(' · '),
          linkPath: `/opportunities/${parcel.id}`,
        },
      });
      notified += 1;
    }

    await prisma.alertRule.update({
      where: { id: rule.id },
      data: {
        lastEvaluatedAt: new Date(),
        ...(notified > 0 ? { lastMatchAt: new Date(), matchCount: { increment: notified } } : {}),
      },
    });

    evaluations.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched: matches.length,
      notified,
    });
  }

  logger.info('evaluated alert rules', {
    rules: evaluations.length,
    notified: evaluations.reduce((sum, evaluation) => sum + evaluation.notified, 0),
  });

  return evaluations;
}
