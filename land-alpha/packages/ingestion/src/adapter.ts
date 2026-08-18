import type { ParcelOpportunityInput, RejectedItem } from '@land-alpha/shared';
import type { RegistryEntry } from '@land-alpha/source-registry';
import type { IngestHttpClient } from './fetch/http';
import type { Logger } from '@land-alpha/shared/logger';

/**
 * The SourceAdapter contract.
 *
 * Every government source, however it publishes, is reduced to this. The four
 * stages are separate so that each can be tested and reasoned about alone:
 *
 *   discover()  find the current artefact (a list URL changes every quarter)
 *   fetch()     pull bytes, retained verbatim for provenance
 *   parse()     bytes -> raw records, no interpretation
 *   normalize() raw records -> ParcelOpportunityInput, all interpretation here
 *   validate()  reject records that would poison the pipeline
 *
 * Splitting parse from normalize is the important one: a county changing its
 * column header breaks parse and nothing else, while a county changing what a
 * column *means* breaks normalize and nothing else. Conflating them makes both
 * failures look identical in the logs.
 */

export interface AdapterContext {
  readonly source: RegistryEntry;
  readonly sourceId: string;
  readonly runId: string;
  readonly http: IngestHttpClient;
  readonly logger: Logger;
  readonly signal?: AbortSignal;
  /** Persist a raw artefact and return its storage key. */
  readonly persistArtifact: (
    filename: string,
    body: Buffer,
    meta: { url?: string; contentType?: string | null },
  ) => Promise<string>;
}

/** A located artefact: the thing we are about to fetch. */
export interface DiscoveredArtifact {
  readonly url: string;
  readonly kind: 'ARCGIS_LAYER' | 'CSV' | 'XLSX' | 'HTML' | 'PDF' | 'JSON';
  readonly label: string;
  readonly meta?: Record<string, unknown>;
}

/** Raw, uninterpreted records straight out of the artefact. */
export interface ParsedBatch {
  readonly records: readonly Record<string, unknown>[];
  readonly artifactKey: string | null;
  readonly sourceUrl: string;
  readonly warnings: readonly string[];
}

export interface NormalizedBatch {
  readonly items: readonly ParcelOpportunityInput[];
  readonly rejected: readonly RejectedItem[];
  readonly warnings: readonly string[];
}

export interface SourceAdapter {
  readonly key: string;
  readonly description: string;
  /** Bump when parsing changes materially; recorded on every ingestion run. */
  readonly parserVersion: string;

  discover(ctx: AdapterContext): Promise<DiscoveredArtifact[]>;
  fetchAndParse(ctx: AdapterContext, artifact: DiscoveredArtifact): Promise<ParsedBatch>;
  normalize(ctx: AdapterContext, batch: ParsedBatch): Promise<NormalizedBatch>;
}

/**
 * Validation applied to every adapter's output, regardless of source.
 *
 * These are the invariants downstream engines rely on. A record failing them is
 * rejected with a reason and counted, never silently dropped and never repaired
 * by inventing a value.
 */
export function validateNormalized(items: readonly ParcelOpportunityInput[]): {
  items: ParcelOpportunityInput[];
  rejected: RejectedItem[];
} {
  const accepted: ParcelOpportunityInput[] = [];
  const rejected: RejectedItem[] = [];
  const seenKeys = new Set<string>();

  items.forEach((item, index) => {
    const problems: string[] = [];

    if (!item.apn?.trim() && !item.sourceRecordId?.trim()) {
      problems.push('record has neither an APN nor a source record identifier');
    }
    if (!/^[A-Z]{2}$/.test(item.state)) {
      problems.push(`invalid state code "${item.state}"`);
    }
    if (!item.county?.trim()) {
      problems.push('missing county');
    }
    if (item.acreage != null && (!Number.isFinite(item.acreage) || item.acreage < 0)) {
      problems.push(`invalid acreage ${item.acreage}`);
    }
    // A single parcel over 50,000 acres is a data error, not a ranch.
    if (item.acreage != null && item.acreage > 50_000) {
      problems.push(`implausible acreage ${item.acreage}`);
    }
    for (const [field, value] of [
      ['minimumBid', item.minimumBid],
      ['askingPrice', item.askingPrice],
      ['assessedValue', item.assessedValue],
    ] as const) {
      if (value != null && (!Number.isFinite(value) || value < 0)) {
        problems.push(`invalid ${field}: ${value}`);
      }
    }
    if (item.latitude != null && (item.latitude < -90 || item.latitude > 90)) {
      problems.push(`latitude out of range: ${item.latitude}`);
    }
    if (item.longitude != null && (item.longitude < -180 || item.longitude > 180)) {
      problems.push(`longitude out of range: ${item.longitude}`);
    }

    const key = `${item.sourceRecordId ?? ''}|${item.apn ?? ''}`;
    if (seenKeys.has(key)) {
      problems.push('duplicate record within the same batch');
    }

    if (problems.length > 0) {
      rejected.push({ index, reason: problems.join('; '), raw: item.rawRecord });
      return;
    }
    seenKeys.add(key);
    accepted.push(item);
  });

  return { items: accepted, rejected };
}

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  adapters.set(adapter.key, adapter);
}

export function getAdapter(key: string): SourceAdapter | undefined {
  return adapters.get(key);
}

export function listAdapters(): SourceAdapter[] {
  return [...adapters.values()];
}
