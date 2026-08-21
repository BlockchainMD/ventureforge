import {
  addCents,
  minConfidence,
  type ConfidenceLevel,
  type OpportunityEconomics,
  type ValuationResult,
} from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';
import {
  getActiveScoringConfig,
  prisma,
  spatial,
  toCents,
  toDecimal,
  Prisma,
} from '@land-alpha/db';
import {
  acreageBandFor,
  computeEconomics,
  DEFAULT_COMPS_CONFIG,
  maximumBidForTargetRatio,
  valueParcel,
  type CompCandidate,
} from '@land-alpha/valuation';
import { estimateCurativeCostCents } from '@land-alpha/title-research';
import { FIXTURE_COMP_SOURCE } from '@land-alpha/db/seed/comparables';

/**
 * Valuation orchestration.
 *
 * Pulls candidate comparable sales from PostGIS, runs the deterministic
 * valuation and economics engines, persists both the current figures and an
 * immutable snapshot, and records which comps were actually used with their
 * adjustments — so a valuation can be re-derived and defended months later.
 */

const logger = createLogger({ component: 'valuation-service' });

export interface ValuationOutcome {
  readonly parcelId: string;
  readonly valuation: ValuationResult;
  readonly economics: OpportunityEconomics | null;
  readonly recommendedMaxBidCents: number | null;
  readonly warnings: string[];
}

