import { describe, expect, it } from 'vitest';
import { estimateHoldDays } from '@land-alpha/valuation';
import { assessAccess, type RoadObservation } from './access';
import {
  assessEnvironment,
  computeEnvironmentalRisk,
  isSpecialFloodHazardZone,
} from './environmental';
import { assessBuildability } from './buildability';
import { scoreParcel, evaluateRejectionRules, type ScoringInputs } from './scoring';
import {
  DEFAULT_SCORING_CONFIG,
  type AccessAssessment,
  type BuildabilityAssessment,
  type EnvironmentalAssessment,
  type OpportunityEconomics,
  type ShapeMetrics,
  type TitlePreScreen,
  type ValuationResult,
} from '@land-alpha/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function road(overrides: Partial<RoadObservation> = {}): RoadObservation {
  return {
    name: 'County Road 88',
    isPublic: true,
    isPaved: true,
    distanceMeters: 3,
    frontageMeters: 120,
    classification: 'secondary',
    source: 'OpenStreetMap',
    ...overrides,
  };
}

function shape(overrides: Partial<ShapeMetrics> = {}): ShapeMetrics {
  return {
    acreage: 5.23,
    areaSqMeters: 21_165,
    perimeterMeters: 600,
    centroid: [-92.35, 47.42],
    bbox: [-92.36, 47.41, -92.34, 47.43],
    widthMeters: 140,
    heightMeters: 150,
    compactness: 0.72,
    aspectRatio: 1.07,
    vertexCount: 5,
    isNarrowStrip: false,
    isSliver: false,
    isIrregular: false,
    isTinyParcel: false,
    likelyRoadwayRemnant: false,
    shapeScore: 88,
    flags: [],
    ...overrides,
  };
}

