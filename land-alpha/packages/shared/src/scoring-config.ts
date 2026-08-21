/**
 * Scoring configuration: the tunable rules that decide what a parcel is worth
 * looking at.
 *
 * These live in `shared` rather than `db` because three very different
 * consumers need them: the scoring engine (Node), the admin screen that edits
 * the weights (browser), and the persistence layer that versions them.
 *
 * Configuration is versioned and immutable once used. Editing weights in place
 * would silently rewrite the meaning of every score ever recorded; instead,
 * saving new weights creates a new version, and every
 * `ParcelScoreSnapshot.configVersion` identifies the exact rules its score was
 * produced under. That is what keeps historical scores comparable — and what
 * makes the eventual "which mechanisms produce abnormal returns" question
 * answerable at all.
 */

export interface ScoringWeights {
  discountToQsv: number;
  access: number;
  buildability: number;
  titleSimplicity: number;
  liquidity: number;
  carryingCost: number;
  shape: number;
  desirability: number;
}

export interface ScoringThresholds {
  exceptionalBasisToQsv: number;
  strongBasisToQsv: number;
  potentialBasisToQsv: number;
  minAcreage: number;
  maxTitleRiskScore: number;
  minAlphaForAlert: number;
}

export interface CostModel {
  recordingCostCents: number;
  titleCostCents: number;
  curativeCostBaseCents: number;
  marketingCostRate: number;
  marketingCostMinCents: number;
  annualCarryRate: number;
  annualTaxFallbackCents: number;
  expectedHoldDays: number;
  quickSaleDiscountFromRetail: number;
  investorLiquidationDiscountFromRetail: number;
}

export interface RejectionRuleConfig {
  key: string;
  enabled: boolean;
  overridable: boolean;
  params?: Record<string, number | string | boolean>;
}

export interface ScoringConfigValue {
  version: string;
  weights: ScoringWeights;
  thresholds: ScoringThresholds;
  costModel: CostModel;
  rejectionRules: RejectionRuleConfig[];
}

/** The starting weights specified in the product brief. */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  discountToQsv: 0.3,
  access: 0.2,
  buildability: 0.15,
  titleSimplicity: 0.1,
  liquidity: 0.1,
  carryingCost: 0.05,
  shape: 0.05,
  desirability: 0.05,
};

export const DEFAULT_THRESHOLDS: ScoringThresholds = {
  exceptionalBasisToQsv: 0.1,
  strongBasisToQsv: 0.2,
  potentialBasisToQsv: 0.3,
  minAcreage: 0.08,
  maxTitleRiskScore: 80,
  minAlphaForAlert: 85,
};

/**
 * Cost assumptions. These are deliberately conservative: over-estimating basis
 * loses a marginal deal, under-estimating it loses money.
 */
export const DEFAULT_COST_MODEL: CostModel = {
  recordingCostCents: 6_000, //     $60 — deed recording and transfer stamps
  titleCostCents: 45_000, //       $450 — search plus owner's policy on a cheap parcel
  curativeCostBaseCents: 0, //       $0 — added per finding by the title pre-screen
  marketingCostRate: 0.06, //        6% of resale price
  marketingCostMinCents: 25_000, // $250 — photography, listing fees, signage floor
  annualCarryRate: 0.03, //          3%/yr of basis: insurance, mowing, admin
  annualTaxFallbackCents: 12_000, //$120 — used only when no tax figure is known
  expectedHoldDays: 180,
  quickSaleDiscountFromRetail: 0.25,
  investorLiquidationDiscountFromRetail: 0.5,
};

export const DEFAULT_REJECTION_RULES: RejectionRuleConfig[] = [
  { key: 'ROADWAY_REMNANT', enabled: true, overridable: true },
  {
    key: 'NO_ACCESS_WITHOUT_EXCEPTIONAL_DISCOUNT',
    enabled: true,
    overridable: true,
    params: { maxBasisToQsv: 0.08 },
  },
  { key: 'BASIS_EXCEEDS_QSV', enabled: true, overridable: true },
  { key: 'SEVERE_TITLE_RISK', enabled: true, overridable: true, params: { threshold: 80 } },
  { key: 'CONTAMINATED_SITE', enabled: true, overridable: true, params: { distanceMeters: 150 } },
  { key: 'PARCEL_TOO_SMALL', enabled: true, overridable: true, params: { minAcreage: 0.08 } },
  { key: 'DUPLICATE_PARCEL', enabled: true, overridable: false },
  {
    key: 'SUBMERGED_OR_FULL_WETLAND',
    enabled: true,
    overridable: true,
    params: { fraction: 0.95 },
  },
];

export const DEFAULT_SCORING_CONFIG: ScoringConfigValue = {
  version: 'v1',
  weights: DEFAULT_WEIGHTS,
  thresholds: DEFAULT_THRESHOLDS,
  costModel: DEFAULT_COST_MODEL,
  rejectionRules: DEFAULT_REJECTION_RULES,
};
