import {
  minConfidence,
  type AccessAssessment,
  type AccessClass,
  type ConfidenceLevel,
  type LegalAccessStatus,
} from '@land-alpha/shared';

/**
 * The Access Engine.
 *
 * Access is the difference between a $26,000 parcel and a $2,000 parcel, and it
 * is the field most often gotten wrong by automated land tools, because the
 * cheap signal (does the polygon touch a line labelled "road"?) is not the
 * signal that matters (does the owner have a legal right to reach it?).
 *
 * This engine therefore maintains two entirely separate tracks:
 *
 *   physicalAccessScore  — 0-100, derived from geometry and road data. This is
 *                          a measurement, and software can make it.
 *   legalAccessStatus    — starts at UNKNOWN. Only a recorded instrument,
 *                          reviewed by a human, moves it. Software never sets
 *                          it to anything else on its own.
 *
 * The letter grade (A-D) describes *the strength of evidence for access*, not a
 * legal conclusion, and every rendering of it in the UI carries that caveat.
 * See docs/decisions/0006.
 */

export interface RoadObservation {
  readonly name: string | null;
  /** Whether the road is in public maintenance. Often unknown; keep it null. */
  readonly isPublic: boolean | null;
  readonly isPaved: boolean | null;
  readonly distanceMeters: number;
  /** Metres of parcel boundary within tolerance of this road. */
  readonly frontageMeters: number;
  readonly classification: string | null;
  readonly source: string;
}

export interface AccessInputs {
  readonly hasGeometry: boolean;
  readonly roads: readonly RoadObservation[];
  /** A visible track/driveway observed in imagery or OSM. Rarely available. */
  readonly apparentDriveway: boolean | null;
  /** Any recorded instrument already reviewed by a human. */
  readonly recordedAccess?: {
    readonly status: LegalAccessStatus;
    readonly confidence: ConfidenceLevel;
    readonly note: string;
  } | null;
  /** Set when the enrichment step ran but found no road data at all. */
  readonly roadDataAvailable: boolean;
}

/** Frontage below this is a corner touch, not usable access. */
const MIN_MEANINGFUL_FRONTAGE_METERS = 8;
/** Beyond this, the parcel is not adjacent to anything by any reading. */
const LANDLOCKED_DISTANCE_METERS = 60;

export function assessAccess(inputs: AccessInputs): AccessAssessment {
  const evidence: string[] = [];
  const unknowns: string[] = [];

  // Legal access is imported, never inferred.
  const legalAccessStatus: LegalAccessStatus = inputs.recordedAccess?.status ?? 'UNKNOWN';
  const legalAccessConfidence: ConfidenceLevel = inputs.recordedAccess?.confidence ?? 'UNKNOWN';
  if (inputs.recordedAccess) {
    evidence.push(inputs.recordedAccess.note);
  } else {
    unknowns.push(
      'Legal access has not been verified. No recorded deed, plat or easement has been reviewed.',
    );
  }

  if (!inputs.roadDataAvailable) {
    return {
      accessClass: 'UNKNOWN',
      physicalAccessScore: 0,
      legalAccessStatus,
      legalAccessConfidence,
      touchesPublicRoad: null,
      touchesNamedRoad: null,
      roadFrontageMeters: null,
      nearestRoadName: null,
      nearestRoadMeters: null,
      nearestPavedRoadName: null,
      nearestPavedRoadMeters: null,
      apparentDriveway: inputs.apparentDriveway,
      potentiallyLandlocked: false,
      evidence,
      unknowns: [...unknowns, 'No road network data was available for this location.'],
      confidence: 'UNKNOWN',
    };
  }

  if (!inputs.hasGeometry) {
    unknowns.push(
      'No parcel polygon is available, so road frontage could not be measured — only proximity to the mapped point.',
    );
  }

  const sorted = [...inputs.roads].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = sorted[0] ?? null;
  const nearestPaved = sorted.find((road) => road.isPaved === true) ?? null;

  const fronting = sorted.filter((road) => road.frontageMeters >= MIN_MEANINGFUL_FRONTAGE_METERS);
  const totalFrontage = fronting.reduce((sum, road) => sum + road.frontageMeters, 0);
  const bestFronting = fronting[0] ?? null;

  const touchesNamedRoad = fronting.some((road) => Boolean(road.name));
  const publicFronting = fronting.filter((road) => road.isPublic === true);
  const touchesPublicRoad =
    publicFronting.length > 0 ? true : fronting.length > 0 ? null : nearest ? false : null;

  const potentiallyLandlocked =
    inputs.hasGeometry &&
    fronting.length === 0 &&
    (nearest == null || nearest.distanceMeters > LANDLOCKED_DISTANCE_METERS);

  // ---- Evidence narrative --------------------------------------------------
  if (bestFronting) {
    evidence.push(
      `Parcel boundary runs for approximately ${Math.round(totalFrontage)} m alongside ${
        bestFronting.name ?? 'an unnamed mapped road'
      }${bestFronting.isPaved === true ? ' (paved)' : bestFronting.isPaved === false ? ' (unpaved)' : ''}, per ${bestFronting.source}.`,
    );
  } else if (nearest) {
    evidence.push(
      `Nearest mapped road (${nearest.name ?? 'unnamed'}) is approximately ${Math.round(nearest.distanceMeters)} m away, per ${nearest.source}.`,
    );
  } else {
    evidence.push('No mapped road was found within the search radius.');
  }

  if (inputs.apparentDriveway === true) {
    evidence.push('A track or driveway appears to reach the parcel in mapped data.');
  }

  if (publicFronting.length === 0 && fronting.length > 0) {
    unknowns.push(
      'The adjacent road’s maintenance status is unknown — it may be a private road or an unopened right-of-way.',
    );
  }
  if (potentiallyLandlocked) {
    unknowns.push(
      'No road adjoins this parcel in mapped data. If no recorded easement exists, the parcel may be landlocked.',
    );
  }

  const physicalAccessScore = computePhysicalScore({
    totalFrontage,
    nearestDistance: nearest?.distanceMeters ?? null,
    hasPublicFronting: publicFronting.length > 0,
    hasNamedFronting: touchesNamedRoad,
    pavedDistance: nearestPaved?.distanceMeters ?? null,
    apparentDriveway: inputs.apparentDriveway,
    hasGeometry: inputs.hasGeometry,
  });

  const accessClass = classifyAccess({
    physicalAccessScore,
    legalAccessStatus,
    hasPublicFronting: publicFronting.length > 0,
    hasNamedFronting: touchesNamedRoad,
    hasAnyFronting: fronting.length > 0,
    potentiallyLandlocked,
    nearestDistance: nearest?.distanceMeters ?? null,
    hasGeometry: inputs.hasGeometry,
  });

  return {
    accessClass,
    physicalAccessScore,
    legalAccessStatus,
    legalAccessConfidence,
    touchesPublicRoad,
    touchesNamedRoad: fronting.length > 0 ? touchesNamedRoad : nearest ? false : null,
    roadFrontageMeters: inputs.hasGeometry ? Math.round(totalFrontage) : null,
    nearestRoadName: nearest?.name ?? null,
    nearestRoadMeters: nearest ? Math.round(nearest.distanceMeters) : null,
    nearestPavedRoadName: nearestPaved?.name ?? null,
    nearestPavedRoadMeters: nearestPaved ? Math.round(nearestPaved.distanceMeters) : null,
    apparentDriveway: inputs.apparentDriveway,
    potentiallyLandlocked,
    evidence,
    unknowns,
    confidence: assessmentConfidence(inputs, fronting.length > 0),
  };
}

