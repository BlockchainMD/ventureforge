import { createLogger } from '@land-alpha/shared/logger';
import { getActiveScoringConfig, prisma, saveScoringConfig, toCents } from '@land-alpha/db';
import {
  calibrateFromOutcomes,
  DEFAULT_CALIBRATION_CONFIG,
  type CalibrationConfig,
  type CalibrationReport,
  type RealisedOutcome,
} from '@land-alpha/valuation';
import { FIXTURE_APN_PREFIX } from '@land-alpha/db/seed/fixture-parcels';

/**
 * Gather what actually happened, and check it against what was predicted.
 *
 * The comparison is deliberately against the valuation snapshot in force when
 * the parcel was acquired, not the current one. Today's valuation has the
 * benefit of comparables recorded after the purchase, so grading against it
 * would flatter the model — it would be marking its own homework with the
 * answers in front of it.
 *
 * Fixture parcels are excluded. Calibrating a model against outcomes generated
 * by that same model is circular, and would manufacture confidence out of
 * nothing.
 */

const logger = createLogger({ component: 'calibration-service' });

export async function collectRealisedOutcomes(): Promise<RealisedOutcome[]> {
  const assets = await prisma.portfolioAsset.findMany({
    where: { soldAt: { not: null }, salePrice: { not: null } },
    include: {
      parcel: {
        select: {
          id: true,
          apn: true,
          state: true,
          county: true,
          acreage: true,
          accessClass: true,
        },
      },
    },
  });

  const outcomes: RealisedOutcome[] = [];
  for (const asset of assets) {
    if ((asset.parcel.apn ?? '').startsWith(FIXTURE_APN_PREFIX)) continue;

    const salePriceCents = toCents(asset.salePrice);
    if (salePriceCents == null || salePriceCents <= 0 || !asset.soldAt) continue;

    // The prediction that informed the purchase: the last snapshot taken on or
    // before the day the parcel was acquired.
    const snapshot = await prisma.parcelValuationSnapshot.findFirst({
      where: { parcelId: asset.parcelId, createdAt: { lte: asset.acquiredAt } },
      orderBy: { createdAt: 'desc' },
      select: { quickSaleValue: true, detail: true },
    });

    const detail = (snapshot?.detail ?? null) as { liquidity?: { holdDays?: number } } | null;
    const realisedHoldDays =
      asset.daysHeld ??
      Math.max(1, Math.round((asset.soldAt.getTime() - asset.acquiredAt.getTime()) / 86_400_000));

    outcomes.push({
      parcelId: asset.parcelId,
      state: asset.parcel.state,
      county: asset.parcel.county,
      acreage: asset.parcel.acreage,
      accessClass: asset.parcel.accessClass,
      predictedQuickSaleCents: toCents(snapshot?.quickSaleValue ?? null),
      predictedHoldDays: detail?.liquidity?.holdDays ?? null,
      realisedSalePriceCents: salePriceCents,
      realisedHoldDays,
      soldAt: asset.soldAt,
    });
  }
  return outcomes;
}

export async function runCalibration(
  options: { apply?: boolean; config?: CalibrationConfig } = {},
): Promise<CalibrationReport> {
  const outcomes = await collectRealisedOutcomes();
  const report = calibrateFromOutcomes(outcomes, options.config ?? DEFAULT_CALIBRATION_CONFIG);

  logger.info('calibration computed', {
    outcomes: outcomes.length,
    marketsCalibrated: Object.keys(report.valueCalibration).length,
    overallValueRatio: report.overall.valueRatio,
    overallHoldRatio: report.overall.holdRatio,
  });

  if (
    options.apply &&
    Object.keys(report.holdCalibration).length + Object.keys(report.valueCalibration).length > 0
  ) {
    const current = await getActiveScoringConfig();
    await saveScoringConfig(
      {
        weights: current.weights,
        thresholds: current.thresholds,
        costModel: current.costModel,
        rejectionRules: current.rejectionRules,
        holdCalibration: report.holdCalibration,
        valueCalibration: report.valueCalibration,
      },
      {
        description: `Calibrated against ${report.generatedFrom} closed sales across ${report.groups.length} markets.`,
      },
    );
    logger.info('calibration applied to scoring config', {
      markets: Object.keys(report.valueCalibration),
    });
  }

  return report;
}
