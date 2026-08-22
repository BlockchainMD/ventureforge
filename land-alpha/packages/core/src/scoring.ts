import {
  aggregateConfidence,
  levelFromScore,
  type AccessAssessment,
  type AlphaScoreResult,
  type BuildabilityAssessment,
  type ConfidenceLevel,
  type EnvironmentalAssessment,
  type OpportunityEconomics,
  type RejectionReason,
  type ScoreBreakdownEntry,
  type ShapeMetrics,
  type TitlePreScreen,
  type ValuationResult,
} from '@land-alpha/shared';
import type { RejectionRuleConfig, ScoringConfigValue } from '@land-alpha/shared';
import type { LiquidityEstimate } from '@land-alpha/valuation';

/**
 * The Alpha Score.
 *
 * One number, 0-100, answering: *how attractive is this parcel relative to
 * everything else we could spend attention on?*
 *
 * Two design commitments make it trustworthy:
 *
 *  1. **Rejection happens before scoring, not through it.** A landlocked
 *     roadway remnant must not be able to score 71 because its price is low.
 *     Hard rules produce a binary reject with a named reason, and rejected
 *     parcels leave the funnel. The brief's optimisation objective — actionable
 *     parcels per hour of analyst attention, not parcels collected — is
 *     implemented here.
 *
 *  2. **Unknowns are visible, not silently averaged.** A component with no data
 *     scores at a neutral value *and* drags the confidence score down, so an
 *     87-with-LOW-confidence never masquerades as an 87.
 */

export interface ScoringInputs {
  readonly economics: OpportunityEconomics | null;
  readonly valuation: ValuationResult | null;
  readonly access: AccessAssessment | null;
  readonly buildability: BuildabilityAssessment | null;
  readonly title: TitlePreScreen | null;
  readonly environmental: EnvironmentalAssessment | null;
  readonly shape: ShapeMetrics | null;
  readonly acreage: number | null;
  readonly failedSaleCount: number;
  readonly isStandingInventory: boolean;
  readonly daysOnSource: number | null;
  readonly hasDuplicate: boolean;
  /**
   * Whether the parcel is bare land, per the assessing authority — not per the
   * list that offered it for sale. `null` means nobody has said.
   */
  readonly isVacant: boolean | null;
  /**
   * How long this is expected to take to sell, from the liquidity engine.
   * Return is annualised, so this is not a detail — it is half the answer.
   */
  readonly liquidity: LiquidityEstimate | null;
  readonly analystOverride?: { readonly rule: string; readonly by: string } | null;
}

const NEUTRAL = 50;

