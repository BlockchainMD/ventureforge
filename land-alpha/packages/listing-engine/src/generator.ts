import {
  formatAcres,
  formatCents,
  formatPercent,
  humanizeEnum,
  metersToFeet,
  truncate,
} from '@land-alpha/shared';
import { DETERMINISTIC_MARKER, getAiProvider, LAND_ALPHA_SYSTEM_PROMPT } from '@land-alpha/ai';
import type { FaqEntry, GeneratedListing, ListingFacts, PropertyFact } from './types';

/**
 * The AI Listing Factory.
 *
 * The hard rule for this module is that a listing may only contain claims the
 * data supports. Property advertising is regulated, buyers rely on it, and the
 * most natural failure of a language model asked to "write a compelling
 * listing" is to invent exactly the claims that matter most — buildable,
 * road-accessible, utilities available, perfect for your dream home.
 *
 * So the structure inverts the usual approach: the *facts* are assembled
 * deterministically first, every unsupported claim is explicitly withheld and
 * recorded in `withheldClaims`, and the model is only permitted to write prose
 * around a fact set it cannot add to.
 */

/** Claims that require evidence, and what evidence would license them. */
const GUARDED_CLAIMS: {
  claim: string;
  licensedBy: (facts: ListingFacts) => boolean;
  withheldReason: string;
}[] = [
  {
    claim: 'buildable',
    licensedBy: () => false,
    withheldReason:
      'Buildability is a screening conclusion only; no listing may state a parcel is buildable.',
  },
  {
    claim: 'legal access',
    licensedBy: (facts) =>
      facts.legalAccessStatus === 'RECORDED_FRONTAGE' ||
      facts.legalAccessStatus === 'RECORDED_EASEMENT' ||
      facts.legalAccessStatus === 'PLATTED_ACCESS',
    withheldReason: 'Legal access has not been verified against a recorded instrument.',
  },
  {
    claim: 'utilities available',
    licensedBy: (facts) => facts.knownUtilities.length > 0,
    withheldReason: 'No utility availability has been established for this parcel.',
  },
  {
    claim: 'no flood risk',
    licensedBy: (facts) => facts.inSpecialFloodHazardArea === false,
    withheldReason: 'Flood hazard data has not been established for this parcel.',
  },
  {
    claim: 'no wetlands',
    licensedBy: () => false,
    withheldReason:
      'Absence from the National Wetlands Inventory does not establish absence of wetlands.',
  },
  {
    claim: 'septic approved',
    licensedBy: () => false,
    withheldReason: 'Septic feasibility requires a percolation test and county approval.',
  },
];

export async function generateListing(facts: ListingFacts): Promise<GeneratedListing> {
  const withheldClaims = GUARDED_CLAIMS.filter((guard) => !guard.licensedBy(facts)).map(
    (guard) => `${guard.claim}: ${guard.withheldReason}`,
  );

  const propertyFacts = buildPropertyFacts(facts);
  const keyFeatures = buildKeyFeatures(facts);
  const title = buildTitle(facts);
  const locationSummary = buildLocationSummary(facts);
  const faq = buildFaq(facts);

  // The model writes only the descriptive prose, from a fact set it cannot add to.
  const provider = getAiProvider();
  let longDescription = buildLongDescription(facts, keyFeatures);
  let deterministic = true;

  try {
    const completion = await provider.complete({
      system: LAND_ALPHA_SYSTEM_PROMPT,
      tier: 'fast',
      temperature: 0.3,
      prompt: `Write a factual property description for a vacant land listing, 120-200 words.

You may use ONLY the facts below. Do not add any claim about buildability, legal access, utilities, septic suitability, flood risk, wetlands, or intended use. Do not speculate about what a buyer could build or do. Do not use marketing superlatives.

Explicitly forbidden claims for this parcel:
${withheldClaims.map((claim) => `- ${claim}`).join('\n')}

FACTS
${propertyFacts.map((fact) => `${fact.label}: ${fact.value}`).join('\n')}
${keyFeatures.map((feature) => `- ${feature}`).join('\n')}

Return only the description text.`,
    });

    if (completion.text !== DETERMINISTIC_MARKER && completion.text.trim().length > 80) {
      const cleaned = stripUnsupportedClaims(completion.text, facts);
      if (cleaned) {
        longDescription = cleaned;
        deterministic = false;
      }
    }
  } catch {
    // Fall back to the deterministic description. A listing must always exist.
  }

  const shortDescription = truncate(
    `${facts.acreage == null ? 'Vacant land' : `${formatAcres(facts.acreage)} of vacant land`} in ${facts.county} County, ${facts.state}.`,
    180,
  );

  const seoTitle = truncate(title, 60);
  const metaDescription = truncate(
    `${shortDescription} ${facts.askingPriceCents == null ? '' : `Priced at ${formatCents(facts.askingPriceCents)}.`} APN ${facts.apn ?? 'available on request'}.`.trim(),
    155,
  );

  return {
    title,
    shortDescription,
    longDescription,
    keyFeatures,
    locationSummary,
    drivingDirections: buildDirections(facts),
    nearbyAttractions: [],
    propertyFacts,
    faq,
    dueDiligenceDisclosure: DUE_DILIGENCE_DISCLOSURE,
    seoTitle,
    metaDescription,
    socialCopy: truncate(
      `${facts.acreage == null ? 'Vacant land' : formatAcres(facts.acreage)} in ${facts.county} County, ${facts.state}${facts.askingPriceCents == null ? '' : ` — ${formatCents(facts.askingPriceCents)}`}. Full property facts and due-diligence notes on the listing page.`,
      280,
    ),
    variants: buildVariants(facts, title, longDescription, shortDescription),
    withheldClaims,
    deterministic,
  };
}

