import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { prisma, listOpportunities } from '@land-alpha/db';
import { registryByKey } from '@land-alpha/source-registry';
import { formatDateTime, formatNumber, humanizeEnum } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { OpportunityTable } from '../../opportunities/opportunity-table';

export const dynamic = 'force-dynamic';

export default async function SourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const source = await prisma.source.findUnique({
    where: { id },
    include: {
      jurisdiction: true,
      runs: { orderBy: { startedAt: 'desc' }, take: 25 },
      _count: { select: { parcels: true, artifacts: true } },
    },
  });
  if (!source) notFound();

  const [parcels, registryEntry] = await Promise.all([
    listOpportunities({ sourceIds: [id], pageSize: 25, includeRejected: true }),
    Promise.resolve(registryByKey(source.registryKey)),
  ]);

  return (
    <>
      <PageHeader
        title={source.name}
        subtitle={
          <>
            {source.jurisdiction.county ? `${source.jurisdiction.county} County, ` : ''}
            {source.jurisdiction.state} · {humanizeEnum(source.sourceType)} ·{' '}
            <span className="num">{source.registryKey}</span>
          </>
        }
        actions={
          <>
            <Badge tone={source.enabled ? 'good' : 'muted'}>
              {source.enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={source.sourceStatus === 'ACTIVE' ? 'good' : 'warn'}>
              {humanizeEnum(source.sourceStatus)}
            </Badge>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="col-span-2 space-y-3">
          <Panel>
            <PanelHeader
              title="Ingestion history"
              subtitle="Every run, with a full accounting of what changed."
            />
            <DataTable>
              <Thead>
                <tr>
                  <Th>Started</Th>
                  <Th>Status</Th>
                  <Th align="right">Found</Th>
                  <Th align="right">New</Th>
                  <Th align="right">Changed</Th>
                  <Th align="right">Removed</Th>
                  <Th align="right">Rejected</Th>
                  <Th align="right">Requests</Th>
                  <Th align="right">Duration</Th>
                  <Th>Parser</Th>
                </tr>
              </Thead>
              <tbody>
                {source.runs.length === 0 ? (
                  <EmptyRow colSpan={10}>
                    This source has never been run.
                    {source.ingestionMethod === 'MANUAL_SOURCE'
                      ? ' It is registered manual-only; inventory arrives through the analyst import workflow.'
                      : ''}
                  </EmptyRow>
                ) : (
                  source.runs.map((run) => (
                    <Tr key={run.id}>
                      <Td className="text-ink-muted">{formatDateTime(run.startedAt)}</Td>
                      <Td>
                        <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                      </Td>
                      <Td align="right">{formatNumber(run.recordsDiscovered)}</Td>
                      <Td align="right" className={run.recordsCreated > 0 ? 'text-good' : undefined}>
                        {formatNumber(run.recordsCreated)}
                      </Td>
                      <Td align="right">{formatNumber(run.recordsChanged)}</Td>
                      <Td align="right" className={run.recordsRemoved > 0 ? 'text-warn' : undefined}>
                        {formatNumber(run.recordsRemoved)}
                      </Td>
                      <Td align="right" className={run.recordsRejected > 0 ? 'text-bad' : undefined}>
                        {formatNumber(run.recordsRejected)}
                      </Td>
                      <Td align="right" className="text-ink-faint">
                        {formatNumber(run.requestCount)}
                      </Td>
                      <Td align="right" className="text-ink-faint">
                        <Value>
                          {run.durationMs == null ? null : `${(run.durationMs / 1000).toFixed(1)}s`}
                        </Value>
                      </Td>
                      <Td className="text-ink-faint">v{run.parserVersion}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </Panel>

          <Panel>
            <PanelHeader
              title="Inventory from this source"
              subtitle={`${formatNumber(parcels.total)} parcels, including rejected`}
            />
            <OpportunityTable rows={parcels.rows} showSource={false} />
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Configuration" />
            <PanelBody className="space-y-2">
              <MetricGrid columns={2}>
                <Metric label="Ingestion method">{humanizeEnum(source.ingestionMethod)}</Metric>
                <Metric label="Update frequency">{humanizeEnum(source.updateFrequency)}</Metric>
                <Metric label="Adapter">{source.adapterKey}</Metric>
                <Metric label="Parser version">v{source.parserVersion}</Metric>
                <Metric label="Total parcels">{formatNumber(source._count.parcels)}</Metric>
                <Metric label="Raw artefacts">{formatNumber(source._count.artifacts)}</Metric>
              </MetricGrid>
              <div className="border-t border-line pt-2">
                <p className="rule-label">Failed auction becomes OTC</p>
                <p
                  className={`num mt-0.5 text-sm ${source.failedAuctionBecomesOtc ? 'text-alpha' : 'text-ink-muted'}`}
                >
                  {source.failedAuctionBecomesOtc ? 'YES' : 'No'}
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                  The single most predictive jurisdiction attribute for this strategy: where failed
                  inventory becomes standing buy-it-now stock, mispricing persists instead of being
                  competed away.
                </p>
              </div>
              {source.acquisitionMethod ? (
                <div className="border-t border-line pt-2">
                  <p className="rule-label">Acquisition method</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                    {source.acquisitionMethod}
                  </p>
                </div>
              ) : null}
              <div className="border-t border-line pt-2">
                <a
                  href={source.discoveryUrl ?? source.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                >
                  Official source <ExternalLink className="size-3" />
                </a>
                {source.attribution ? (
                  <p className="mt-1 text-[10px] text-ink-faint">Attribution: {source.attribution}</p>
                ) : null}
              </div>
            </PanelBody>
          </Panel>

          {source.jurisdiction.dispositionNotes ? (
            <Panel>
              <PanelHeader
                title="Jurisdiction intelligence"
                subtitle="How this county actually disposes of failed land."
              />
              <PanelBody>
                <p className="text-[11px] leading-relaxed text-ink-muted">
                  {source.jurisdiction.dispositionNotes}
                </p>
              </PanelBody>
            </Panel>
          ) : null}

          {source.notes ?? registryEntry?.notes ? (
            <Panel>
              <PanelHeader title="Engineering notes" />
              <PanelBody>
                <p className="text-[11px] leading-relaxed text-ink-muted">
                  {source.notes ?? registryEntry?.notes}
                </p>
              </PanelBody>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Jurisdiction links" />
            <PanelBody className="space-y-1">
              {(
                [
                  ['Official', source.jurisdiction.officialUrl],
                  ['Assessor', source.jurisdiction.assessorUrl],
                  ['Recorder', source.jurisdiction.recorderUrl],
                  ['GIS', source.jurisdiction.gisUrl],
                  ['Tax sale', source.jurisdiction.taxSaleUrl],
                ] as const
              ).map(([label, url]) =>
                url ? (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <span className="rule-label">{label}</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="truncate text-[11px] text-info hover:underline"
                    >
                      {new URL(url).hostname}
                    </a>
                  </div>
                ) : null,
              )}
            </PanelBody>
          </Panel>

          <Link
            href="/sources"
            className="block text-center text-[11px] text-ink-faint hover:text-alpha"
          >
            ← All sources
          </Link>
        </div>
      </div>
    </>
  );
}
