import { Prisma } from '@prisma/client';
import { prisma } from '../client';
import { toCents, toDecimal } from '../mappers';
import {
  DISTRESSED_REOFFER_SOURCE_TYPES,
  MAX_PAGE_SIZE,
  STANDING_INVENTORY_SOURCE_TYPES,
  type OpportunityFilter,
  type OpportunitySummary,
} from '@land-alpha/shared';
import { normalizeApn } from '@land-alpha/shared/ids';

/**
 * Parcel querying.
 *
 * `buildWhere` is the single translation from the shared `OpportunityFilter`
 * into SQL. The table, saved searches, alert evaluation and the map all call
 * it, so a filter behaves identically wherever it is used — a saved search that
 * shows 12 parcels cannot silently match a different 15 when an alert runs.
 */

export function buildWhere(filter: OpportunityFilter): Prisma.ParcelOpportunityWhereInput {
  const and: Prisma.ParcelOpportunityWhereInput[] = [];

  // Inventory that has vanished from its source is never a live opportunity.
  and.push({ removedFromSourceAt: null });

  if (!filter.includeRejected) and.push({ rejected: false });

  if (filter.q?.trim()) {
    const q = filter.q.trim();
    const apn = normalizeApn(q);
    and.push({
      OR: [
        { apnNormalized: { contains: apn } },
        { apn: { contains: q, mode: 'insensitive' } },
        { county: { contains: q, mode: 'insensitive' } },
        { municipality: { contains: q, mode: 'insensitive' } },
        { situsAddress: { contains: q, mode: 'insensitive' } },
        { legalDescription: { contains: q, mode: 'insensitive' } },
      ],
    });
  }

  if (filter.minAlphaScore != null) and.push({ alphaScore: { gte: filter.minAlphaScore } });
  if (filter.maxAlphaScore != null) and.push({ alphaScore: { lte: filter.maxAlphaScore } });
  if (filter.states?.length) and.push({ state: { in: filter.states } });
  if (filter.counties?.length) and.push({ county: { in: filter.counties } });
  if (filter.sourceIds?.length) and.push({ sourceId: { in: filter.sourceIds } });
  if (filter.sourceTypes?.length) and.push({ source: { sourceType: { in: filter.sourceTypes } } });

  // Price filters compare against the figure an analyst actually pays: the
  // asking price when the source states one, otherwise the minimum bid.
  if (filter.maxPrice != null) {
    and.push({
      OR: [
        { askingPrice: { lte: toDecimal(filter.maxPrice)! } },
        { AND: [{ askingPrice: null }, { minimumBid: { lte: toDecimal(filter.maxPrice)! } }] },
      ],
    });
  }
  if (filter.minPrice != null) {
    and.push({
      OR: [
        { askingPrice: { gte: toDecimal(filter.minPrice)! } },
        { AND: [{ askingPrice: null }, { minimumBid: { gte: toDecimal(filter.minPrice)! } }] },
      ],
    });
  }

  if (filter.minAcreage != null) and.push({ acreage: { gte: filter.minAcreage } });
  if (filter.maxAcreage != null) and.push({ acreage: { lte: filter.maxAcreage } });
  if (filter.maxBasisToQsv != null)
    and.push({ basisToQsv: { lte: filter.maxBasisToQsv, not: null } });
  if (filter.minQuickSaleValue != null) {
    and.push({ quickSaleValue: { gte: toDecimal(filter.minQuickSaleValue)! } });
  }
  if (filter.accessClasses?.length) and.push({ accessClass: { in: filter.accessClasses } });
  if (filter.buildability?.length) and.push({ buildability: { in: filter.buildability } });
  if (filter.maxTitleRisk != null) and.push({ titleRiskScore: { lte: filter.maxTitleRisk } });

  // Environmental overlap filters treat "unknown" as passing: excluding parcels
  // we simply have not measured yet would hide new inventory, which is the
  // opposite of what an analyst screening for fresh opportunities wants.
  if (filter.maxFloodOverlap != null) {
    and.push({
      OR: [
        { floodOverlapFraction: { lte: filter.maxFloodOverlap } },
        { floodOverlapFraction: null },
      ],
    });
  }
  if (filter.maxWetlandOverlap != null) {
    and.push({
      OR: [
        { wetlandOverlapFraction: { lte: filter.maxWetlandOverlap } },
        { wetlandOverlapFraction: null },
      ],
    });
  }

  if (filter.auctionBefore) and.push({ auctionDate: { lte: new Date(filter.auctionBefore) } });
  if (filter.auctionAfter) and.push({ auctionDate: { gte: new Date(filter.auctionAfter) } });
  if (filter.firstSeenAfter) and.push({ firstSeenAt: { gte: new Date(filter.firstSeenAfter) } });

  if (filter.offeredOnly) {
    // What a county has actually put up, as opposed to what it merely holds.
    // Everything else is inventory we found in a government record with no
    // offering attached to it.
    and.push({ saleStatus: { in: ['AVAILABLE', 'SCHEDULED'] } });
  }

  if (filter.otcOnly) {
    and.push({
      OR: [
        { otcEligible: true },
        { saleType: 'OVER_THE_COUNTER' },
        { source: { sourceType: { in: [...STANDING_INVENTORY_SOURCE_TYPES] } } },
      ],
    });
  }
  if (filter.noReserveOnly) and.push({ source: { sourceType: 'NO_RESERVE' } });
  if (filter.minFailedSaleCount != null) {
    and.push({ failedSaleCount: { gte: filter.minFailedSaleCount } });
  }
  if (filter.statuses?.length) and.push({ status: { in: filter.statuses } });
  if (filter.watchlistedOnly) and.push({ watchlisted: true });
  if (filter.minConfidenceScore != null) {
    and.push({ confidenceScore: { gte: filter.minConfidenceScore } });
  }
  if (filter.hasGeometry) and.push({ NOT: { compactness: null } });

  return { AND: and };
}

