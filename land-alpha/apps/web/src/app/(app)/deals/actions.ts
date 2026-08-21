'use server';

import { revalidatePath } from 'next/cache';
import { prisma, toDecimal } from '@land-alpha/db';
import { requireRole } from '@/server/auth';
import { recordActivity } from '@/server/activity';

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function setChecklistItemAction(
  itemId: string,
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'NOT_APPLICABLE',
  findings: string,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const item = await prisma.dealChecklistItem.update({
    where: { id: itemId },
    data: {
      status,
      findings: findings.trim() || null,
      completedById: status === 'COMPLETE' ? user.id : null,
      completedAt: status === 'COMPLETE' ? new Date() : null,
    },
    select: { dealId: true, label: true, deal: { select: { parcelId: true } } },
  });

  revalidatePath(`/deals/${item.dealId}`);
  return { ok: true, message: `${item.label}: ${status.toLowerCase().replace('_', ' ')}.` };
}

/**
 * Record an acquisition that already happened.
 *
 * The wording matters: this does not *buy* anything. A human bought the parcel
 * at a government auction or counter, and this records the outcome so the
 * portfolio and the outcome ledger reflect reality.
 */
export async function recordAcquisitionAction(
  parcelId: string,
  input: { pricePaidDollars: number; closingCostsDollars: number; acquiredOn: string },
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  if (!Number.isFinite(input.pricePaidDollars) || input.pricePaidDollars <= 0) {
    return { ok: false, message: 'Enter the price actually paid.' };
  }
  const acquiredAt = new Date(input.acquiredOn);
  if (Number.isNaN(acquiredAt.getTime())) {
    return { ok: false, message: 'Enter a valid acquisition date.' };
  }

  const priceCents = Math.round(input.pricePaidDollars * 100);
  const closingCents = Math.round((input.closingCostsDollars || 0) * 100);

  await prisma.$transaction(async (tx) => {
    await tx.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        status: 'ACQUIRED',
        actualPurchasePrice: toDecimal(priceCents),
        acquiredAt,
      },
    });
    await tx.portfolioAsset.upsert({
      where: { parcelId },
      create: {
        parcelId,
        acquiredAt,
        acquisitionPrice: toDecimal(priceCents)!,
        closingCosts: toDecimal(closingCents)!,
      },
      update: {
        acquiredAt,
        acquisitionPrice: toDecimal(priceCents)!,
        closingCosts: toDecimal(closingCents)!,
      },
    });
    // The outcome ledger: what actually happened, which is the training data
    // for the eventual "which mechanisms produce abnormal returns" question.
    await tx.auctionOutcome.create({
      data: {
        parcelId,
        eventType: 'ACQUISITION',
        eventDate: acquiredAt,
        winningBid: toDecimal(priceCents),
        soldToUs: true,
        outcome: 'WON',
      },
    });
    await tx.deal.updateMany({
      where: { parcelId },
      data: { closedAt: new Date(), outcome: 'ACQUIRED' },
    });
  });

  await recordActivity(user, {
    action: 'parcel.acquired',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Recorded acquisition at $${input.pricePaidDollars.toLocaleString('en-US')}`,
    metadata: { priceCents, closingCents },
  });

  revalidatePath('/portfolio');
  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: 'Acquisition recorded and added to the portfolio.' };
}

export async function recordBidOutcomeAction(
  parcelId: string,
  outcome: 'WON' | 'LOST',
  winningBidDollars: number | null,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  await prisma.$transaction(async (tx) => {
    await tx.parcelOpportunity.update({
      where: { id: parcelId },
      data: { status: outcome === 'WON' ? 'WON' : 'LOST' },
    });
    await tx.auctionOutcome.create({
      data: {
        parcelId,
        eventType: 'AUCTION',
        eventDate: new Date(),
        winningBid:
          winningBidDollars == null ? null : toDecimal(Math.round(winningBidDollars * 100)),
        soldToUs: outcome === 'WON',
        outcome,
      },
    });
  });
  await recordActivity(user, {
    action: 'parcel.bidOutcome',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Recorded bid outcome: ${outcome}`,
  });
  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: `Recorded as ${outcome.toLowerCase()}.` };
}
