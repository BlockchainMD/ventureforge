import Link from 'next/link';
import { prisma } from '@land-alpha/db';
import { formatDateTime, formatNumber, humanizeEnum } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';

export const metadata = { title: 'Ingestion — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * Observability for the data pipeline.
 *
 * Two questions, in order: is anything broken, and what did the last runs
 * actually do? Failed parsers are surfaced first because a silently broken
 * parser is worse than an obviously failed one.
 */
export default async function IngestionPage() {
  const since = new Date(Date.now() - 7 * 86_400_000);

  const [runs, jobs, failing, totals] = await Promise.all([
    prisma.ingestionRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 40,
      include: { source: { select: { id: true, name: true, registryKey: true } } },
    }),
    prisma.job.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.source.findMany({
      where: { OR: [{ sourceStatus: 'BROKEN' }, { consecutiveFailures: { gt: 0 } }] },
      select: { id: true, name: true, consecutiveFailures: true, sourceStatus: true },
      orderBy: { consecutiveFailures: 'desc' },
    }),
    prisma.ingestionRun.aggregate({
      where: { startedAt: { gte: since } },
      _sum: {
        recordsDiscovered: true,
        recordsCreated: true,
        recordsChanged: true,
        recordsRejected: true,
        requestCount: true,
        bytesFetched: true,
      },
      _count: { _all: true },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Ingestion"
        subtitle="Pipeline health, run history and the job queue."
      />

      <div className="space-y-3 p-4">
        <Panel>
          <PanelHeader title="Last seven days" />
          <PanelBody>
            <MetricGrid columns={6}>
              <Metric label="Runs">{formatNumber(totals._count._all)}</Metric>
              <Metric label="Records seen">
                {formatNumber(totals._sum.recordsDiscovered ?? 0)}
              </Metric>
              <Metric label="New parcels" tone="text-good">
                {formatNumber(totals._sum.recordsCreated ?? 0)}
              </Metric>
              <Metric label="Changed">{formatNumber(totals._sum.recordsChanged ?? 0)}</Metric>
              <Metric
                label="Rejected rows"
                hint="Records that failed validation and were counted, not silently dropped"
                tone={(totals._sum.recordsRejected ?? 0) > 0 ? 'text-warn' : undefined}
              >
                {formatNumber(totals._sum.recordsRejected ?? 0)}
              </Metric>
              <Metric label="HTTP requests" hint="Total requests made to government servers">
                {formatNumber(totals._sum.requestCount ?? 0)}
              </Metric>
            </MetricGrid>
          </PanelBody>
        </Panel>

        {failing.length > 0 ? (
          <Panel className="border-bad/40">
            <PanelHeader
              title="Parsers needing attention"
              subtitle="A source that fails three times running is taken out of the schedule automatically."
            />
            <PanelBody className="space-y-1.5">
              {failing.map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3">
                  <Link href={`/sources/${source.id}`} className="text-xs text-ink hover:text-alpha">
                    {source.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="num text-[11px] text-bad">
                      {source.consecutiveFailures} consecutive failure
                      {source.consecutiveFailures === 1 ? '' : 's'}
                    </span>
                    <Badge tone={source.sourceStatus === 'BROKEN' ? 'bad' : 'warn'}>
                      {humanizeEnum(source.sourceStatus)}
                    </Badge>
                  </div>
                </div>
              ))}
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader title="Recent runs" />
          <DataTable>
            <Thead>
              <tr>
                <Th>Started</Th>
                <Th>Source</Th>
                <Th>Status</Th>
                <Th align="right">Found</Th>
                <Th align="right">New</Th>
                <Th align="right">Changed</Th>
                <Th align="right">Removed</Th>
                <Th align="right">Rejected</Th>
                <Th align="right">Errors</Th>
                <Th align="right">Duration</Th>
                <Th>Trigger</Th>
              </tr>
            </Thead>
            <tbody>
              {runs.length === 0 ? (
                <EmptyRow colSpan={11}>
                  No ingestion runs yet. Trigger one from the Sources screen.
                </EmptyRow>
              ) : (
                runs.map((run) => (
                  <Tr key={run.id}>
                    <Td className="text-ink-muted">{formatDateTime(run.startedAt)}</Td>
                    <Td>
                      <Link href={`/sources/${run.source.id}`} className="hover:text-alpha">
                        {run.source.name}
                      </Link>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                    </Td>
                    <Td align="right">{formatNumber(run.recordsDiscovered)}</Td>
                    <Td align="right" className={run.recordsCreated > 0 ? 'text-good' : undefined}>
                      {formatNumber(run.recordsCreated)}
                    </Td>
                    <Td align="right">{formatNumber(run.recordsChanged)}</Td>
                    <Td align="right">{formatNumber(run.recordsRemoved)}</Td>
                    <Td align="right" className={run.recordsRejected > 0 ? 'text-warn' : undefined}>
                      {formatNumber(run.recordsRejected)}
                    </Td>
                    <Td align="right" className={run.errorCount > 0 ? 'text-bad' : undefined}>
                      {formatNumber(run.errorCount)}
                    </Td>
                    <Td align="right" className="text-ink-faint">
                      <Value>
                        {run.durationMs == null ? null : `${(run.durationMs / 1000).toFixed(1)}s`}
                      </Value>
                    </Td>
                    <Td className="text-ink-faint">{run.triggeredBy}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <Panel>
          <PanelHeader
            title="Job queue"
            subtitle="Ingestion, enrichment, scoring and alert evaluation."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Queued</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th align="right">Attempts</Th>
                <Th>Last error</Th>
              </tr>
            </Thead>
            <tbody>
              {jobs.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No jobs. Start the worker with <span className="num">pnpm worker</span> to process
                  the queue.
                </EmptyRow>
              ) : (
                jobs.map((job) => (
                  <Tr key={job.id}>
                    <Td className="text-ink-muted">{formatDateTime(job.createdAt)}</Td>
                    <Td className="num text-[11px]">{job.type}</Td>
                    <Td>
                      <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                    </Td>
                    <Td align="right">
                      {job.attempts} / {job.maxAttempts}
                    </Td>
                    <Td className="max-w-md truncate text-[11px] text-bad" title={job.lastError ?? ''}>
                      {job.lastError ?? ''}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}
