import { prisma } from '../client';
import type { Prisma } from '@prisma/client';

/**
 * Source health.
 *
 * "Is our data still real?" is the question that decides whether the whole
 * product can be trusted on any given morning, so it gets a first-class
 * computation rather than a chart bolted onto a log view.
 */

export interface SourceHealth {
  readonly id: string;
  readonly registryKey: string;
  readonly name: string;
  readonly state: string;
  readonly county: string | null;
  readonly sourceType: string;
  readonly ingestionMethod: string;
  readonly sourceStatus: string;
  readonly enabled: boolean;
  readonly lastCheckedAt: Date | null;
  readonly lastSuccessfulAt: Date | null;
  readonly consecutiveFailures: number;
  readonly parcelCount: number;
  readonly liveParcelCount: number;
  readonly runsLast30: number;
  readonly successfulRunsLast30: number;
  readonly successRate: number | null;
  readonly staleness: 'FRESH' | 'DUE' | 'STALE' | 'NEVER_RUN' | 'MANUAL';
  readonly expectedIntervalHours: number | null;
}

const EXPECTED_INTERVAL_HOURS: Record<string, number> = {
  REALTIME: 6,
  DAILY: 24,
  WEEKLY: 24 * 7,
  MONTHLY: 24 * 30,
  QUARTERLY: 24 * 90,
  ANNUAL: 24 * 365,
  EVENT_DRIVEN: 24 * 14,
  UNKNOWN: 24 * 14,
};

