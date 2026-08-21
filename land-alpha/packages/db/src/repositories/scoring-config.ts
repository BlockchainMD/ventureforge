import { Prisma } from '@prisma/client';
import { prisma } from '../client';
import {
  DEFAULT_SCORING_CONFIG,
  type CostModel,
  type RejectionRuleConfig,
  type ScoringConfigValue,
  type ScoringThresholds,
  type ScoringWeights,
} from '@land-alpha/shared';

/** Persistence for versioned scoring configuration. Types live in `shared`. */

export async function getActiveScoringConfig(): Promise<ScoringConfigValue> {
  const row = await prisma.scoringConfig.findFirst({ where: { isActive: true } });
  if (!row) return DEFAULT_SCORING_CONFIG;
  return {
    version: row.version,
    weights: row.weights as unknown as ScoringWeights,
    thresholds: row.thresholds as unknown as ScoringThresholds,
    costModel: row.costModel as unknown as CostModel,
    rejectionRules: row.rejectionRules as unknown as RejectionRuleConfig[],
  };
}

export async function saveScoringConfig(
  value: Omit<ScoringConfigValue, 'version'>,
  options: { description?: string; createdById?: string } = {},
): Promise<ScoringConfigValue> {
  const count = await prisma.scoringConfig.count();
  const version = `v${count + 1}`;
  await prisma.$transaction([
    prisma.scoringConfig.updateMany({ where: { isActive: true }, data: { isActive: false } }),
    prisma.scoringConfig.create({
      data: {
        version,
        isActive: true,
        weights: value.weights as unknown as Prisma.InputJsonValue,
        thresholds: value.thresholds as unknown as Prisma.InputJsonValue,
        costModel: value.costModel as unknown as Prisma.InputJsonValue,
        rejectionRules: value.rejectionRules as unknown as Prisma.InputJsonValue,
        description: options.description ?? null,
        createdById: options.createdById ?? null,
      },
    }),
  ]);
  return { ...value, version };
}

/** Weights must sum to 1 before they can be saved; the UI shows the running total. */
export function validateWeights(weights: ScoringWeights): { valid: boolean; sum: number } {
  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  return { valid: Math.abs(sum - 1) < 1e-6, sum };
}