function buildOrderBy(
  filter: OpportunityFilter,
): Prisma.ParcelOpportunityOrderByWithRelationInput[] {
  const direction = filter.direction ?? 'desc';
  const nulls = direction === 'desc' ? 'last' : 'last';
  switch (filter.sort) {
    case 'basisToQsv':
      return [{ basisToQsv: { sort: direction, nulls } }, { alphaScore: 'desc' }];
    case 'askingPrice':
      return [{ askingPrice: { sort: direction, nulls } }, { alphaScore: 'desc' }];
    case 'acreage':
      return [{ acreage: { sort: direction, nulls } }];
    case 'quickSaleValue':
      return [{ quickSaleValue: { sort: direction, nulls } }];
    case 'auctionDate':
      return [{ auctionDate: { sort: direction, nulls } }];
    case 'firstSeenAt':
      return [{ firstSeenAt: direction }];
    case 'titleRiskScore':
      return [{ titleRiskScore: { sort: direction, nulls } }];
    case 'confidenceScore':
      return [{ confidenceScore: { sort: direction, nulls } }];
    case 'annualizedRoiAtQsv':
      return [{ annualizedRoiAtQsv: { sort: direction, nulls } }, { alphaScore: 'desc' }];
    case 'expectedHoldDays':
      return [{ expectedHoldDays: { sort: direction, nulls } }, { alphaScore: 'desc' }];
    case 'alphaScore':
    default:
      return [{ alphaScore: { sort: direction, nulls } }, { firstSeenAt: 'desc' }];
  }
}

const SUMMARY_SELECT = {
  id: true,
  state: true,
  county: true,
  apn: true,
  acreage: true,
  askingPrice: true,
  minimumBid: true,
  estimatedAllInBasis: true,
  quickSaleValue: true,
  retailValue: true,
  basisToQsv: true,
  annualizedRoiAtQsv: true,
  expectedHoldDays: true,
  alphaScore: true,
  accessClass: true,
  buildability: true,
  titleRiskScore: true,
  auctionDate: true,
  offerDeadline: true,
  status: true,
  analystDisposition: true,
  watchlisted: true,
  confidenceLevel: true,
  source: { select: { name: true, sourceType: true } },
} satisfies Prisma.ParcelOpportunitySelect;

type SummaryRow = Prisma.ParcelOpportunityGetPayload<{ select: typeof SUMMARY_SELECT }>;

export function toSummary(row: SummaryRow): OpportunitySummary {
  return {
    id: row.id,
    state: row.state,
    county: row.county,
    apn: row.apn,
    acreage: row.acreage,
    sourceName: row.source.name,
    sourceType: row.source.sourceType,
    askingPrice: toCents(row.askingPrice) ?? toCents(row.minimumBid),
    allInBasis: toCents(row.estimatedAllInBasis),
    quickSaleValue: toCents(row.quickSaleValue),
    retailValue: toCents(row.retailValue),
    basisToQsv: row.basisToQsv,
    annualizedRoiAtQsv: row.annualizedRoiAtQsv,
    expectedHoldDays: row.expectedHoldDays,
    alphaScore: row.alphaScore,
    accessClass: row.accessClass,
    buildability: row.buildability,
    titleRiskScore: row.titleRiskScore,
    auctionDate: row.auctionDate,
    offerDeadline: row.offerDeadline,
    status: row.status,
    analystDisposition: row.analystDisposition,
    watchlisted: row.watchlisted,
    confidenceLevel: row.confidenceLevel,
  };
}