export function scoreParcel(inputs: ScoringInputs, config: ScoringConfigValue): AlphaScoreResult {
  const rejectionReasons = evaluateRejectionRules(inputs, config);
  const overriddenRule = inputs.analystOverride?.rule;
  const effectiveRejections = rejectionReasons.filter(
    (reason) => !(reason.overridable && reason.rule === overriddenRule),
  );

  const breakdown: ScoreBreakdownEntry[] = [];
  const push = (
    key: string,
    label: string,
    weight: number,
    rawScore: number,
    rationale: string,
    confidence: ConfidenceLevel,
  ): void => {
    breakdown.push({
      key,
      label,
      weight,
      rawScore: clamp(rawScore),
      weightedScore: clamp(rawScore) * weight,
      rationale,
      confidence,
    });
  };

  // ---- 30% Discount to conservative quick-sale value -----------------------
  const value = scoreDiscountToQsv(inputs, config);
  push(
    'discountToQsv',
    'Discount to quick-sale value',
    config.weights.discountToQsv,
    value.score,
    value.rationale,
    value.confidence,
  );

  // ---- 20% Access -----------------------------------------------------------
  const access = scoreAccess(inputs.access);
  push(
    'access',
    'Access',
    config.weights.access,
    access.score,
    access.rationale,
    access.confidence,
  );

  // ---- 15% Buildability ------------------------------------------------------
  const buildability = scoreBuildability(inputs.buildability);
  push(
    'buildability',
    'Buildability',
    config.weights.buildability,
    buildability.score,
    buildability.rationale,
    buildability.confidence,
  );

  // ---- 10% Title simplicity --------------------------------------------------
  const title = scoreTitleSimplicity(inputs.title);
  push(
    'titleSimplicity',
    'Title simplicity',
    config.weights.titleSimplicity,
    title.score,
    title.rationale,
    title.confidence,
  );

  // ---- 10% Liquidity ---------------------------------------------------------
  const liquidity = scoreLiquidity(inputs);
  push(
    'liquidity',
    'Liquidity',
    config.weights.liquidity,
    liquidity.score,
    liquidity.rationale,
    liquidity.confidence,
  );

  // ---- 5% Carrying cost ------------------------------------------------------
  const carrying = scoreCarryingCost(inputs.economics);
  push(
    'carryingCost',
    'Carrying cost',
    config.weights.carryingCost,
    carrying.score,
    carrying.rationale,
    carrying.confidence,
  );

  // ---- 5% Shape / topography -------------------------------------------------
  const shape = scoreShape(inputs);
  push(
    'shape',
    'Shape and topography',
    config.weights.shape,
    shape.score,
    shape.rationale,
    shape.confidence,
  );

  // ---- 5% Unique desirability -------------------------------------------------
  const desirability = scoreDesirability(inputs);
  push(
    'desirability',
    'Unique desirability',
    config.weights.desirability,
    desirability.score,
    desirability.rationale,
    desirability.confidence,
  );

  const weightSum = breakdown.reduce((sum, entry) => sum + entry.weight, 0);
  const rawAlpha =
    weightSum === 0
      ? 0
      : breakdown.reduce((sum, entry) => sum + entry.weightedScore, 0) / weightSum;

  const confidence = aggregateConfidence(
    breakdown.map((entry) => ({
      field: entry.key,
      level: entry.confidence,
      weight: entry.weight,
    })),
  );

  const rejected = effectiveRejections.length > 0;

  // A parcel with no value estimate is not a mediocre opportunity; it is an
  // unmeasured one. Every component that depends on value scores neutral, the
  // weighted mean lands near 50, and it outranks a parcel that has actually
  // been assessed and found ordinary. Unranked is the honest answer, and it
  // keeps the buy list made of parcels somebody could act on.
  const valuable = inputs.valuation?.quickSale != null || inputs.valuation?.retail != null;

  return {
    alphaScore: rejected ? 0 : valuable ? Math.round(rawAlpha) : null,
    rejected,
    rejectionReasons: effectiveRejections,
    breakdown,
    components: {
      valueScore: clamp(value.score),
      accessScore: clamp(access.score),
      buildabilityScore: clamp(buildability.score),
      titleSimplicityScore: clamp(title.score),
      liquidityScore: clamp(liquidity.score),
      carryingCostScore: clamp(carrying.score),
      shapeScore: clamp(shape.score),
      desirabilityScore: clamp(desirability.score),
    },
    confidenceScore: confidence.score,
    confidenceLevel: levelFromScore(confidence.score),
    whyInteresting: buildWhyInteresting(inputs, breakdown),
    remainingQuestions: buildRemainingQuestions(inputs),
    configVersion: config.version,
  };
}

// ===========================================================================
// Component scoring
// ===========================================================================

interface ComponentScore {
  score: number;
  rationale: string;
  confidence: ConfidenceLevel;
}

/**
 * The headline component. Maps basis/QSV onto 0-100 with the brief's tiers as
 * anchor points: 10% -> 100, 20% -> 80, 30% -> 60, 100% -> 0.
 */
function scoreDiscountToQsv(inputs: ScoringInputs, config: ScoringConfigValue): ComponentScore {
  const economics = inputs.economics;
  if (!economics || economics.basisToQsv == null) {
    // Two different gaps produce the same null, and an analyst can act on one
    // of them in an afternoon: a missing price is a phone call to the
    // Comptroller, a missing quick-sale value needs comparable sales that may
    // not exist. Saying which is missing is the difference between a queue
    // someone works and a queue someone ignores.
    const missing =
      economics == null
        ? 'Neither an acquisition price nor a quick-sale value has been established'
        : !economics.priced && inputs.valuation?.quickSale != null
          ? 'No acquisition price has been obtained for this parcel, so the discount cannot be computed'
          : 'No quick-sale value could be established, so the discount is unknown';
    return {
      score: NEUTRAL,
      rationale: `${missing}.`,
      confidence: 'UNKNOWN',
    };
  }

  const ratio = economics.basisToQsv;
  const {
    exceptionalBasisToQsv: exceptional,
    strongBasisToQsv: strong,
    potentialBasisToQsv: potential,
  } = config.thresholds;

  let score: number;
  if (ratio <= exceptional) {
    // Below the exceptional threshold, keep rewarding but with diminishing returns.
    score = 100 - Math.max(0, (ratio / exceptional) * 8 - 8);
    score = Math.min(100, 92 + (1 - ratio / Math.max(exceptional, 1e-6)) * 8);
  } else if (ratio <= strong) {
    score = interpolate(ratio, exceptional, strong, 92, 80);
  } else if (ratio <= potential) {
    score = interpolate(ratio, strong, potential, 80, 60);
  } else if (ratio <= 1) {
    score = interpolate(ratio, potential, 1, 60, 0);
  } else {
    score = 0;
  }

  return {
    score,
    rationale: `All-in basis is ${(ratio * 100).toFixed(1)}% of quick-sale value (${economics.tier.toLowerCase()}).`,
    confidence: inputs.valuation?.confidence ?? 'UNKNOWN',
  };
}