function cleanEnvironment(
  overrides: Partial<EnvironmentalAssessment> = {},
): EnvironmentalAssessment {
  return {
    floodZones: ['X'],
    floodOverlapFraction: 0,
    inSpecialFloodHazardArea: false,
    layersScreened: ['FLOOD', 'WETLANDS', 'SOILS', 'CONTAMINATION', 'TERRAIN'],
    wetlandTypes: [],
    wetlandOverlapFraction: 0,
    soilSeries: ['Cloquet sandy loam'],
    soilDrainageClasses: ['Well drained'],
    hydricSoilFraction: 0,
    contaminatedSites: [],
    nearestContaminatedSiteMeters: null,
    meanElevationMeters: 420,
    minElevationMeters: 415,
    maxElevationMeters: 428,
    meanSlopePercent: 4,
    environmentalRiskScore: 0,
    evidence: ['No SFHA'],
    unknowns: [],
    confidence: 'HIGH',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

describe('assessAccess', () => {
  it('grades a parcel fronting a named public road as A but keeps legal access UNKNOWN', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [road()],
      apparentDriveway: null,
      roadDataAvailable: true,
    });

    expect(result.accessClass).toBe('A');
    expect(result.physicalAccessScore).toBeGreaterThan(70);
    // The whole point: physical adjacency never implies a legal right.
    expect(result.legalAccessStatus).toBe('UNKNOWN');
    expect(result.legalAccessConfidence).toBe('UNKNOWN');
    expect(result.unknowns.some((u) => u.includes('Legal access has not been verified'))).toBe(
      true,
    );
  });

  it('grades adjacency to a road of unknown maintenance status as B, not A', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [road({ isPublic: null })],
      apparentDriveway: null,
      roadDataAvailable: true,
    });
    expect(result.accessClass).toBe('B');
    expect(result.unknowns.some((u) => u.includes('maintenance status is unknown'))).toBe(true);
  });

  it('grades an apparently landlocked parcel as D', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [road({ distanceMeters: 900, frontageMeters: 0 })],
      apparentDriveway: null,
      roadDataAvailable: true,
    });
    expect(result.accessClass).toBe('D');
    expect(result.potentiallyLandlocked).toBe(true);
    expect(result.physicalAccessScore).toBeLessThan(20);
  });

  it('treats a corner touch as no frontage', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [road({ frontageMeters: 3, distanceMeters: 1 })],
      apparentDriveway: null,
      roadDataAvailable: true,
    });
    expect(result.accessClass).toBe('C');
    expect(result.roadFrontageMeters).toBe(0);
  });

  it('returns UNKNOWN when there is no road data at all rather than guessing', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [],
      apparentDriveway: null,
      roadDataAvailable: false,
    });
    expect(result.accessClass).toBe('UNKNOWN');
    expect(result.confidence).toBe('UNKNOWN');
    expect(result.potentiallyLandlocked).toBe(false);
  });

  it('promotes to A only when a recorded instrument is supplied', () => {
    const result = assessAccess({
      hasGeometry: true,
      roads: [road({ isPublic: null, name: null })],
      apparentDriveway: null,
      roadDataAvailable: true,
      recordedAccess: {
        status: 'RECORDED_EASEMENT',
        confidence: 'VERIFIED',
        note: 'Access easement recorded at Book 412 Page 88, reviewed 2026-07-02.',
      },
    });
    expect(result.accessClass).toBe('A');
    expect(result.legalAccessStatus).toBe('RECORDED_EASEMENT');
    expect(result.legalAccessConfidence).toBe('VERIFIED');
  });

  it('caps the physical score when only a point location is known', () => {
    const withGeometry = assessAccess({
      hasGeometry: true,
      roads: [road()],
      apparentDriveway: true,
      roadDataAvailable: true,
    });
    const pointOnly = assessAccess({
      hasGeometry: false,
      roads: [road()],
      apparentDriveway: true,
      roadDataAvailable: true,
    });
    expect(pointOnly.physicalAccessScore).toBeLessThan(withGeometry.physicalAccessScore);
    expect(pointOnly.roadFrontageMeters).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Environmental
// ---------------------------------------------------------------------------

describe('isSpecialFloodHazardZone', () => {
  it('classifies FEMA zone codes correctly', () => {
    expect(isSpecialFloodHazardZone('AE')).toBe(true);
    expect(isSpecialFloodHazardZone('A')).toBe(true);
    expect(isSpecialFloodHazardZone('VE')).toBe(true);
    expect(isSpecialFloodHazardZone('X')).toBe(false);
    expect(isSpecialFloodHazardZone('X500')).toBe(false);
    expect(isSpecialFloodHazardZone('AREA NOT INCLUDED')).toBe(false);
  });
});

describe('assessEnvironment', () => {
  it('never claims soil data proves septic suitability', () => {
    const result = assessEnvironment({
      soils: {
        series: ['Menahga loamy sand'],
        drainageClasses: ['Excessively drained'],
        hydricFraction: 0,
        available: true,
        source: 'USDA NRCS SSURGO',
      },
    });
    expect(result.unknowns.some((u) => u.includes('does not establish septic suitability'))).toBe(
      true,
    );
  });

  it('does not penalise a parcel for layers it has not measured', () => {
    const unmeasured = assessEnvironment({});
    expect(unmeasured.environmentalRiskScore).toBe(0);
    // ...but it must not look confident about it.
    expect(unmeasured.confidence).toBe('UNKNOWN');
    expect(unmeasured.inSpecialFloodHazardArea).toBeNull();
  });

  it('scores a floodplain-and-wetland parcel as high risk', () => {
    const result = assessEnvironment({
      flood: { zones: ['AE'], overlapFraction: 0.8, available: true, source: 'FEMA NFHL' },
      wetlands: {
        types: ['PEM1C'],
        overlapFraction: 0.7,
        available: true,
        source: 'USFWS NWI',
      },
    });
    expect(result.inSpecialFloodHazardArea).toBe(true);
    expect(result.environmentalRiskScore).toBeGreaterThan(70);
  });

  it('warns that absence from the NWI is not proof of no wetlands', () => {
    const result = assessEnvironment({
      wetlands: { types: [], overlapFraction: 0, available: true, source: 'USFWS NWI' },
    });
    expect(result.unknowns.some((u) => u.includes('does not prove absence'))).toBe(true);
  });

  it('refuses to call terrain alone a screening', () => {
    // Elevation is the layer that is easiest to obtain and least able to
    // decide anything. A parcel we know only the slope of has not been
    // screened, and calling that LOW confidence would let buildability rate it.
    const result = assessEnvironment({
      terrain: {
        meanElevationMeters: 402,
        minElevationMeters: 399,
        maxElevationMeters: 405,
        meanSlopePercent: 3.1,
        available: true,
        source: 'USGS EPQS',
      },
    });
    expect(result.layersScreened).toEqual(['TERRAIN']);
    expect(result.confidence).toBe('UNKNOWN');
  });

  it('keeps LOW confidence once a hazard layer has actually answered', () => {
    const result = assessEnvironment({
      flood: { zones: ['X'], overlapFraction: 0, available: true, source: 'FEMA NFHL' },
      terrain: {
        meanElevationMeters: 402,
        minElevationMeters: 399,
        maxElevationMeters: 405,
        meanSlopePercent: 3.1,
        available: true,
        source: 'USGS EPQS',
      },
    });
    expect(result.layersScreened).toEqual(['FLOOD', 'TERRAIN']);
    expect(result.confidence).toBe('LOW');
  });

  it('carries the reason a layer was skipped into the unknowns', () => {
    // "Not available" invites a retry tonight. "The publisher forbids automated
    // queries" tells an analyst to open the map viewer, which is the only thing
    // that will ever close this gap.
    const result = assessEnvironment({
      flood: {
        zones: [],
        overlapFraction: null,
        available: false,
        source: 'FEMA NFHL',
        unavailableReason:
          'the publisher does not permit automated queries against this service, so it must be checked by hand at https://msc.fema.gov/portal/search',
      },
    });
    const line = result.unknowns.find((u) => u.startsWith('FEMA flood hazard mapping'));
    expect(line).toContain('msc.fema.gov');
    expect(result.layersScreened).not.toContain('FLOOD');
  });
});

describe('computeEnvironmentalRisk', () => {
  it('treats a nearby cleanup site as a dominant risk', () => {
    const risk = computeEnvironmentalRisk({
      inSfha: false,
      floodOverlapFraction: 0,
      wetlandOverlapFraction: 0,
      wetlandMapped: false,
      hydricSoilFraction: 0,
      nearestContaminatedSiteMeters: 90,
      meanSlopePercent: 3,
    });
    expect(risk).toBeGreaterThanOrEqual(45);
  });

  it('stays within 0-100 under compounding hazards', () => {
    const risk = computeEnvironmentalRisk({
      inSfha: true,
      floodOverlapFraction: 1,
      wetlandOverlapFraction: 1,
      wetlandMapped: true,
      hydricSoilFraction: 1,
      nearestContaminatedSiteMeters: 10,
      meanSlopePercent: 40,
    });
    expect(risk).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Buildability
// ---------------------------------------------------------------------------

const GOOD_ACCESS: AccessAssessment = {
  accessClass: 'A',
  physicalAccessScore: 88,
  legalAccessStatus: 'UNKNOWN',
  legalAccessConfidence: 'UNKNOWN',
  touchesPublicRoad: true,
  touchesNamedRoad: true,
  roadFrontageMeters: 120,
  nearestRoadName: 'County Road 88',
  nearestRoadMeters: 3,
  nearestPavedRoadName: 'County Road 88',
  nearestPavedRoadMeters: 3,
  apparentDriveway: null,
  potentiallyLandlocked: false,
  evidence: [],
  unknowns: [],
  confidence: 'HIGH',
};

describe('assessBuildability', () => {
  it('returns GREEN with an explicit unknowns list, never a bare colour', () => {
    const result = assessBuildability({
      acreage: 5.23,
      shape: shape(),
      access: GOOD_ACCESS,
      environmental: cleanEnvironment(),
      zoning: {
        code: 'RR',
        description: 'Rural Residential',
        minimumLotSizeAcres: 2,
        minimumFrontageMeters: null,
        residentialUseAllowed: true,
        source: 'County zoning GIS',
        confidence: 'HIGH',
      },
      utilities: {
        publicWaterAvailable: null,
        publicSewerAvailable: null,
        electricNearby: null,
        source: null,
      },
    });

    expect(result.rating).toBe('GREEN');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
    expect(result.unknowns.some((u) => u.includes('Septic feasibility'))).toBe(true);
    expect(result.unknowns.some((u) => u.includes('setback'))).toBe(true);
    expect(result.requiresHumanVerification.length).toBeGreaterThan(0);
    expect(result.blockingIssues).toHaveLength(0);
  });

  it('returns RED with a blocking issue for a landlocked parcel', () => {
    const result = assessBuildability({
      acreage: 5,
      shape: shape(),
      access: { ...GOOD_ACCESS, accessClass: 'D', potentiallyLandlocked: true },
      environmental: cleanEnvironment(),
      zoning: {
        code: 'RR',
        description: null,
        minimumLotSizeAcres: 2,
        minimumFrontageMeters: null,
        residentialUseAllowed: true,
        source: 'GIS',
        confidence: 'HIGH',
      },
      utilities: {
        publicWaterAvailable: null,
        publicSewerAvailable: null,
        electricNearby: null,
        source: null,
      },
    });
    expect(result.rating).toBe('RED');
    expect(result.blockingIssues.some((b) => b.includes('No mapped road adjoins'))).toBe(true);
  });

  it('blocks an undersized lot but flags the grandfathering question', () => {
    const result = assessBuildability({
      acreage: 0.5,
      shape: shape({ acreage: 0.5 }),
      access: GOOD_ACCESS,
      environmental: cleanEnvironment(),
      zoning: {
        code: 'RR',
        description: null,
        minimumLotSizeAcres: 5,
        minimumFrontageMeters: null,
        residentialUseAllowed: true,
        source: 'GIS',
        confidence: 'HIGH',
      },
      utilities: {
        publicWaterAvailable: null,
        publicSewerAvailable: null,
        electricNearby: null,
        source: null,
      },
    });
    expect(result.rating).toBe('RED');
    expect(result.requiresHumanVerification.some((v) => v.includes('grandfathered'))).toBe(true);
  });

  it('downgrades to YELLOW when part of the parcel is in a floodplain', () => {
    const result = assessBuildability({
      acreage: 5,
      shape: shape(),
      access: GOOD_ACCESS,
      environmental: cleanEnvironment({
        floodZones: ['AE'],
        inSpecialFloodHazardArea: true,
        floodOverlapFraction: 0.35,
        environmentalRiskScore: 30,
      }),
      zoning: {
        code: 'RR',
        description: null,
        minimumLotSizeAcres: 2,
        minimumFrontageMeters: null,
        residentialUseAllowed: true,
        source: 'GIS',
        confidence: 'HIGH',
      },
      utilities: {
        publicWaterAvailable: null,
        publicSewerAvailable: null,
        electricNearby: null,
        source: null,
      },
    });
    expect(result.rating).toBe('YELLOW');
    expect(result.unknowns.some((u) => u.includes('Special Flood Hazard Area'))).toBe(true);
  });

  it('returns UNKNOWN rather than YELLOW when access has not been assessed', () => {
    const result = assessBuildability({
      acreage: 5,
      shape: shape(),
      access: { ...GOOD_ACCESS, accessClass: 'UNKNOWN', confidence: 'UNKNOWN' },
      environmental: cleanEnvironment(),
      zoning: {
        code: null,
        description: null,
        minimumLotSizeAcres: null,
        minimumFrontageMeters: null,
        residentialUseAllowed: null,
        source: null,
        confidence: 'UNKNOWN',
      },
      utilities: {
        publicWaterAvailable: null,
        publicSewerAvailable: null,
        electricNearby: null,
        source: null,
      },
    });
    expect(result.rating).toBe('UNKNOWN');
    expect(result.confidence).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// Alpha Score
// ---------------------------------------------------------------------------

function economics(overrides: Partial<OpportunityEconomics> = {}): OpportunityEconomics {
  return {
    acquisitionPrice: 314_000,
    priced: true,
    governmentFees: 0,
    recordingCost: 6_000,
    titleCost: 45_000,
    curativeCost: 0,
    carryingCost: 12_000,
    marketingCost: 156_000,
    allInBasis: 533_000,
    basisToQsv: 0.205,
    basisToRetail: 0.157,
    basisFloorToQsv: 0.205,
    grossProfitAtQsv: 2_067_000,
    roiAtQsv: 3.88,
    annualizedRoiAtQsv: 22.8,
    expectedHoldDays: 180,
    tier: 'STRONG',
    ...overrides,
  };
}

function valuation(overrides: Partial<ValuationResult> = {}): ValuationResult {
  return {
    retail: {
      low: 2_800_000,
      mid: 3_400_000,
      high: 4_000_000,
      confidence: 'HIGH',
      method: 'comps',
    },
    quickSale: {
      low: 2_100_000,
      mid: 2_600_000,
      high: 3_000_000,
      confidence: 'HIGH',
      method: 'qsv',
    },
    investorLiquidation: {
      low: 1_400_000,
      mid: 1_700_000,
      high: 2_000_000,
      confidence: 'HIGH',
      method: 'ilv',
    },
    compCount: 9,
    comps: [],
    pricePerAcreUsed: 650_000,
    confidence: 'HIGH',
    warnings: [],
    ...overrides,
  };
}

const CLEAN_TITLE: TitlePreScreen = {
  riskScore: 18,
  band: 'LOW',
  findings: [],
  chainDepth: 3,
  chainGaps: [],
  unknowns: [],
  requiresProfessionalReview: false,
  confidence: 'MEDIUM',
  disclaimer: 'x',
};

const GOOD_BUILDABILITY: BuildabilityAssessment = {
  rating: 'GREEN',
  score: 88,
  reasons: ['a', 'b', 'c'],
  unknowns: ['septic'],
  blockingIssues: [],
  requiresHumanVerification: ['Recorded legal access (deed, plat or easement).'],
  confidence: 'HIGH',
};

function scoringInputs(overrides: Partial<ScoringInputs> = {}): ScoringInputs {
  return {
    economics: economics(),
    valuation: valuation(),
    access: GOOD_ACCESS,
    buildability: GOOD_BUILDABILITY,
    title: CLEAN_TITLE,
    environmental: cleanEnvironment(),
    shape: shape(),
    acreage: 5.23,
    failedSaleCount: 1,
    isStandingInventory: true,
    daysOnSource: 400,
    hasDuplicate: false,
    isVacant: true,
    liquidity: estimateHoldDays({
      acreage: 5.23,
      quickSaleValueCents: 2_000_000,
      accessClass: 'A',
      buildability: 'GREEN',
      hasUtilities: null,
      comparableCount: 9,
    }),
    ...overrides,
  };
}

describe('scoreParcel — improvements on the roll', () => {
  it('rejects a parcel the assessing authority records as improved', () => {
    const result = scoreParcel(scoringInputs({ isVacant: false }), DEFAULT_SCORING_CONFIG);
    expect(result.rejected).toBe(true);
    expect(result.rejectionReasons.map((reason) => reason.rule)).toContain('IMPROVEMENTS_PRESENT');
  });

  it('does not reject when nobody has said either way', () => {
    const result = scoreParcel(scoringInputs({ isVacant: null }), DEFAULT_SCORING_CONFIG);
    expect(result.rejectionReasons.map((reason) => reason.rule)).not.toContain(
      'IMPROVEMENTS_PRESENT',
    );
  });

  it('leaves the rule overridable, because demolition is a real strategy', () => {
    const result = scoreParcel(scoringInputs({ isVacant: false }), DEFAULT_SCORING_CONFIG);
    const reason = result.rejectionReasons.find((r) => r.rule === 'IMPROVEMENTS_PRESENT');
    expect(reason?.overridable).toBe(true);
  });
});

describe('scoreParcel', () => {
  it('scores an excellent parcel highly and explains why', () => {
    const result = scoreParcel(scoringInputs(), DEFAULT_SCORING_CONFIG);

    expect(result.rejected).toBe(false);
    expect(result.alphaScore).toBeGreaterThan(75);
    expect(result.alphaScore).toBeLessThanOrEqual(100);
    expect(result.whyInteresting.length).toBeGreaterThan(2);
    expect(result.remainingQuestions).toContain('Verify recorded legal access');
    expect(result.configVersion).toBe('v1');
  });

  it('weights the breakdown exactly as configured and sums to the score', () => {
    const result = scoreParcel(scoringInputs(), DEFAULT_SCORING_CONFIG);
    const weightSum = result.breakdown.reduce((sum, entry) => sum + entry.weight, 0);
    expect(weightSum).toBeCloseTo(1, 6);

    const recomputed = result.breakdown.reduce((sum, entry) => sum + entry.weightedScore, 0);
    expect(Math.round(recomputed)).toBe(result.alphaScore);
  });

  it('rejects rather than merely penalising a roadway remnant', () => {
    const result = scoreParcel(
      scoringInputs({ shape: shape({ likelyRoadwayRemnant: true, shapeScore: 2 }) }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.rejected).toBe(true);
    expect(result.alphaScore).toBe(0);
    expect(result.rejectionReasons.map((r) => r.rule)).toContain('ROADWAY_REMNANT');
  });

  it('rejects a landlocked parcel unless the discount is exceptional', () => {
    const landlocked = { ...GOOD_ACCESS, accessClass: 'D' as const, potentiallyLandlocked: true };

    const normalDiscount = scoreParcel(
      scoringInputs({ access: landlocked }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(normalDiscount.rejected).toBe(true);

    const exceptionalDiscount = scoreParcel(
      scoringInputs({
        access: landlocked,
        economics: economics({ basisToQsv: 0.05 }),
      }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(exceptionalDiscount.rejected).toBe(false);

    // Surviving the rejection rule is not the same as being attractive: the
    // same deep discount with real access must still score materially higher.
    const withAccess = scoreParcel(
      scoringInputs({ economics: economics({ basisToQsv: 0.05 }) }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(exceptionalDiscount.alphaScore!).toBeLessThan(withAccess.alphaScore! - 10);
  });

  it('rejects when basis meets or exceeds quick-sale value', () => {
    const result = scoreParcel(
      scoringInputs({ economics: economics({ basisToQsv: 1.4, tier: 'WEAK' }) }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.rejectionReasons.map((r) => r.rule)).toContain('BASIS_EXCEEDS_QSV');
  });

  it('rejects on the cost floor alone when no price has been obtained', () => {
    // Making the acquisition price nullable correctly suppressed basisToQsv,
    // and silently disabled this rejection for every unpriced parcel — which
    // is currently all of them. The floor is enough to decide: a parcel whose
    // closing and holding costs already exceed its value cannot be rescued by
    // any purchase figure.
    const result = scoreParcel(
      scoringInputs({
        economics: economics({
          priced: false,
          basisToQsv: null,
          basisToRetail: null,
          basisFloorToQsv: 1.56,
          roiAtQsv: null,
          tier: 'UNKNOWN',
        }),
      }),
      DEFAULT_SCORING_CONFIG,
    );
    const rejection = result.rejectionReasons.find((r) => r.rule === 'BASIS_EXCEEDS_QSV');
    expect(rejection).toBeDefined();
    expect(rejection!.explanation).toContain('No purchase price makes it profitable');
  });

  it('does not reject an unpriced parcel whose floor leaves room', () => {
    const result = scoreParcel(
      scoringInputs({
        economics: economics({
          priced: false,
          basisToQsv: null,
          basisToRetail: null,
          basisFloorToQsv: 0.07,
          roiAtQsv: null,
          tier: 'UNKNOWN',
        }),
      }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.rejectionReasons.map((r) => r.rule)).not.toContain('BASIS_EXCEEDS_QSV');
  });

  it('leaves a parcel it cannot value unranked rather than average', () => {
    // Every component that depends on value scores neutral, so the weighted
    // mean lands near 50 — which is how ten Ottawa parcels with no comparable
    // sales and no valuation came to sit at the top of the buy list, above
    // parcels that had been assessed and found ordinary.
    const unvalued = scoreParcel(
      { ...scoringInputs({ economics: null }), valuation: null },
      DEFAULT_SCORING_CONFIG,
    );
    expect(unvalued.alphaScore).toBeNull();
    // Not rejected: nothing is wrong with the parcel, we simply cannot say.
    expect(unvalued.rejected).toBe(false);
  });

  it('honours an analyst override on an overridable rule', () => {
    const inputs = scoringInputs({ shape: shape({ likelyRoadwayRemnant: true }) });
    const overridden = scoreParcel(
      { ...inputs, analystOverride: { rule: 'ROADWAY_REMNANT', by: 'analyst@example.com' } },
      DEFAULT_SCORING_CONFIG,
    );
    expect(overridden.rejected).toBe(false);
  });

  it('does not let an override defeat a non-overridable rule', () => {
    const inputs = scoringInputs({ hasDuplicate: true });
    const attempted = scoreParcel(
      { ...inputs, analystOverride: { rule: 'DUPLICATE_PARCEL', by: 'analyst@example.com' } },
      DEFAULT_SCORING_CONFIG,
    );
    expect(attempted.rejected).toBe(true);
    expect(attempted.rejectionReasons.map((r) => r.rule)).toContain('DUPLICATE_PARCEL');
  });

  it('drags confidence down when inputs are missing, even if economics look good', () => {
    const blind = scoreParcel(
      scoringInputs({
        access: null,
        buildability: null,
        title: null,
        environmental: null,
        shape: null,
      }),
      DEFAULT_SCORING_CONFIG,
    );
    const informed = scoreParcel(scoringInputs(), DEFAULT_SCORING_CONFIG);

    expect(blind.confidenceScore).toBeLessThan(informed.confidenceScore);
    expect(blind.confidenceLevel).not.toBe('HIGH');
  });

  it('produces a score in 0-100 for every combination it is given', () => {
    const variants: Partial<ScoringInputs>[] = [
      {},
      { economics: null, valuation: null },
      { access: null },
      { title: { ...CLEAN_TITLE, riskScore: 100, band: 'REJECT' } },
      { acreage: 0.001 },
      { failedSaleCount: 9, daysOnSource: 3000 },
      { environmental: cleanEnvironment({ environmentalRiskScore: 95, meanSlopePercent: 45 }) },
    ];
    for (const variant of variants) {
      const result = scoreParcel(scoringInputs(variant), DEFAULT_SCORING_CONFIG);
      // Null is a legitimate outcome — a parcel with no valuation is unranked,
      // not zero and not average — but a number must always be in range.
      if (result.alphaScore === null) continue;
      expect(result.alphaScore).toBeGreaterThanOrEqual(0);
      expect(result.alphaScore).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.alphaScore)).toBe(true);
    }
  });

  it('ranks a better discount above a worse one, all else equal', () => {
    const cheap = scoreParcel(
      scoringInputs({ economics: economics({ basisToQsv: 0.08, tier: 'EXCEPTIONAL' }) }),
      DEFAULT_SCORING_CONFIG,
    );
    const dear = scoreParcel(
      scoringInputs({ economics: economics({ basisToQsv: 0.45, tier: 'WEAK' }) }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(cheap.alphaScore!).toBeGreaterThan(dear.alphaScore!);
  });
});

describe('evaluateRejectionRules', () => {
  it('rejects a parcel below the minimum acreage', () => {
    const reasons = evaluateRejectionRules(
      scoringInputs({ acreage: 0.01 }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(reasons.map((r) => r.rule)).toContain('PARCEL_TOO_SMALL');
  });

  it('rejects a parcel adjacent to a regulated cleanup site', () => {
    const reasons = evaluateRejectionRules(
      scoringInputs({
        environmental: cleanEnvironment({ nearestContaminatedSiteMeters: 60 }),
      }),
      DEFAULT_SCORING_CONFIG,
    );
    const contamination = reasons.find((r) => r.rule === 'CONTAMINATED_SITE');
    expect(contamination).toBeDefined();
    expect(contamination!.overridable).toBe(true);
    expect(contamination!.explanation).toContain('analyst override');
  });

  it('rejects an almost entirely wetland parcel', () => {
    const reasons = evaluateRejectionRules(
      scoringInputs({ environmental: cleanEnvironment({ wetlandOverlapFraction: 0.98 }) }),
      DEFAULT_SCORING_CONFIG,
    );
    expect(reasons.map((r) => r.rule)).toContain('SUBMERGED_OR_FULL_WETLAND');
  });

  it('applies no rules when they are all disabled', () => {
    const disabled = {
      ...DEFAULT_SCORING_CONFIG,
      rejectionRules: DEFAULT_SCORING_CONFIG.rejectionRules.map((rule) => ({
        ...rule,
        enabled: false,
      })),
    };
    const reasons = evaluateRejectionRules(
      scoringInputs({ acreage: 0.001, hasDuplicate: true }),
      disabled,
    );
    expect(reasons).toHaveLength(0);
  });
});