export interface OpportunityPage {
  readonly rows: OpportunitySummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
}

export async function listOpportunities(filter: OpportunityFilter): Promise<OpportunityPage> {
  const where = buildWhere(filter);
  const pageSize = Math.min(filter.pageSize ?? 50, MAX_PAGE_SIZE);
  const page = Math.max(1, filter.page ?? 1);

  const [rows, total] = await Promise.all([
    prisma.parcelOpportunity.findMany({
      where,
      select: SUMMARY_SELECT,
      orderBy: buildOrderBy(filter),
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.parcelOpportunity.count({ where }),
  ]);

  return {
    rows: rows.map(toSummary),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function countMatching(filter: OpportunityFilter): Promise<number> {
  return prisma.parcelOpportunity.count({ where: buildWhere(filter) });
}

/** Full detail payload for the parcel underwriting page. */
export async function getParcelDetail(id: string) {
  return prisma.parcelOpportunity.findUnique({
    where: { id },
    include: {
      source: { include: { jurisdiction: true } },
      jurisdiction: true,
      evidence: { orderBy: { createdAt: 'desc' }, take: 400 },
      changes: { orderBy: { detectedAt: 'desc' }, take: 50 },
      notes: { orderBy: { createdAt: 'desc' }, include: { user: { select: { name: true } } } },
      documents: { orderBy: { createdAt: 'desc' } },
      titleInstruments: { orderBy: { chainPosition: 'asc' } },
      titleResearchTasks: { orderBy: { createdAt: 'desc' } },
      valuationSnapshots: { orderBy: { createdAt: 'desc' }, take: 5 },
      scoreSnapshots: { orderBy: { createdAt: 'desc' }, take: 20 },
      comparableLinks: { include: { comparable: true }, orderBy: { weight: 'desc' } },
      memos: { orderBy: { createdAt: 'desc' }, take: 3 },
      auctionOutcomes: { orderBy: { eventDate: 'desc' } },
      deal: { include: { checklistItems: { orderBy: { ordering: 'asc' } } } },
      portfolioAsset: true,
      listing: { include: { variants: true, photos: true } },
    },
  });
}

export async function getParcelBySlug(slug: string) {
  return prisma.parcelOpportunity.findUnique({
    where: { publicSlug: slug },
    include: {
      listing: { include: { variants: true, photos: true } },
      jurisdiction: true,
    },
  });
}

export interface DashboardStats {
  readonly activeOpportunities: number;
  /**
   * Of the active opportunities, those a county has actually offered.
   *
   * The gap between this and `activeOpportunities` is the important number on
   * the dashboard: most sources publish a government-held inventory rather than
   * an offer list, so the headline count is dominated by parcels nobody can
   * buy today.
   */
  readonly offeredForSale: number;
  readonly newToday: number;
  readonly newThisWeek: number;
  readonly totalAskingCents: number;
  readonly estimatedQsvCents: number;
  readonly aggregateImpliedDiscount: number | null;
  /** Parcels with both a cost and a value — the population the discount covers. */
  readonly pricedParcelCount: number;
  readonly sourcesMonitored: number;
  readonly sourcesHealthy: number;
  readonly sourceRefreshSuccessRate: number | null;
  readonly watchlisted: number;
  readonly inDueDiligence: number;
  readonly rejectedCount: number;
  readonly exceptionalCount: number;
  readonly distressedInventoryCount: number;
  readonly auctionsNext14Days: number;
}

/**
 * The dashboard header. One round-trip per figure would be 14 queries; these
 * are grouped into a handful of aggregates instead.
 */
export async function dashboardStats(now = new Date()): Promise<DashboardStats> {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const inTwoWeeks = new Date(now.getTime() + 14 * 24 * 3600_000);
  const liveWhere = buildWhere({ includeRejected: false });

  const [
    activeOpportunities,
    offeredForSale,
    newToday,
    newThisWeek,
    sums,
    sourcesMonitored,
    sourcesHealthy,
    watchlisted,
    inDueDiligence,
    rejectedCount,
    exceptionalCount,
    distressedInventoryCount,
    auctionsNext14Days,
    runStats,
  ] = await Promise.all([
    prisma.parcelOpportunity.count({ where: liveWhere }),
    prisma.parcelOpportunity.count({
      where: buildWhere({ includeRejected: false, offeredOnly: true }),
    }),
    prisma.parcelOpportunity.count({
      where: { AND: [liveWhere, { firstSeenAt: { gte: startOfToday } }] },
    }),
    prisma.parcelOpportunity.count({
      where: { AND: [liveWhere, { firstSeenAt: { gte: weekAgo } }] },
    }),
    // The headline "total asking" must be the sum of what an analyst would
    // actually pay per parcel — the asking price where the source publishes
    // one, otherwise the minimum bid. Summing the two columns separately and
    // picking whichever is non-zero silently reports only the handful of
    // parcels that happen to carry an asking price.
    prisma.$queryRaw<
      {
        asking: string | null;
        qsv: string | null;
        basis: string | null;
        comparable_basis: string | null;
        comparable_qsv: string | null;
        comparable_count: number;
      }[]
    >`
      SELECT
        SUM(COALESCE(p."askingPrice", p."minimumBid", 0))::text AS asking,
        SUM(COALESCE(p."quickSaleValue", 0))::text              AS qsv,
        SUM(COALESCE(p."estimatedAllInBasis", 0))::text         AS basis,
        -- The aggregate discount is only meaningful across parcels where BOTH
        -- a cost and a value exist. Many government layers publish no price at
        -- all (Minnesota tax-forfeited land among them); including their value
        -- but not their cost would manufacture an enormous fictitious discount.
        SUM(p."estimatedAllInBasis") FILTER (
          WHERE p."estimatedAllInBasis" IS NOT NULL AND p."quickSaleValue" IS NOT NULL
        )::text AS comparable_basis,
        SUM(p."quickSaleValue") FILTER (
          WHERE p."estimatedAllInBasis" IS NOT NULL AND p."quickSaleValue" IS NOT NULL
        )::text AS comparable_qsv,
        COUNT(*) FILTER (
          WHERE p."estimatedAllInBasis" IS NOT NULL AND p."quickSaleValue" IS NOT NULL
        )::int AS comparable_count
      FROM "ParcelOpportunity" p
      WHERE p."removedFromSourceAt" IS NULL AND p."rejected" = false
    `,
    prisma.source.count({ where: { enabled: true } }),
    prisma.source.count({ where: { enabled: true, sourceStatus: 'ACTIVE' } }),
    prisma.parcelOpportunity.count({ where: { AND: [liveWhere, { watchlisted: true }] } }),
    prisma.parcelOpportunity.count({ where: { status: 'DUE_DILIGENCE' } }),
    prisma.parcelOpportunity.count({ where: { rejected: true } }),
    prisma.parcelOpportunity.count({
      where: { AND: [liveWhere, { economicsTier: 'EXCEPTIONAL' }] },
    }),
    prisma.parcelOpportunity.count({
      where: {
        AND: [liveWhere, { source: { sourceType: { in: [...DISTRESSED_REOFFER_SOURCE_TYPES] } } }],
      },
    }),
    prisma.parcelOpportunity.count({
      where: { AND: [liveWhere, { auctionDate: { gte: now, lte: inTwoWeeks } }] },
    }),
    prisma.ingestionRun.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { startedAt: { gte: new Date(now.getTime() - 30 * 24 * 3600_000) } },
    }),
  ]);

  const totals = sums[0];
  const totalAskingCents = toCents(totals?.asking ?? null) ?? 0;
  const estimatedQsvCents = toCents(totals?.qsv ?? null) ?? 0;
  const comparableBasisCents = toCents(totals?.comparable_basis ?? null) ?? 0;
  const comparableQsvCents = toCents(totals?.comparable_qsv ?? null) ?? 0;

  const totalRuns = runStats.reduce((sum, row) => sum + row._count._all, 0);
  const successfulRuns = runStats
    .filter((row) => row.status === 'SUCCEEDED' || row.status === 'PARTIAL')
    .reduce((sum, row) => sum + row._count._all, 0);

  return {
    activeOpportunities,
    offeredForSale,
    newToday,
    newThisWeek,
    totalAskingCents,
    estimatedQsvCents,
    aggregateImpliedDiscount:
      comparableQsvCents > 0 && comparableBasisCents > 0
        ? 1 - comparableBasisCents / comparableQsvCents
        : null,
    pricedParcelCount: totals?.comparable_count ?? 0,
    sourcesMonitored,
    sourcesHealthy,
    sourceRefreshSuccessRate: totalRuns === 0 ? null : successfulRuns / totalRuns,
    watchlisted,
    inDueDiligence,
    rejectedCount,
    exceptionalCount,
    distressedInventoryCount,
    auctionsNext14Days,
  };
}

/** Distinct counties present in inventory, for the filter bar. */
export async function availableCounties(
  states?: string[],
): Promise<{ state: string; county: string; count: number }[]> {
  const rows = await prisma.parcelOpportunity.groupBy({
    by: ['state', 'county'],
    where: states?.length ? { state: { in: states } } : undefined,
    _count: { _all: true },
    orderBy: [{ state: 'asc' }, { county: 'asc' }],
  });
  return rows.map((row) => ({ state: row.state, county: row.county, count: row._count._all }));
}
