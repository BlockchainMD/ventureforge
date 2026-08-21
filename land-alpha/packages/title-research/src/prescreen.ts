import {
  minConfidence,
  type ConfidenceLevel,
  type TitleFinding,
  type TitlePreScreen,
  type UsdCents,
} from '@land-alpha/shared';

/**
 * Title pre-screen — emphatically **not** a title opinion.
 *
 * This module answers one narrow question: *given the recorded instruments we
 * have actually seen, how likely is this parcel to be a title problem?* It
 * produces a 0-100 risk score, a set of named findings, and — most importantly
 * — an explicit list of what it does not know.
 *
 * Tax-forfeited and tax-foreclosure inventory has a characteristic title
 * profile that this engine is tuned for: the government's own deed usually
 * extinguishes most prior encumbrances, but not all of them, and *which* ones
 * survive is jurisdiction-specific. Federal liens, certain assessments and
 * easements commonly survive; that is why they are weighted the way they are.
 */

export interface TitleInstrumentInput {
  readonly instrumentType: string;
  readonly recordedDate: Date | null;
  readonly grantor: string | null;
  readonly grantee: string | null;
  readonly amountCents: UsdCents | null;
  readonly description: string | null;
  readonly resolved: boolean;
  readonly chainPosition: number | null;
  readonly sourceUrl?: string | null;
}

export interface TitlePreScreenInputs {
  readonly instruments: readonly TitleInstrumentInput[];
  /** True when a recorder search was actually performed for this parcel. */
  readonly recorderSearched: boolean;
  /** True when the recorder cannot be searched programmatically. */
  readonly recorderRequiresManualSearch: boolean;
  /** How the government came to own it — drives which encumbrances survive. */
  readonly acquisitionMechanism:
    'TAX_FORFEITURE' | 'TAX_FORECLOSURE' | 'SURPLUS' | 'LAND_BANK' | 'UNKNOWN';
  readonly hasLegalDescription: boolean;
  readonly ownerNameMatchesRecord: boolean | null;
}

/** Points contributed by each finding type, before mechanism adjustment. */
const SEVERITY_POINTS: Record<
  string,
  { points: number; severity: TitleFinding['severity']; summary: string }
> = {
  FEDERAL_LIEN: {
    points: 35,
    severity: 'MAJOR',
    summary:
      'Federal lien of record. Federal liens frequently survive a tax sale and carry a statutory redemption right.',
  },
  TAX_LIEN: {
    points: 12,
    severity: 'MODERATE',
    summary:
      'Tax lien of record. Often extinguished by the forfeiture itself, but must be confirmed.',
  },
  MORTGAGE: {
    points: 18,
    severity: 'MODERATE',
    summary: 'Recorded mortgage. Usually extinguished by tax foreclosure if properly noticed.',
  },
  JUDGMENT: {
    points: 16,
    severity: 'MODERATE',
    summary: 'Recorded judgment against a prior owner.',
  },
  LIEN: { points: 12, severity: 'MODERATE', summary: 'Recorded lien of unspecified type.' },
  PROBATE_INDICATOR: {
    points: 22,
    severity: 'MAJOR',
    summary:
      'Chain passes through an estate. Heirs may hold unreleased interests that a tax deed does not clear.',
  },
  QUIET_TITLE_INDICATOR: {
    points: 20,
    severity: 'MAJOR',
    summary: 'Record suggests a quiet-title action will be needed to make title marketable.',
  },
  RESTRICTIVE_COVENANT: {
    points: 8,
    severity: 'MINOR',
    summary: 'Recorded restrictive covenant limiting use.',
  },
  HOA_REFERENCE: {
    points: 10,
    severity: 'MINOR',
    summary: 'HOA or POA reference: assessments may run with the land and survive a tax sale.',
  },
  EASEMENT: {
    points: 4,
    severity: 'INFO',
    summary:
      'Recorded easement. Usually survives any conveyance; check whether it burdens the buildable area.',
  },
  PLAT: { points: 0, severity: 'INFO', summary: 'Recorded plat.' },
  DEED: { points: 0, severity: 'INFO', summary: 'Deed in the chain of title.' },
  OWNERSHIP_TRANSFER: { points: 0, severity: 'INFO', summary: 'Ownership transfer.' },
};

/**
 * How much a given acquisition mechanism reduces the weight of a pre-existing
 * private encumbrance. A properly noticed tax foreclosure wipes most junior
 * liens; a surplus sale by a county that simply owns land does not.
 */
