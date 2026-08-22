import {
  ACCESS_CLASSES,
  BUILDABILITY_RATINGS,
  PARCEL_STATUSES,
  SOURCE_TYPES,
  type AccessClass,
  type BuildabilityRating,
  type ParcelStatus,
  type SourceType,
} from './enums';

/**
 * One filter model, three consumers.
 *
 * The opportunity table's filter bar, saved searches and alert rules all speak
 * this shape. That is why it lives in `shared` and is plain JSON: a saved
 * search is literally a persisted `OpportunityFilter`, and an alert rule is a
 * filter plus a delivery channel. Adding a filter therefore adds it to all
 * three surfaces at once.
 */
export interface OpportunityFilter {
  /** Free text over APN, county, legal description, address. */
  q?: string;
  minAlphaScore?: number;
  maxAlphaScore?: number;
  states?: string[];
  counties?: string[];
  sourceTypes?: SourceType[];
  sourceIds?: string[];
  /** Cents. */
  maxPrice?: number;
  minPrice?: number;
  minAcreage?: number;
  maxAcreage?: number;
  /** Fraction, e.g. 0.2 for "basis is at most 20% of quick-sale value". */
  maxBasisToQsv?: number;
  minQuickSaleValue?: number;
  accessClasses?: AccessClass[];
  buildability?: BuildabilityRating[];
  maxTitleRisk?: number;
  /** Fraction of parcel in mapped flood hazard area. */
  maxFloodOverlap?: number;
  maxWetlandOverlap?: number;
  auctionBefore?: string;
  auctionAfter?: string;
  /** Only inventory that can be bought on demand rather than at auction. */
  otcOnly?: boolean;
  /**
   * Only parcels a county has actually put up for sale.
   *
   * Most sources publish a government-held inventory, not an offer list. St.
   * Louis County publishes its entire tax-forfeited roll — 14,220 parcels — and
   * says in its own notes that being on it is not the same as being offered.
   * Without this the ranked list is 99.6% land nobody can buy, and the fifty-odd
   * parcels a county has genuinely offered are impossible to find in it.
   */
  offeredOnly?: boolean;
  noReserveOnly?: boolean;
  minFailedSaleCount?: number;
  statuses?: ParcelStatus[];
  watchlistedOnly?: boolean;
  includeRejected?: boolean;
  /** Parcels first seen after this ISO timestamp — powers "new today/this week". */
  firstSeenAfter?: string;
  minConfidenceScore?: number;
  hasGeometry?: boolean;
  sort?: OpportunitySort;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const OPPORTUNITY_SORTS = [
  'alphaScore',
  'basisToQsv',
  'askingPrice',
  'acreage',
  'quickSaleValue',
  'auctionDate',
  'firstSeenAt',
  'titleRiskScore',
  'confidenceScore',
  // Return per year of capital tied up. The one an investor with finite money
  // should actually sort by.
  'annualizedRoiAtQsv',
  'expectedHoldDays',
] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];

export const DEFAULT_FILTER: OpportunityFilter = {
  sort: 'alphaScore',
  direction: 'desc',
  page: 1,
  pageSize: 50,
  includeRejected: false,
};

export const MAX_PAGE_SIZE = 200;

/**
 * Parse a filter from URL search params. Deliberately forgiving — an unknown
 * or malformed parameter is dropped rather than throwing, because these values
 * come from user-editable URLs and shared links.
 */
