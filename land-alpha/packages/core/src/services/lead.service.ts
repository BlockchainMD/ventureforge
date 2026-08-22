import { createLogger } from '@land-alpha/shared/logger';
import { formatCents, formatAcres } from '@land-alpha/shared';
import { prisma, toCents } from '@land-alpha/db';

/**
 * Getting a buyer enquiry in front of a person.
 *
 * A public enquiry used to create a Lead row and notify nobody. It sat in the
 * database until somebody happened to open the Leads page, which for a
 * weekend enquiry could be Monday.
 *
 * Response time is the strongest predictor of conversion in this business. A
 * buyer enquiring on three parcels buys from whichever seller replies first,
 * and a lead two days old is usually already gone — so a lead nobody is told
 * about is close to a lead that never arrived.
 *
 * Urgency is graded by what the buyer actually did, because "someone asked a
 * question" and "someone offered money" should not arrive looking the same.
 */

const logger = createLogger({ component: 'lead-service' });

export type LeadUrgency = 'IMMEDIATE' | 'HIGH' | 'NORMAL';

export interface LeadSignal {
  readonly urgency: LeadUrgency;
  readonly title: string;
  readonly body: string;
}

/**
 * How loudly to announce a lead.
 *
 * An offer at or above the asking price is the strongest signal a public
 * listing can produce and is treated as such. Interest in financing is next:
 * those buyers are scarcer, slower to find, and worth substantially more over
 * the life of a note than a cash buyer at the same headline price.
 */
export function gradeLead(lead: {
  name: string;
  offerAmountCents: number | null;
  financing: string | null;
  inquiry: string | null;
  askingPriceCents: number | null;
  acreage: number | null;
  county: string;
  state: string;
}): LeadSignal {
  const where = `${lead.county} County, ${lead.state}`;
  const size = lead.acreage == null ? '' : ` · ${formatAcres(lead.acreage)}`;
  const wantsFinance = /finance|financing|monthly|payment|terms|owner/i.test(
    `${lead.financing ?? ''} ${lead.inquiry ?? ''}`,
  );

  if (lead.offerAmountCents != null && lead.offerAmountCents > 0) {
    const meetsAsking =
      lead.askingPriceCents != null && lead.offerAmountCents >= lead.askingPriceCents;
    const gap =
      lead.askingPriceCents == null || lead.askingPriceCents === 0
        ? null
        : (lead.askingPriceCents - lead.offerAmountCents) / lead.askingPriceCents;
    return {
      urgency: meetsAsking || (gap != null && gap <= 0.15) ? 'IMMEDIATE' : 'HIGH',
      title: `Offer ${formatCents(lead.offerAmountCents)} — ${where}`,
      body: [
        lead.name,
        lead.askingPriceCents == null
          ? null
          : meetsAsking
            ? `at or above the ${formatCents(lead.askingPriceCents)} asking price`
            : `against ${formatCents(lead.askingPriceCents)} asking`,
        wantsFinance ? 'asking about financing' : null,
      ]
        .filter(Boolean)
        .join(' · ')
        .concat(size),
    };
  }

  if (wantsFinance) {
    return {
      urgency: 'HIGH',
      title: `Financing enquiry — ${where}`,
      body: `${lead.name} is asking about payment terms${size}. These buyers are scarcer than cash buyers and worth more over the life of a note.`,
    };
  }

  return {
    urgency: 'NORMAL',
    title: `Enquiry — ${where}`,
    body: `${lead.name}${size}${lead.inquiry ? ` · "${lead.inquiry.slice(0, 90)}"` : ''}`,
  };
}

/**
 * Tell the people who can act on it.
 *
 * Viewers are excluded: notifying somebody who cannot reply is noise, and
 * noise is what makes an alert queue get ignored.
 */
export async function notifyNewLead(leadId: string): Promise<number> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      parcel: {
        select: {
          id: true,
          acreage: true,
          county: true,
          state: true,
          listing: { select: { askingPrice: true, slug: true } },
        },
      },
    },
  });
  if (!lead) return 0;

  const signal = gradeLead({
    name: lead.name,
    offerAmountCents: toCents(lead.offerAmount),
    financing: lead.financing,
    inquiry: lead.inquiry,
    askingPriceCents: toCents(lead.parcel?.listing?.askingPrice ?? null),
    acreage: lead.parcel?.acreage ?? null,
    county: lead.parcel?.county ?? 'Unknown',
    state: lead.parcel?.state ?? '',
  });

  const recipients = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'ANALYST'] }, isActive: true },
    select: { id: true },
  });
  if (recipients.length === 0) {
    logger.warn('lead received with nobody to notify', { leadId });
    return 0;
  }

  await prisma.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      channel: 'IN_APP',
      parcelId: lead.parcelId,
      urgency: signal.urgency,
      title: signal.title,
      body: `${signal.body} · ${lead.email}${lead.phone ? ` · ${lead.phone}` : ''}`,
      linkPath: '/leads',
    })),
  });

  logger.info('lead notification sent', {
    leadId,
    urgency: signal.urgency,
    recipients: recipients.length,
  });
  return recipients.length;
}
