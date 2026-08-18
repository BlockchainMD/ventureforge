import Link from 'next/link';
import { listSourceHealth, prisma } from '@land-alpha/db';
import { registryCoverage } from '@land-alpha/source-registry';
import { formatDateTime, formatNumber, formatPercent, humanizeEnum } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { getSessionUser, hasRole } from '@/server/auth';
import { SourceControls } from './source-controls';

export const metadata = { title: 'Sources — Land Alpha' };
export const dynamic = 'force-dynamic';

export default async function SourcesPage() {
  const [health, user, candidates] = await Promise.all([
    listSourceHealth(),
    getSessionUser(),
    prisma.sourceDiscoveryCandidate.findMany({
      where: { status: 'PENDING' },
      orderBy: { score: 'desc' },
      take: 20,
    }),
  ]);

  const coverage = registryCoverage();
  const canRun = user != null && hasRole(user, 'ANALYST');
  const canToggle = user != null && hasRole(user, 'ADMIN');

  return (
    <>
      <PageHeader
        title="Source registry"
        subtitle={
          <>
            {coverage.active} active · {coverage.candidates} candidates · {coverage.manualOnly}{' '}
            manual-only, across {coverage.counties} counties in {coverage.states.join(', ')}
          </>
        }
      />

      <div className="space-y-3 p-4">
        <Panel>
          <PanelBody>
            <MetricGrid columns={5}>
              <Metric label="Active sources">{coverage.active}</Metric>
              <Metric label="Candidates awaiting adapters">{coverage.candidates}</Metric>
              <Metric
                label="Manual-only"
                hint="Behind an access control we do not circumvent — imported by an analyst"
              >
                {coverage.manualOnly}
              </Metric>
              <Metric label="Counties covered">{coverage.counties}</Metric>
              <Metric label="Live parcels">
                {formatNumber(health.reduce((sum, source) => sum + source.liveParcelCount, 0))}
              </Metric>
            </MetricGrid>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Monitored sources"
            subtitle="Every known government inventory endpoint and how that jurisdiction disposes of failed land."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Source</Th>
                <Th>Jurisdiction</Th>
                <Th>Type</Th>
                <Th>Method</Th>
                <Th>Status</Th>
                <Th>Freshness</Th>
                <Th align="right">Live parcels</Th>
                <Th align="right">Success</Th>
                <Th>Last success</Th>
                <Th />
              </tr>
            </Thead>
            <tbody>
              {health.map((source) => (
                <Tr key={source.id}>
                  <Td>
                    <Link href={`/sources/${source.id}`} className="text-ink hover:text-alpha">
                      {source.name}
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">
                    {source.county ? `${source.county}, ` : ''}
                    {source.state}
                  </Td>
                  <Td className="text-ink-muted">{humanizeEnum(source.sourceType)}</Td>
                  <Td className="text-ink-faint">{humanizeEnum(source.ingestionMethod)}</Td>
                  <Td>
                    <Badge
                      tone={
                        source.sourceStatus === 'ACTIVE'
                          ? 'good'
                          : source.sourceStatus === 'BROKEN'
                            ? 'bad'
                            : source.sourceStatus === 'MANUAL_ONLY'
                              ? 'info'
                              : 'muted'
                      }
                    >
                      {humanizeEnum(source.sourceStatus)}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        source.staleness === 'FRESH'
                          ? 'good'
                          : source.staleness === 'MANUAL'
                            ? 'muted'
                            : source.staleness === 'DUE'
                              ? 'warn'
                              : 'bad'
                      }
                    >
                      {source.staleness.replace('_', ' ')}
                    </Badge>
                  </Td>
                  <Td align="right">{formatNumber(source.liveParcelCount)}</Td>
                  <Td align="right">
                    <Value>
                      {source.successRate == null ? null : formatPercent(source.successRate, 0)}
                    </Value>
                  </Td>
                  <Td className="text-ink-faint">
                    <Value>
                      {source.lastSuccessfulAt == null
                        ? null
                        : formatDateTime(source.lastSuccessfulAt)}
                    </Value>
                  </Td>
                  <Td>
                    <SourceControls
                      sourceId={source.id}
                      enabled={source.enabled}
                      manualOnly={source.ingestionMethod === 'MANUAL_SOURCE'}
                      canRun={canRun}
                      canToggle={canToggle}
                    />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>

        <Panel>
          <PanelHeader
            title="Discovered candidates"
            subtitle="Found by the source discovery agent. Nothing here reaches production without human approval."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Jurisdiction</Th>
                <Th>Candidate</Th>
                <Th>Matched terms</Th>
                <Th align="right">Score</Th>
                <Th>Found</Th>
              </tr>
            </Thead>
            <tbody>
              {candidates.length === 0 ? (
                <EmptyRow colSpan={5}>
                  No candidates awaiting review. Run the discovery agent from the worker to search a
                  state or county for new government land-disposition programmes.
                </EmptyRow>
              ) : (
                candidates.map((candidate) => (
                  <Tr key={candidate.id}>
                    <Td>
                      {candidate.county ? `${candidate.county}, ` : ''}
                      {candidate.state}
                    </Td>
                    <Td>
                      <a
                        href={candidate.candidateUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-info hover:underline"
                      >
                        {candidate.title}
                      </a>
                    </Td>
                    <Td className="text-ink-faint">{candidate.matchedTerms.join(', ')}</Td>
                    <Td align="right">{candidate.score.toFixed(2)}</Td>
                    <Td className="text-ink-faint">{formatDateTime(candidate.discoveredAt)}</Td>
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
