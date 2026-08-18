import { describe, expect, it, beforeEach } from 'vitest';
import { setAiProvider, FixtureProvider, type AiProvider } from '@land-alpha/ai';
import { buildTitle, generateListing, stripUnsupportedClaims } from './generator';
import type { ListingFacts } from './types';

function facts(overrides: Partial<ListingFacts> = {}): ListingFacts {
  return {
    parcelId: 'p1',
    state: 'MN',
    county: 'St. Louis',
    municipality: null,
    apn: '010-0001-00010',
    acreage: 5.23,
    legalDescription: 'NE1/4 of SW1/4, Section 12, Township 55N, Range 15W',
    zoning: 'RR',
    zoningSource: 'County zoning GIS',
    askingPriceCents: 1_995_000,
    annualTaxCents: 11_800,
    latitude: 47.36,
    longitude: -92.33,
    accessClass: 'A',
    legalAccessStatus: 'UNKNOWN',
    nearestRoadName: 'County Road 88',
    roadFrontageMeters: 132,
    nearestPavedRoadName: 'County Road 88',
    buildability: 'GREEN',
    floodZones: ['X'],
    inSpecialFloodHazardArea: false,
    wetlandTypes: [],
    wetlandOverlapFraction: 0,
    meanSlopePercent: 3.2,
    meanElevationMeters: 420,
    knownUtilities: [],
    isVacant: true,
    ...overrides,
  };
}

/** A provider that returns whatever text a test wants, to probe the guardrails. */
function providerReturning(text: string): AiProvider {
  return {
    name: 'test',
    async complete() {
      return {
        text,
        provider: 'test',
        model: 'test',
        inputTokens: null,
        outputTokens: null,
        deterministic: false,
      };
    },
  };
}

beforeEach(() => {
  setAiProvider(new FixtureProvider());
});

describe('buildTitle', () => {
  it('claims road frontage only when frontage was actually measured', () => {
    expect(buildTitle(facts())).toContain('County Road 88 Frontage');
    expect(buildTitle(facts({ roadFrontageMeters: 0 }))).not.toMatch(/frontage/i);
    expect(buildTitle(facts({ nearestRoadName: null }))).not.toMatch(/frontage/i);
  });

  it('does not claim frontage from a corner touch', () => {
    expect(buildTitle(facts({ roadFrontageMeters: 3 }))).not.toMatch(/frontage/i);
  });

  it('names the place without inventing one', () => {
    expect(buildTitle(facts())).toContain('St. Louis County, MN');
    expect(buildTitle(facts({ municipality: 'Duluth' }))).toContain('Duluth, MN');
  });
});

