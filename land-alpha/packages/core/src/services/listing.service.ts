import { prisma, toCents, toDecimal, Prisma } from '@land-alpha/db';
import { listingSlug } from '@land-alpha/shared/ids';
import { generateListing, type ListingFacts } from '@land-alpha/listing-engine';
import { createLogger } from '@land-alpha/shared/logger';
import { buildAmortizationSchedule, suggestTerms } from '@land-alpha/valuation';

/**
 * The Listing Factory service.
 *
 * Reads only the public-facing subset of a parcel. Internal underwriting —
 * alpha score, all-in basis, acquisition price, comparables — is not passed to
 * the generator at all, so it cannot leak into a public page even by mistake.
 */

const logger = createLogger({ component: 'listing-service' });

/**
 * Financing terms to publish alongside the price.
 *
 * A monthly figure changes who the buyer is. Cash buyers for rural land are a
 * thin, price-sensitive pool; buyers who can pay $300 a month are a much larger
 * one, and they are not comparing against the same alternatives. The terms are
 * written onto the listing rather than derived when the page renders, so that
 * what a buyer was shown remains what was offered even after the pricing model
 * changes underneath it.
 */
function financeOfferFor(askingPriceCents: number | null): {
  financeOffered: boolean;
  financeDownPayment: ReturnType<typeof toDecimal>;
  financeMonthlyPayment: ReturnType<typeof toDecimal>;
  financeTermMonths: number | null;
  financeAnnualRate: number | null;
  financeDocumentFee: ReturnType<typeof toDecimal>;
} {
  // Below about $3,000 a note is not worth servicing: the paperwork, the
  // collection risk and the bookkeeping cost more than the interest earns.
  if (askingPriceCents == null || askingPriceCents < 300_000) {
    return {
      financeOffered: false,
      financeDownPayment: null,
      financeMonthlyPayment: null,
      financeTermMonths: null,
      financeAnnualRate: null,
      financeDocumentFee: null,
    };
  }
  const terms = suggestTerms(askingPriceCents);
  const schedule = buildAmortizationSchedule(terms, new Date());
  return {
    financeOffered: true,
    financeDownPayment: toDecimal(terms.downPaymentCents),
    financeMonthlyPayment: toDecimal(schedule.monthlyPaymentCents),
    financeTermMonths: terms.termMonths,
    financeAnnualRate: terms.annualRate,
    financeDocumentFee: toDecimal(terms.documentFeeCents ?? 0),
  };
}

export async function generateListingForParcel(
  parcelId: string,
  requestedBy?: string,
): Promise<{ slug: string; withheldClaims: string[]; deterministic: boolean }> {
  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    include: { portfolioAsset: true },
  });
  if (!parcel) throw new Error(`Parcel not found: ${parcelId}`);

  const facts: ListingFacts = {
    parcelId: parcel.id,
    state: parcel.state,
    county: parcel.county,
    municipality: parcel.municipality,
    apn: parcel.apn,
    acreage: parcel.acreage,
    legalDescription: parcel.legalDescription,
    zoning: parcel.zoning,
    zoningSource: parcel.zoningSource,
    // The public asking price is the list price we set, never our basis.
    askingPriceCents: toCents(parcel.portfolioAsset?.listPrice) ?? toCents(parcel.retailValue),
    annualTaxCents: toCents(parcel.annualTaxEstimate),
    latitude: parcel.latitude,
    longitude: parcel.longitude,

    accessClass: parcel.accessClass,
    legalAccessStatus: parcel.legalAccessStatus,
    nearestRoadName: parcel.nearestRoadName,
    roadFrontageMeters: parcel.roadFrontageMeters,
    nearestPavedRoadName: parcel.nearestPavedRoadName,

    buildability: parcel.buildability,
    floodZones: parcel.floodZones,
    inSpecialFloodHazardArea: parcel.inSpecialFloodHazardArea,
    wetlandTypes: parcel.wetlandTypes,
    wetlandOverlapFraction: parcel.wetlandOverlapFraction,
    meanSlopePercent: parcel.meanSlopePercent,
    meanElevationMeters: parcel.meanElevationMeters,

    knownUtilities: parcel.knownUtilities,
    isVacant: parcel.isVacant,
  };

  const listing = await generateListing(facts);

  const slug =
    parcel.publicSlug ??
    listingSlug({
      acreage: parcel.acreage,
      county: parcel.county,
      state: parcel.state,
      parcelId: parcel.id,
    });

  await prisma.$transaction(async (tx) => {
    const record = await tx.listing.upsert({
      where: { parcelId },
      create: {
        parcelId,
        slug,
        title: listing.title,
        shortDescription: listing.shortDescription,
        longDescription: listing.longDescription,
        keyFeatures: listing.keyFeatures,
        locationSummary: listing.locationSummary,
        drivingDirections: listing.drivingDirections,
        nearbyAttractions: listing.nearbyAttractions,
        propertyFacts: listing.propertyFacts as unknown as Prisma.InputJsonValue,
        faq: listing.faq as unknown as Prisma.InputJsonValue,
        dueDiligenceDisclosure: listing.dueDiligenceDisclosure,
        seoTitle: listing.seoTitle,
        metaDescription: listing.metaDescription,
        socialCopy: listing.socialCopy,
        askingPrice: toDecimal(facts.askingPriceCents),
        ...financeOfferFor(facts.askingPriceCents),
        generatedBy: listing.deterministic ? 'listing-engine' : 'listing-engine+ai',
      },
      update: {
        title: listing.title,
        shortDescription: listing.shortDescription,
        longDescription: listing.longDescription,
        keyFeatures: listing.keyFeatures,
        locationSummary: listing.locationSummary,
        drivingDirections: listing.drivingDirections,
        propertyFacts: listing.propertyFacts as unknown as Prisma.InputJsonValue,
        faq: listing.faq as unknown as Prisma.InputJsonValue,
        dueDiligenceDisclosure: listing.dueDiligenceDisclosure,
        seoTitle: listing.seoTitle,
        metaDescription: listing.metaDescription,
        socialCopy: listing.socialCopy,
        askingPrice: toDecimal(facts.askingPriceCents),
        ...financeOfferFor(facts.askingPriceCents),
      },
      select: { id: true },
    });

    for (const variant of listing.variants) {
      await tx.listingVariant.upsert({
        where: { listingId_channel: { listingId: record.id, channel: variant.channel } },
        create: {
          listingId: record.id,
          channel: variant.channel,
          title: variant.title,
          body: variant.body,
          metadata: { withheldClaims: listing.withheldClaims } as unknown as Prisma.InputJsonValue,
        },
        update: { title: variant.title, body: variant.body },
      });
    }

    await tx.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        publicSlug: slug,
        status: parcel.status === 'READY_TO_LIST' ? 'LISTED' : parcel.status,
      },
    });
  });

  logger.info('generated listing', {
    parcelId,
    slug,
    withheld: listing.withheldClaims.length,
    deterministic: listing.deterministic,
    requestedBy,
  });

  return { slug, withheldClaims: listing.withheldClaims, deterministic: listing.deterministic };
}

/** Publish or unpublish a listing. Publishing is always an explicit human act. */
export async function setListingPublished(parcelId: string, published: boolean): Promise<void> {
  await prisma.listing.update({
    where: { parcelId },
    data: { published, publishedAt: published ? new Date() : null },
  });
}
