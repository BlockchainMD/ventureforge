import {
  formatAcres,
  formatCents,
  formatPercent,
  humanizeEnum,
  type UsdCents,
} from '@land-alpha/shared';
import {
  DETERMINISTIC_MARKER,
  getAiProvider,
  LAND_ALPHA_SYSTEM_PROMPT,
  type CompletionResult,
} from './provider';

/**
 * The investment memo.
 *
 * Every section is generated from an explicit fact sheet built by deterministic
 * engines. The AI's only job is to explain and connect those facts — it never
 * originates a number, and any field the pipeline could not establish is
 * carried through as "UNKNOWN — verification required" rather than filled in.
 *
 * When no AI provider is configured, the deterministic renderer produces the
 * same memo without the prose. That output is less pleasant to read and exactly
 * as trustworthy, which is the correct trade.
 */

export const MEMO_SECTIONS = [
  'INVESTMENT THESIS',
  'WHY IT MAY BE MISPRICED',
  'ACQUISITION ECONOMICS',
  'ACCESS',
  'BUILDABILITY',
  'ENVIRONMENTAL',
  'TITLE',
  'COMPARABLE SALES',
  'EXIT STRATEGY',
  'KEY RISKS',
  'UNANSWERED QUESTIONS',
  'RECOMMENDED MAXIMUM BID',
  'RECOMMENDATION',
] as const;

export type MemoSection = (typeof MEMO_SECTIONS)[number];

export interface MemoFacts {
  readonly parcelId: string;
  readonly state: string;
  readonly county: string;
  readonly apn: string | null;
  readonly acreage: number | null;
  readonly sourceName: string;
  readonly sourceType: string;
  readonly saleType: string;
  readonly failedSaleCount: number;
  readonly otcEligible: boolean | null;
  readonly daysOnSource: number | null;

  readonly acquisitionPriceCents: UsdCents | null;
  readonly allInBasisCents: UsdCents | null;
  readonly quickSaleValueCents: UsdCents | null;
  readonly retailValueCents: UsdCents | null;
  readonly investorLiquidationValueCents: UsdCents | null;
  readonly basisToQsv: number | null;
  readonly grossProfitCents: UsdCents | null;
  readonly roiAtQsv: number | null;
  readonly economicsTier: string | null;
  readonly recommendedMaxBidCents: UsdCents | null;

  readonly accessClass: string;
  readonly legalAccessStatus: string;
  readonly roadFrontageMeters: number | null;
  readonly nearestRoadName: string | null;
  readonly accessEvidence: readonly string[];
  readonly accessUnknowns: readonly string[];

  readonly buildability: string;
  readonly buildabilityReasons: readonly string[];
  readonly buildabilityUnknowns: readonly string[];
  readonly buildabilityBlockers: readonly string[];

  readonly floodZones: readonly string[];
  readonly floodOverlapFraction: number | null;
  readonly wetlandTypes: readonly string[];
  readonly wetlandOverlapFraction: number | null;
  readonly meanSlopePercent: number | null;
  readonly nearestContaminatedSiteMeters: number | null;
  readonly environmentalRiskScore: number | null;

  readonly titleRiskScore: number | null;
  readonly titleFindings: readonly string[];

  readonly comparableCount: number;
  readonly comparables: readonly {
    apn: string | null;
    saleDate: string;
    salePriceCents: UsdCents;
    acreage: number;
    adjustedPricePerAcreCents: UsdCents;
    distanceMeters: number | null;
  }[];
  readonly valuationConfidence: string;
  readonly valuationWarnings: readonly string[];

  readonly alphaScore: number | null;
  readonly confidenceLevel: string;
  readonly whyInteresting: readonly string[];
  readonly remainingQuestions: readonly string[];
  readonly rejected: boolean;
  readonly rejectionReasons: readonly string[];

  /** Evidence identifiers available for citation. */
  readonly evidenceFields: readonly string[];
}

export interface GeneratedMemo {
  readonly sections: Record<string, string>;
  readonly recommendation: string;
  readonly recommendedMaxBidCents: UsdCents | null;
  readonly unknowns: string[];
  readonly evidenceRefs: string[];
  readonly provider: string;
  readonly model: string;
  readonly deterministic: boolean;
}

