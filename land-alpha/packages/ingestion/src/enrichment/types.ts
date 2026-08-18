import type { AnyGeometry, ParcelGeometry, Position } from '@land-alpha/shared';
import type { IngestHttpClient } from '../fetch/http.js';

/**
 * Enrichment connectors.
 *
 * Each connector wraps one public dataset and returns raw observations. All
 * *interpretation* happens in `@land-alpha/core` — connectors never decide
 * whether a parcel is risky, only what the published layers say about it.
 *
 * Every connector must degrade gracefully: an unreachable federal service
 * returns `available: false`, which the confidence model treats as "unmeasured"
 * rather than "clear".
 */

export interface EnrichmentTarget {
  readonly parcelId: string;
  readonly centroid: Position;
  readonly geometry: ParcelGeometry | null;
  readonly acreage: number | null;
}

export interface EnrichmentContext {
  readonly http: IngestHttpClient;
  readonly mode: 'fixture' | 'live';
  readonly signal?: AbortSignal;
}

export interface OverlayHit {
  readonly label: string;
  readonly geometry: AnyGeometry | null;
  readonly attributes: Record<string, unknown>;
}
