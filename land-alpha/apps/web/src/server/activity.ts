import 'server-only';
import { prisma } from '@land-alpha/db';
import type { SessionUser } from './auth';

/**
 * Audit trail.
 *
 * Compliance principle 10 is "maintain complete audit history", and the actions
 * that matter here are the ones that move money or change a conclusion:
 * approving a maximum bid, overriding a rejection, changing scoring weights,
 * marking a parcel acquired. Every one of those writes a row.
 */
export async function recordActivity(
  actor: SessionUser | null,
  input: {
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await prisma.activityLog.create({
    data: {
      userId: actor?.id ?? null,
      actorLabel: actor ? `${actor.name} <${actor.email}>` : 'system',
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      metadata: (input.metadata ?? {}) as object,
    },
  });
}