/**
 * Build the headline.
 *
 * Every element must be evidence-backed. "With County Road Frontage" only
 * appears when frontage was actually measured against a named road.
 */
export function buildTitle(facts: ListingFacts): string {
  const parts: string[] = [];
  parts.push(facts.acreage == null ? 'Vacant Land' : `${formatAcres(facts.acreage)}`);

  const hasNamedFrontage =
    facts.roadFrontageMeters != null && facts.roadFrontageMeters >= 8 && facts.nearestRoadName;
  if (hasNamedFrontage) {
    parts.push(`With ${titleCaseRoad(facts.nearestRoadName!)} Frontage`);
  }

  const place = facts.municipality
    ? `${facts.municipality}, ${facts.state}`
    : `${facts.county} County, ${facts.state}`;

  return `${parts.join(' ')} — ${place}`;
}

function buildKeyFeatures(facts: ListingFacts): string[] {
  const features: string[] = [];

  if (facts.acreage != null) features.push(`${formatAcres(facts.acreage)} of vacant land`);
  if (facts.apn) features.push(`Assessor parcel number ${facts.apn}`);

  if (facts.roadFrontageMeters != null && facts.roadFrontageMeters >= 8) {
    features.push(
      `Approximately ${Math.round(metersToFeet(facts.roadFrontageMeters))} ft of boundary along ${facts.nearestRoadName ?? 'a mapped road'} (per county mapping)`,
    );
  }
  if (facts.zoning) {
    features.push(
      `Mapped zoning district ${facts.zoning}${facts.zoningSource ? ` per ${facts.zoningSource}` : ''}`,
    );
  }
  if (facts.inSpecialFloodHazardArea === false) {
    features.push('No FEMA Special Flood Hazard Area mapped on the parcel');
  }
  if (facts.annualTaxCents != null) {
    features.push(`Annual property tax of approximately ${formatCents(facts.annualTaxCents)}`);
  }
  if (facts.meanElevationMeters != null) {
    features.push(`Mean elevation approximately ${Math.round(facts.meanElevationMeters)} m`);
  }
  if (facts.knownUtilities.length > 0) {
    features.push(`Utilities noted in county records: ${facts.knownUtilities.join(', ')}`);
  }

  return features;
}