function scoreAccess(access: AccessAssessment | null): ComponentScore {
  if (!access || access.accessClass === 'UNKNOWN') {
    return {
      score: NEUTRAL * 0.6,
      rationale: 'Access could not be assessed from available data.',
      confidence: 'UNKNOWN',
    };
  }
  const base: Record<string, number> = { A: 95, B: 72, C: 38, D: 5 };
  let score = base[access.accessClass] ?? NEUTRAL;

  // Verified legal access is worth more than the same physical picture without it.
  if (
    access.legalAccessStatus === 'RECORDED_FRONTAGE' ||
    access.legalAccessStatus === 'RECORDED_EASEMENT' ||
    access.legalAccessStatus === 'PLATTED_ACCESS'
  ) {
    score = Math.min(100, score + 5);
  }
  if (access.nearestPavedRoadMeters != null && access.nearestPavedRoadMeters > 8000) {
    score -= 8;
  }

  return {
    score,
    rationale: `Access class ${access.accessClass}${
      access.roadFrontageMeters ? `, ~${access.roadFrontageMeters} m of measured frontage` : ''
    }; legal access ${access.legalAccessStatus === 'UNKNOWN' ? 'unverified' : access.legalAccessStatus.toLowerCase().replace(/_/g, ' ')}.`,
    confidence: access.confidence,
  };
}

function scoreBuildability(buildability: BuildabilityAssessment | null): ComponentScore {
  if (!buildability || buildability.rating === 'UNKNOWN') {
    return {
      score: NEUTRAL * 0.7,
      rationale: 'Buildability could not be screened from available data.',
      confidence: 'UNKNOWN',
    };
  }
  return {
    score: buildability.score,
    rationale: `Screened ${buildability.rating}${
      buildability.blockingIssues.length ? `: ${buildability.blockingIssues[0]}` : ''
    }`,
    confidence: buildability.confidence,
  };
}

function scoreTitleSimplicity(title: TitlePreScreen | null): ComponentScore {
  if (!title) {
    return {
      score: NEUTRAL,
      rationale: 'No title pre-screen has been run.',
      confidence: 'UNKNOWN',
    };
  }
  return {
    score: 100 - title.riskScore,
    rationale: `Title pre-screen risk ${title.riskScore}/100 (${title.band.toLowerCase().replace(/_/g, ' ')}).`,
    confidence: title.confidence,
  };
}

/**
 * Liquidity: how readily this can be resold. Driven by size (small rural
 * parcels have the deepest buyer pool), access, comp density and price point.
 */
/**
 * Liquidity, scored from the hold estimate rather than re-derived here.
 *
 * This component used to approximate time-to-sell from comp counts, acreage and
 * access — the same signals the liquidity engine now weighs properly. Two
 * estimates of the same thing drift apart, and the one an analyst reads on the
 * parcel page should be the one the score is built from, so this reads that
 * estimate and nothing else.
 *
 * The scale is anchored on the baseline hold: a parcel expected to sell in the
 * baseline period scores neutral, faster scores above, slower below.
 */
