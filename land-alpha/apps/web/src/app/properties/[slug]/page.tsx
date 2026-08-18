import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma, spatial, toCents } from '@land-alpha/db';
import { env } from '@land-alpha/shared/env';
import { formatAcres, formatCents } from '@land-alpha/shared';
import { ParcelMap } from '@/components/ui/parcel-map';
import { InquiryForm } from './inquiry-form';

export const dynamic = 'force-dynamic';

interface PropertyFactRow {
  label: string;
  value: string;
  source: string;
}
interface FaqRow {
  question: string;
  answer: string;
}

async function loadListing(slug: string) {
  return prisma.listing.findUnique({
    where: { slug },
    include: {
      parcel: {
        select: {
          id: true,
          acreage: true,
          county: true,
          state: true,
          apn: true,
          latitude: true,
          longitude: true,
          annualTaxEstimate: true,
          zoning: true,
        },
      },
      photos: { orderBy: { ordering: 'asc' } },
    },
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await loadListing(slug);
  if (!listing) return { title: 'Property not found' };
  return {
    title: listing.seoTitle,
    description: listing.metaDescription,
    openGraph: { title: listing.seoTitle, description: listing.metaDescription },
  };
}

/**
 * Public property page.
 *
 * Contains only what the listing generator produced from verified public
 * records. No alpha score, no acquisition cost, no basis, no comparables —
 * those are never loaded into this component, so they cannot leak.
 */
export default async function PropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!env().PUBLIC_SITE_ENABLED) notFound();
  const { slug } = await params;

  const listing = await loadListing(slug);
  if (!listing || !listing.published) notFound();

  const geometry = await spatial.readParcelGeometry(listing.parcelId);
  const facts = (listing.propertyFacts ?? []) as unknown as PropertyFactRow[];
  const faq = (listing.faq ?? []) as unknown as FaqRow[];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{listing.title}</h1>
        <p className="num mt-2 text-xl text-alpha">
          {listing.askingPrice == null
            ? 'Price on application'
            : formatCents(toCents(listing.askingPrice))}
          {listing.parcel.acreage == null ? null : (
            <span className="ml-3 text-sm text-ink-muted">
              {formatAcres(listing.parcel.acreage)}
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-ink-muted">{listing.locationSummary}</p>
      </header>

      <div className="mt-6">
        <ParcelMap
          geometry={geometry}
          centroid={
            listing.parcel.longitude != null && listing.parcel.latitude != null
              ? [listing.parcel.longitude, listing.parcel.latitude]
              : null
          }
          height={380}
        />
        <p className="mt-1 text-[10px] text-ink-faint">
          Boundary shown from county parcel mapping. This is not a survey and the corners have not
          been staked.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-8">
        <div className="col-span-2 space-y-8">
          <section>
            <h2 className="rule-label">About this property</h2>
            <div className="mt-2 space-y-3">
              {listing.longDescription.split('\n\n').map((paragraph, index) => (
                <p key={index} className="text-sm leading-relaxed text-ink-muted">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>

          {listing.keyFeatures.length > 0 ? (
            <section>
              <h2 className="rule-label">Key features</h2>
              <ul className="mt-2 space-y-1">
                {listing.keyFeatures.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm text-ink-muted">
                    <span className="text-alpha">·</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {listing.drivingDirections ? (
            <section>
              <h2 className="rule-label">Getting there</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                {listing.drivingDirections}
              </p>
            </section>
          ) : null}

          <section>
            <h2 className="rule-label">Property facts</h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <tbody>
                {facts.map((fact) => (
                  <tr key={fact.label} className="border-b border-line/60">
                    <td className="py-1.5 pr-4 align-top text-ink-faint">{fact.label}</td>
                    <td className="num py-1.5 pr-4 align-top text-ink">{fact.value}</td>
                    <td className="py-1.5 align-top text-[10px] text-ink-faint">{fact.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section>
            <h2 className="rule-label">Questions buyers ask</h2>
            <dl className="mt-2 space-y-4">
              {faq.map((entry) => (
                <div key={entry.question}>
                  <dt className="text-sm font-medium text-ink">{entry.question}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{entry.answer}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-sm border border-warn/30 bg-warn/5 p-4">
            <h2 className="rule-label text-warn">Buyer due diligence</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              {listing.dueDiligenceDisclosure}
            </p>
          </section>
        </div>

        <aside className="space-y-4">
          <div className="rounded-sm border border-line bg-panel p-4">
            <h2 className="rule-label">Enquire or make an offer</h2>
            <div className="mt-3">
              <InquiryForm parcelId={listing.parcelId} slug={listing.slug} />
            </div>
          </div>

          <div className="rounded-sm border border-line bg-panel p-4">
            <h2 className="rule-label">At a glance</h2>
            <dl className="mt-2 space-y-1.5 text-xs">
              <Row label="APN" value={listing.parcel.apn} />
              <Row
                label="Acreage"
                value={listing.parcel.acreage == null ? null : formatAcres(listing.parcel.acreage)}
              />
              <Row label="County" value={`${listing.parcel.county}, ${listing.parcel.state}`} />
              <Row label="Zoning" value={listing.parcel.zoning} />
              <Row
                label="Annual tax"
                value={
                  listing.parcel.annualTaxEstimate == null
                    ? null
                    : formatCents(toCents(listing.parcel.annualTaxEstimate))
                }
              />
              <Row
                label="Coordinates"
                value={
                  listing.parcel.latitude == null || listing.parcel.longitude == null
                    ? null
                    : `${listing.parcel.latitude.toFixed(5)}, ${listing.parcel.longitude.toFixed(5)}`
                }
              />
            </dl>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="num text-ink">{value ?? '—'}</dd>
    </div>
  );
}
