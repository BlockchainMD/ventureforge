import type { ConfidenceLevel, ExtractionMethod } from './enums';

/**
 * Provenance is mandatory in Land Alpha, not decorative.
 *
 * Every derived field on a parcel that a human might act on carries a
 * `ProvenancedValue`: the value, where it came from, when, how confident we
 * are, and a pointer to the evidence record that proves it.
 */

export interface ProvenancedValue<T> {
  readonly value: T;
  readonly source: string;
  readonly sourceUrl?: string | null;
  readonly retrievedAt: Date;
  readonly confidence: ConfidenceLevel;
  readonly extractionMethod: ExtractionMethod;
  /** Verbatim snippet supporting the value. Never paraphrased. */
  readonly extractedText?: string | null;
  /** Object-storage key of the artefact this came from, when one exists. */
  readonly documentKey?: string | null;
  readonly notes?: string | null;
}

export interface EvidenceInput {
  readonly field: string;
  readonly value: string;
  readonly source: string;
  readonly sourceUrl?: string | null;
  readonly documentKey?: string | null;
  readonly extractedText?: string | null;
  readonly retrievedAt: Date;
  readonly confidence: ConfidenceLevel;
  readonly extractionMethod: ExtractionMethod;
  readonly notes?: string | null;
}

export function provenanced<T>(
  value: T,
  meta: Omit<ProvenancedValue<T>, 'value'>,
): ProvenancedValue<T> {
  return { value, ...meta };
}

export function toEvidence<T>(field: string, pv: ProvenancedValue<T>): EvidenceInput {
  return {
    field,
    value: serializeValue(pv.value),
    source: pv.source,
    sourceUrl: pv.sourceUrl ?? null,
    documentKey: pv.documentKey ?? null,
    extractedText: pv.extractedText ?? null,
    retrievedAt: pv.retrievedAt,
    confidence: pv.confidence,
    extractionMethod: pv.extractionMethod,
    notes: pv.notes ?? null,
  };
}

function serializeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

/** Convenience for engines that produce many evidence rows at once. */
export class EvidenceCollector {
  private readonly rows: EvidenceInput[] = [];

  add(input: EvidenceInput): this {
    this.rows.push(input);
    return this;
  }

  addValue<T>(field: string, pv: ProvenancedValue<T>): this {
    return this.add(toEvidence(field, pv));
  }

  /** Record a computed value, attributing it to the engine that derived it. */
  addDerived(
    field: string,
    value: unknown,
    options: {
      engine: string;
      confidence: ConfidenceLevel;
      retrievedAt?: Date;
      notes?: string;
      inputs?: readonly string[];
    },
  ): this {
    return this.add({
      field,
      value: serializeValue(value),
      source: options.engine,
      sourceUrl: null,
      documentKey: null,
      extractedText: options.inputs?.length ? `derived from: ${options.inputs.join(', ')}` : null,
      retrievedAt: options.retrievedAt ?? new Date(),
      confidence: options.confidence,
      extractionMethod: 'DERIVED_CALCULATION',
      notes: options.notes ?? null,
    });
  }

  all(): readonly EvidenceInput[] {
    return this.rows;
  }

  get size(): number {
    return this.rows.length;
  }
}
