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

/** Generate an investment memo for this parcel, synchronously. */
export async function generateMemoAction(parcelId: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  try {
    const { generateMemoForParcel } = await import('@land-alpha/core');
    const result = await generateMemoForParcel(parcelId, user.email);
    revalidatePath(`/opportunities/${parcelId}`);
    return {
      ok: true,
      message: `Memo v${result.version} generated${result.deterministic ? ' (deterministic — no AI provider configured)' : ''}.`,
    };
  } catch (error) {
    return { ok: false, message: `Memo generation failed: ${String(error).slice(0, 200)}` };
  }
}

/**
 * Generate a public marketing package.
 *
 * Generating is not publishing: the listing is created unpublished and a human
 * must publish it explicitly.
 */
export async function generateListingAction(parcelId: string): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  try {
    const { generateListingForParcel } = await import('@land-alpha/core');
    const result = await generateListingForParcel(parcelId, user.email);
    await recordActivity(user, {
      action: 'listing.generate',
      entityType: 'ParcelOpportunity',
      entityId: parcelId,
      summary: `Generated a listing (${result.withheldClaims.length} claims withheld as unsupported)`,
    });
    revalidatePath(`/opportunities/${parcelId}`);
    return {
      ok: true,
      message: `Listing generated at /properties/${result.slug}. ${result.withheldClaims.length} claims were withheld as unsupported. Review before publishing.`,
    };
  } catch (error) {
    return { ok: false, message: `Listing generation failed: ${String(error).slice(0, 200)}` };
  }
}

/** Publish or unpublish a listing. Always an explicit human act. */
export async function setListingPublishedAction(
  parcelId: string,
  published: boolean,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const { setListingPublished } = await import('@land-alpha/core');
  await setListingPublished(parcelId, published);
  await recordActivity(user, {
    action: published ? 'listing.publish' : 'listing.unpublish',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `${published ? 'Published' : 'Unpublished'} the public listing`,
  });
  revalidatePath(`/opportunities/${parcelId}`);
  revalidatePath('/properties');
  return { ok: true, message: published ? 'Listing published.' : 'Listing unpublished.' };
}

/**
 * Record what an analyst saw in a public map viewer.
 *
 * FEMA's NFHL, the National Wetlands Inventory and EPA's coordinate-bearing
 * facility service are all published behind robots directives or bot protection
 * that this project does not work around, so a person looking at the map is the
 * only screening those layers will ever get. This puts what they saw into the
 * same engine an API response would feed, then re-runs enrichment and scoring so
 * the parcel's rating moves immediately — which is the whole point, since a
 * parcel with no hazard screening is capped at buildability UNKNOWN.
 */
export async function recordEnvironmentalScreenAction(
  parcelId: string,
  input: {
    layer: 'FLOOD' | 'WETLANDS' | 'CONTAMINATION' | 'SOILS';
    findings: string;
    overlapPercent: string;
    nearestSiteMeters: string;
    clear: boolean;
    sourceUrl: string;
    notes: string;
  },
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');
  const { recordManualScreen } = await import('@land-alpha/core');

  const findings = input.findings
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const overlapPercent = input.overlapPercent.trim() ? Number(input.overlapPercent) : null;
  if (
    overlapPercent != null &&
    (!Number.isFinite(overlapPercent) || overlapPercent < 0 || overlapPercent > 100)
  ) {
    return { ok: false, message: 'Overlap must be a percentage between 0 and 100.' };
  }
  const nearestSiteMeters = input.nearestSiteMeters.trim() ? Number(input.nearestSiteMeters) : null;
  if (nearestSiteMeters != null && (!Number.isFinite(nearestSiteMeters) || nearestSiteMeters < 0)) {
    return {
      ok: false,
      message: 'Distance to the nearest site must be a positive number of metres.',
    };
  }

  try {
    await recordManualScreen({
      parcelId,
      layer: input.layer,
      findings,
      overlapFraction: overlapPercent == null ? null : overlapPercent / 100,
      nearestSiteMeters,
      clear: input.clear,
      sourceUrl: input.sourceUrl.trim() || null,
      notes: input.notes.trim() || null,
      screenedById: user.id,
      screenedByLabel: user.name,
    });
  } catch (error) {
    return { ok: false, message: String(error instanceof Error ? error.message : error) };
  }

  await recordActivity(user, {
    action: 'parcel.environmental-screen',
    entityType: 'ParcelOpportunity',
    entityId: parcelId,
    summary: `Recorded a manual ${input.layer.toLowerCase()} screen: ${
      input.clear ? 'clear' : findings.join(', ') || `${nearestSiteMeters} m to nearest site`
    }`,
    metadata: { layer: input.layer, findings, clear: input.clear, sourceUrl: input.sourceUrl },
  });

  // Re-run the screen so the rating reflects the new evidence without the
  // analyst having to remember a second button.
  await enrichParcel(parcelId, { stages: ['environmental', 'buildability'] });
  await scoreParcelById(parcelId);

  revalidatePath(`/opportunities/${parcelId}`);
  return { ok: true, message: `Recorded. ${input.layer} is now screened.` };
}

