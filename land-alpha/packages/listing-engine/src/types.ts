import type { UsdCents } from '@land-alpha/shared';

/**
 * Listing generation input.
 *
 * Note what is *not* here: alpha score, all-in basis, acquisition price,
 * comparable sales, rejection reasons. A listing is generated from verified
 * public facts about the land, and the underwriting is deliberately kept out of
 * reach so that no internal figure can leak into a public page by accident.
 */
export interface ListingFacts {
  readonly parcelId: string;
  readonly state: string;
  readonly county: string;
  readonly municipality: string | null;
  readonly apn: string | null;
  readonly acreage: number | null;
  readonly legalDescription: string | null;
  readonly zoning: string | null;
  readonly zoningSource: string | null;
  readonly askingPriceCents: UsdCents | null;
  readonly annualTaxCents: UsdCents | null;
  readonly latitude: number | null;
  readonly longitude: number | null;

  readonly accessClass: string;
  readonly legalAccessStatus: string;
  readonly nearestRoadName: string | null;
  readonly roadFrontageMeters: number | null;
  readonly nearestPavedRoadName: string | null;

  readonly buildability: string;
  readonly floodZones: readonly string[];
  readonly inSpecialFloodHazardArea: boolean | null;
  readonly wetlandTypes: readonly string[];
  readonly wetlandOverlapFraction: number | null;
  readonly meanSlopePercent: number | null;
  readonly meanElevationMeters: number | null;

  readonly knownUtilities: readonly string[];
  readonly isVacant: boolean | null;
}

export interface PropertyFact {
  readonly label: string;
  readonly value: string;
  /** Where this came from — reproduced on the public page. */
  readonly source: string;
}

export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

export interface GeneratedListing {
  readonly title: string;
  readonly shortDescription: string;
  readonly longDescription: string;
  readonly keyFeatures: string[];
  readonly locationSummary: string;
  readonly drivingDirections: string | null;
  readonly nearbyAttractions: string[];
  readonly propertyFacts: PropertyFact[];
  readonly faq: FaqEntry[];
  readonly dueDiligenceDisclosure: string;
  readonly seoTitle: string;
  readonly metaDescription: string;
  readonly socialCopy: string;
  readonly variants: { channel: string; title: string; body: string }[];
  readonly withheldClaims: string[];
  readonly deterministic: boolean;
}
