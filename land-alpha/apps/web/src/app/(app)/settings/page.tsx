import { redirect } from 'next/navigation';
import { prisma, spatial } from '@land-alpha/db';
import { env, aiEnabled } from '@land-alpha/shared/env';
import { registryCoverage } from '@land-alpha/source-registry';
import { formatDateTime, formatNumber } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Metric, MetricGrid } from '@/components/ui/value';
import { Badge } from '@/components/ui/badge';
import { DataTable, Td, Th, Thead, Tr } from '@/components/ui/table';
import { getSessionUser, hasRole } from '@/server/auth';

export const metadata = { title: 'Settings — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * System settings and health.
 *
 * Shows how each optional integration is currently resolved, so it is obvious
 * at a glance whether the environmental figures on a parcel came from FEMA or
 * from a fixture — which changes how much they should be trusted.
 */
export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const config = env();
  const [postgis, users, activity, counts] = await Promise.all([
    spatial.postgisVersion(),
    hasRole(user, 'ADMIN')
      ? prisma.user.findMany({ orderBy: { role: 'asc' }, select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true } })
      : Promise.resolve([]),
    prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
    prisma.$transaction([
      prisma.parcelOpportunity.count(),
      prisma.evidence.count(),
      prisma.comparableSale.count(),
      prisma.parcelChange.count(),
    ]),
  ]);

  const coverage = registryCoverage();

  return (
    <>
      <PageHeader title="Settings" subtitle="System configuration, integrations and audit history" />

      <div className="space-y-3 p-4">
        <Panel>
          <PanelHeader title="Data" />
          <PanelBody>
            <MetricGrid columns={6}>
              <Metric label="Parcels">{formatNumber(counts[0])}</Metric>
              <Metric label="Evidence rows" hint="Every derived fact with its provenance">
                {formatNumber(counts[1])}
              </Metric>
              <Metric label="Comparable sales">{formatNumber(counts[2])}</Metric>
              <Metric label="Change events">{formatNumber(counts[3])}</Metric>
              <Metric label="Registered sources">{coverage.active + coverage.candidates + coverage.manualOnly}</Metric>
              <Metric label="Counties">{coverage.counties}</Metric>
            </MetricGrid>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Integrations"
            subtitle="Every integration is optional and degrades to a documented fixture mode."
          />
          <PanelBody className="space-y-2">
            <IntegrationRow
              label="PostgreSQL + PostGIS"
              status={postgis ? 'live' : 'missing'}
              detail={postgis ?? 'PostGIS extension not available — spatial features are disabled.'}
            />
            <IntegrationRow
              label="Job queue"
              status="live"
              detail={`${config.QUEUE_DRIVER} driver${config.REDIS_URL ? ' (Redis configured)' : ' (no Redis required)'}`}
            />
            <IntegrationRow
              label="Object storage"
              status="live"
              detail={
                config.STORAGE_DRIVER === 's3'
                  ? `S3-compatible bucket ${config.S3_BUCKET ?? '(unset)'}`
                  : `Filesystem at ${config.STORAGE_LOCAL_DIR}`
              }
            />
            <IntegrationRow
              label="AI provider"
              status={aiEnabled(config) ? 'live' : 'fixture'}
              detail={
                aiEnabled(config)
                  ? `${config.AI_PROVIDER} · ${config.AI_MODEL_REASONING}`
                  : 'Fixture mode — memos and listings are generated deterministically from structured data, with no external call.'
              }
            />
            <IntegrationRow
              label="Environmental enrichment"
              status={config.ENRICHMENT_MODE === 'live' ? 'live' : 'fixture'}
              detail={
                config.ENRICHMENT_MODE === 'live'
                  ? 'FEMA NFHL, USFWS NWI, EPA FRS and USGS 3DEP are queried directly.'
                  : 'Fixture mode — federal services are not called; parcels carry whatever was previously recorded.'
              }
            />
            <IntegrationRow
              label="Ingestion politeness"
              status="live"
              detail={`${config.INGEST_MIN_DELAY_MS}ms minimum delay per host · robots.txt ${config.INGEST_RESPECT_ROBOTS ? 'respected' : 'IGNORED'} · ${config.INGEST_MAX_REQUESTS_PER_RUN} requests per run`}
            />
            <IntegrationRow
              label="Email"
              status={config.EMAIL_DRIVER === 'smtp' ? 'live' : 'fixture'}
              detail={
                config.EMAIL_DRIVER === 'smtp'
                  ? 'SMTP configured'
                  : 'Console driver — alert emails are logged, not sent.'
              }
            />
          </PanelBody>
        </Panel>

        {hasRole(user, 'ADMIN') ? (
          <Panel>
            <PanelHeader title="Users" />
            <DataTable>
              <Thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Last sign-in</Th>
                </tr>
              </Thead>
              <tbody>
                {users.map((row) => (
                  <Tr key={row.id}>
                    <Td className="text-ink">{row.name}</Td>
                    <Td className="num text-[11px] text-ink-muted">{row.email}</Td>
                    <Td>
                      <Badge tone={row.role === 'ADMIN' ? 'alpha' : 'muted'}>{row.role}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={row.isActive ? 'good' : 'bad'}>
                        {row.isActive ? 'active' : 'disabled'}
                      </Badge>
                    </Td>
                    <Td className="text-ink-faint">
                      {row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'never'}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Audit history"
            subtitle="Every decision that moves money or changes a conclusion."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Summary</Th>
              </tr>
            </Thead>
            <tbody>
              {activity.map((row) => (
                <Tr key={row.id}>
                  <Td className="text-ink-faint">{formatDateTime(row.createdAt)}</Td>
                  <Td className="text-ink-muted">{row.actorLabel}</Td>
                  <Td className="num text-[11px]">{row.action}</Td>
                  <Td className="text-ink-muted">{row.summary}</Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}

function IntegrationRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: 'live' | 'fixture' | 'missing';
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 pb-2 last:border-0">
      <div className="min-w-0">
        <p className="text-xs text-ink">{label}</p>
        <p className="text-[11px] leading-relaxed text-ink-faint">{detail}</p>
      </div>
      <Badge tone={status === 'live' ? 'good' : status === 'fixture' ? 'warn' : 'bad'}>
        {status}
      </Badge>
    </div>
  );
}
