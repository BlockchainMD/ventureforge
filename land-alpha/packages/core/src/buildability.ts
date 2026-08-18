import {
  minConfidence,
  type AccessAssessment,
  type BuildabilityAssessment,
  type BuildabilityRating,
  type ConfidenceLevel,
  type EnvironmentalAssessment,
  type ShapeMetrics,
} from '@land-alpha/shared';

/**
 * The Buildability Engine.
 *
 * Buildability here is a **screening conclusion**, never a determination. No
 * software can tell you a parcel is buildable; only a county can, through
 * zoning verification, a septic permit and a building permit.
 *
 * What this engine can do — and what makes it worth having — is separate three
 * things that a raw data dump conflates:
 *
 *   reasons          what the evidence supports
 *   unknowns         what we have not established
 *   blockingIssues   what would stop a build regardless of the unknowns
 *
 * A GREEN with four unknowns is a different object from a GREEN with none, and
 * the output makes that legible rather than collapsing it into a colour.
 */

export interface ZoningContext {
  readonly code: string | null;
  readonly description: string | null;
  readonly minimumLotSizeAcres: number | null;
  readonly minimumFrontageMeters: number | null;
  readonly residentialUseAllowed: boolean | null;
  readonly source: string | null;
  readonly confidence: ConfidenceLevel;
}

export interface UtilityContext {
  readonly publicWaterAvailable: boolean | null;
  readonly publicSewerAvailable: boolean | null;
  readonly electricNearby: boolean | null;
  readonly source: string | null;
}

export interface BuildabilityInputs {
  readonly acreage: number | null;
  readonly shape: ShapeMetrics | null;
  readonly access: AccessAssessment;
  readonly environmental: EnvironmentalAssessment;
  readonly zoning: ZoningContext;
  readonly utilities: UtilityContext;
}

