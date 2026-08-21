import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, toCents } from '@land-alpha/db';
import { env } from '@land-alpha/shared/env';
import { formatAcres, formatCents } from '@land-alpha/shared';

export const metadata = {
  title: 'Vacant land for sale — Land Alpha',
  description: 'Vacant land parcels for sale, with verified public-record property facts.',
};
export const dynamic = 'force-dynamic';

export default async function PropertiesIndex() {
  if (!env().PUBLIC_SITE_ENABLED) notFound();

  const listings = await prisma.listing.findMany({
    where: { published: true },
    orderBy: { publishedAt: 'desc' },
    include: { parcel: { select: { acreage: true, county: true, state: true } } },
    take: 60,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Vacant land for sale</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Every listing states its property facts and the source of each one.
      </p>

      {listings.length === 0 ? (
        <p className="mt-10 rounded-sm border border-line bg-panel p-8 text-center text-sm text-ink-faint">
          No properties are currently listed.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {listings.map((listing) => (
            <li key={listing.id} className="rounded-sm border border-line bg-panel p-4">
              <Link href={`/properties/${listing.slug}`} className="block">
                <h2 className="text-sm font-medium text-ink hover:text-alpha">{listing.title}</h2>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  {listing.shortDescription}
                </p>
                <p className="num mt-2 text-sm text-alpha">
                  {listing.askingPrice == null
                    ? 'Price on application'
                    : formatCents(toCents(listing.askingPrice))}
                  {listing.parcel.acreage == null ? null : (
                    <span className="ml-2 text-xs text-ink-faint">
                      {formatAcres(listing.parcel.acreage)}
                    </span>
                  )}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
