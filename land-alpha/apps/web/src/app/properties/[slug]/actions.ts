'use server';

import { z } from 'zod';
import { prisma, toDecimal } from '@land-alpha/db';
import { createLogger } from '@land-alpha/shared/logger';
import { notifyNewLead } from '@land-alpha/core';

const logger = createLogger({ component: 'public-inquiry' });

/**
 * Public enquiry intake.
 *
 * Unauthenticated, so everything is validated and bounded. The listing must
 * actually be published and must own the supplied parcel, so a crafted
 * parcelId cannot attach an enquiry to unlisted inventory.
 */
const inquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional(),
  offerAmount: z.coerce.number().nonnegative().max(50_000_000).optional(),
  financing: z.enum(['CASH', 'FINANCING', 'OWNER_FINANCING']).optional(),
  inquiry: z.string().trim().max(2000).optional(),
});

export async function submitInquiryAction(
  parcelId: string,
  slug: string,
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  const listing = await prisma.listing.findUnique({
    where: { slug },
    select: { parcelId: true, published: true },
  });
  if (!listing || !listing.published || listing.parcelId !== parcelId) {
    return { ok: false, message: 'This property is not currently available for enquiries.' };
  }

  const raw = {
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') || undefined,
    offerAmount: formData.get('offerAmount') || undefined,
    financing: formData.get('financing') || undefined,
    inquiry: formData.get('inquiry') || undefined,
  };

  const parsed = inquirySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: 'Please check the details and try again.' };
  }

  const data = parsed.data;
  const lead = await prisma.lead.create({
    data: {
      parcelId,
      name: data.name,
      email: data.email.toLowerCase(),
      phone: data.phone ?? null,
      offerAmount: data.offerAmount ? toDecimal(Math.round(data.offerAmount * 100)) : null,
      financing: data.financing ?? null,
      inquiry: data.inquiry ?? null,
      source: 'PUBLIC_SITE',
      status: 'NEW',
    },
    select: { id: true },
  });

  // Response time is the strongest predictor of conversion here, so a lead
  // reaches someone who can act on it rather than waiting to be discovered.
  // A failure to notify must not lose the buyer their confirmation — the lead
  // is already saved either way.
  try {
    await notifyNewLead(lead.id);
  } catch (error) {
    logger.error('lead saved but notification failed', { leadId: lead.id, error: String(error) });
  }

  logger.info('public enquiry received', { slug, hasOffer: data.offerAmount != null });
  return { ok: true, message: 'Enquiry received.' };
}
