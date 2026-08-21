'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@land-alpha/db';
import type { OpportunityFilter } from '@land-alpha/shared';
import { requireRole } from '@/server/auth';
import { recordActivity } from '@/server/activity';

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function saveSearchAction(
  name: string,
  filter: OpportunityFilter,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  await prisma.savedSearch.upsert({
    where: { userId_name: { userId: user.id, name } },
    create: { userId: user.id, name, filters: filter as unknown as object },
    update: { filters: filter as unknown as object },
  });
  revalidatePath('/opportunities');
  return { ok: true, message: `Saved “${name}”.` };
}

/**
 * An alert rule is the same filter, plus a delivery channel. Nothing is
 * translated between the two — the alert evaluator runs the identical query the
 * table just ran, which is what guarantees an alert and a saved search can
 * never disagree about what matches.
 */
export async function createAlertRuleAction(
  name: string,
  filter: OpportunityFilter,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  await prisma.alertRule.upsert({
    where: { userId_name: { userId: user.id, name } },
    create: {
      userId: user.id,
      name,
      filters: filter as unknown as object,
      channels: ['IN_APP', 'EMAIL'],
      enabled: true,
    },
    update: { filters: filter as unknown as object, enabled: true },
  });
  await prisma.savedSearch.upsert({
    where: { userId_name: { userId: user.id, name } },
    create: { userId: user.id, name, filters: filter as unknown as object },
    update: { filters: filter as unknown as object },
  });
  await recordActivity(user, {
    action: 'alert.create',
    entityType: 'AlertRule',
    entityId: name,
    summary: `Created alert rule “${name}”`,
    metadata: { filter },
  });
  revalidatePath('/opportunities');
  return { ok: true, message: `Alerting on “${name}”.` };
}