/**
 * Record the acquisition price an analyst obtained.
 *
 * Tax-deed and lands-available inventory is published without a price: Orange
 * County's layer carries a TDA number, a sale date and a status, and the payoff
 * figure — opening bid plus accrued taxes, interest and fees — comes from the
 * Comptroller on request. Until someone asks, the parcel has no cost, and
 * without a cost there is no spread, no return and nothing to rank.
 *
 * Writing it to `askingPrice` puts it exactly where a published price would go,
 * so valuation, scoring and the memo consume it with no special case. What the
 * audit log preserves is that a person supplied it.
 */
export async function setAcquisitionPriceAction(
  parcelId: string,
  dollars: string,
  note: string,
): Promise<ActionResult> {
  const user = await requireRole('ANALYST');

  const trimmed = dollars.trim();
  if (!trimmed) {
    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: { askingPrice: null },
    });
    await recordActivity(user, {
      action: 'parcel.acquisition-price',
      entityType: 'ParcelOpportunity',
      entityId: parcelId,
      summary: 'Cleared the acquisition price',
    });
  } else {
    const amount = Number(trimmed.replace(/[$,]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, message: 'Enter the price in dollars, or leave it blank to clear it.' };
    }
    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: { askingPrice: toDecimal(Math.round(amount * 100)) },
    });
    await recordActivity(user, {
      action: 'parcel.acquisition-price',
      entityType: 'ParcelOpportunity',
      entityId: parcelId,
      summary: `Recorded an acquisition price of $${amount.toLocaleString('en-US')}${note.trim() ? ` — ${note.trim()}` : ''}`,
      metadata: { amount, note: note.trim() || null },
    });
  }

  // Re-price and re-rank immediately. A figure entered and not acted on is the
  // same as no figure at all.
  await valuateParcel(parcelId);
  await scoreParcelById(parcelId);
  revalidatePath(`/opportunities/${parcelId}`);
  revalidatePath('/opportunities');
  return {
    ok: true,
    message: trimmed ? 'Price recorded. Economics and rank updated.' : 'Price cleared.',
  };
}

export interface BulkPriceResult extends ActionResult {
  readonly applied: number;
  readonly unmatched: string[];
}

/**
 * Record acquisition prices in bulk from a county's reply.
 *
 * A county holds one list and answers one request. Orange has forty-six
 * parcels waiting on a payoff figure and one Comptroller; the reply comes back
 * as a list, and re-typing forty-six numbers one page at a time is where this
 * work stops being done.
 *
 * Accepts anything with a reference and an amount on each line — comma, tab or
 * whitespace separated — because the reply will be pasted out of a spreadsheet
 * or an email and should not have to be cleaned up first. References match
 * against the source record ID (a TDA number) or the APN, in that order.
 * Anything unmatched is reported rather than silently dropped: a line that
 * quietly did nothing is how a parcel ends up priced in someone's head and not
 * in the system.
 */
export async function recordPricesInBulkAction(
  state: string,
  county: string,
  pasted: string,
): Promise<BulkPriceResult> {
  const user = await requireRole('ANALYST');
  const { recordPricesInBulk } = await import('@land-alpha/core');
  const outcome = await recordPricesInBulk(state, county, pasted);

  if (outcome.applied > 0) {
    await recordActivity(user, {
      action: 'parcel.acquisition-price.bulk',
      entityType: 'Source',
      entityId: `${state}/${county}`,
      summary: `Recorded ${outcome.applied} acquisition prices for ${county} County, ${state}`,
      metadata: { applied: outcome.applied, unmatched: outcome.unmatched.length },
    });
  }

  revalidatePath('/blocked');
  revalidatePath('/opportunities');
  return {
    ok: outcome.applied > 0,
    applied: outcome.applied,
    unmatched: [...outcome.unmatched],
    message:
      outcome.applied === 0
        ? 'No lines matched a parcel in this county.'
        : `Recorded ${outcome.applied} price${outcome.applied === 1 ? '' : 's'}.${
            outcome.unmatched.length > 0
              ? ` ${outcome.unmatched.length} line(s) did not match.`
              : ''
          }`,
  };
}
