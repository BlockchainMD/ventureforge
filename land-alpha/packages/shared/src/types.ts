import type {
  AccessClass,
  AnalystDisposition,
  BuildabilityRating,
  ConfidenceLevel,
  LegalAccessStatus,
  OwnerType,
  ParcelStatus,
  SaleStatus,
  SaleType,
  SourceType,
} from './enums';
import type { ParcelGeometry, Position } from './geo';
import type { EvidenceInput } from './provenance';
import type { UsdCents } from './money';

/**
 * `ParcelOpportunityInput` is the canonical contract every source adapter
 * normalises to. Adapters differ wildly; downstream engines see exactly this.
 *
 * Everything is optional except the identity fields, because government
 * inventories are sparse and a missing field must never be forged into a
 * default. `null` means "known absent"; `undefined` means "not looked at".
 */
export interface ParcelOpportunityInput {
  // ---- Identity ------------------------------------------------------------
  readonly sourceId: string;
  readonly sourceRecordId?: string | null;
  readonly sourceUrl?: string | null;
  readonly state: string;
  readonly county: string;
  readonly apn?: string | null;
  readonly alternateApns?: readonly string[];

  // ---- Sale ----------------------------------------------------------------
  readonly saleType?: SaleType;
  readonly saleStatus?: SaleStatus;
  readonly auctionDate?: Date | null;
  readonly offerDeadline?: Date | null;
  readonly minimumBid?: UsdCents | null;
  readonly askingPrice?: UsdCents | null;
  readonly taxesDue?: UsdCents | null;
  readonly fees?: UsdCents | null;
  readonly priorAuctionStatus?: string | null;
  readonly priorAuctionDate?: Date | null;
  readonly priorMinimumBid?: UsdCents | null;
  readonly failedSaleCount?: number | null;
  readonly otcEligible?: boolean | null;
  readonly acquisitionInstructions?: string | null;

  // ---- Geography -----------------------------------------------------------
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly geometry?: ParcelGeometry | null;
  readonly acreage?: number | null;
  readonly lotSquareFeet?: number | null;
  readonly municipality?: string | null;
  readonly zip?: string | null;
  readonly situsAddress?: string | null;
  readonly legalDescription?: string | null;

  // ---- Property ------------------------------------------------------------
  readonly assessedValue?: UsdCents | null;
  readonly taxableValue?: UsdCents | null;
  readonly landAssessedValue?: UsdCents | null;
  readonly improvementAssessedValue?: UsdCents | null;
  readonly propertyClass?: string | null;
  readonly isVacant?: boolean | null;
  readonly currentUse?: string | null;
  readonly zoning?: string | null;
  readonly zoningSource?: string | null;
  readonly annualTaxEstimate?: UsdCents | null;

  // ---- Ownership -----------------------------------------------------------
  readonly currentOwner?: string | null;
  readonly ownerType?: OwnerType | null;
  readonly governmentOwner?: string | null;
  readonly priorOwner?: string | null;
  readonly acquisitionDate?: Date | null;
  readonly lastDeedDate?: Date | null;

  // ---- Provenance ----------------------------------------------------------
  /** Evidence rows produced while parsing this record. */
  readonly evidence?: readonly EvidenceInput[];
  /** The untouched source row, retained verbatim for audit and re-parsing. */
  readonly rawRecord?: Record<string, unknown>;
  /** Storage key of the raw artefact (PDF/CSV/HTML) this row came from. */
  readonly rawArtifactKey?: string | null;
}

/** Geometry + shape analysis produced by `@land-alpha/gis`. */
export interface ShapeMetrics {
  readonly acreage: number;
  readonly areaSqMeters: number;
  readonly perimeterMeters: number;
  readonly centroid: Position;
  readonly bbox: [number, number, number, number];
  readonly widthMeters: number;
  readonly heightMeters: number;
  /** 4πA/P² — 1.0 is a circle, near 0 is a sliver. */
  readonly compactness: number;
  readonly aspectRatio: number;
  readonly vertexCount: number;
  readonly isNarrowStrip: boolean;
  readonly isSliver: boolean;
  readonly isIrregular: boolean;
  readonly isTinyParcel: boolean;
  readonly likelyRoadwayRemnant: boolean;
  readonly shapeScore: number;
  readonly flags: readonly string[];
}