export function filterFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): OpportunityFilter {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const getAll = (key: string): string[] => {
    if (params instanceof URLSearchParams) return params.getAll(key).flatMap(splitList);
    const value = params[key];
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value]).flatMap(splitList);
  };

  const filter: OpportunityFilter = { ...DEFAULT_FILTER };

  const q = get('q')?.trim();
  if (q) filter.q = q;

  assignNumber(filter as Record<string, unknown>, 'minAlphaScore', get('minAlphaScore'), 0, 100);
  assignNumber(filter as Record<string, unknown>, 'maxAlphaScore', get('maxAlphaScore'), 0, 100);
  assignNumber(filter as Record<string, unknown>, 'maxPrice', get('maxPrice'), 0);
  assignNumber(filter as Record<string, unknown>, 'minPrice', get('minPrice'), 0);
  assignNumber(filter as Record<string, unknown>, 'minAcreage', get('minAcreage'), 0);
  assignNumber(filter as Record<string, unknown>, 'maxAcreage', get('maxAcreage'), 0);
  assignNumber(filter as Record<string, unknown>, 'maxBasisToQsv', get('maxBasisToQsv'), 0, 100);
  assignNumber(filter as Record<string, unknown>, 'minQuickSaleValue', get('minQuickSaleValue'), 0);
  assignNumber(filter as Record<string, unknown>, 'maxTitleRisk', get('maxTitleRisk'), 0, 100);
  assignNumber(filter as Record<string, unknown>, 'maxFloodOverlap', get('maxFloodOverlap'), 0, 1);
  assignNumber(
    filter as Record<string, unknown>,
    'maxWetlandOverlap',
    get('maxWetlandOverlap'),
    0,
    1,
  );
  assignNumber(
    filter as Record<string, unknown>,
    'minFailedSaleCount',
    get('minFailedSaleCount'),
    0,
  );
  assignNumber(
    filter as Record<string, unknown>,
    'minConfidenceScore',
    get('minConfidenceScore'),
    0,
    100,
  );

  const states = getAll('states')
    .map((s) => s.toUpperCase())
    .filter((s) => /^[A-Z]{2}$/.test(s));
  if (states.length) filter.states = states;

  const counties = getAll('counties').filter(Boolean);
  if (counties.length) filter.counties = counties;

  const sourceTypes = getAll('sourceTypes').filter((v): v is SourceType =>
    (SOURCE_TYPES as readonly string[]).includes(v),
  );
  if (sourceTypes.length) filter.sourceTypes = sourceTypes;

  const sourceIds = getAll('sourceIds').filter(Boolean);
  if (sourceIds.length) filter.sourceIds = sourceIds;

  const accessClasses = getAll('accessClasses').filter((v): v is AccessClass =>
    (ACCESS_CLASSES as readonly string[]).includes(v),
  );
  if (accessClasses.length) filter.accessClasses = accessClasses;

  const buildability = getAll('buildability').filter((v): v is BuildabilityRating =>
    (BUILDABILITY_RATINGS as readonly string[]).includes(v),
  );
  if (buildability.length) filter.buildability = buildability;

  const statuses = getAll('statuses').filter((v): v is ParcelStatus =>
    (PARCEL_STATUSES as readonly string[]).includes(v),
  );
  if (statuses.length) filter.statuses = statuses;

  if (get('otcOnly') === 'true') filter.otcOnly = true;
  if (get('offeredOnly') === 'true') filter.offeredOnly = true;
  if (get('noReserveOnly') === 'true') filter.noReserveOnly = true;
  if (get('watchlistedOnly') === 'true') filter.watchlistedOnly = true;
  if (get('includeRejected') === 'true') filter.includeRejected = true;
  if (get('hasGeometry') === 'true') filter.hasGeometry = true;

  const auctionBefore = get('auctionBefore');
  if (auctionBefore && !Number.isNaN(Date.parse(auctionBefore)))
    filter.auctionBefore = auctionBefore;
  const auctionAfter = get('auctionAfter');
  if (auctionAfter && !Number.isNaN(Date.parse(auctionAfter))) filter.auctionAfter = auctionAfter;
  const firstSeenAfter = get('firstSeenAfter');
  if (firstSeenAfter && !Number.isNaN(Date.parse(firstSeenAfter))) {
    filter.firstSeenAfter = firstSeenAfter;
  }

  const sort = get('sort');
  if (sort && (OPPORTUNITY_SORTS as readonly string[]).includes(sort)) {
    filter.sort = sort as OpportunitySort;
  }
  const direction = get('direction');
  if (direction === 'asc' || direction === 'desc') filter.direction = direction;

  const page = Number(get('page'));
  if (Number.isFinite(page) && page >= 1) filter.page = Math.floor(page);
  const pageSize = Number(get('pageSize'));
  if (Number.isFinite(pageSize) && pageSize >= 1) {
    filter.pageSize = Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
  }

  return filter;
}

export function filterToSearchParams(filter: OpportunityFilter): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(','));
    } else if (typeof value === 'boolean') {
      if (value) params.set(key, 'true');
    } else {
      params.set(key, String(value));
    }
  }
  return params;
}

/** How many non-default constraints are active — drives the "N filters" chip. */
export function activeFilterCount(filter: OpportunityFilter): number {
  const ignored = new Set(['sort', 'direction', 'page', 'pageSize', 'includeRejected']);
  let count = 0;
  for (const [key, value] of Object.entries(filter)) {
    if (ignored.has(key) || value == null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'boolean' && !value) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    count += 1;
  }
  return count;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function assignNumber(
  target: Record<string, unknown>,
  key: string,
  raw: string | undefined,
  min?: number,
  max?: number,
): void {
  if (raw == null || raw === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  if (min != null && value < min) return;
  if (max != null && value > max) return;
  target[key] = value;
}

/**
 * The starter saved searches described in the brief. Seeded for every new user
 * so the product is immediately useful rather than an empty filter bar.
 */
export const STARTER_SAVED_SEARCHES: {
  name: string;
  description: string;
  filters: OpportunityFilter;
}[] = [
  {
    name: 'Micro Acquisition',
    description: 'Cheap enough to buy without a committee. Price ≤ $2,500, Alpha ≥ 80, access A/B.',
    filters: {
      ...DEFAULT_FILTER,
      maxPrice: 250_000,
      minAlphaScore: 80,
      accessClasses: ['A', 'B'],
    },
  },
  {
    name: 'Strong Flip',
    description: 'Basis ≤ 20% of QSV, QSV ≥ $20,000, Alpha ≥ 85.',
    filters: {
      ...DEFAULT_FILTER,
      maxBasisToQsv: 0.2,
      minQuickSaleValue: 2_000_000,
      minAlphaScore: 85,
    },
  },
  {
    name: 'Failed Auction',
    description: 'Inventory nobody bought, now available over the counter.',
    filters: {
      ...DEFAULT_FILTER,
      minFailedSaleCount: 1,
      otcOnly: true,
      sort: 'basisToQsv',
      direction: 'asc',
    },
  },
];