export function assessBuildability(inputs: BuildabilityInputs): BuildabilityAssessment {
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const blockingIssues: string[] = [];
  const requiresHumanVerification: string[] = [];
  let confidence: ConfidenceLevel = 'MEDIUM';

  // ---- Hard blockers -------------------------------------------------------

  if (inputs.shape?.likelyRoadwayRemnant) {
    blockingIssues.push(
      'Parcel geometry matches a roadway or right-of-way remnant: long, narrow and of near-uniform width.',
    );
  }

  if (inputs.access.accessClass === 'D') {
    blockingIssues.push(
      'No mapped road adjoins the parcel. Without a recorded easement, there is no way to reach it and nothing can be permitted.',
    );
  }

  if (
    inputs.environmental.wetlandOverlapFraction != null &&
    inputs.environmental.wetlandOverlapFraction >= 0.9
  ) {
    blockingIssues.push(
      `Approximately ${Math.round(inputs.environmental.wetlandOverlapFraction * 100)}% of the parcel is mapped as wetland, leaving no practical upland building area.`,
    );
  }

  if (
    inputs.environmental.floodOverlapFraction != null &&
    inputs.environmental.floodOverlapFraction >= 0.95 &&
    inputs.environmental.inSpecialFloodHazardArea === true
  ) {
    blockingIssues.push(
      'Effectively the entire parcel lies within a mapped Special Flood Hazard Area.',
    );
  }

  if (
    inputs.acreage != null &&
    inputs.zoning.minimumLotSizeAcres != null &&
    inputs.acreage < inputs.zoning.minimumLotSizeAcres * 0.999
  ) {
    // Substandard lots are sometimes grandfathered — a real and common
    // exception, so this blocks the screening conclusion but is stated as
    // something to verify rather than as a settled fact.
    blockingIssues.push(
      `Parcel is ${inputs.acreage.toFixed(2)} ac against an apparent zoning minimum of ${inputs.zoning.minimumLotSizeAcres.toFixed(2)} ac in ${inputs.zoning.code ?? 'the mapped zone'}.`,
    );
    requiresHumanVerification.push(
      'Whether this substandard lot qualifies as a grandfathered lot of record under the local ordinance.',
    );
  }

  if (inputs.zoning.residentialUseAllowed === false) {
    blockingIssues.push(
      `Mapped zoning ${inputs.zoning.code ?? ''} does not appear to permit residential use.`.trim(),
    );
  }

  // ---- Supporting evidence -------------------------------------------------

  if (inputs.acreage != null) {
    if (inputs.zoning.minimumLotSizeAcres != null && inputs.acreage >= inputs.zoning.minimumLotSizeAcres) {
      reasons.push(
        `Acreage (${inputs.acreage.toFixed(2)} ac) meets the apparent zoning minimum of ${inputs.zoning.minimumLotSizeAcres.toFixed(2)} ac.`,
      );
    } else if (inputs.zoning.minimumLotSizeAcres == null && inputs.acreage >= 1) {
      reasons.push(`Parcel size (${inputs.acreage.toFixed(2)} ac) is typical for rural residential use.`);
    }
  } else {
    unknowns.push('Parcel acreage is unknown.');
  }

  if (inputs.access.accessClass === 'A') {
    reasons.push('Parcel appears to front a public road.');
  } else if (inputs.access.accessClass === 'B') {
    reasons.push('Parcel appears to adjoin a mapped road; the road’s status is not confirmed.');
  }

  if (inputs.environmental.inSpecialFloodHazardArea === false) {
    reasons.push('No mapped Special Flood Hazard Area intersects the parcel.');
  }
  if (
    inputs.environmental.wetlandTypes.length === 0 &&
    inputs.environmental.confidence !== 'UNKNOWN'
  ) {
    reasons.push('No National Wetlands Inventory wetlands were identified on the parcel.');
  }

  if (inputs.shape && !inputs.shape.isNarrowStrip && !inputs.shape.isSliver) {
    reasons.push('Parcel geometry is conventional and can accommodate a building envelope.');
  }

  if (inputs.utilities.publicWaterAvailable === true && inputs.utilities.publicSewerAvailable === true) {
    reasons.push('Public water and sewer appear to be available.');
  }

  // ---- Partial constraints (degrade, not block) ----------------------------

  const partialConstraints: string[] = [];

  if (
    inputs.environmental.inSpecialFloodHazardArea === true &&
    !blockingIssues.some((issue) => issue.includes('Flood') || issue.includes('Special Flood'))
  ) {
    partialConstraints.push(
      `Part of the parcel lies in a Special Flood Hazard Area${
        inputs.environmental.floodOverlapFraction != null
          ? ` (~${Math.round(inputs.environmental.floodOverlapFraction * 100)}% of area)`
          : ''
      }.`,
    );
  }

  if (
    inputs.environmental.wetlandTypes.length > 0 &&
    (inputs.environmental.wetlandOverlapFraction == null ||
      inputs.environmental.wetlandOverlapFraction < 0.9)
  ) {
    partialConstraints.push(
      `Mapped wetlands cover part of the parcel${
        inputs.environmental.wetlandOverlapFraction != null
          ? ` (~${Math.round(inputs.environmental.wetlandOverlapFraction * 100)}% of area)`
          : ''
      }, reducing the usable building area.`,
    );
  }

  if (inputs.environmental.meanSlopePercent != null && inputs.environmental.meanSlopePercent > 15) {
    partialConstraints.push(
      `Mean slope of ${inputs.environmental.meanSlopePercent.toFixed(0)}% will raise site-development cost.`,
    );
  }

  if (inputs.shape?.isNarrowStrip && !inputs.shape.likelyRoadwayRemnant) {
    partialConstraints.push(
      `Parcel is narrow (about ${Math.round(inputs.shape.widthMeters)} m wide), which may make setbacks difficult to satisfy.`,
    );
  }

  if (
    inputs.zoning.minimumFrontageMeters != null &&
    inputs.access.roadFrontageMeters != null &&
    inputs.access.roadFrontageMeters < inputs.zoning.minimumFrontageMeters
  ) {
    partialConstraints.push(
      `Measured road frontage (~${inputs.access.roadFrontageMeters} m) is below the apparent ${inputs.zoning.minimumFrontageMeters} m zoning requirement.`,
    );
    requiresHumanVerification.push('Recorded frontage against the zoning frontage requirement.');
  }

  // ---- Unknowns ------------------------------------------------------------

  if (!inputs.zoning.code) {
    unknowns.push('Zoning district is unknown.');
    requiresHumanVerification.push('Zoning district and permitted uses, confirmed with the county.');
    confidence = minConfidence(confidence, 'LOW');
  } else {
    confidence = minConfidence(confidence, inputs.zoning.confidence);
    if (inputs.zoning.minimumLotSizeAcres == null) {
      unknowns.push(`Minimum lot size for zone ${inputs.zoning.code} is unknown.`);
    }
  }

  if (inputs.utilities.publicSewerAvailable !== true) {
    unknowns.push('Septic feasibility — no percolation test or county health-department approval.');
    requiresHumanVerification.push('Septic system feasibility and permit availability.');
  }
  if (inputs.utilities.publicWaterAvailable !== true) {
    unknowns.push('Potable water — whether a well can be permitted and drilled.');
  }
  if (inputs.utilities.electricNearby == null) {
    unknowns.push('Distance to the nearest electrical service.');
  }

  unknowns.push('Exact setback, height and coverage compliance for a specific building plan.');

  if (inputs.access.legalAccessStatus === 'UNKNOWN') {
    unknowns.push('Legal access has not been verified against recorded instruments.');
    requiresHumanVerification.push('Recorded legal access (deed, plat or easement).');
  }

  unknowns.push(...partialConstraints.map((constraint) => `Impact of: ${constraint}`));

  confidence = minConfidence(confidence, inputs.environmental.confidence, inputs.access.confidence);

  const rating = decideRating({
    blockingIssues,
    partialConstraints,
    reasons,
    accessClass: inputs.access.accessClass,
    zoningKnown: Boolean(inputs.zoning.code),
    acreageKnown: inputs.acreage != null,
    environmentalKnown: inputs.environmental.confidence !== 'UNKNOWN',
  });

  return {
    rating,
    score: ratingToScore(rating, partialConstraints.length, unknowns.length),
    reasons,
    unknowns: dedupe(unknowns),
    blockingIssues,
    requiresHumanVerification: dedupe(requiresHumanVerification),
    confidence: rating === 'UNKNOWN' ? 'UNKNOWN' : confidence,
  };
}

