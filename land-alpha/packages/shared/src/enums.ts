/**
 * Canonical enumerations for Land Alpha.
 *
 * These are the single source of truth. `packages/db/prisma/schema.prisma`
 * mirrors them; `packages/shared/src/enums.test.ts` asserts the two never drift.
 */

export const SOURCE_TYPES = [
  'TAX_FORECLOSURE',
  'TAX_FORFEITED',
  'OVER_THE_COUNTER',
  'LANDS_AVAILABLE_FOR_TAXES',
  'REOFFER',
  'FINAL_SALE',
  'NO_RESERVE',
  'COUNTY_SURPLUS',
  'CITY_SURPLUS',
  'STATE_SURPLUS',
  'DNR_SURPLUS',
  'DOT_SURPLUS',
  'LAND_BANK',
  'OTHER',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/**
 * Source types where inventory is standing (buy any time) rather than
 * scheduled (bid on a date). Drives "OTC only" filtering and the urgency model.
 */
export const STANDING_INVENTORY_SOURCE_TYPES: readonly SourceType[] = [
  'OVER_THE_COUNTER',
  'LANDS_AVAILABLE_FOR_TAXES',
  'TAX_FORFEITED',
  'COUNTY_SURPLUS',
  'CITY_SURPLUS',
  'STATE_SURPLUS',
  'DNR_SURPLUS',
  'DOT_SURPLUS',
  'LAND_BANK',
];

/**
 * Source types that only exist because an earlier auction failed. These are the
 * core of the Land Alpha thesis: inventory nobody else is watching.
 */
export const DISTRESSED_REOFFER_SOURCE_TYPES: readonly SourceType[] = [
  'OVER_THE_COUNTER',
  'LANDS_AVAILABLE_FOR_TAXES',
  'REOFFER',
  'FINAL_SALE',
  'NO_RESERVE',
];

export const INGESTION_METHODS = [
  'API',
  'ARCGIS_REST',
  'CSV_EXPORT',
  'XLSX_EXPORT',
  'HTML_TABLE',
  'HTML_DETAIL',
  'PDF',
  'MANUAL_SOURCE',
] as const;
export type IngestionMethod = (typeof INGESTION_METHODS)[number];

export const SOURCE_STATUSES = [
  'ACTIVE',
  'CANDIDATE',
  'PENDING_APPROVAL',
  'DEGRADED',
  'BROKEN',
  'MANUAL_ONLY',
  'RETIRED',
] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const UPDATE_FREQUENCIES = [
  'REALTIME',
  'DAILY',
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'EVENT_DRIVEN',
  'UNKNOWN',
] as const;
export type UpdateFrequency = (typeof UPDATE_FREQUENCIES)[number];

export const JURISDICTION_TYPES = ['STATE', 'COUNTY', 'MUNICIPALITY', 'AGENCY'] as const;
export type JurisdictionType = (typeof JURISDICTION_TYPES)[number];

export const SALE_TYPES = [
  'AUCTION',
  'SEALED_BID',
  'OVER_THE_COUNTER',
  'APPLICATION',
  'NEGOTIATED',
  'LISTED',
  'UNKNOWN',
] as const;
export type SaleType = (typeof SALE_TYPES)[number];

export const SALE_STATUSES = [
  'AVAILABLE',
  'SCHEDULED',
  'PENDING',
  'SOLD',
  'WITHDRAWN',
  'EXPIRED',
  'UNKNOWN',
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Full acquisition lifecycle. Order is meaningful: it is the analyst funnel. */
export const PARCEL_STATUSES = [
  'DISCOVERED',
  'ENRICHING',
  'SCORED',
  'REJECTED',
  'WATCHLIST',
  'DUE_DILIGENCE',
  'READY_TO_BID',
  'APPROVED',
  'BID_PLACED',
  'WON',
  'LOST',
  'PURCHASE_PENDING',
  'ACQUIRED',
  'TITLE_CURATIVE',
  'READY_TO_LIST',
  'LISTED',
  'UNDER_CONTRACT',
  'SOLD',
  'ARCHIVED',
] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

/** Statuses at or beyond which the parcel is owned inventory, not a candidate. */
export const PORTFOLIO_STATUSES: readonly ParcelStatus[] = [
  'ACQUIRED',
  'TITLE_CURATIVE',
  'READY_TO_LIST',
  'LISTED',
  'UNDER_CONTRACT',
  'SOLD',
];

/** Statuses that keep a parcel in the live opportunity funnel. */
export const PIPELINE_STATUSES: readonly ParcelStatus[] = [
  'DISCOVERED',
  'ENRICHING',
  'SCORED',
  'WATCHLIST',
  'DUE_DILIGENCE',
  'READY_TO_BID',
  'APPROVED',
  'BID_PLACED',
];

export const ANALYST_DISPOSITIONS = [
  'UNREVIEWED',
  'PURSUE',
  'MONITOR',
  'PASS',
  'NEEDS_RESEARCH',
] as const;
export type AnalystDisposition = (typeof ANALYST_DISPOSITIONS)[number];

/**
 * Access classification.
 *
 * These describe the *strength of the evidence for access*, never a legal
 * conclusion. See `legalAccessStatus` for the separate legal track.
 */
export const ACCESS_CLASSES = ['A', 'B', 'C', 'D', 'UNKNOWN'] as const;
export type AccessClass = (typeof ACCESS_CLASSES)[number];

export const ACCESS_CLASS_LABELS: Record<AccessClass, string> = {
  A: 'Documented or strongly supported public-road access',
  B: 'Likely access; verification required',
  C: 'Questionable or private access',
  D: 'Apparently landlocked',
  UNKNOWN: 'Insufficient evidence to classify access',
};

/**
 * Legal access is a records question, not a map question. It stays UNKNOWN
 * until a recorded instrument has been reviewed by a human.
 */
export const LEGAL_ACCESS_STATUSES = [
  'UNKNOWN',
  'RECORDED_FRONTAGE',
  'RECORDED_EASEMENT',
  'PLATTED_ACCESS',
  'PRESCRIPTIVE_CLAIMED',
  'NO_RECORDED_ACCESS_FOUND',
  'DISPUTED',
] as const;
export type LegalAccessStatus = (typeof LEGAL_ACCESS_STATUSES)[number];

export const BUILDABILITY_RATINGS = ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'] as const;
export type BuildabilityRating = (typeof BUILDABILITY_RATINGS)[number];

export const CONFIDENCE_LEVELS = ['VERIFIED', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const RISK_BANDS = ['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'SEVERE'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

export const OWNER_TYPES = [
  'COUNTY',
  'CITY',
  'STATE',
  'FEDERAL',
  'LAND_BANK',
  'PRIVATE_INDIVIDUAL',
  'PRIVATE_ENTITY',
  'TRUST',
  'UNKNOWN',
] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

export const EXTRACTION_METHODS = [
  'STRUCTURED_API',
  'ARCGIS_QUERY',
  'CSV_COLUMN',
  'SPREADSHEET_CELL',
  'HTML_SELECTOR',
  'PDF_TEXT',
  'PDF_TABLE',
  'SPATIAL_JOIN',
  'DERIVED_CALCULATION',
  'ANALYST_ENTRY',
  'AI_EXTRACTION',
] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

/**
 * Extraction methods that may never, on their own, support a VERIFIED claim.
 * AI extraction in particular is always demoted — see `confidence.ts`.
 */
export const UNVERIFIABLE_EXTRACTION_METHODS: readonly ExtractionMethod[] = ['AI_EXTRACTION'];

export const USER_ROLES = ['ADMIN', 'ANALYST', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'OFFER',
  'NEGOTIATING',
  'CONTRACT',
  'CLOSED',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const TITLE_INSTRUMENT_TYPES = [
  'DEED',
  'MORTGAGE',
  'LIEN',
  'JUDGMENT',
  'EASEMENT',
  'RESTRICTIVE_COVENANT',
  'HOA_REFERENCE',
  'PROBATE_INDICATOR',
  'TAX_LIEN',
  'FEDERAL_LIEN',
  'OWNERSHIP_TRANSFER',
  'QUIET_TITLE_INDICATOR',
  'PLAT',
  'OTHER',
] as const;
export type TitleInstrumentType = (typeof TITLE_INSTRUMENT_TYPES)[number];

export const INGESTION_RUN_STATUSES = [
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'SKIPPED',
] as const;
export type IngestionRunStatus = (typeof INGESTION_RUN_STATUSES)[number];

export const CHANGE_KINDS = [
  'CREATED',
  'PRICE_CHANGED',
  'AUCTION_DATE_CHANGED',
  'SALE_STATUS_CHANGED',
  'ATTRIBUTES_CHANGED',
  'REAPPEARED',
  'REMOVED_FROM_SOURCE',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export const ALERT_CHANNELS = ['IN_APP', 'EMAIL', 'SMS'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const US_STATES_SUPPORTED = ['MN', 'FL', 'MI'] as const;
export type SupportedState = (typeof US_STATES_SUPPORTED)[number];