/** Output of the Access Engine. Physical and legal tracks are kept apart. */
export interface AccessAssessment {
  readonly accessClass: AccessClass;
  readonly physicalAccessScore: number;
  readonly legalAccessStatus: LegalAccessStatus;
  readonly legalAccessConfidence: ConfidenceLevel;
  readonly touchesPublicRoad: boolean | null;
  readonly touchesNamedRoad: boolean | null;
  readonly roadFrontageMeters: number | null;
  readonly nearestRoadName: string | null;
  readonly nearestRoadMeters: number | null;
  readonly nearestPavedRoadName: string | null;
  readonly nearestPavedRoadMeters: number | null;
  readonly apparentDriveway: boolean | null;
  readonly potentiallyLandlocked: boolean;
  readonly evidence: readonly string[];
  readonly unknowns: readonly string[];
  readonly confidence: ConfidenceLevel;
}

export interface EnvironmentalAssessment {
  readonly floodZones: readonly string[];
  readonly floodOverlapFraction: number | null;
  readonly inSpecialFloodHazardArea: boolean | null;
  readonly wetlandTypes: readonly string[];
  readonly wetlandOverlapFraction: number | null;
  readonly soilSeries: readonly string[];
  readonly soilDrainageClasses: readonly string[];
  readonly hydricSoilFraction: number | null;
  readonly contaminatedSites: readonly ContaminatedSiteHit[];
  readonly nearestContaminatedSiteMeters: number | null;
  readonly meanElevationMeters: number | null;
  readonly minElevationMeters: number | null;
  readonly maxElevationMeters: number | null;
  readonly meanSlopePercent: number | null;
  readonly environmentalRiskScore: number;
  /**
   * Layers that actually returned data — FLOOD, WETLANDS, SOILS, CONTAMINATION,
   * TERRAIN. Absent from this list means unscreened, which is not the same as
   * clear and must never be rendered as clear.
   */
  readonly layersScreened: readonly string[];
  readonly evidence: readonly string[];
  readonly unknowns: readonly string[];
  readonly confidence: ConfidenceLevel;
}

export interface ContaminatedSiteHit {
  readonly program: 'SUPERFUND' | 'BROWNFIELD' | 'RCRA_CORRECTIVE' | 'STATE_CLEANUP' | 'OTHER';
  readonly name: string;
  readonly distanceMeters: number;
  readonly registryId?: string | null;
  readonly url?: string | null;
}

export interface BuildabilityAssessment {
  readonly rating: BuildabilityRating;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly unknowns: readonly string[];
  readonly blockingIssues: readonly string[];
  readonly requiresHumanVerification: readonly string[];
  readonly confidence: ConfidenceLevel;
}

export interface TitlePreScreen {
  readonly riskScore: number;
  readonly band: 'LOW' | 'MODERATE' | 'REVIEW_RECOMMENDED' | 'SUBSTANTIAL' | 'REJECT';
  readonly findings: readonly TitleFinding[];
  readonly chainDepth: number;
  readonly chainGaps: readonly string[];
  readonly unknowns: readonly string[];
  readonly requiresProfessionalReview: boolean;
  readonly confidence: ConfidenceLevel;
  readonly disclaimer: string;
}

export interface TitleFinding {
  readonly instrumentType: string;
  readonly severity: 'INFO' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'BLOCKING';
  readonly summary: string;
  readonly points: number;
  readonly evidenceRef?: string | null;
}

export interface ValuationEstimate {
  readonly low: UsdCents;
  readonly mid: UsdCents;
  readonly high: UsdCents;
  readonly confidence: ConfidenceLevel;
  readonly method: string;
  readonly notes?: string | null;
}

export interface ValuationResult {
  readonly retail: ValuationEstimate | null;
  readonly quickSale: ValuationEstimate | null;
  readonly investorLiquidation: ValuationEstimate | null;
  readonly compCount: number;
  readonly comps: readonly ComparableSummary[];
  readonly pricePerAcreUsed: UsdCents | null;
  readonly confidence: ConfidenceLevel;
  readonly warnings: readonly string[];
}

