'use server';

import { revalidatePath } from 'next/cache';
import { prisma, toDecimal, getActiveScoringConfig } from '@land-alpha/db';
import { enrichParcel, scoreParcelById, valuateParcel } from '@land-alpha/core';
import type { AnalystDisposition, ParcelStatus } from '@land-alpha/shared';
import { requireRole } from '@/server/auth';
import { recordActivity } from '@/server/activity';
import { DEAL_CHECKLIST } from '@/server/deal-checklist';

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function setDispositionAction(
  parcelId: string,
  disposition: AnalystDisposition,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const status: Partial<Record<AnalystDisposition, ParcelStatus>> = {
    PURSUE: 'DUE_DILIGENCE',
    MONITOR: 'WATCHLIST',
    PASS: 'REJECTED',
  };

  await prisma.parcelOpportunity.update({
    where: { id: parcelId },
    data: {
      analystDisposition: disposition,
      reviewedAt: new Date(),
      ...(status[disposition] ? { status: status[disposition] } : {}),
      ...(disposition === 'MONITOR' ? { watchlisted: true } : {}),
    },
  });

  await recordActivity(user, {
    action: 'parcel.disposition',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Set disposition to ${disposition}`,
  });
  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: `Marked ${disposition.toLowerCase()}.` };
}

export async function toggleWatchlistAction(parcelId: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    select: { watchlisted: true },
  });
  if (!parcel) return { ok: false, message: 'Parcel not found.' };

  const watchlisted = !parcel.watchlisted;
  await prisma.parcelOpportunity.update({ where: { id: parcelId }, data: { watchlisted } });

  const list = await prisma.watchlist.upsert({
    where: { userId_name: { userId: user.id, name: 'Primary' } },
    create: { userId: user.id, name: 'Primary' },
    update: {},
    select: { id: true },
  });
  if (watchlisted) {
    await prisma.watchlistItem.upsert({
      where: { watchlistId_parcelId: { watchlistId: list.id, parcelId } },
      create: { watchlistId: list.id, parcelId },
      update: {},
    });
  } else {
    await prisma.watchlistItem.deleteMany({ where: { watchlistId: list.id, parcelId } });
  }

  revalidatePath(`/opportunities/${parcelId}`);
  revalidatePath('/watchlists');
  return { ok: true, message: watchlisted ? 'Added to watchlist.' : 'Removed from watchlist.' };
}

/**
 * Open a deal room.
 *
 * Creating the deal materialises the full due-diligence checklist. Nothing here
 * commits to an acquisition — it commits to *doing the work*, which is the only
 * thing software should be deciding.
 */
export async function startDueDiligenceAction(parcelId: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');

  const existing = await prisma.deal.findUnique({ where: { parcelId }, select: { id: true } });
  if (existing) return { ok: true, message: 'Deal room already open.' };

  await prisma.$transaction(async (tx) => {
    const deal = await tx.deal.create({
      data: { parcelId, openedById: user.id },
      select: { id: true },
    });
    await tx.dealChecklistItem.createMany({
      data: DEAL_CHECKLIST.map((item, index) => ({
        dealId: deal.id,
        key: item.key,
        label: item.label,
        category: item.category,
        required: item.required,
        ordering: index,
      })),
    });
    await tx.parcelOpportunity.update({
      where: { id: parcelId },
      data: { status: 'DUE_DILIGENCE', analystDisposition: 'PURSUE', reviewedAt: new Date() },
    });
  });

  await recordActivity(user, {
    action: 'deal.open',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: 'Opened a deal room and started due diligence',
  });
  revalidatePath(`/opportunities/${parcelId}`);
  revalidatePath('/deals');
  return { ok: true, message: 'Deal room opened.' };
}

/**
 * Record an approved maximum bid.
 *
 * This is the closest the software comes to an acquisition decision, and it
 * stops here: it records a human's authorisation and its exact value. The
 * system never submits a bid, signs an agreement, or moves money.
 */
export async function approveMaxBidAction(
  parcelId: string,
  maxBidDollars: number,
  acknowledgement: boolean,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  if (!Number.isFinite(maxBidDollars) || maxBidDollars <= 0) {
    return { ok: false, message: 'Enter a maximum bid greater than zero.' };
  }

  const config = await getActiveScoringConfig();
  const HIGH_VALUE_CENTS = 25_000_00;
  const cents = Math.round(maxBidDollars * 100);

  if (cents >= HIGH_VALUE_CENTS && !acknowledgement) {
    return {
      ok: false,
      message:
        'Acquisitions at or above $25,000 require explicit acknowledgement that the due-diligence checklist has been reviewed.',
    };
  }

  const deal = await prisma.deal.findUnique({ where: { parcelId }, select: { id: true } });

  await prisma.$transaction(async (tx) => {
    await tx.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        approvedMaxBid: toDecimal(cents),
        approvedMaxBidBy: user.id,
        approvedMaxBidAt: new Date(),
        status: 'READY_TO_BID',
      },
    });
    if (deal) {
      await tx.deal.update({
        where: { id: deal.id },
        data: {
          approvedMaxBid: toDecimal(cents),
          approvedById: user.id,
          approvedAt: new Date(),
          ...(acknowledgement
            ? { dueDiligenceAcknowledgedBy: user.id, dueDiligenceAcknowledgedAt: new Date() }
            : {}),
        },
      });
    }
  });

  await recordActivity(user, {
    action: 'parcel.approveMaxBid',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Approved a maximum bid of $${maxBidDollars.toLocaleString('en-US')}`,
    metadata: { cents, acknowledgement, scoringConfigVersion: config.version },
  });

  revalidatePath(`/opportunities/${parcelId}`);
  return {
    ok: true,
    message: `Maximum bid of $${maxBidDollars.toLocaleString('en-US')} recorded. You must place the bid yourself with the issuing office.`,
  };
}