export async function valuateParcel(parcelId: string): Promise<ValuationOutcome> {
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    include: { source: true },
  });
  if (!parcel) throw new Error(`Parcel not found: ${parcelId}`);

  const config = await getActiveScoringConfig();
  const warnings: string[] = [];

  const acreage = parcel.acreage;
  const centroid =
    parcel.longitude != null && parcel.latitude != null
      ? ([parcel.longitude, parcel.latitude] as [number, number])
      : null;

  // ---- Candidate comps -----------------------------------------------------
  let candidates: CompCandidate[] = [];
  if (acreage != null && acreage > 0 && centroid) {
    const band = acreageBandFor(acreage);
    const rows = await spatial.findNearbyComparables({
      origin: centroid,
      state: parcel.state,
      county: parcel.county,
      radiusMeters: DEFAULT_COMPS_CONFIG.maxDistanceMeters,
      minAcreage: band.min,
      maxAcreage: band.max,
      soldSince: new Date(Date.now() - DEFAULT_COMPS_CONFIG.maxAgeDays * 86_400_000),
      limit: 80,
    });

    candidates = rows.map((row) => ({
      id: row.id,
      apn: row.apn,
      saleDate: row.saleDate,
      salePriceCents: Math.round(Number(row.salePrice) * 100),
      acreage: row.acreage,
      distanceMeters: row.distance_m == null ? null : Number(row.distance_m),
      zoning: row.zoning,
      accessClass: row.accessClass,
      hasUtilities: row.hasUtilities,
      source: row.source,
      isFixture: row.source === FIXTURE_COMP_SOURCE,
    }));

    // Fall back to a county-wide search before giving up: a thin rural county
    // may have no sale within the radius but plenty within its borders.
    if (candidates.length < DEFAULT_COMPS_CONFIG.minComps) {
      const countyWide = await spatial.findNearbyComparables({
        origin: centroid,
        state: parcel.state,
        county: parcel.county,
        radiusMeters: 250_000,
        minAcreage: band.min,
        maxAcreage: band.max,
        soldSince: new Date(Date.now() - DEFAULT_COMPS_CONFIG.maxAgeDays * 86_400_000),
        limit: 80,
      });
      if (countyWide.length > candidates.length) {
        warnings.push(
          'Too few comparable sales nearby; the search was widened to the whole county, which weakens the estimate.',
        );
        candidates = countyWide.map((row) => ({
          id: row.id,
          apn: row.apn,
          saleDate: row.saleDate,
          salePriceCents: Math.round(Number(row.salePrice) * 100),
          acreage: row.acreage,
          distanceMeters: row.distance_m == null ? null : Number(row.distance_m),
          zoning: row.zoning,
          accessClass: row.accessClass,
          hasUtilities: row.hasUtilities,
          source: row.source,
          isFixture: row.source === FIXTURE_COMP_SOURCE,
        }));
      }
    }
  } else if (acreage == null || acreage <= 0) {
    warnings.push('Parcel acreage is unknown, so no comparable-sales valuation is possible.');
  }

  const valuation = valueParcel(
    {
      subject: {
        acreage: acreage ?? 0,
        zoning: parcel.zoning,
        accessClass: parcel.accessClass === 'UNKNOWN' ? null : parcel.accessClass,
        hasUtilities: parcel.knownUtilities.length > 0 ? true : null,
      },
      candidates,
      landAssessedValueCents: toCents(parcel.landAssessedValue),
    },
    {
      comps: DEFAULT_COMPS_CONFIG,
      quickSaleDiscount: config.costModel.quickSaleDiscountFromRetail,
      investorLiquidationDiscount: config.costModel.investorLiquidationDiscountFromRetail,
      assessedValueMultiplier: 1.15,
    },
  );
  warnings.push(...valuation.warnings);

  // ---- Economics -----------------------------------------------------------
  const acquisitionPriceCents =
    toCents(parcel.askingPrice) ?? toCents(parcel.minimumBid) ?? toCents(parcel.taxesDue) ?? 0;

  const curativeCents = parcel.titleRiskScore != null ? await curativeCostFor(parcelId) : 0;

  const economics =
    valuation.quickSale || valuation.retail
      ? computeEconomics(
          {
            acquisitionPriceCents,
            governmentFeesCents: toCents(parcel.fees),
            annualTaxCents: toCents(parcel.annualTaxEstimate),
            titleCurativeCents: curativeCents,
            quickSaleValueCents: valuation.quickSale?.mid ?? null,
            retailValueCents: valuation.retail?.mid ?? null,
          },
          config.costModel,
          config.thresholds,
        )
      : null;

  const recommendedMaxBidCents =
    valuation.quickSale && acquisitionPriceCents >= 0
      ? maximumBidForTargetRatio({
          quickSaleValueCents: valuation.quickSale.mid,
          targetBasisToQsv: config.thresholds.strongBasisToQsv,
          costs: config.costModel,
          governmentFeesCents: toCents(parcel.fees) ?? 0,
          annualTaxCents: toCents(parcel.annualTaxEstimate),
          titleCurativeCents: curativeCents,
        })
      : null;

  // ---- Persist -------------------------------------------------------------
  const valuationConfidence: ConfidenceLevel =
    acquisitionPriceCents === 0 ? minConfidence(valuation.confidence, 'LOW') : valuation.confidence;

  if (acquisitionPriceCents === 0) {
    warnings.push(
      'No acquisition price is published for this parcel, so the all-in basis is a floor rather than an estimate.',
    );
  }

  await prisma.parcelOpportunity.update({
    where: { id: parcelId },
    data: {
      retailValueLow: toDecimal(valuation.retail?.low ?? null),
      retailValue: toDecimal(valuation.retail?.mid ?? null),
      retailValueHigh: toDecimal(valuation.retail?.high ?? null),
      quickSaleValueLow: toDecimal(valuation.quickSale?.low ?? null),
      quickSaleValue: toDecimal(valuation.quickSale?.mid ?? null),
      quickSaleValueHigh: toDecimal(valuation.quickSale?.high ?? null),
      investorLiquidationValue: toDecimal(valuation.investorLiquidation?.mid ?? null),
      valuationConfidence,
      comparableCount: valuation.compCount,
      valuationMethod: valuation.retail?.method ?? null,
      valuationWarnings: warnings.slice(0, 20),

      estimatedAcquisitionCost: toDecimal(acquisitionPriceCents || null),
      estimatedAllInBasis: toDecimal(economics?.allInBasis ?? null),
      estimatedCarryingCost: toDecimal(economics?.carryingCost ?? null),
      estimatedTitleCost: toDecimal(economics?.titleCost ?? null),
      estimatedCurativeCost: toDecimal(economics?.curativeCost ?? null),
      estimatedMarketingCost: toDecimal(economics?.marketingCost ?? null),
      estimatedRecordingCost: toDecimal(economics?.recordingCost ?? null),
      basisToQsv: economics?.basisToQsv ?? null,
      basisToRetail: economics?.basisToRetail ?? null,
      expectedGrossMargin: toDecimal(economics?.grossProfitAtQsv ?? null),
      roiAtQsv: economics?.roiAtQsv ?? null,
      annualizedRoiAtQsv: economics?.annualizedRoiAtQsv ?? null,
      economicsTier: economics?.tier ?? null,
    },
  });

  const snapshot = await prisma.parcelValuationSnapshot.create({
    data: {
      parcelId,
      retailValue: toDecimal(valuation.retail?.mid ?? null),
      quickSaleValue: toDecimal(valuation.quickSale?.mid ?? null),
      investorLiquidationValue: toDecimal(valuation.investorLiquidation?.mid ?? null),
      confidence: valuationConfidence,
      comparableCount: valuation.compCount,
      method: valuation.retail?.method ?? 'none',
      detail: {
        pricePerAcreUsed: valuation.pricePerAcreUsed,
        economics: economics as unknown as Prisma.InputJsonValue,
        warnings,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  // Record exactly which comps were used, with their adjustments, so the
  // number can be defended rather than merely reproduced.
  if (valuation.comps.length > 0) {
    await prisma.comparableLink.createMany({
      data: valuation.comps.map((comp) => ({
        parcelId,
        comparableId: comp.id,
        valuationSnapshotId: snapshot.id,
        distanceMeters: comp.distanceMeters,
        weight: comp.weight,
        adjustedPricePerAcre: toDecimal(comp.adjustedPricePerAcre)!,
        adjustments: comp.adjustments as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }

  logger.info('valued parcel', {
    parcelId,
    comps: valuation.compCount,
    qsv: valuation.quickSale?.mid ?? null,
    basisToQsv: economics?.basisToQsv ?? null,
  });

  return { parcelId, valuation, economics, recommendedMaxBidCents, warnings };
}

async function curativeCostFor(parcelId: string): Promise<number> {
  const instruments = await prisma.titleInstrument.findMany({
    where: { parcelId, resolved: false },
    select: { severity: true },
  });
  if (instruments.length === 0) return 0;
  return estimateCurativeCostCents({
    riskScore: 0,
    band: 'LOW',
    findings: instruments.map((instrument) => ({
      instrumentType: 'UNKNOWN',
      severity: instrument.severity as 'INFO' | 'MINOR' | 'MODERATE' | 'MAJOR' | 'BLOCKING',
      summary: '',
      points: 0,
    })),
    chainDepth: 0,
    chainGaps: [],
    unknowns: [],
    requiresProfessionalReview: false,
    confidence: 'UNKNOWN',
    disclaimer: '',
  });
}

/** Sum of estimated costs, used by the detail page's economics breakdown. */
export function totalCosts(economics: OpportunityEconomics): number {
  return addCents(
    economics.governmentFees,
    economics.recordingCost,
    economics.titleCost,
    economics.curativeCost,
    economics.carryingCost,
    economics.marketingCost,
  );
}