const MECHANISM_LIEN_DISCOUNT: Record<TitlePreScreenInputs['acquisitionMechanism'], number> = {
  TAX_FORFEITURE: 0.35,
  TAX_FORECLOSURE: 0.4,
  LAND_BANK: 0.5,
  SURPLUS: 1,
  UNKNOWN: 0.8,
};

/** Encumbrances that survive regardless of mechanism and are never discounted. */
const SURVIVES_TAX_SALE = new Set([
  'FEDERAL_LIEN',
  'EASEMENT',
  'RESTRICTIVE_COVENANT',
  'HOA_REFERENCE',
]);

export function preScreenTitle(inputs: TitlePreScreenInputs): TitlePreScreen {
  const findings: TitleFinding[] = [];
  const unknowns: string[] = [];
  let confidence: ConfidenceLevel = 'MEDIUM';

  const discount = MECHANISM_LIEN_DISCOUNT[inputs.acquisitionMechanism];

  for (const instrument of inputs.instruments) {
    if (instrument.resolved) continue;
    const type = instrument.instrumentType.toUpperCase();
    const template = SEVERITY_POINTS[type];
    if (!template || template.points === 0) continue;

    const multiplier = SURVIVES_TAX_SALE.has(type) ? 1 : discount;
    const points = Math.round(template.points * multiplier);
    if (points === 0) continue;

    findings.push({
      instrumentType: type,
      severity: template.severity,
      summary: describeInstrument(instrument, template.summary, multiplier < 1),
      points,
      evidenceRef: instrument.sourceUrl ?? null,
    });
  }

  // ---- Chain analysis ------------------------------------------------------
  const deeds = inputs.instruments
    .filter((instrument) => {
      const type = instrument.instrumentType.toUpperCase();
      return type === 'DEED' || type === 'OWNERSHIP_TRANSFER';
    })
    .sort((a, b) => (b.recordedDate?.getTime() ?? 0) - (a.recordedDate?.getTime() ?? 0));

  const chainDepth = deeds.length;
  const chainGaps: string[] = [];

  for (let i = 0; i < deeds.length - 1; i += 1) {
    const later = deeds[i]!;
    const earlier = deeds[i + 1]!;
    // The grantor of a deed should be the grantee of the one before it. A break
    // means either a missing instrument or a defective conveyance.
    if (later.grantor && earlier.grantee && !namesRoughlyMatch(later.grantor, earlier.grantee)) {
      chainGaps.push(
        `Chain break: "${later.grantor}" conveyed in ${formatYear(later.recordedDate)} but the prior deed vested title in "${earlier.grantee}".`,
      );
    }
    if (later.recordedDate && earlier.recordedDate) {
      const gapYears =
        (later.recordedDate.getTime() - earlier.recordedDate.getTime()) / (365 * 86_400_000);
      if (gapYears > 45) {
        chainGaps.push(
          `${Math.round(gapYears)}-year gap between recorded conveyances (${formatYear(earlier.recordedDate)}–${formatYear(later.recordedDate)}).`,
        );
      }
    }
  }

  for (const gap of chainGaps) {
    findings.push({
      instrumentType: 'CHAIN',
      severity: 'MAJOR',
      summary: gap,
      points: 15,
      evidenceRef: null,
    });
  }

  // ---- Coverage and confidence --------------------------------------------
  if (inputs.recorderRequiresManualSearch) {
    unknowns.push(
      'This county recorder cannot be searched programmatically. A manual search has been queued; findings below are incomplete until it is done.',
    );
    confidence = 'LOW';
  } else if (!inputs.recorderSearched) {
    unknowns.push('No recorder search has been performed for this parcel.');
    confidence = 'UNKNOWN';
  }

  if (chainDepth === 0) {
    unknowns.push('No deeds have been retrieved, so no chain of title could be constructed.');
    confidence = minConfidence(confidence, 'LOW');
  } else if (chainDepth < 2) {
    unknowns.push('Only one deed was retrieved; the chain has not been traced back.');
    confidence = minConfidence(confidence, 'LOW');
  }

  if (!inputs.hasLegalDescription) {
    unknowns.push(
      'No legal description is available, so recorded instruments cannot be matched to this parcel with certainty.',
    );
    confidence = minConfidence(confidence, 'LOW');
  }

  if (inputs.ownerNameMatchesRecord === false) {
    findings.push({
      instrumentType: 'OWNERSHIP',
      severity: 'MODERATE',
      summary:
        'The owner named by the sale source does not match the last recorded grantee. One of the two records is stale or the parcel has been misidentified.',
      points: 12,
      evidenceRef: null,
    });
  } else if (inputs.ownerNameMatchesRecord == null) {
    unknowns.push('Vesting owner has not been reconciled against the recorded chain.');
  }

  unknowns.push('Survey matters, boundary disputes and unrecorded interests are not covered.');

  // ---- Score ---------------------------------------------------------------
  const rawPoints = findings.reduce((sum, finding) => sum + finding.points, 0);

  /**
   * An unsearched recorder is not the same as a clean one. Rather than scoring
   * such a parcel as low risk, an unknown baseline is applied, so a parcel with
   * no research reads as "unassessed risk" instead of "no risk found".
   */
  const unresearchedBaseline = inputs.recorderSearched
    ? 0
    : inputs.recorderRequiresManualSearch
      ? 30
      : 25;

  const riskScore = Math.min(100, rawPoints + unresearchedBaseline);
  const band = bandForScore(riskScore);

  return {
    riskScore,
    band,
    findings: findings.sort((a, b) => b.points - a.points),
    chainDepth,
    chainGaps,
    unknowns,
    requiresProfessionalReview: riskScore > 40,
    confidence,
    disclaimer: TITLE_DISCLAIMER,
  };
}