function decideRating(input: {
  blockingIssues: string[];
  partialConstraints: string[];
  reasons: string[];
  accessClass: string;
  zoningKnown: boolean;
  acreageKnown: boolean;
  environmentalKnown: boolean;
}): BuildabilityRating {
  if (input.blockingIssues.length > 0) return 'RED';

  // Without acreage or any environmental layer there is nothing to conclude
  // from, and a YELLOW would overstate what we know.
  if (!input.acreageKnown || !input.environmentalKnown) return 'UNKNOWN';
  if (input.accessClass === 'UNKNOWN') return 'UNKNOWN';

  if (input.partialConstraints.length > 0) return 'YELLOW';

  // GREEN requires positive evidence across access, zoning and environment —
  // not merely the absence of bad news.
  if (input.zoningKnown && (input.accessClass === 'A' || input.accessClass === 'B') && input.reasons.length >= 3) {
    return 'GREEN';
  }
  return 'YELLOW';
}

function ratingToScore(
  rating: BuildabilityRating,
  constraintCount: number,
  unknownCount: number,
): number {
  const base = rating === 'GREEN' ? 90 : rating === 'YELLOW' ? 55 : rating === 'RED' ? 5 : 35;
  const penalty = Math.min(20, constraintCount * 6 + Math.max(0, unknownCount - 4) * 2);
  return Math.max(0, Math.min(100, base - penalty));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Mandatory caveat rendered next to every buildability rating, including the
 * asterisk on GREEN required by the brief's decision card.
 */
export const BUILDABILITY_DISCLAIMER =
  'Preliminary screening only. This is not a zoning determination, a permit, a septic approval, or any representation that a structure can be built. Verify with the county before relying on it.';
