'use server';

import { z } from 'zod';
import { prisma, toDecimal } from '@land-alpha/db';
import { createLogger } from '@land-alpha/shared/logger';

const logger = createLogger({ component: 'public-inquiry' });

/**
 * Public enquiry intake.
 *
 * Unauthenticated, so everything is validated and bounded. The parcel is taken
 * from the route, and the listing must actually be published — a crafted
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
  await prisma.lead.create({
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
  });

  logger.info('public enquiry received', { slug, hasOffer: data.offerAmount != null });
  return { ok: true, message: 'Enquiry received.' };
}