export async function generateInvestmentMemo(facts: MemoFacts): Promise<GeneratedMemo> {
  const provider = getAiProvider();
  const factSheet = renderFactSheet(facts);

  let completion: CompletionResult;
  try {
    completion = await provider.complete({
      system: LAND_ALPHA_SYSTEM_PROMPT,
      tier: 'reasoning',
      prompt: `Write an investment memo for the parcel below.

Produce exactly these sections, each introduced by its heading on its own line:
${MEMO_SECTIONS.join('\n')}

Rules specific to this document:
- ACQUISITION ECONOMICS must restate the provided figures exactly; do not recompute.
- ACCESS must state the access class AND separately state that legal access is ${facts.legalAccessStatus === 'UNKNOWN' ? 'unverified' : facts.legalAccessStatus}. Never describe physical adjacency as legal access.
- BUILDABILITY must describe the rating as a preliminary screening conclusion and list its unknowns.
- TITLE must state that this is an automated pre-screen and not a title opinion.
- RECOMMENDED MAXIMUM BID must use the provided figure and explain what it means.
- UNANSWERED QUESTIONS must be concrete and actionable.

FACT SHEET
${factSheet}`,
    });
  } catch {
    completion = {
      text: DETERMINISTIC_MARKER,
      provider: 'fixture',
      model: 'deterministic',
      inputTokens: null,
      outputTokens: null,
      deterministic: true,
    };
  }

  const sections =
    completion.text === DETERMINISTIC_MARKER || completion.text.trim() === ''
      ? renderDeterministicMemo(facts)
      : parseSections(completion.text, facts);

  return {
    sections,
    recommendation: recommendationFor(facts),
    recommendedMaxBidCents: facts.recommendedMaxBidCents,
    unknowns: collectUnknowns(facts),
    evidenceRefs: [...facts.evidenceFields],
    provider: completion.provider,
    model: completion.model,
    deterministic: completion.text === DETERMINISTIC_MARKER,
  };
}

/** Split a model response into the expected sections, tolerating formatting drift. */
function parseSections(text: string, facts: MemoFacts): Record<string, string> {
  const sections: Record<string, string> = {};
  const pattern = new RegExp(
    `^\\s*#*\\s*(${MEMO_SECTIONS.map((section) => section.replace(/ /g, '\\s+')).join('|')})\\s*:?\\s*$`,
    'gim',
  );

  const matches = [...text.matchAll(pattern)];
  if (matches.length === 0) {
    // The model ignored the structure. Rather than presenting unlabelled prose
    // as a memo, fall back to the deterministic renderer.
    return renderDeterministicMemo(facts);
  }

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const heading = match[1]!.replace(/\s+/g, ' ').toUpperCase();
    const start = match.index! + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
    sections[heading] = text.slice(start, end).trim();
  }

  // Any section the model dropped is filled from the deterministic renderer, so
  // a memo is never silently missing its risk section.
  const fallback = renderDeterministicMemo(facts);
  for (const section of MEMO_SECTIONS) {
    if (!sections[section]?.trim()) sections[section] = fallback[section] ?? '';
  }
  return sections;
}

/**
 * Deterministic memo renderer.
 *
 * Used when no AI provider is configured, when a provider call fails, and when
 * a model returns something unusable. It is intentionally the same shape as the
 * generated memo, so downstream consumers never branch on which produced it.
 */
