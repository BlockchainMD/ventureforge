import type { JobStatus } from './enums';

/**
 * Queue contract. Two drivers implement it — Postgres (default) and BullMQ
 * (when `REDIS_URL` is present). See docs/decisions/0003-job-queue.md.
 */

export const JOB_TYPES = [
  'source.ingest',
  'source.discover',
  'parcel.enrich',
  'parcel.score',
  'parcel.valuate',
  'parcel.memo',
  'parcel.listing',
  'alert.evaluate',
  'worklist.notify',
  'finance.sweep',
  'calibration.run',
  'maintenance.sourceHealth',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface JobPayloadMap {
  'source.ingest': { sourceId: string; force?: boolean; triggeredBy?: string };
  'source.discover': { state: string; county?: string; requestedBy: string };
  'parcel.enrich': { parcelId: string; stages?: readonly EnrichmentStage[] };
  'parcel.score': { parcelId: string };
  'parcel.valuate': { parcelId: string };
  'parcel.memo': { parcelId: string; requestedBy?: string };
  'parcel.listing': { parcelId: string; requestedBy?: string };
  'alert.evaluate': { alertId?: string; since?: string };
  /** Nudge whoever can act that parcels are blocked on a fact only a person can obtain. */
  'worklist.notify': Record<string, never>;
  /** Re-evaluate live seller-financed notes; delinquency is a function of the calendar. */
  'finance.sweep': Record<string, never>;
  /** Grade past predictions against realised outcomes and apply what the evidence supports. */
  'calibration.run': Record<string, never>;
  'maintenance.sourceHealth': Record<string, never>;
}

export const ENRICHMENT_STAGES = [
  'geometry',
  'access',
  'environmental',
  'buildability',
  'valuation',
  'title',
  'scoring',
] as const;
export type EnrichmentStage = (typeof ENRICHMENT_STAGES)[number];

export interface EnqueueOptions {
  /** Collapses duplicates: enqueueing the same key twice is a no-op while pending. */
  readonly dedupeKey?: string;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  /** Higher runs first. */
  readonly priority?: number;
}

export interface JobRecord<T extends JobType = JobType> {
  readonly id: string;
  readonly type: T;
  readonly payload: JobPayloadMap[T];
  readonly status: JobStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly lastError: string | null;
  readonly result: unknown;
}

/**
 * Producer side. The web app only ever needs this half.
 */
export interface JobQueue {
  enqueue<T extends JobType>(
    type: T,
    payload: JobPayloadMap[T],
    options?: EnqueueOptions,
  ): Promise<string>;
  cancel(jobId: string): Promise<void>;
  close(): Promise<void>;
}

export type JobHandler<T extends JobType> = (
  payload: JobPayloadMap[T],
  ctx: { jobId: string; attempt: number },
) => Promise<unknown>;

export type JobHandlerMap = { [T in JobType]?: JobHandler<T> };

export interface ConsumerOptions {
  readonly concurrency: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly onJobStart?: (job: JobRecord) => void;
  readonly onJobEnd?: (job: JobRecord, outcome: 'SUCCEEDED' | 'FAILED', detail?: string) => void;
}

/**
 * Consumer side, implemented by the worker's driver.
 *
 * Kept separate from `JobQueue` because the two drivers consume very
 * differently — the Postgres driver polls and claims with SKIP LOCKED, BullMQ
 * pushes through its own worker — while both produce identically.
 */
export interface JobConsumer {
  start(handlers: JobHandlerMap, options: ConsumerOptions): Promise<void>;
  stop(): Promise<void>;
}

/** Exponential backoff with full jitter, capped at 15 minutes. */
export function backoffMs(attempt: number, baseMs = 2000, capMs = 15 * 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exponential / 2 + Math.random() * (exponential / 2));
}