function scoreLiquidity(inputs: ScoringInputs): ComponentScore {
  const estimate = inputs.liquidity;
  if (!estimate) {
    return {
      score: NEUTRAL,
      rationale: 'Time to sell has not been estimated.',
      confidence: 'UNKNOWN',
    };
  }

  const { holdDays, baselineDays } = estimate;
  // A parcel twice as slow as baseline scores 0; one half as slow scores 100.
  const ratio = baselineDays > 0 ? holdDays / baselineDays : 1;
  const score = clamp(NEUTRAL + (1 - ratio) * 100);

  const drivers = [...estimate.factors]
    .filter((factor) => Math.abs(factor.multiplier - 1) > 0.01)
    .sort((a, b) => Math.abs(b.multiplier - 1) - Math.abs(a.multiplier - 1))
    .slice(0, 2)
    .map((factor) => factor.rationale.replace(/\.$/, ''));

  const months = (holdDays / 30.4).toFixed(1);
  const rationale = drivers.length
    ? `Expected to sell in about ${months} months. ${capitalize(drivers.join('; '))}.`
    : `Expected to sell in about ${months} months.`;

  return { score, rationale, confidence: estimate.confidence };
}

function scoreCarryingCost(economics: OpportunityEconomics | null): ComponentScore {
  if (!economics) {
    return { score: NEUTRAL, rationale: 'Carrying cost not modelled.', confidence: 'UNKNOWN' };
  }
  const share = economics.allInBasis > 0 ? economics.carryingCost / economics.allInBasis : 0;
  // 0% of basis -> 100, 25% of basis -> 0.
  const score = clamp(100 - share * 400);
  return {
    score,
    rationale: `Estimated carrying cost is ${(share * 100).toFixed(1)}% of all-in basis over ${economics.expectedHoldDays} days.`,
    confidence: 'MEDIUM',
  };
}

function scoreShape(inputs: ScoringInputs): ComponentScore {
  if (!inputs.shape) {
    return {
      score: NEUTRAL * 0.8,
      rationale: 'No parcel geometry available, so shape could not be evaluated.',
      confidence: 'UNKNOWN',
    };
  }
  let score = inputs.shape.shapeScore;
  const slope = inputs.environmental?.meanSlopePercent ?? null;
  if (slope != null) {
    if (slope > 25) score -= 25;
    else if (slope > 15) score -= 12;
  }
  return {
    score,
    rationale: `Compactness ${inputs.shape.compactness.toFixed(2)}, aspect ratio ${inputs.shape.aspectRatio.toFixed(1)}${
      slope != null ? `, mean slope ${slope.toFixed(0)}%` : ''
    }.`,
    confidence: slope == null ? 'MEDIUM' : 'HIGH',
  };
}

/**
 * Unique desirability. This is where the Land Alpha thesis is scored directly:
 * inventory that failed at auction and rolled into standing over-the-counter
 * stock is, by construction, inventory that nobody else is competing for.
 */
function scoreDesirability(inputs: ScoringInputs): ComponentScore {
  const notes: string[] = [];
  let score = NEUTRAL;

  if (inputs.failedSaleCount >= 2) {
    score += 22;
    notes.push(`${inputs.failedSaleCount} prior failed sales — competition is minimal`);
  } else if (inputs.failedSaleCount === 1) {
    score += 12;
    notes.push('one prior failed sale');
  }

  if (inputs.isStandingInventory) {
    score += 15;
    notes.push('available over the counter rather than at a contested auction');
  }

  if (inputs.daysOnSource != null && inputs.daysOnSource > 365) {
    score += 8;
    notes.push(`listed for ${Math.round(inputs.daysOnSource / 30)} months`);
  }

  if (inputs.environmental?.environmentalRiskScore != null) {
    if (inputs.environmental.environmentalRiskScore <= 10) {
      score += 8;
      notes.push('no material environmental constraints identified');
    } else if (inputs.environmental.environmentalRiskScore >= 60) {
      score -= 20;
      notes.push('significant environmental constraints');
    }
  }

  return {
    score,
    rationale: notes.length
      ? capitalize(notes.join('; ')) + '.'
      : 'No distinguishing characteristics identified.',
    confidence: 'MEDIUM',
  };
}

// ===========================================================================
// Rejection rules
// ===========================================================================

/**
 * Hard rejections. These are not score penalties — they remove a parcel from
 * the funnel entirely, because analyst attention is the scarce resource.
 */