export function renderDeterministicMemo(facts: MemoFacts): Record<string, string> {
  const unknown = 'UNKNOWN — verification required';
  const money = (cents: UsdCents | null): string => (cents == null ? unknown : formatCents(cents));

  return {
    'INVESTMENT THESIS': [
      `${facts.acreage == null ? 'A parcel of unknown acreage' : formatAcres(facts.acreage)} in ${facts.county} County, ${facts.state}, offered through ${facts.sourceName} as ${humanizeEnum(facts.sourceType)} inventory [source].`,
      facts.basisToQsv == null
        ? 'No quick-sale value could be established, so no economic thesis can be stated.'
        : `Estimated all-in basis of ${money(facts.allInBasisCents)} against a conservative quick-sale value of ${money(facts.quickSaleValueCents)} — ${formatPercent(facts.basisToQsv, 1)} of value [basisToQsv].`,
      facts.alphaScore == null
        ? ''
        : `Alpha Score ${Math.round(facts.alphaScore)} at ${facts.confidenceLevel} confidence.`,
    ]
      .filter(Boolean)
      .join(' '),

    'WHY IT MAY BE MISPRICED':
      facts.whyInteresting.length > 0
        ? facts.whyInteresting.map((point) => `- ${point}`).join('\n')
        : 'No structural reason for mispricing has been identified. Treat the discount with scepticism.',

    'ACQUISITION ECONOMICS': [
      `Acquisition price: ${money(facts.acquisitionPriceCents)} [acquisitionPrice]`,
      `Estimated all-in basis: ${money(facts.allInBasisCents)} [allInBasis]`,
      `Quick-sale value: ${money(facts.quickSaleValueCents)} [quickSaleValue]`,
      `Retail value: ${money(facts.retailValueCents)} [retailValue]`,
      `Investor liquidation value: ${money(facts.investorLiquidationValueCents)}`,
      `Basis / QSV: ${facts.basisToQsv == null ? unknown : formatPercent(facts.basisToQsv, 1)}`,
      `Potential gross profit at QSV: ${money(facts.grossProfitCents)}`,
      `ROI at QSV: ${facts.roiAtQsv == null ? unknown : formatPercent(facts.roiAtQsv, 0)}`,
      `Tier: ${facts.economicsTier ?? unknown}`,
    ].join('\n'),

    ACCESS: [
      `Access class ${facts.accessClass}. This describes the strength of evidence for physical access only.`,
      `Legal access status: ${humanizeEnum(facts.legalAccessStatus)}${facts.legalAccessStatus === 'UNKNOWN' ? ' — no recorded deed, plat or easement has been reviewed.' : '.'}`,
      facts.roadFrontageMeters == null
        ? ''
        : `Measured road frontage: ${Math.round(facts.roadFrontageMeters)} m${facts.nearestRoadName ? ` along ${facts.nearestRoadName}` : ''} [roadFrontage].`,
      ...facts.accessEvidence.map((line) => `- ${line}`),
      ...facts.accessUnknowns.map((line) => `- ${unknown}: ${line}`),
    ]
      .filter(Boolean)
      .join('\n'),

    BUILDABILITY: [
      `Screened ${facts.buildability}. This is a preliminary screening conclusion, not a zoning determination, permit or septic approval.`,
      ...facts.buildabilityBlockers.map((line) => `- BLOCKING: ${line}`),
      ...facts.buildabilityReasons.map((line) => `- ${line}`),
      ...facts.buildabilityUnknowns.map((line) => `- ${unknown}: ${line}`),
    ].join('\n'),

    ENVIRONMENTAL: [
      facts.floodZones.length > 0
        ? `FEMA flood zones intersecting the parcel: ${facts.floodZones.join(', ')}${facts.floodOverlapFraction == null ? '' : ` covering ${formatPercent(facts.floodOverlapFraction, 0)} of its area`} [floodZones].`
        : `No FEMA flood hazard data recorded: ${unknown}.`,
      facts.wetlandTypes.length > 0
        ? `NWI wetlands mapped: ${facts.wetlandTypes.join(', ')}${facts.wetlandOverlapFraction == null ? '' : ` covering ${formatPercent(facts.wetlandOverlapFraction, 0)}`} [wetlands].`
        : 'No NWI wetlands identified. Absence from the inventory does not prove absence of jurisdictional wetlands.',
      facts.meanSlopePercent == null
        ? `Slope: ${unknown}.`
        : `Mean slope ${facts.meanSlopePercent.toFixed(1)}%.`,
      facts.nearestContaminatedSiteMeters == null
        ? 'No regulated cleanup site identified within the search radius.'
        : `Nearest regulated cleanup site approximately ${Math.round(facts.nearestContaminatedSiteMeters)} m away.`,
      'This is a screening review of public mapping layers, not a Phase I Environmental Site Assessment.',
    ].join('\n'),

    TITLE: [
      facts.titleRiskScore == null
        ? `Title pre-screen has not been run: ${unknown}.`
        : `Automated title pre-screen risk: ${Math.round(facts.titleRiskScore)} / 100.`,
      ...facts.titleFindings.map((line) => `- ${line}`),
      'Preliminary automated title research only. Not a title opinion or title insurance commitment. Obtain a title commitment from a licensed title company before acquiring.',
    ].join('\n'),

    'COMPARABLE SALES':
      facts.comparables.length === 0
        ? `No comparable sales were used. ${facts.valuationWarnings.join(' ')}`.trim()
        : [
            `${facts.comparableCount} recorded sales, size-adjusted. Valuation confidence: ${facts.valuationConfidence}.`,
            ...facts.comparables
              .slice(0, 8)
              .map(
                (comp) =>
                  `- ${comp.apn ?? 'unidentified parcel'}: ${formatCents(comp.salePriceCents)} for ${formatAcres(comp.acreage)} on ${comp.saleDate}, adjusted to ${formatCents(comp.adjustedPricePerAcreCents)}/acre${comp.distanceMeters == null ? '' : ` at ${(comp.distanceMeters / 1609.344).toFixed(1)} mi`}`,
              ),
            ...facts.valuationWarnings.map((warning) => `- Caveat: ${warning}`),
          ].join('\n'),

    'EXIT STRATEGY': [
      facts.quickSaleValueCents == null
        ? `No exit can be modelled without a value estimate: ${unknown}.`
        : `Primary exit is a retail sale to an end user at or below ${money(facts.retailValueCents)}, with a quick-sale fallback at ${money(facts.quickSaleValueCents)}. Underwriting assumes the quick-sale outcome.`,
      facts.investorLiquidationValueCents == null
        ? ''
        : `Downside exit to another land investor is estimated at ${money(facts.investorLiquidationValueCents)}.`,
      facts.accessClass === 'D'
        ? 'With no apparent access, the realistic buyer pool is limited to adjoining owners.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),

    'KEY RISKS':
      [
        ...facts.rejectionReasons.map((reason) => `- REJECTION RULE: ${reason}`),
        ...facts.buildabilityBlockers.map((line) => `- ${line}`),
        facts.valuationConfidence === 'LOW' || facts.valuationConfidence === 'UNKNOWN'
          ? '- Valuation rests on thin or absent comparable data.'
          : '',
        facts.legalAccessStatus === 'UNKNOWN'
          ? '- Legal access is unverified. The parcel may be unusable regardless of physical adjacency.'
          : '',
        facts.titleRiskScore != null && facts.titleRiskScore > 40
          ? '- Title pre-screen indicates professional review is required before acquisition.'
          : '',
      ]
        .filter(Boolean)
        .join('\n') || '- No blocking risks identified by the screening rules.',

    'UNANSWERED QUESTIONS':
      collectUnknowns(facts)
        .map((question) => `- ${question}`)
        .join('\n') || '- None recorded.',

    'RECOMMENDED MAXIMUM BID':
      facts.recommendedMaxBidCents == null
        ? `${unknown} — a maximum bid cannot be derived without a quick-sale value.`
        : `${formatCents(facts.recommendedMaxBidCents)}. This is the highest acquisition price at which the all-in basis still lands inside the target basis/QSV ratio. It is an underwriting boundary, not an instruction to bid.`,

    RECOMMENDATION: recommendationFor(facts),
  };
}

function recommendationFor(facts: MemoFacts): string {
  if (facts.rejected) {
    return `REJECT — ${facts.rejectionReasons[0] ?? 'failed the screening rules'}.`;
  }
  switch (facts.economicsTier) {
    case 'EXCEPTIONAL':
      return 'STRONG BUY CANDIDATE — proceed to due diligence and establish a maximum bid.';
    case 'STRONG':
      return 'BUY CANDIDATE — proceed to due diligence.';
    case 'POTENTIAL':
      return 'WORTH REVIEW — the discount is real but modest; verify the unknowns before committing time.';
    case 'WEAK':
      return 'PASS — the discount does not compensate for the work and risk.';
    default:
      return 'INSUFFICIENT DATA — not enough is established to make a recommendation.';
  }
}

function collectUnknowns(facts: MemoFacts): string[] {
  const unknowns = new Set<string>([
    ...facts.remainingQuestions,
    ...facts.accessUnknowns,
    ...facts.buildabilityUnknowns,
  ]);
  if (facts.titleRiskScore == null) unknowns.add('Title pre-screen has not been run.');
  if (facts.acreage == null) unknowns.add('Parcel acreage is not established.');
  if (facts.comparableCount === 0) unknowns.add('No comparable sales support the valuation.');
  return [...unknowns];
}

function renderFactSheet(facts: MemoFacts): string {
  const lines: string[] = [];
  const push = (label: string, value: unknown): void => {
    lines.push(`${label}: ${value == null || value === '' ? 'UNKNOWN' : String(value)}`);
  };

  push('parcel', `${facts.apn ?? 'unknown APN'}, ${facts.county} County, ${facts.state}`);
  push('acreage', facts.acreage == null ? null : formatAcres(facts.acreage));
  push('source', `${facts.sourceName} (${facts.sourceType})`);
  push('sale type', humanizeEnum(facts.saleType));
  push('failed prior sales', facts.failedSaleCount);
  push('over-the-counter eligible', facts.otcEligible);
  push('days listed', facts.daysOnSource);
  push(
    'acquisition price',
    facts.acquisitionPriceCents == null ? null : formatCents(facts.acquisitionPriceCents),
  );
  push('all-in basis', facts.allInBasisCents == null ? null : formatCents(facts.allInBasisCents));
  push(
    'quick-sale value',
    facts.quickSaleValueCents == null ? null : formatCents(facts.quickSaleValueCents),
  );
  push('retail value', facts.retailValueCents == null ? null : formatCents(facts.retailValueCents));
  push('basis/QSV', facts.basisToQsv == null ? null : formatPercent(facts.basisToQsv, 1));
  push(
    'gross profit at QSV',
    facts.grossProfitCents == null ? null : formatCents(facts.grossProfitCents),
  );
  push('economics tier', facts.economicsTier);
  push(
    'recommended maximum bid',
    facts.recommendedMaxBidCents == null ? null : formatCents(facts.recommendedMaxBidCents),
  );
  push('access class', facts.accessClass);
  push('legal access status', facts.legalAccessStatus);
  push('road frontage (m)', facts.roadFrontageMeters);
  push('nearest road', facts.nearestRoadName);
  push('access evidence', facts.accessEvidence.join(' | '));
  push('access unknowns', facts.accessUnknowns.join(' | '));
  push('buildability', facts.buildability);
  push('buildability reasons', facts.buildabilityReasons.join(' | '));
  push('buildability unknowns', facts.buildabilityUnknowns.join(' | '));
  push('buildability blockers', facts.buildabilityBlockers.join(' | '));
  push('flood zones', facts.floodZones.join(', '));
  push('flood overlap', facts.floodOverlapFraction);
  push('wetland types', facts.wetlandTypes.join(', '));
  push('wetland overlap', facts.wetlandOverlapFraction);
  push('mean slope %', facts.meanSlopePercent);
  push('nearest cleanup site (m)', facts.nearestContaminatedSiteMeters);
  push('title risk score', facts.titleRiskScore);
  push('title findings', facts.titleFindings.join(' | '));
  push('comparable count', facts.comparableCount);
  push('valuation confidence', facts.valuationConfidence);
  push('valuation warnings', facts.valuationWarnings.join(' | '));
  push('alpha score', facts.alphaScore);
  push('overall confidence', facts.confidenceLevel);
  push('why interesting', facts.whyInteresting.join(' | '));
  push('remaining questions', facts.remainingQuestions.join(' | '));
  push('rejected', facts.rejected);
  push('rejection reasons', facts.rejectionReasons.join(' | '));
  push('citable evidence fields', facts.evidenceFields.join(', '));

  return lines.join('\n');
}
