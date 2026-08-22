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
  DEFAULT_LIQUIDITY_CONFIG,
  DEFAULT_VALUATION_CONFIG,
  estimateHoldDays,
  maximumBidForTargetRatio,
  valueParcel,
  type CompCandidate,
} from '@land-alpha/valuation';
import { estimateCurativeCostCents } from '@land-alpha/title-research';
import { FIXTURE_COMP_SOURCE } from '@land-alpha/db/seed/comparables';
import { FIXTURE_APN_PREFIX } from '@land-alpha/db/seed/fixture-parcels';

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

  // A fixture parcel draws only on fixture sales and a real parcel only on
  // recorded ones. Once a county publishes a real roll, letting the two mix
  // would make a fixture's expected conclusion drift with that county's
  // market — the specification tests would stop measuring the pipeline.
  const fixtures = (parcel.apn ?? '').startsWith(FIXTURE_APN_PREFIX) ? 'only' : 'exclude';

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
      fixtures,
    });

    candidates = rows.map((row) => ({
      id: row.id,
      apn: row.apn,
      saleDate: row.saleDate,
      salePriceCents: Math.round(Number(row.salePrice) * 100),
      acreage: row.acreage,
      distanceMeters: row.distance_m == null ? null : Number(row.distance_m),
      zoning: row.zoning,
      neighborhood: row.neighborhood,
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
        fixtures,
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
          neighborhood: row.neighborhood,
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

  // A market where parcels consistently fetch less than predicted needs its
  // estimates lowered, and the correction belongs on the value rather than on
  // the comparables — the comps are what the market did, the error is in how we
  // read them.
  const marketKey = `${parcel.state}/${parcel.county}`;
  const valueCorrection = config.valueCalibration?.[marketKey];

  const valuation = valueParcel(
    {
      subject: {
        acreage: acreage ?? 0,
        neighborhood: parcel.neighborhood,
        zoning: parcel.zoning,
        accessClass: parcel.accessClass === 'UNKNOWN' ? null : parcel.accessClass,
        hasUtilities: parcel.knownUtilities.length > 0 ? true : null,
      },
      candidates,
      landAssessedValueCents: toCents(parcel.landAssessedValue),
    },
    {
      ...DEFAULT_VALUATION_CONFIG,
      comps: DEFAULT_COMPS_CONFIG,
      quickSaleDiscount: config.costModel.quickSaleDiscountFromRetail,
      investorLiquidationDiscount: config.costModel.investorLiquidationDiscountFromRetail,
      marketCorrection: valueCorrection ?? 1,
    },
  );
  warnings.push(...valuation.warnings);
  if (valueCorrection != null && Math.abs(valueCorrection - 1) > 0.02) {
    warnings.push(
      valueCorrection < 1
        ? `Values in ${marketKey} are corrected down ${((1 - valueCorrection) * 100).toFixed(0)}% because parcels sold here have fetched less than this engine predicted.`
        : `Values in ${marketKey} are corrected up ${((valueCorrection - 1) * 100).toFixed(0)}% because parcels sold here have fetched more than this engine predicted.`,
    );
  }

  // ---- Economics -----------------------------------------------------------
  // Null, not zero. Nothing in this chain may substitute a favourable number
  // for a missing one: a parcel priced at nothing scores as the best deal on
  // the board, which is precisely inverted from the truth that nobody has
  // obtained its payoff figure yet.
  const acquisitionPriceCents =
    toCents(parcel.askingPrice) ?? toCents(parcel.minimumBid) ?? toCents(parcel.taxesDue) ?? null;

  const curativeCents = parcel.titleRiskScore != null ? await curativeCostFor(parcelId) : 0;

  // ---- Liquidity -----------------------------------------------------------
  // Estimated before economics, because how long the parcel takes to sell sets
  // the carrying cost and the annualised return the ranking is built on.
  const liquidity = estimateHoldDays(
    {
      acreage,
      quickSaleValueCents: valuation.quickSale?.mid ?? null,
      accessClass: parcel.accessClass === 'UNKNOWN' ? null : parcel.accessClass,
      buildability: parcel.buildability === 'UNKNOWN' ? null : parcel.buildability,
      hasUtilities: parcel.knownUtilities.length > 0 ? true : null,
      comparableCount: valuation.compCount,
    },
    { ...DEFAULT_LIQUIDITY_CONFIG, calibration: config.holdCalibration ?? {} },
    `${parcel.state}/${parcel.county}`,
  );
  warnings.push(...liquidity.warnings);

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
            holdDaysOverride: liquidity.holdDays,
          },
          config.costModel,
          config.thresholds,
        )
      : null;

  // Computed whether or not the price is known — when it is not, this is the
  // single most useful number on the page: what the parcel is worth bidding.
  const recommendedMaxBidCents = valuation.quickSale
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
    acquisitionPriceCents == null
      ? minConfidence(valuation.confidence, 'LOW')
      : valuation.confidence;

  if (acquisitionPriceCents == null) {
    warnings.push(
      'No acquisition price is published for this parcel. The all-in basis shown is a floor covering closing and carrying costs only, and no return, margin or acquisition tier can be computed until the payoff figure is obtained.',
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

      estimatedAcquisitionCost: toDecimal(acquisitionPriceCents),
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

      expectedHoldDays: liquidity.holdDays,
      liquidityConfidence: liquidity.confidence,
      liquidityFactors: liquidity.factors as unknown as Prisma.InputJsonValue,
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
        liquidity: liquidity as unknown as Prisma.InputJsonValue,
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
    holdDays: liquidity.holdDays,
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