export function evaluateRejectionRules(
  inputs: ScoringInputs,
  config: ScoringConfigValue,
): RejectionReason[] {
  const reasons: RejectionReason[] = [];
  const rules = new Map(config.rejectionRules.map((rule) => [rule.key, rule]));

  const enabled = (key: string): RejectionRuleConfig | null => {
    const rule = rules.get(key);
    return rule?.enabled ? rule : null;
  };

  const roadwayRule = enabled('ROADWAY_REMNANT');
  if (roadwayRule && inputs.shape?.likelyRoadwayRemnant) {
    reasons.push({
      rule: 'ROADWAY_REMNANT',
      explanation:
        'Parcel geometry matches a roadway or right-of-way remnant: long, narrow and of near-uniform width.',
      overridable: roadwayRule.overridable,
    });
  }

  const accessRule = enabled('NO_ACCESS_WITHOUT_EXCEPTIONAL_DISCOUNT');
  if (accessRule && inputs.access?.accessClass === 'D') {
    const threshold = Number(accessRule.params?.maxBasisToQsv ?? 0.08);
    const ratio = inputs.economics?.basisToQsv;
    // A landlocked parcel is only worth a look at a genuinely exceptional
    // discount, because the exit is to an adjoining owner and nobody else.
    if (ratio == null || ratio > threshold) {
      reasons.push({
        rule: 'NO_ACCESS_WITHOUT_EXCEPTIONAL_DISCOUNT',
        explanation:
          ratio == null
            ? 'Parcel appears landlocked and no valuation exists to justify the risk.'
            : `Parcel appears landlocked and the discount (basis at ${(ratio * 100).toFixed(0)}% of QSV) does not clear the ${(threshold * 100).toFixed(0)}% threshold required for a landlocked parcel.`,
        overridable: accessRule.overridable,
      });
    }
  }

  const basisRule = enabled('BASIS_EXCEEDS_QSV');
  if (basisRule && inputs.economics != null) {
    // With a price, this is the real ratio. Without one, the floor — closing
    // and carrying costs alone — is enough to decide: if owning the parcel
    // already costs more than it is worth before paying for the land, no
    // acquisition price makes it work, so the rule fires on the floor too.
    const { basisToQsv, basisFloorToQsv } = inputs.economics;
    if (basisToQsv != null && basisToQsv >= 1) {
      reasons.push({
        rule: 'BASIS_EXCEEDS_QSV',
        explanation: `All-in basis (${(basisToQsv * 100).toFixed(0)}% of quick-sale value) meets or exceeds what the parcel is worth.`,
        overridable: basisRule.overridable,
      });
    } else if (basisToQsv == null && basisFloorToQsv != null && basisFloorToQsv >= 1) {
      reasons.push({
        rule: 'BASIS_EXCEEDS_QSV',
        explanation: `Before any acquisition price, the cost of closing and holding this parcel is already ${(basisFloorToQsv * 100).toFixed(0)}% of its quick-sale value. No purchase price makes it profitable.`,
        overridable: basisRule.overridable,
      });
    }
  }

  const titleRule = enabled('SEVERE_TITLE_RISK');
  if (titleRule && inputs.title) {
    const threshold = Number(titleRule.params?.threshold ?? 80);
    if (inputs.title.riskScore >= threshold) {
      reasons.push({
        rule: 'SEVERE_TITLE_RISK',
        explanation: `Title pre-screen risk of ${inputs.title.riskScore}/100 exceeds the ${threshold} rejection threshold.`,
        overridable: titleRule.overridable,
      });
    }
  }

  const contaminationRule = enabled('CONTAMINATED_SITE');
  if (contaminationRule && inputs.environmental?.nearestContaminatedSiteMeters != null) {
    const distance = Number(contaminationRule.params?.distanceMeters ?? 150);
    if (inputs.environmental.nearestContaminatedSiteMeters < distance) {
      reasons.push({
        rule: 'CONTAMINATED_SITE',
        explanation: `A regulated cleanup site lies ~${Math.round(inputs.environmental.nearestContaminatedSiteMeters)} m away, inside the ${distance} m rejection radius. Requires explicit analyst override.`,
        overridable: contaminationRule.overridable,
      });
    }
  }

  const sizeRule = enabled('PARCEL_TOO_SMALL');
  if (sizeRule && inputs.acreage != null) {
    const minAcreage = Number(sizeRule.params?.minAcreage ?? config.thresholds.minAcreage);
    if (inputs.acreage < minAcreage) {
      reasons.push({
        rule: 'PARCEL_TOO_SMALL',
        explanation: `Parcel is ${inputs.acreage.toFixed(3)} ac, below the ${minAcreage} ac minimum for a plausible independent use.`,
        overridable: sizeRule.overridable,
      });
    }
  }

  const improvementRule = enabled('IMPROVEMENTS_PRESENT');
  if (improvementRule && inputs.isVacant === false) {
    reasons.push({
      rule: 'IMPROVEMENTS_PRESENT',
      // A structure on a tax-forfeited parcel is a liability, not a bonus. It
      // carries demolition cost, code enforcement exposure and often an
      // occupant, and none of that is priced by a vacant-land comparable. The
      // county's list says what is being sold; the assessment roll says what is
      // on it, and where they disagree the roll is the one that inspected it.
      explanation:
        'The assessment roll records a building on this parcel, so it is not the vacant land the sale list describes.',
      overridable: improvementRule.overridable,
    });
  }

  const duplicateRule = enabled('DUPLICATE_PARCEL');
  if (duplicateRule && inputs.hasDuplicate) {
    reasons.push({
      rule: 'DUPLICATE_PARCEL',
      explanation: 'Another parcel record covers substantially the same ground.',
      overridable: duplicateRule.overridable,
    });
  }

  const wetlandRule = enabled('SUBMERGED_OR_FULL_WETLAND');
  if (wetlandRule && inputs.environmental?.wetlandOverlapFraction != null) {
    const fraction = Number(wetlandRule.params?.fraction ?? 0.95);
    if (inputs.environmental.wetlandOverlapFraction >= fraction) {
      reasons.push({
        rule: 'SUBMERGED_OR_FULL_WETLAND',
        explanation: `Approximately ${Math.round(inputs.environmental.wetlandOverlapFraction * 100)}% of the parcel is mapped wetland or open water.`,
        overridable: wetlandRule.overridable,
      });
    }
  }

  return reasons;
}

