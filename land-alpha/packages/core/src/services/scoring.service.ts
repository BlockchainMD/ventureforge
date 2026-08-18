import {
  STANDING_INVENTORY_SOURCE_TYPES,
  type AccessAssessment,
  type AlphaScoreResult,
  type BuildabilityAssessment,
  type EnvironmentalAssessment,
  type OpportunityEconomics,
  type ShapeMetrics,
  type TitlePreScreen,
  type ValuationResult,
} from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';
import { getActiveScoringConfig, prisma, spatial, toCents, Prisma } from '@land-alpha/db';
import { scoreParcel } from '../scoring.js';

/**
 * Scoring orchestration.
 *
 * Reads everything the enrichment and valuation stages established, runs the
 * Alpha Score, writes the result plus an immutable snapshot stamped with the
 * config version that produced it.
 */

const logger = createLogger({ component: 'scoring-service' });

export async function scoreParcelById(parcelId: string): Promise<AlphaScoreResult> {
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    include: { source: true },
  });
  if (!parcel) throw new Error(`Parcel not found: ${parcelId}`);

  const config = await getActiveScoringConfig();

  // Duplicate detection needs geometry; a point-only parcel cannot be checked
  // this way and is not assumed clean.
  const duplicates = parcel.compactness != null ? await spatial.findGeometricDuplicates(parcelId) : [];

  const access: AccessAssessment | null =
    parcel.accessClass === 'UNKNOWN' && parcel.physicalAccessScore == null
      ? null
      : {
          accessClass: parcel.accessClass,
          physicalAccessScore: parcel.physicalAccessScore ?? 0,
          legalAccessStatus: parcel.legalAccessStatus,
          legalAccessConfidence: parcel.legalAccessConfidence,
          touchesPublicRoad: parcel.touchesPublicRoad,
          touchesNamedRoad: parcel.touchesNamedRoad,
          roadFrontageMeters: parcel.roadFrontageMeters,
          nearestRoadName: parcel.nearestRoadName,
          nearestRoadMeters: parcel.nearestRoadMeters,
          nearestPavedRoadName: parcel.nearestPavedRoadName,
          nearestPavedRoadMeters: parcel.nearestPavedRoadMeters,
          apparentDriveway: parcel.apparentDriveway,
          potentiallyLandlocked: parcel.potentiallyLandlocked ?? false,
          evidence: parcel.accessEvidence,
          unknowns: parcel.accessUnknowns,
          // The assessment's own confidence, not the legal-access confidence:
          // conflating them would report every parcel as unknown-access simply
          // because legal access is (correctly) never inferred.
          confidence: parcel.accessConfidence,
        };

  const buildability: BuildabilityAssessment | null =
    parcel.buildability === 'UNKNOWN' && parcel.buildabilityScore == null
      ? null
      : {
          rating: parcel.buildability,
          score: parcel.buildabilityScore ?? 35,
          reasons: parcel.buildabilityReasons,
          unknowns: parcel.buildabilityUnknowns,
          blockingIssues: parcel.buildabilityBlockers,
          requiresHumanVerification: [],
          confidence: parcel.buildabilityConfidence,
        };

  const environmental: EnvironmentalAssessment | null =
    parcel.environmentalConfidence === 'UNKNOWN' && parcel.environmentalRiskScore == null
      ? null
      : {
          floodZones: parcel.floodZones,
          floodOverlapFraction: parcel.floodOverlapFraction,
          inSpecialFloodHazardArea: parcel.inSpecialFloodHazardArea,
          wetlandTypes: parcel.wetlandTypes,
          wetlandOverlapFraction: parcel.wetlandOverlapFraction,
          soilSeries: parcel.soilSeries,
          soilDrainageClasses: parcel.soilDrainageClasses,
          hydricSoilFraction: parcel.hydricSoilFraction,
          contaminatedSites: [],
          nearestContaminatedSiteMeters: parcel.nearestContaminatedSiteMeters,
          meanElevationMeters: parcel.meanElevationMeters,
          minElevationMeters: parcel.minElevationMeters,
          maxElevationMeters: parcel.maxElevationMeters,
          meanSlopePercent: parcel.meanSlopePercent,
          environmentalRiskScore: parcel.environmentalRiskScore ?? 0,
          evidence: [],
          unknowns: [],
          confidence: parcel.environmentalConfidence,
        };

  const shape: ShapeMetrics | null =
    parcel.compactness == null
      ? null
      : {
          acreage: parcel.acreage ?? 0,
          areaSqMeters: 0,
          perimeterMeters: parcel.perimeterMeters ?? 0,
          centroid: [parcel.longitude ?? 0, parcel.latitude ?? 0],
          bbox: [
            parcel.bboxWest ?? 0,
            parcel.bboxSouth ?? 0,
            parcel.bboxEast ?? 0,
            parcel.bboxNorth ?? 0,
          ],
          widthMeters: 0,
          heightMeters: 0,
          compactness: parcel.compactness,
          aspectRatio: parcel.aspectRatio ?? 1,
          vertexCount: 0,
          isNarrowStrip: parcel.shapeFlags.includes('NARROW_STRIP'),
          isSliver: parcel.shapeFlags.includes('SLIVER'),
          isIrregular: parcel.shapeFlags.includes('IRREGULAR_SHAPE'),
          isTinyParcel: parcel.shapeFlags.includes('TINY_PARCEL'),
          likelyRoadwayRemnant: parcel.shapeFlags.includes('LIKELY_ROADWAY_REMNANT'),
          shapeScore: parcel.shapeScore ?? 50,
          flags: parcel.shapeFlags,
        };

  const title: TitlePreScreen | null =
    parcel.titleRiskScore == null
      ? null
      : {
          riskScore: parcel.titleRiskScore,
          band:
            parcel.titleRiskScore <= 20
              ? 'LOW'
              : parcel.titleRiskScore <= 40
                ? 'MODERATE'
                : parcel.titleRiskScore <= 60
                  ? 'REVIEW_RECOMMENDED'
                  : parcel.titleRiskScore <= 80
                    ? 'SUBSTANTIAL'
                    : 'REJECT',
          findings: [],
          chainDepth: 0,
          chainGaps: [],
          unknowns: [],
          requiresProfessionalReview: parcel.titleRiskScore > 40,
          confidence: 'LOW',
          disclaimer: '',
        };

  const economics: OpportunityEconomics | null =
    parcel.estimatedAllInBasis == null
      ? null
      : {
          acquisitionPrice: toCents(parcel.estimatedAcquisitionCost) ?? 0,
          governmentFees: toCents(parcel.fees) ?? 0,
          recordingCost: toCents(parcel.estimatedRecordingCost) ?? 0,
          titleCost: toCents(parcel.estimatedTitleCost) ?? 0,
          curativeCost: toCents(parcel.estimatedCurativeCost) ?? 0,
          carryingCost: toCents(parcel.estimatedCarryingCost) ?? 0,
          marketingCost: toCents(parcel.estimatedMarketingCost) ?? 0,
          allInBasis: toCents(parcel.estimatedAllInBasis) ?? 0,
          basisToQsv: parcel.basisToQsv,
          basisToRetail: parcel.basisToRetail,
          grossProfitAtQsv: toCents(parcel.expectedGrossMargin),
          roiAtQsv: parcel.roiAtQsv,
          annualizedRoiAtQsv: parcel.annualizedRoiAtQsv,
          expectedHoldDays: config.costModel.expectedHoldDays,
          tier: (parcel.economicsTier as OpportunityEconomics['tier']) ?? 'UNKNOWN',
        };

  const valuation: ValuationResult | null =
    parcel.quickSaleValue == null && parcel.retailValue == null
      ? null
      : {
          retail:
            parcel.retailValue == null
              ? null
              : {
                  low: toCents(parcel.retailValueLow) ?? 0,
                  mid: toCents(parcel.retailValue) ?? 0,
                  high: toCents(parcel.retailValueHigh) ?? 0,
                  confidence: parcel.valuationConfidence,
                  method: parcel.valuationMethod ?? '',
                },
          quickSale:
            parcel.quickSaleValue == null
              ? null
              : {
                  low: toCents(parcel.quickSaleValueLow) ?? 0,
                  mid: toCents(parcel.quickSaleValue) ?? 0,
                  high: toCents(parcel.quickSaleValueHigh) ?? 0,
                  confidence: parcel.valuationConfidence,
                  method: '',
                },
          investorLiquidation: null,
          compCount: parcel.comparableCount,
          comps: [],
          pricePerAcreUsed: null,
          confidence: parcel.valuationConfidence,
          warnings: parcel.valuationWarnings,
        };

  const daysOnSource = Math.floor(
    (Date.now() - parcel.firstSeenAt.getTime()) / 86_400_000,
  );

  const result = scoreParcel(
    {
      economics,
      valuation,
      access,
      buildability,
      title,
      environmental,
      shape,
      acreage: parcel.acreage,
      failedSaleCount: parcel.failedSaleCount,
      isStandingInventory:
        parcel.otcEligible === true ||
        parcel.saleType === 'OVER_THE_COUNTER' ||
        STANDING_INVENTORY_SOURCE_TYPES.includes(parcel.source.sourceType),
      daysOnSource,
      hasDuplicate: duplicates.length > 0,
      analystOverride: parcel.rejectionOverriddenBy
        ? { rule: parcel.rejectionOverrideNote ?? '', by: parcel.rejectionOverriddenBy }
        : null,
    },
    config,
  );

  await prisma.$transaction([
    prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        alphaScore: result.alphaScore,
        valueScore: result.components.valueScore,
        accessScore: result.components.accessScore,
        buildabilityScoreNorm: result.components.buildabilityScore,
        liquidityScore: result.components.liquidityScore,
        shapeScore: result.components.shapeScore,
        desirabilityScore: result.components.desirabilityScore,
        confidenceScore: result.confidenceScore,
        confidenceLevel: result.confidenceLevel,
        scoringConfigVersion: result.configVersion,
        whyInteresting: [...result.whyInteresting],
        remainingQuestions: [...result.remainingQuestions],
        rejected: result.rejected,
        rejectionReasons: result.rejectionReasons as unknown as Prisma.InputJsonValue,
        scoredAt: new Date(),
        // Only advance the funnel from the pre-review states; an analyst's own
        // decision is never overwritten by a re-score.
        status: result.rejected
          ? parcel.status === 'DISCOVERED' || parcel.status === 'ENRICHING' || parcel.status === 'SCORED'
            ? 'REJECTED'
            : parcel.status
          : parcel.status === 'DISCOVERED' || parcel.status === 'ENRICHING'
            ? 'SCORED'
            : parcel.status,
      },
    }),
    prisma.parcelScoreSnapshot.create({
      data: {
        parcelId,
        alphaScore: result.alphaScore,
        configVersion: result.configVersion,
        components: result.components as unknown as Prisma.InputJsonValue,
        breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
        rejected: result.rejected,
      },
    }),
  ]);

  logger.info('scored parcel', {
    parcelId,
    alphaScore: result.alphaScore,
    rejected: result.rejected,
    confidence: result.confidenceLevel,
  });

  return result;
}

/** Re-score every live parcel. Used after the admin changes scoring weights. */
export async function rescoreAll(options: { batchSize?: number } = {}): Promise<number> {
  const batchSize = options.batchSize ?? 200;
  let processed = 0;
  let cursor: string | undefined;

  for (;;) {
    const batch = await prisma.parcelOpportunity.findMany({
      where: { removedFromSourceAt: null },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      await scoreParcelById(row.id);
      processed += 1;
    }
    cursor = batch[batch.length - 1]!.id;
  }

  logger.info('rescored all parcels', { processed });
  return processed;
}