describe('generateListing', () => {
  it('never asserts buildability, even for a GREEN-screened parcel', async () => {
    const listing = await generateListing(facts({ buildability: 'GREEN' }));
    const allText = [
      listing.title,
      listing.longDescription,
      listing.shortDescription,
      ...listing.keyFeatures,
    ].join(' ');

    expect(allText).not.toMatch(/\bbuildable\b/i);
    expect(listing.withheldClaims.some((claim) => claim.startsWith('buildable'))).toBe(true);
  });

  it('withholds a legal-access claim while legal access is unverified', async () => {
    const listing = await generateListing(facts({ legalAccessStatus: 'UNKNOWN' }));
    expect(listing.withheldClaims.some((claim) => claim.startsWith('legal access'))).toBe(true);

    const accessFaq = listing.faq.find((entry) => entry.question.includes('legal access'));
    expect(accessFaq?.answer).toMatch(/adjacency to a road is not the same as a legal right/i);
  });

  it('permits a legal-access statement once a recorded instrument exists', async () => {
    const listing = await generateListing(facts({ legalAccessStatus: 'RECORDED_EASEMENT' }));
    expect(listing.withheldClaims.some((claim) => claim.startsWith('legal access'))).toBe(false);

    const accessFaq = listing.faq.find((entry) => entry.question.includes('legal access'));
    expect(accessFaq?.answer).toMatch(/Recorded access has been identified/i);
  });

  it('discloses mapped wetlands rather than omitting them', async () => {
    const listing = await generateListing(
      facts({ wetlandTypes: ['PEM1C'], wetlandOverlapFraction: 0.3 }),
    );
    expect(listing.longDescription).toMatch(/National Wetlands Inventory/i);
    expect(listing.longDescription).toMatch(/wetland delineation/i);
  });

  it('discloses a flood hazard rather than omitting it', async () => {
    const listing = await generateListing(
      facts({ inSpecialFloodHazardArea: true, floodZones: ['AE'] }),
    );
    expect(listing.longDescription).toMatch(/Special Flood Hazard Area/i);
  });

  it('attaches a source to every published property fact', async () => {
    const listing = await generateListing(facts());
    expect(listing.propertyFacts.length).toBeGreaterThan(4);
    for (const fact of listing.propertyFacts) {
      expect(fact.source.length).toBeGreaterThan(3);
    }
  });

  it('always includes the due-diligence disclosure', async () => {
    const listing = await generateListing(facts());
    expect(listing.dueDiligenceDisclosure).toMatch(/no representation that this parcel is buildable/i);
    expect(listing.dueDiligenceDisclosure).toMatch(/not a survey/i);
  });

  it('produces a complete listing with no AI provider configured', async () => {
    const listing = await generateListing(facts());
    expect(listing.deterministic).toBe(true);
    expect(listing.longDescription.length).toBeGreaterThan(100);
    expect(listing.variants.length).toBeGreaterThanOrEqual(4);
    expect(listing.seoTitle.length).toBeLessThanOrEqual(60);
    expect(listing.metaDescription.length).toBeLessThanOrEqual(155);
  });

  it('rejects model output that asserts a forbidden claim', async () => {
    setAiProvider(
      providerReturning(
        'This buildable parcel is ready for your dream home. Utilities are available at the road. Legal access is guaranteed. Perc test passed.',
      ),
    );
    const listing = await generateListing(facts());

    // Every sentence was forbidden, so the model output is discarded entirely.
    expect(listing.deterministic).toBe(true);
    expect(listing.longDescription).not.toMatch(/buildable/i);
    expect(listing.longDescription).not.toMatch(/guaranteed/i);
  });

  it('keeps compliant model prose', async () => {
    setAiProvider(
      providerReturning(
        'This parcel comprises 5.23 acres of vacant land in St. Louis County, Minnesota. County mapping shows the boundary running along County Road 88. The assessor records an annual property tax of approximately $118. Buyers should verify zoning and site conditions with the county before purchasing.',
      ),
    );
    const listing = await generateListing(facts());
    expect(listing.deterministic).toBe(false);
    expect(listing.longDescription).toMatch(/5\.23 acres/);
  });

  it('falls back cleanly when the provider throws', async () => {
    setAiProvider({
      name: 'broken',
      async complete() {
        throw new Error('provider unavailable');
      },
    });
    const listing = await generateListing(facts());
    expect(listing.deterministic).toBe(true);
    expect(listing.longDescription.length).toBeGreaterThan(100);
  });
});

describe('stripUnsupportedClaims', () => {
  it('removes only the offending sentence when the rest is sound', () => {
    const text =
      'The parcel is 5.23 acres in St. Louis County. This buildable lot is ready for construction. County mapping shows frontage along County Road 88. The assessor records an annual tax of $118. Buyers should verify all details independently.';
    const cleaned = stripUnsupportedClaims(text, facts());
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toMatch(/buildable/i);
    expect(cleaned).toMatch(/5\.23 acres/);
  });

  it('discards the whole passage when most of it is unsupported', () => {
    const text = 'Buildable. Utilities are available. Legal access is guaranteed.';
    expect(stripUnsupportedClaims(text, facts())).toBeNull();
  });

  it('permits a utilities statement when utilities are actually recorded', () => {
    const withUtilities = facts({ knownUtilities: ['ELECTRIC'] });
    const text =
      'The parcel is 5.23 acres in St. Louis County. Utilities are available nearby per county records. Buyers should confirm connection costs with each provider. Boundaries are from county mapping.';
    const cleaned = stripUnsupportedClaims(text, withUtilities);
    expect(cleaned).toMatch(/Utilities are available/i);
  });
});
