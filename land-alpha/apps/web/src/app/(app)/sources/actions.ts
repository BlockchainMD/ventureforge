'use server';

import { revalidatePath } from 'next/cache';
import { prisma, getQueue } from '@land-alpha/db';
import { requireRole } from '@/server/auth';
import { recordActivity } from '@/server/activity';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * Queue an ingestion run.
 *
 * Enqueued rather than run inline: a county import can take minutes and must
 * survive a browser tab closing. The dedupe key means clicking twice does not
 * hit the county's server twice.
 */
export async function triggerIngestionAction(sourceId: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { name: true, ingestionMethod: true, sourceStatus: true },
  });
  if (!source) return { ok: false, message: 'Source not found.' };

  if (source.ingestionMethod === 'MANUAL_SOURCE') {
    return {
      ok: false,
      message:
        'This source is manual-only — it sits behind an access control we do not circumvent. Use the manual import workflow instead.',
    };
  }

  const queue = await getQueue();
  await queue.enqueue(
    'source.ingest',
    { sourceId, triggeredBy: user.email },
    { dedupeKey: `source.ingest:${sourceId}`, priority: 5 },
  );

  await recordActivity(user, {
    action: 'source.ingest',
    entityType: 'Source',
    entityId: sourceId,
    summary: `Queued an ingestion run for ${source.name}`,
  });
  revalidatePath('/sources');
  revalidatePath('/ingestion');
  return { ok: true, message: `Ingestion queued for ${source.name}.` };
}

/**
 * Enable or disable a source.
 *
 * A source the operator disabled stays disabled through registry syncs — the
 * registry file defines what exists, the operator decides what runs.
 */
export async function setSourceEnabledAction(
  sourceId: string,
  enabled: boolean,
): Promise<ActionResult> {
  const user = await requireRole('ADMIN');
  const source = await prisma.source.update({
    where: { id: sourceId },
    data: { enabled, ...(enabled ? { sourceStatus: 'ACTIVE' } : {}) },
    select: { name: true },
  });
  await recordActivity(user, {
    action: enabled ? 'source.enable' : 'source.disable',
    entityType: 'Source',
    entityId: sourceId,
    summary: `${enabled ? 'Enabled' : 'Disabled'} ${source.name}`,
  });
  revalidatePath('/sources');
  return { ok: true, message: `${source.name} ${enabled ? 'enabled' : 'disabled'}.` };
}

/**
 * Approve a discovered source candidate.
 *
 * Nothing found by the discovery agent becomes a production ingestion source
 * without this step. That is a hard product rule, not a workflow preference.
 */
export async function reviewCandidateAction(
  candidateId: string,
  decision: 'APPROVED' | 'REJECTED',
  notes: string,
): Promise<ActionResult> {
  const user = await requireRole('ADMIN');
  await prisma.sourceDiscoveryCandidate.update({
    where: { id: candidateId },
    data: {
      status: decision,
      reviewedById: user.id,
      reviewedAt: new Date(),
      reviewNotes: notes.trim() || null,
    },
  });
  await recordActivity(user, {
    action: 'source.reviewCandidate',
    entityType: 'SourceDiscoveryCandidate',
    entityId: candidateId,
    summary: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} a discovered source candidate`,
    metadata: { notes },
  });
  revalidatePath('/sources');
  return {
    ok: true,
    message:
      decision === 'APPROVED'
        ? 'Approved. Add a registry entry and adapter to bring it into production.'
        : 'Rejected.',
  };
}
