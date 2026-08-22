import type { MetadataRoute } from 'next';
import { prisma } from '@land-alpha/db';
import { env } from '@land-alpha/shared/env';

/**
 * Only published listings, and only ones still for sale.
 *
 * A sitemap advertising a parcel that has sold wastes crawl budget and sends
 * buyers to a dead end, which is worse than not listing it at all.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env().NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');

  const listings = await prisma.listing.findMany({
    where: { published: true, parcel: { status: { notIn: ['SOLD', 'ARCHIVED'] } } },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });

  return [
    { url: `${base}/properties`, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    ...listings.map((listing) => ({
      url: `${base}/properties/${listing.slug}`,
      lastModified: listing.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