function buildLongDescription(facts: ListingFacts, keyFeatures: string[]): string {
  const place = facts.municipality
    ? `${facts.municipality}, ${facts.county} County, ${facts.state}`
    : `${facts.county} County, ${facts.state}`;

  const paragraphs: string[] = [
    `${facts.acreage == null ? 'A parcel of vacant land' : `${formatAcres(facts.acreage)} of vacant land`} in ${place}${facts.apn ? `, assessor parcel number ${facts.apn}` : ''}.`,
    keyFeatures.length > 0
      ? `County records and public mapping indicate the following: ${keyFeatures.join('; ')}.`
      : '',
    facts.wetlandTypes.length > 0
      ? `The National Wetlands Inventory maps ${facts.wetlandTypes.join(', ')} on part of this parcel${facts.wetlandOverlapFraction == null ? '' : `, covering approximately ${formatPercent(facts.wetlandOverlapFraction, 0)} of its area`}. Buyers should obtain a wetland delineation.`
      : '',
    facts.inSpecialFloodHazardArea === true
      ? `Part of this parcel lies within a FEMA Special Flood Hazard Area (${facts.floodZones.join(', ')}). Buyers should review the effective flood map.`
      : '',
    'This listing describes only what public records show. Buyers are responsible for their own due diligence on zoning, permitted uses, access, utilities and site conditions.',
  ];

  return paragraphs.filter(Boolean).join('\n\n');
}

function buildLocationSummary(facts: ListingFacts): string {
  const parts: string[] = [
    facts.municipality
      ? `${facts.municipality}, ${facts.county} County, ${facts.state}`
      : `${facts.county} County, ${facts.state}`,
  ];
  if (facts.latitude != null && facts.longitude != null) {
    parts.push(`approximately ${facts.latitude.toFixed(5)}, ${facts.longitude.toFixed(5)}`);
  }
  return parts.join(' — ');
}

function buildDirections(facts: ListingFacts): string | null {
  if (facts.latitude == null || facts.longitude == null) return null;
  return `Navigate to ${facts.latitude.toFixed(5)}, ${facts.longitude.toFixed(5)}${facts.nearestRoadName ? `, near ${facts.nearestRoadName}` : ''}. These coordinates are derived from county parcel mapping and locate the parcel approximately; they are not a surveyed boundary, and the parcel corners have not been staked.`;
}

function buildPropertyFacts(facts: ListingFacts): PropertyFact[] {
  const rows: PropertyFact[] = [];
  const add = (label: string, value: string | null, source: string): void => {
    if (value) rows.push({ label, value, source });
  };

  add('Assessor parcel number', facts.apn, 'County assessor');
  add('Acreage', facts.acreage == null ? null : formatAcres(facts.acreage), 'County parcel record');
  add('County', `${facts.county} County, ${facts.state}`, 'County parcel record');
  add('Municipality', facts.municipality, 'County parcel record');
  add('Zoning district', facts.zoning, facts.zoningSource ?? 'County zoning mapping');
  add(
    'Annual property tax',
    facts.annualTaxCents == null ? null : formatCents(facts.annualTaxCents),
    'County tax record',
  );
  add(
    'FEMA flood zone',
    facts.floodZones.length > 0 ? facts.floodZones.join(', ') : null,
    'FEMA National Flood Hazard Layer',
  );
  add(
    'Mapped wetlands',
    facts.wetlandTypes.length > 0 ? facts.wetlandTypes.join(', ') : null,
    'USFWS National Wetlands Inventory',
  );
  add(
    'Mean slope',
    facts.meanSlopePercent == null ? null : `${facts.meanSlopePercent.toFixed(1)}%`,
    'USGS 3DEP elevation data',
  );
  add(
    'Coordinates',
    facts.latitude == null || facts.longitude == null
      ? null
      : `${facts.latitude.toFixed(5)}, ${facts.longitude.toFixed(5)}`,
    'County parcel mapping',
  );
  add('Legal description', facts.legalDescription, 'County records');

  return rows;
}

