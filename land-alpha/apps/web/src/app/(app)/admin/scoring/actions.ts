'use server';

import { revalidatePath } from 'next/cache';
import { getQueue, prisma, saveScoringConfig, validateWeights } from '@land-alpha/db';
import type { CostModel, RejectionRuleConfig, ScoringThresholds, ScoringWeights } from '@land-alpha/shared';
import { requireRole } from '@/server/auth';
import { recordActivity } from '@/server/activity';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Save new scoring weights.
 *
 * Never edits in place. Saving creates a new immutable version and activates
 * it, so `ParcelScoreSnapshot.configVersion` always identifies exactly the
 * rules a historical score was produced under. Without that, comparing a score
 * from March against one from July would be meaningless.
 */
export async function saveScoringConfigAction(input: {
  weights: ScoringWeights;
  thresholds: ScoringThresholds;
  costModel: CostModel;
  rejectionRules: RejectionRuleConfig[];
  description: string;
}): Promise<ActionResult> {
  const user = await requireRole('ADMIN');

  const validation = validateWeights(input.weights);
  if (!validation.valid) {
    return {
      ok: false,
      message: `Weights must sum to 1.00 — they currently sum to ${validation.sum.toFixed(3)}.`,
    };
  }

  const saved = await saveScoringConfig(
    {
      weights: input.weights,
      thresholds: input.thresholds,
      costModel: input.costModel,
      rejectionRules: input.rejectionRules,
    },
    { description: input.description, createdById: user.id },
  );

  await recordActivity(user, {
    action: 'scoring.save',
    entityType: 'ScoringConfig',
    entityId: saved.version,
    summary: `Activated scoring configuration ${saved.version}`,
    metadata: { weights: input.weights, thresholds: input.thresholds },
  });

  revalidatePath('/admin/scoring');
  return {
    ok: true,
    message: `Saved as ${saved.version} and activated. Re-score the inventory to apply it.`,
  };
}

/** Queue a full re-score under the active configuration. */
export async function rescoreAllAction(): Promise<ActionResult> {
  const user = await requireRole('ADMIN');
  const parcels = await prisma.parcelOpportunity.findMany({
    where: { removedFromSourceAt: null },
    select: { id: true },
  });

  const queue = await getQueue();
  for (const parcel of parcels) {
    await queue.enqueue(
      'parcel.score',
      { parcelId: parcel.id },
      { dedupeKey: `parcel.score:${parcel.id}` },
    );
  }

  await recordActivity(user, {
    action: 'scoring.rescoreAll',
    entityType: 'ScoringConfig',
    entityId: 'active',
    summary: `Queued a re-score of ${parcels.length} parcels`,
  });

  revalidatePath('/admin/scoring');
  return {
    ok: true,
    message: `Queued ${parcels.length} parcels for re-scoring. Start the worker to process them.`,
  };
}