/** Bands specified in the brief. */
export function bandForScore(score: number): TitlePreScreen['band'] {
  if (score <= 20) return 'LOW';
  if (score <= 40) return 'MODERATE';
  if (score <= 60) return 'REVIEW_RECOMMENDED';
  if (score <= 80) return 'SUBSTANTIAL';
  return 'REJECT';
}

/**
 * Estimated curative cost implied by the findings. Feeds the all-in basis, so
 * that a parcel with a probate problem is not underwritten as if it were clean.
 */
export function estimateCurativeCostCents(prescreen: TitlePreScreen): UsdCents {
  let cost = 0;
  for (const finding of prescreen.findings) {
    switch (finding.severity) {
      case 'BLOCKING':
        cost += 350_000; // $3,500 — quiet title action
        break;
      case 'MAJOR':
        cost += 175_000; // $1,750
        break;
      case 'MODERATE':
        cost += 60_000; // $600
        break;
      case 'MINOR':
        cost += 15_000; // $150
        break;
      default:
        break;
    }
  }
  if (prescreen.chainGaps.length > 0) cost += 200_000;
  return cost;
}

export const TITLE_DISCLAIMER =
  'Preliminary automated title research only. Not a title opinion or title insurance commitment. Land Alpha does not perform title examinations; obtain a title commitment from a licensed title company before acquiring.';

// --- helpers ---------------------------------------------------------------

function describeInstrument(
  instrument: TitleInstrumentInput,
  base: string,
  discounted: boolean,
): string {
  const parts = [base];
  if (instrument.recordedDate) parts.push(`Recorded ${formatYear(instrument.recordedDate)}.`);
  if (instrument.grantor) parts.push(`Grantor: ${instrument.grantor}.`);
  if (instrument.description) parts.push(instrument.description);
  if (discounted) {
    parts.push('Weight reduced because the acquisition mechanism commonly extinguishes it.');
  }
  return parts.join(' ');
}

/**
 * Name matching for chain analysis. Deliberately loose: recorders are riddled
 * with punctuation, entity-suffix and middle-initial variation, and a strict
 * comparison would report a chain break on every other parcel.
 */
export function namesRoughlyMatch(a: string, b: string): boolean {
  const normalize = (value: string): string =>
    value
      .toUpperCase()
      .replace(/\b(LLC|INC|CORP|CO|LP|LLP|TRUST|TRUSTEE|ET AL|ET UX|JR|SR|II|III)\b/g, '')
      .replace(/[^A-Z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return true;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const leftTokens = new Set(left.split(' ').filter((token) => token.length > 2));
  const rightTokens = right.split(' ').filter((token) => token.length > 2);
  if (leftTokens.size === 0 || rightTokens.length === 0) return true;

  const shared = rightTokens.filter((token) => leftTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.length) >= 0.5;
}

function formatYear(date: Date | null): string {
  return date ? String(date.getUTCFullYear()) : 'an unknown year';
}