function buildFaq(facts: ListingFacts): FaqEntry[] {
  return [
    {
      question: 'Can I build on this property?',
      answer:
        'We do not represent that this parcel is buildable. Whether a structure can be permitted depends on zoning, setbacks, septic and well approval, access, and other requirements determined solely by the county. Contact the county planning and health departments before purchasing.',
    },
    {
      question: 'Does the property have legal access?',
      answer:
        facts.legalAccessStatus === 'RECORDED_FRONTAGE' ||
        facts.legalAccessStatus === 'RECORDED_EASEMENT' ||
        facts.legalAccessStatus === 'PLATTED_ACCESS'
          ? `Recorded access has been identified for this parcel (${humanizeEnum(facts.legalAccessStatus)}). Buyers should confirm it independently through a title company.`
          : 'Legal access has not been verified. Public mapping may show a road nearby, but adjacency to a road is not the same as a legal right to use it. Verify recorded access through a title company before purchasing.',
    },
    {
      question: 'Are utilities available?',
      answer:
        facts.knownUtilities.length > 0
          ? `County records note the following: ${facts.knownUtilities.join(', ')}. Confirm availability and connection cost with each provider.`
          : 'No utility service has been established for this parcel. Assume none is available and confirm with local providers.',
    },
    {
      question: 'Is the property in a flood zone?',
      answer:
        facts.inSpecialFloodHazardArea === true
          ? `Public FEMA mapping shows part of this parcel within a Special Flood Hazard Area (${facts.floodZones.join(', ')}). Review the effective flood map and consider an elevation certificate.`
          : facts.inSpecialFloodHazardArea === false
            ? 'Public FEMA mapping does not show a Special Flood Hazard Area on this parcel. Flood maps are revised periodically; confirm against the current effective map.'
            : 'Flood hazard mapping has not been established for this parcel. Review FEMA mapping before purchasing.',
    },
    {
      question: 'Can I see the property before buying?',
      answer:
        'Yes. We encourage every buyer to visit in person. Parcel corners have not been surveyed or staked, so use the coordinates and county mapping as a guide only.',
    },
    {
      question: 'What is included in the sale?',
      answer:
        'The land only. No structures, improvements, mineral rights or water rights are represented as included unless stated in writing in the purchase agreement.',
    },
  ];
}

function buildVariants(
  facts: ListingFacts,
  title: string,
  longDescription: string,
  shortDescription: string,
): { channel: string; title: string; body: string }[] {
  return [
    {
      channel: 'website',
      title,
      body: longDescription,
    },
    {
      channel: 'marketplace',
      title: truncate(title, 80),
      body: `${shortDescription}\n\n${longDescription}\n\n${DUE_DILIGENCE_DISCLOSURE}`,
    },
    {
      channel: 'classified',
      title: truncate(title, 70),
      body: truncate(
        `${shortDescription} ${facts.apn ? `APN ${facts.apn}.` : ''} Buyer to verify all information.`,
        500,
      ),
    },
    {
      channel: 'email',
      title: `New listing: ${truncate(title, 60)}`,
      body: `${shortDescription}\n\n${longDescription}\n\nFull property facts, maps and due-diligence notes are on the listing page.`,
    },
  ];
}

/**
 * Last-line defence against a model asserting something the data does not
 * support. Any sentence containing a forbidden claim is dropped rather than the
 * whole description being discarded, and if too much is dropped the
 * deterministic description is used instead.
 */
export function stripUnsupportedClaims(text: string, facts: ListingFacts): string | null {
  const forbidden: RegExp[] = [
    /\bbuildable\b/i,
    /\bready to build\b/i,
    /\bbuild your\b/i,
    /\bperc(olation)?\s+(test)?\s*(passed|approved)\b/i,
    /\bseptic (approved|permitted)\b/i,
    /\bguaranteed\b/i,
    /\bno restrictions\b/i,
  ];
  if (facts.knownUtilities.length === 0) {
    forbidden.push(
      /\bpower (is )?available\b/i,
      /\butilities (are )?available\b/i,
      /\bcity water\b/i,
    );
  }
  if (
    facts.legalAccessStatus !== 'RECORDED_FRONTAGE' &&
    facts.legalAccessStatus !== 'RECORDED_EASEMENT' &&
    facts.legalAccessStatus !== 'PLATTED_ACCESS'
  ) {
    forbidden.push(/\blegal access\b/i, /\bdeeded access\b/i, /\bguaranteed access\b/i);
  }

  const sentences = text.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((sentence) => !forbidden.some((pattern) => pattern.test(sentence)));

  // If the model needed heavy censoring, it was not writing from the facts.
  if (kept.length < sentences.length * 0.7 || kept.join(' ').trim().length < 80) return null;
  return kept.join(' ').trim();
}

function titleCaseRoad(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const DUE_DILIGENCE_DISCLOSURE = `Buyer due diligence. All information is provided from public records and is believed accurate but is not warranted. Land Alpha makes no representation that this parcel is buildable, that legal access exists, that utilities are available, that a septic system can be permitted, or that the parcel is free of wetlands, flood risk or environmental conditions. Boundaries shown are from county mapping and are not a survey. Buyers are responsible for independently verifying zoning, permitted uses, access, utilities, taxes, assessments, title and physical condition before purchasing.`;