export async function listSourceHealth(now = new Date()): Promise<SourceHealth[]> {
  const since = new Date(now.getTime() - 30 * 24 * 3600_000);
  const sources = await prisma.source.findMany({
    include: {
      jurisdiction: { select: { state: true, county: true } },
      _count: { select: { parcels: true } },
    },
    orderBy: [{ enabled: 'desc' }, { sourceStatus: 'asc' }, { name: 'asc' }],
  });

  const [runGroups, liveCounts] = await Promise.all([
    prisma.ingestionRun.groupBy({
      by: ['sourceId', 'status'],
      where: { startedAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.parcelOpportunity.groupBy({
      by: ['sourceId'],
      where: { removedFromSourceAt: null, rejected: false },
      _count: { _all: true },
    }),
  ]);

  const liveBySource = new Map(liveCounts.map((row) => [row.sourceId, row._count._all]));
  const runsBySource = new Map<string, { total: number; successful: number }>();
  for (const group of runGroups) {
    const entry = runsBySource.get(group.sourceId) ?? { total: 0, successful: 0 };
    entry.total += group._count._all;
    if (group.status === 'SUCCEEDED' || group.status === 'PARTIAL') {
      entry.successful += group._count._all;
    }
    runsBySource.set(group.sourceId, entry);
  }

  return sources.map((source) => {
    const runs = runsBySource.get(source.id) ?? { total: 0, successful: 0 };
    const expected = EXPECTED_INTERVAL_HOURS[source.updateFrequency] ?? null;
    return {
      id: source.id,
      registryKey: source.registryKey,
      name: source.name,
      state: source.jurisdiction.state,
      county: source.jurisdiction.county,
      sourceType: source.sourceType,
      ingestionMethod: source.ingestionMethod,
      sourceStatus: source.sourceStatus,
      enabled: source.enabled,
      lastCheckedAt: source.lastCheckedAt,
      lastSuccessfulAt: source.lastSuccessfulAt,
      consecutiveFailures: source.consecutiveFailures,
      parcelCount: source._count.parcels,
      liveParcelCount: liveBySource.get(source.id) ?? 0,
      runsLast30: runs.total,
      successfulRunsLast30: runs.successful,
      successRate: runs.total === 0 ? null : runs.successful / runs.total,
      staleness: computeStaleness(source.ingestionMethod, source.lastSuccessfulAt, expected, now),
      expectedIntervalHours: expected,
    };
  });
}

function computeStaleness(
  ingestionMethod: string,
  lastSuccessfulAt: Date | null,
  expectedHours: number | null,
  now: Date,
): SourceHealth['staleness'] {
  if (ingestionMethod === 'MANUAL_SOURCE') return 'MANUAL';
  if (!lastSuccessfulAt) return 'NEVER_RUN';
  if (!expectedHours) return 'FRESH';
  const ageHours = (now.getTime() - lastSuccessfulAt.getTime()) / 3600_000;
  if (ageHours > expectedHours * 2) return 'STALE';
  if (ageHours > expectedHours) return 'DUE';
  return 'FRESH';
}

/** Sources whose next refresh is due. Drives the scheduler. */
export async function sourcesDueForRefresh(now = new Date()): Promise<string[]> {
  const sources = await prisma.source.findMany({
    where: { enabled: true, sourceStatus: { in: ['ACTIVE', 'DEGRADED'] } },
    select: { id: true, updateFrequency: true, lastSuccessfulAt: true, consecutiveFailures: true },
  });
  return sources
    .filter((source) => {
      const expected = EXPECTED_INTERVAL_HOURS[source.updateFrequency] ?? 24 * 14;
      if (!source.lastSuccessfulAt) return true;
      // Back off a source that keeps failing rather than hammering it.
      const penalty = Math.min(source.consecutiveFailures, 5) * expected * 0.5;
      const ageHours = (now.getTime() - source.lastSuccessfulAt.getTime()) / 3600_000;
      return ageHours >= expected + penalty;
    })
    .map((source) => source.id);
}

export async function recordRunStart(
  sourceId: string,
  parserVersion: string,
  triggeredBy: string,
): Promise<string> {
  const run = await prisma.ingestionRun.create({
    data: { sourceId, parserVersion, triggeredBy },
    select: { id: true },
  });
  await prisma.source.update({
    where: { id: sourceId },
    data: { lastCheckedAt: new Date() },
  });
  return run.id;
}

export interface RunCompletion {
  readonly status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  readonly recordsDiscovered: number;
  readonly recordsCreated: number;
  readonly recordsChanged: number;
  readonly recordsUnchanged: number;
  readonly recordsRemoved: number;
  readonly recordsRejected: number;
  readonly requestCount: number;
  readonly bytesFetched: number;
  readonly errors: unknown[];
  readonly warnings: unknown[];
  readonly notes?: string;
}

export async function recordRunCompletion(
  runId: string,
  sourceId: string,
  completion: RunCompletion,
): Promise<void> {
  const run = await prisma.ingestionRun.findUnique({
    where: { id: runId },
    select: { startedAt: true },
  });
  const completedAt = new Date();

  await prisma.$transaction([
    prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: completion.status,
        completedAt,
        durationMs: run ? completedAt.getTime() - run.startedAt.getTime() : null,
        recordsDiscovered: completion.recordsDiscovered,
        recordsCreated: completion.recordsCreated,
        recordsChanged: completion.recordsChanged,
        recordsUnchanged: completion.recordsUnchanged,
        recordsRemoved: completion.recordsRemoved,
        recordsRejected: completion.recordsRejected,
        requestCount: completion.requestCount,
        bytesFetched: completion.bytesFetched,
        errorCount: completion.errors.length,
        errors: completion.errors as Prisma.InputJsonValue,
        warnings: completion.warnings as Prisma.InputJsonValue,
        notes: completion.notes ?? null,
      },
    }),
    prisma.source.update({
      where: { id: sourceId },
      data:
        completion.status === 'SUCCEEDED' || completion.status === 'PARTIAL'
          ? {
              lastSuccessfulAt: completedAt,
              consecutiveFailures: 0,
              sourceStatus: completion.status === 'PARTIAL' ? 'DEGRADED' : 'ACTIVE',
            }
          : completion.status === 'FAILED'
            ? { consecutiveFailures: { increment: 1 } }
            : {},
    }),
  ]);

  // Three straight failures is not a blip; stop scheduling it and surface it.
  if (completion.status === 'FAILED') {
    const source = await prisma.source.findUnique({
      where: { id: sourceId },
      select: { consecutiveFailures: true },
    });
    if (source && source.consecutiveFailures >= 3) {
      await prisma.source.update({ where: { id: sourceId }, data: { sourceStatus: 'BROKEN' } });
    }
  }
}
