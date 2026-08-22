import { prisma, toCents } from '@land-alpha/db';
import { formatCents } from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';

const logger = createLogger({ component: 'worklist-service' });

/**
 * The queue of parcels blocked on a person, and the nudge to clear it.
 *
 * Every automated part of this system now runs on its own: sources are swept
 * every quarter hour, new inventory is enriched, valued and scored without
 * being asked. What does not run on its own is the small set of facts no
 * public endpoint will hand over — an acquisition price that has to be
 * requested from a county, and the flood and wetland layers whose publishers
 * do not permit automated queries.
 *
 * Those facts gate everything downstream. A parcel without a price has no
 * computable discount, so a third of its Alpha Score is a constant and it
 * cannot be bid on at all. The work to fix that is minutes per county, and the
 * only reason it would not get done is that nobody is told it is waiting.
 */

export interface WorklistCounty {
  readonly state: string;
  readonly county: string;
  readonly parcelsAwaitingPrice: number;
  readonly quickSaleValueCents: number;
}

/**
 * A county whose inventory cannot be valued at all.
 *
 * These parcels are not rejected — nothing is wrong with the land — and they
 * carry no Alpha Score, because a score estimates return and there is no value
 * to estimate one against. That combination makes them invisible: absent from
 * the ranking, absent from the price queue, absent from the rejected list. A
 * quarter of inventory sitting in a place nobody looks is a fact worth one
 * line on a page rather than a discovery someone makes months later.
 */
export interface DarkCounty {
  readonly state: string;
  readonly county: string;
  readonly parcels: number;
  readonly reason: string;
}

export interface WorklistSummary {
  readonly awaitingPrice: number;
  readonly awaitingScreen: number;
  readonly quickSaleValueCents: number;
  readonly counties: readonly WorklistCounty[];
  /** Counties whose parcels cannot be valued, and why. */
  readonly dark: readonly DarkCounty[];
}

/**
 * What is waiting, grouped the way it gets cleared.
 *
 * Parcels with no value estimate are excluded. Those are blocked on comparable
 * sales, which no amount of typing produces, and counting them here would turn
 * a queue somebody can finish into one they cannot.
 */
export async function summariseWorklist(): Promise<WorklistSummary> {
  const parcels = await prisma.parcelOpportunity.findMany({
    where: {
      removedFromSourceAt: null,
      rejected: false,
      status: { notIn: ['REJECTED', 'ACQUIRED', 'SOLD'] },
      quickSaleValue: { not: null },
      OR: [{ askingPrice: null }, { environmentalLayersScreened: { isEmpty: true } }],
    },
    select: {
      state: true,
      county: true,
      askingPrice: true,
      quickSaleValue: true,
      environmentalLayersScreened: true,
    },
  });

  const counties = new Map<string, { state: string; county: string; n: number; cents: number }>();
  let awaitingPrice = 0;
  let awaitingScreen = 0;
  let quickSaleValueCents = 0;

  for (const parcel of parcels) {
    if (parcel.askingPrice == null) {
      awaitingPrice += 1;
      const cents = toCents(parcel.quickSaleValue) ?? 0;
      quickSaleValueCents += cents;
      const key = `${parcel.state}/${parcel.county}`;
      const group = counties.get(key) ?? {
        state: parcel.state,
        county: parcel.county,
        n: 0,
        cents: 0,
      };
      group.n += 1;
      group.cents += cents;
      counties.set(key, group);
    } else if (parcel.environmentalLayersScreened.length === 0) {
      awaitingScreen += 1;
    }
  }

  return {
    awaitingPrice,
    awaitingScreen,
    quickSaleValueCents,
    dark: await summariseDark(),
    counties: [...counties.values()]
      .sort((a, b) => b.cents - a.cents)
      .map((group) => ({
        state: group.state,
        county: group.county,
        parcelsAwaitingPrice: group.n,
        quickSaleValueCents: group.cents,
      })),
  };
}

/**
 * Inventory that cannot be valued, grouped by county and cause.
 *
 * The cause is read from the valuation's own warnings rather than re-derived,
 * so the page says what the engine concluded instead of a second opinion that
 * can drift from it.
 */
async function summariseDark(): Promise<DarkCounty[]> {
  const parcels = await prisma.parcelOpportunity.findMany({
    where: {
      removedFromSourceAt: null,
      rejected: false,
      alphaScore: null,
      status: { notIn: ['REJECTED', 'ACQUIRED', 'SOLD'] },
    },
    select: { state: true, county: true, valuationWarnings: true },
  });

  const groups = new Map<
    string,
    { state: string; county: string; n: number; reasons: Set<string> }
  >();
  for (const parcel of parcels) {
    const key = `${parcel.state}/${parcel.county}`;
    const group = groups.get(key) ?? {
      state: parcel.state,
      county: parcel.county,
      n: 0,
      reasons: new Set<string>(),
    };
    group.n += 1;
    const cause = parcel.valuationWarnings.find((warning) =>
      warning.startsWith('No comparable sales'),
    );
    if (cause) group.reasons.add(cause);
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => b.n - a.n)
    .map((group) => ({
      state: group.state,
      county: group.county,
      parcels: group.n,
      reason:
        [...group.reasons][0] ??
        'No valuation could be established, and the engine recorded no reason.',
    }));
}

/**
 * Tells whoever can act that the queue is not empty.
 *
 * Deliberately silent when there is nothing to do. A digest that arrives every
 * day whatever the state of the world is a digest people stop opening, and the
 * one morning it matters it will be skimmed with the rest.
 *
 * Also silent when the queue has not changed since the last nudge: the work is
 * measured in counties, not parcels, and being told the same three counties
 * are waiting every morning teaches people to ignore it.
 */
export async function notifyWorklist(): Promise<number> {
  const summary = await summariseWorklist();
  if (summary.awaitingPrice === 0) return 0;

  const recipients = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'ANALYST'] }, isActive: true },
    select: { id: true },
  });
  if (recipients.length === 0) {
    logger.warn('parcels are waiting on a person and there is nobody to tell', {
      awaitingPrice: summary.awaitingPrice,
    });
    return 0;
  }

  const fingerprint = summary.counties
    .map((county) => `${county.state}/${county.county}:${county.parcelsAwaitingPrice}`)
    .join(',');

  const alreadySent = await prisma.notification.findFirst({
    where: { title: { startsWith: WORKLIST_TITLE_PREFIX }, body: { contains: fingerprint } },
    select: { id: true },
  });
  if (alreadySent) return 0;

  const where = summary.counties
    .map(
      (county) =>
        `${county.county} County, ${county.state} (${county.parcelsAwaitingPrice}, ${formatCents(county.quickSaleValueCents)})`,
    )
    .join('; ');

  const title = `${WORKLIST_TITLE_PREFIX}${summary.counties.length} ${
    summary.counties.length === 1 ? 'county' : 'counties'
  } hold prices for ${summary.awaitingPrice} parcels`;

  await prisma.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      channel: 'IN_APP' as const,
      urgency: 'NORMAL' as const,
      title,
      body:
        `${formatCents(summary.quickSaleValueCents)} of quick-sale value cannot be ranked or bid ` +
        `until someone obtains an acquisition price. One request per county clears it: ${where}. ` +
        `[${fingerprint}]`,
      linkPath: '/blocked',
    })),
  });

  logger.info('worklist notified', {
    recipients: recipients.length,
    awaitingPrice: summary.awaitingPrice,
    counties: summary.counties.length,
  });
  return recipients.length;
}

const WORKLIST_TITLE_PREFIX = 'Prices outstanding — ';
