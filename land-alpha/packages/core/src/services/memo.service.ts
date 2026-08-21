import { prisma, toCents, toDecimal, getActiveScoringConfig, Prisma } from '@land-alpha/db';
import { formatDate, type RejectionReason } from '@land-alpha/shared';
import { maximumBidForTargetRatio } from '@land-alpha/valuation';
import { generateInvestmentMemo, type MemoFacts } from '@land-alpha/ai';
import { createLogger } from '@land-alpha/shared/logger';

/**
 * Investment memo generation.
 *
 * Assembles the fact sheet entirely from persisted, engine-derived values —
 * never from a re-computation at render time — so the memo describes the same
 * parcel state that was scored, and remains a faithful record of what was known
 * when the decision was made.
 */

const logger = createLogger({ component: 'memo-service' });

export async function generateMemoForParcel(
  parcelId: string,
  requestedBy?: string,
): Promise<{ version: number; deterministic: boolean }> {
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    include: {
      source: true,
      comparableLinks: { include: { comparable: true }, orderBy: { weight: 'desc' }, take: 12 },
      titleInstruments: { where: { resolved: false } },
      evidence: { select: { field: true }, distinct: ['field'] },
    },
  });
  if (!parcel) throw new Error(`Parcel not found: ${parcelId}`);

  const config = await getActiveScoringConfig();
  const quickSaleValueCents = toCents(parcel.quickSaleValue);

  const recommendedMaxBidCents =
    quickSaleValueCents == null
      ? null
      : maximumBidForTargetRatio({
          quickSaleValueCents,
          targetBasisToQsv: config.thresholds.strongBasisToQsv,
          costs: config.costModel,
          governmentFeesCents: toCents(parcel.fees) ?? 0,
          annualTaxCents: toCents(parcel.annualTaxEstimate),
          titleCurativeCents: toCents(parcel.estimatedCurativeCost),
        });

  const rejectionReasons = (parcel.rejectionReasons ?? []) as unknown as RejectionReason[];

  const facts: MemoFacts = {
    parcelId: parcel.id,
    state: parcel.state,
    county: parcel.county,
    apn: parcel.apn,
    acreage: parcel.acreage,
    sourceName: parcel.source.name,
    sourceType: parcel.source.sourceType,
    saleType: parcel.saleType,
    failedSaleCount: parcel.failedSaleCount,
    otcEligible: parcel.otcEligible,
    daysOnSource: Math.floor((Date.now() - parcel.firstSeenAt.getTime()) / 86_400_000),

    acquisitionPriceCents:
      toCents(parcel.askingPrice) ??
      toCents(parcel.minimumBid) ??
      toCents(parcel.estimatedAcquisitionCost),
    allInBasisCents: toCents(parcel.estimatedAllInBasis),
    quickSaleValueCents,
    retailValueCents: toCents(parcel.retailValue),
    investorLiquidationValueCents: toCents(parcel.investorLiquidationValue),
    basisToQsv: parcel.basisToQsv,
    grossProfitCents: toCents(parcel.expectedGrossMargin),
    roiAtQsv: parcel.roiAtQsv,
    economicsTier: parcel.economicsTier,
    recommendedMaxBidCents,

    accessClass: parcel.accessClass,
    legalAccessStatus: parcel.legalAccessStatus,
    roadFrontageMeters: parcel.roadFrontageMeters,
    nearestRoadName: parcel.nearestRoadName,
    accessEvidence: parcel.accessEvidence,
    accessUnknowns: parcel.accessUnknowns,

    buildability: parcel.buildability,
    buildabilityReasons: parcel.buildabilityReasons,
    buildabilityUnknowns: parcel.buildabilityUnknowns,
    buildabilityBlockers: parcel.buildabilityBlockers,

    floodZones: parcel.floodZones,
    floodOverlapFraction: parcel.floodOverlapFraction,
    wetlandTypes: parcel.wetlandTypes,
    wetlandOverlapFraction: parcel.wetlandOverlapFraction,
    meanSlopePercent: parcel.meanSlopePercent,
    nearestContaminatedSiteMeters: parcel.nearestContaminatedSiteMeters,
    environmentalRiskScore: parcel.environmentalRiskScore,

    titleRiskScore: parcel.titleRiskScore,
    titleFindings: parcel.titleInstruments.map(
      (instrument) =>
        `${instrument.instrumentType}${instrument.recordedDate ? ` recorded ${formatDate(instrument.recordedDate)}` : ''} (${instrument.severity})`,
    ),

    comparableCount: parcel.comparableCount,
    comparables: parcel.comparableLinks.map((link) => ({
      apn: link.comparable.apn,
      saleDate: formatDate(link.comparable.saleDate),
      salePriceCents: toCents(link.comparable.salePrice) ?? 0,
      acreage: link.comparable.acreage,
      adjustedPricePerAcreCents: toCents(link.adjustedPricePerAcre) ?? 0,
      distanceMeters: link.distanceMeters,
    })),
    valuationConfidence: parcel.valuationConfidence,
    valuationWarnings: parcel.valuationWarnings,

    alphaScore: parcel.alphaScore,
    confidenceLevel: parcel.confidenceLevel,
    whyInteresting: parcel.whyInteresting,
    remainingQuestions: parcel.remainingQuestions,
    rejected: parcel.rejected,
    rejectionReasons: rejectionReasons.map((reason) => reason.explanation),

    evidenceFields: parcel.evidence.map((row) => row.field),
  };

  const memo = await generateInvestmentMemo(facts);

  const previous = await prisma.investmentMemo.findFirst({
    where: { parcelId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (previous?.version ?? 0) + 1;

  await prisma.investmentMemo.create({
    data: {
      parcelId,
      version,
      provider: memo.provider,
      model: memo.model,
      sections: memo.sections as unknown as Prisma.InputJsonValue,
      recommendation: memo.recommendation,
      recommendedMaxBid: toDecimal(memo.recommendedMaxBidCents),
      evidenceRefs: memo.evidenceRefs,
      unknowns: memo.unknowns,
      generatedBy: requestedBy ?? null,
    },
  });

  logger.info('generated investment memo', {
    parcelId,
    version,
    provider: memo.provider,
    deterministic: memo.deterministic,
  });

  return { version, deterministic: memo.deterministic };
}
