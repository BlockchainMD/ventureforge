import {
  CONFIDENCE_LEVELS,
  UNVERIFIABLE_EXTRACTION_METHODS,
  type ConfidenceLevel,
  type ExtractionMethod,
} from './enums.js';

/**
 * The confidence model.
 *
 * Land Alpha's central failure mode is a parcel whose headline economics look
 * spectacular because half its inputs were guessed. The confidence model exists
 * to make that impossible to miss:
 *
 *  - every derived field carries a level,
 *  - levels combine pessimistically (a chain is as weak as its weakest link),
 *  - an aggregate with many unknowns is pulled down even if each known input is
 *    strong.
 */

const ORDER: Record<ConfidenceLevel, number> = {
  UNKNOWN: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  VERIFIED: 4,
};

const FROM_ORDER = ['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'VERIFIED'] as const;

export function confidenceRank(level: ConfidenceLevel): number {
  return ORDER[level];
}

export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

/** Weakest-link combination. Used when a value depends on several inputs. */
export function minConfidence(...levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return 'UNKNOWN';
  let lowest = levels[0]!;
  for (const level of levels) {
    if (ORDER[level] < ORDER[lowest]) lowest = level;
  }
  return lowest;
}

export function maxConfidence(...levels: ConfidenceLevel[]): ConfidenceLevel {
  if (levels.length === 0) return 'UNKNOWN';
  let highest = levels[0]!;
  for (const level of levels) {
    if (ORDER[level] > ORDER[highest]) highest = level;
  }
  return highest;
}

export function demoteConfidence(level: ConfidenceLevel, steps = 1): ConfidenceLevel {
  const next = Math.max(0, ORDER[level] - steps);
  return FROM_ORDER[next]!;
}

export function meetsConfidence(level: ConfidenceLevel, minimum: ConfidenceLevel): boolean {
  return ORDER[level] >= ORDER[minimum];
}

/**
 * The ceiling an extraction method can reach on its own.
 *
 * A structured government API can assert VERIFIED. A regex over PDF text
 * cannot, no matter how confident the parser feels. AI extraction tops out at
 * MEDIUM and is never permitted to be the sole basis for a HIGH claim — that is
 * the mechanical expression of "AI is never the sole authority".
 */
export function ceilingForExtractionMethod(method: ExtractionMethod): ConfidenceLevel {
  if (UNVERIFIABLE_EXTRACTION_METHODS.includes(method)) return 'MEDIUM';
  switch (method) {
    case 'STRUCTURED_API':
    case 'ARCGIS_QUERY':
    case 'ANALYST_ENTRY':
      return 'VERIFIED';
    case 'CSV_COLUMN':
    case 'SPREADSHEET_CELL':
      return 'HIGH';
    case 'HTML_SELECTOR':
    case 'PDF_TABLE':
    case 'SPATIAL_JOIN':
    case 'DERIVED_CALCULATION':
      return 'HIGH';
    case 'PDF_TEXT':
      return 'MEDIUM';
    default:
      return 'MEDIUM';
  }
}

/** Clamp a claimed confidence to what the extraction method can actually support. */
export function clampToExtractionMethod(
  claimed: ConfidenceLevel,
  method: ExtractionMethod,
): ConfidenceLevel {
  return minConfidence(claimed, ceilingForExtractionMethod(method));
}

export interface ConfidenceInput {
  /** Field name, used for explaining the aggregate. */
  readonly field: string;
  readonly level: ConfidenceLevel;
  /** Relative importance of this field to the overall picture. Defaults to 1. */
  readonly weight?: number;
}

export interface AggregateConfidence {
  readonly level: ConfidenceLevel;
  /** 0-100. Continuous companion to the discrete level; used by scoring. */
  readonly score: number;
  readonly unknownFields: readonly string[];
  readonly weakFields: readonly string[];
  readonly explanation: string;
}

const LEVEL_SCORE: Record<ConfidenceLevel, number> = {
  UNKNOWN: 0,
  LOW: 30,
  MEDIUM: 60,
  HIGH: 85,
  VERIFIED: 100,
};

/**
 * Aggregate many field confidences into one parcel-level confidence.
 *
 * Deliberately harsh: unknown fields score zero rather than being skipped, so a
 * parcel with five great facts and five missing ones lands in the middle, not
 * at the top. That is the intended behaviour — see the brief's requirement that
 * "a parcel with numerous unknowns should have its overall confidence reduced
 * even if headline economics appear attractive".
 */
export function aggregateConfidence(inputs: readonly ConfidenceInput[]): AggregateConfidence {
  if (inputs.length === 0) {
    return {
      level: 'UNKNOWN',
      score: 0,
      unknownFields: [],
      weakFields: [],
      explanation: 'No fields evaluated.',
    };
  }

  let weighted = 0;
  let totalWeight = 0;
  const unknownFields: string[] = [];
  const weakFields: string[] = [];

  for (const input of inputs) {
    const weight = input.weight ?? 1;
    weighted += LEVEL_SCORE[input.level] * weight;
    totalWeight += weight;
    if (input.level === 'UNKNOWN') unknownFields.push(input.field);
    else if (input.level === 'LOW') weakFields.push(input.field);
  }

  const score = totalWeight === 0 ? 0 : Math.round(weighted / totalWeight);
  const level = levelFromScore(score);

  const parts: string[] = [`${inputs.length} fields evaluated`];
  if (unknownFields.length > 0) parts.push(`${unknownFields.length} unknown`);
  if (weakFields.length > 0) parts.push(`${weakFields.length} low-confidence`);

  return {
    level,
    score,
    unknownFields,
    weakFields,
    explanation: parts.join(', ') + '.',
  };
}

export function levelFromScore(score: number): ConfidenceLevel {
  if (score >= 95) return 'VERIFIED';
  if (score >= 78) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 20) return 'LOW';
  return 'UNKNOWN';
}

export function scoreFromLevel(level: ConfidenceLevel): number {
  return LEVEL_SCORE[level];
}