/**
 * Override a rejection rule. Requires a written reason, which is stored and
 * audited — an override with no stated justification is not an override, it is
 * an accident waiting to be repeated.
 */
export async function overrideRejectionAction(
  parcelId: string,
  rule: string,
  reason: string,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  if (reason.trim().length < 12) {
    return { ok: false, message: 'Give a substantive reason for overriding this rule.' };
  }

  await prisma.parcelOpportunity.update({
    where: { id: parcelId },
    data: { rejectionOverriddenBy: user.id, rejectionOverrideNote: rule },
  });
  await prisma.parcelNote.create({
    data: {
      parcelId,
      userId: user.id,
      body: `Rejection override — ${rule}: ${reason.trim()}`,
      pinned: true,
    },
  });
  await scoreParcelById(parcelId);

  await recordActivity(user, {
    action: 'parcel.overrideRejection',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Overrode rejection rule ${rule}`,
    metadata: { rule, reason: reason.trim() },
  });
  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: `Override recorded for ${rule}.` };
}

export async function addNoteAction(parcelId: string, body: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  if (!body.trim()) return { ok: false, message: 'Note is empty.' };
  await prisma.parcelNote.create({ data: { parcelId, userId: user.id, body: body.trim() } });
  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: 'Note added.' };
}

/** Re-run enrichment, valuation and scoring for a single parcel, synchronously. */
export async function refreshParcelAction(parcelId: string): Promise<ActionResult> {
  await requireRole('ANALYST');
  try {
    await enrichParcel(parcelId);
    await valuateParcel(parcelId);
    const score = await scoreParcelById(parcelId);
    revalidatePath(`/opportunities/${parcelId}`);
    return {
      ok: true,
      message: `Re-scored: Alpha ${score.alphaScore}${score.rejected ? ' (rejected)' : ''}.`,
    };
  } catch (error) {
    return { ok: false, message: `Refresh failed: ${String(error).slice(0, 200)}` };
  }
}