// ===========================================================================
// Narrative
// ===========================================================================

function buildWhyInteresting(
  inputs: ScoringInputs,
  breakdown: readonly ScoreBreakdownEntry[],
): string[] {
  const points: string[] = [];

  if (inputs.failedSaleCount > 0) {
    points.push(
      inputs.failedSaleCount === 1
        ? 'failed a prior auction'
        : `failed ${inputs.failedSaleCount} prior auctions`,
    );
  }
  if (inputs.isStandingInventory)
    points.push('over-the-counter acquisition, no auction competition');

  const economics = inputs.economics;
  if (economics?.basisToQsv != null && economics.basisToQsv <= 0.3) {
    points.push(
      `all-in basis is ${(economics.basisToQsv * 100).toFixed(0)}% of conservative quick-sale value`,
    );
  }
  if (inputs.valuation && inputs.valuation.compCount >= 5) {
    points.push(`${inputs.valuation.compCount} recorded comparable sales support the valuation`);
  }
  if (inputs.access?.accessClass === 'A') points.push('apparent public-road frontage');
  else if (inputs.access?.accessClass === 'B') points.push('appears to adjoin a mapped road');
  if (inputs.shape && !inputs.shape.isIrregular && !inputs.shape.isNarrowStrip) {
    points.push('conventional parcel geometry');
  }
  if (
    inputs.environmental?.environmentalRiskScore != null &&
    inputs.environmental.environmentalRiskScore <= 10
  ) {
    points.push('no material environmental constraints identified');
  }
  if (inputs.daysOnSource != null && inputs.daysOnSource > 540) {
    points.push('stale inventory that has sat unsold for over 18 months');
  }

  if (points.length === 0) {
    const best = [...breakdown].sort((a, b) => b.rawScore - a.rawScore)[0];
    if (best) points.push(best.rationale.toLowerCase().replace(/\.$/, ''));
  }
  return points;
}

function buildRemainingQuestions(inputs: ScoringInputs): string[] {
  const questions: string[] = [];
  if (inputs.access?.legalAccessStatus === 'UNKNOWN') {
    questions.push('Verify recorded legal access');
  }
  if (inputs.buildability) {
    questions.push(...inputs.buildability.requiresHumanVerification.slice(0, 3));
  }
  if (inputs.title?.requiresProfessionalReview) {
    questions.push('Title company review before bidding');
  }
  if (inputs.valuation && inputs.valuation.compCount < 3) {
    questions.push('Confirm value against local sales — comparable data is thin');
  }
  if (inputs.environmental?.confidence === 'UNKNOWN') {
    questions.push('Run environmental screening — no public layers were available');
  }
  return [...new Set(questions)].slice(0, 6);
}

// ===========================================================================

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function interpolate(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number {
  if (fromHigh === fromLow) return toLow;
  const fraction = (value - fromLow) / (fromHigh - fromLow);
  return toLow + (toHigh - toLow) * fraction;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