function computePhysicalScore(input: {
  totalFrontage: number;
  nearestDistance: number | null;
  hasPublicFronting: boolean;
  hasNamedFronting: boolean;
  pavedDistance: number | null;
  apparentDriveway: boolean | null;
  hasGeometry: boolean;
}): number {
  let score = 0;

  if (input.totalFrontage >= MIN_MEANINGFUL_FRONTAGE_METERS) {
    // Frontage saturates: 60 m of frontage is not twice as useful as 30 m.
    score += 45 + Math.min(20, (input.totalFrontage / 60) * 20);
    if (input.hasPublicFronting) score += 15;
    if (input.hasNamedFronting) score += 5;
  } else if (input.nearestDistance != null) {
    // No frontage: score decays with distance to the nearest road.
    score += Math.max(0, 35 - input.nearestDistance * 0.5);
  }

  if (input.pavedDistance != null) {
    score += input.pavedDistance <= 30 ? 12 : input.pavedDistance <= 1600 ? 6 : 2;
  }

  if (input.apparentDriveway === true) score += 8;

  // Without a polygon we measured proximity to a point, which is weaker
  // evidence; cap the score so a point-only parcel cannot outrank a mapped one.
  if (!input.hasGeometry) score = Math.min(score, 55);

  return Math.round(Math.min(100, Math.max(0, score)));
}

function classifyAccess(input: {
  physicalAccessScore: number;
  legalAccessStatus: LegalAccessStatus;
  hasPublicFronting: boolean;
  hasNamedFronting: boolean;
  hasAnyFronting: boolean;
  potentiallyLandlocked: boolean;
  nearestDistance: number | null;
  hasGeometry: boolean;
}): AccessClass {
  // A is reserved for documented access. Physical adjacency alone never earns
  // it unless the adjoining road is confirmed to be in public maintenance.
  if (
    input.legalAccessStatus === 'RECORDED_FRONTAGE' ||
    input.legalAccessStatus === 'RECORDED_EASEMENT' ||
    input.legalAccessStatus === 'PLATTED_ACCESS'
  ) {
    return 'A';
  }
  if (input.legalAccessStatus === 'NO_RECORDED_ACCESS_FOUND') return 'D';
  if (input.legalAccessStatus === 'DISPUTED') return 'C';

  if (input.hasPublicFronting && input.hasNamedFronting) return 'A';
  if (input.hasAnyFronting) return 'B';
  if (input.potentiallyLandlocked) return 'D';
  if (input.nearestDistance != null && input.nearestDistance <= LANDLOCKED_DISTANCE_METERS) {
    return 'C';
  }
  if (!input.hasGeometry) return 'UNKNOWN';
  return 'UNKNOWN';
}

function assessmentConfidence(inputs: AccessInputs, hasFronting: boolean): ConfidenceLevel {
  if (!inputs.roadDataAvailable) return 'UNKNOWN';
  let level: ConfidenceLevel = inputs.hasGeometry ? 'HIGH' : 'LOW';
  if (!hasFronting) level = minConfidence(level, 'MEDIUM');
  const anyPublicKnown = inputs.roads.some((road) => road.isPublic != null);
  if (!anyPublicKnown) level = minConfidence(level, 'MEDIUM');
  return level;
}

/**
 * Human-readable caveat that must accompany any A-D grade in the UI or in
 * generated documents. Exported so there is exactly one wording.
 */
export const ACCESS_DISCLAIMER =
  'Access class reflects the strength of available evidence for physical access. It is not a determination of legal access. Legal access requires review of recorded deeds, plats and easements.';