export interface ComparableSummary {
  readonly id: string;
  readonly apn: string | null;
  readonly saleDate: Date;
  readonly salePrice: UsdCents;
  readonly acreage: number;
  readonly distanceMeters: number | null;
  readonly pricePerAcre: UsdCents;
  readonly adjustedPricePerAcre: UsdCents;
  readonly weight: number;
  readonly adjustments: readonly { factor: string; multiplier: number; rationale: string }[];
  readonly source: string;
  /** True when this comparable is development fixture data, not a recorded sale. */
  readonly isFixture: boolean;
}

export interface OpportunityEconomics {
  readonly acquisitionPrice: UsdCents;
  /**
   * Whether `acquisitionPrice` is a published figure or a placeholder zero.
   * When false the basis is a floor covering closing and carrying costs only,
   * every ratio below is null, and the tier is UNKNOWN.
   */
  readonly priced: boolean;
  readonly governmentFees: UsdCents;
  readonly recordingCost: UsdCents;
  readonly titleCost: UsdCents;
  readonly curativeCost: UsdCents;
  readonly carryingCost: UsdCents;
  readonly marketingCost: UsdCents;
  readonly allInBasis: UsdCents;
  readonly basisToQsv: number | null;
  readonly basisToRetail: number | null;
  /**
   * The floor basis as a share of quick-sale value — always computed, because
   * it needs no acquisition price. When it already meets or exceeds 1, the
   * parcel is unbuyable at any price: the costs of owning it exceed what it is
   * worth before a cent has been paid for the land.
   */
  readonly basisFloorToQsv: number | null;
  readonly grossProfitAtQsv: UsdCents | null;
  readonly roiAtQsv: number | null;
  readonly annualizedRoiAtQsv: number | null;
  readonly expectedHoldDays: number;
  readonly tier: 'EXCEPTIONAL' | 'STRONG' | 'POTENTIAL' | 'WEAK' | 'UNKNOWN';
}

export interface ScoreBreakdownEntry {
  readonly key: string;
  readonly label: string;
  readonly weight: number;
  readonly rawScore: number;
  readonly weightedScore: number;
  readonly rationale: string;
  readonly confidence: ConfidenceLevel;
}

export interface RejectionReason {
  readonly rule: string;
  readonly explanation: string;
  readonly overridable: boolean;
}

export interface AlphaScoreResult {
  /**
   * Null when the parcel cannot be valued.
   *
   * The score is an estimate of return. Without a value estimate there is no
   * return to estimate, and a weighted mean over unknowns lands near the
   * neutral 50 — which is how a parcel nobody knows anything about outranks
   * one that has been assessed and found merely decent.
   */
  readonly alphaScore: number | null;
  readonly rejected: boolean;
  readonly rejectionReasons: readonly RejectionReason[];
  readonly breakdown: readonly ScoreBreakdownEntry[];
  readonly components: {
    readonly valueScore: number;
    readonly accessScore: number;
    readonly buildabilityScore: number;
    readonly titleSimplicityScore: number;
    readonly liquidityScore: number;
    readonly carryingCostScore: number;
    readonly shapeScore: number;
    readonly desirabilityScore: number;
  };
  readonly confidenceScore: number;
  readonly confidenceLevel: ConfidenceLevel;
  readonly whyInteresting: readonly string[];
  readonly remainingQuestions: readonly string[];
  readonly configVersion: string;
}

/** The row shape the opportunity table and decision card render from. */
export interface OpportunitySummary {
  readonly id: string;
  readonly state: string;
  readonly county: string;
  readonly apn: string | null;
  readonly acreage: number | null;
  readonly sourceName: string;
  readonly sourceType: SourceType;
  readonly askingPrice: UsdCents | null;
  readonly allInBasis: UsdCents | null;
  readonly quickSaleValue: UsdCents | null;
  readonly retailValue: UsdCents | null;
  readonly basisToQsv: number | null;
  readonly annualizedRoiAtQsv: number | null;
  readonly expectedHoldDays: number | null;
  readonly alphaScore: number | null;
  readonly accessClass: AccessClass | null;
  readonly buildability: BuildabilityRating | null;
  readonly titleRiskScore: number | null;
  readonly auctionDate: Date | null;
  readonly offerDeadline: Date | null;
  readonly status: ParcelStatus;
  readonly analystDisposition: AnalystDisposition;
  readonly watchlisted: boolean;
  readonly confidenceLevel: ConfidenceLevel | null;
}
