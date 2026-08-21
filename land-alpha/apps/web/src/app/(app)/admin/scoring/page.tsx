import { redirect } from 'next/navigation';
import { getActiveScoringConfig, prisma } from '@land-alpha/db';
import { formatDateTime, formatNumber } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { getSessionUser, hasRole } from '@/server/auth';
import { ScoringEditor } from './scoring-editor';

export const metadata = { title: 'Scoring model — Land Alpha' };
export const dynamic = 'force-dynamic';

export default async function ScoringAdminPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [config, versions, scoredCount] = await Promise.all([
    getActiveScoringConfig(),
    prisma.scoringConfig.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.parcelOpportunity.count({ where: { scoredAt: { not: null } } }),
  ]);

  const canEdit = hasRole(user, 'ADMIN');

  return (
    <>
      <PageHeader
        title="Scoring model"
        subtitle={
          <>
            Active version <span className="num text-alpha">{config.version}</span> ·{' '}
            {formatNumber(scoredCount)} parcels scored under it
            {canEdit ? '' : ' · read-only (admin required to change)'}
          </>
        }
      />

      <div className="space-y-3 p-3 sm:p-4">
        <ScoringEditor config={config} canEdit={canEdit} />

        <Panel>
          <PanelHeader
            title="Version history"
            subtitle="Configurations are immutable, so every historical score remains interpretable."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Version</Th>
                <Th>Created</Th>
                <Th>Status</Th>
                <Th>Description</Th>
              </tr>
            </Thead>
            <tbody>
              {versions.length === 0 ? (
                <EmptyRow colSpan={4}>
                  Running on the built-in default weights. Save a version to start tracking changes.
                </EmptyRow>
              ) : (
                versions.map((version) => (
                  <Tr key={version.id}>
                    <Td className="num text-ink">{version.version}</Td>
                    <Td className="text-ink-faint">{formatDateTime(version.createdAt)}</Td>
                    <Td>
                      <Badge tone={version.isActive ? 'good' : 'muted'}>
                        {version.isActive ? 'active' : 'superseded'}
                      </Badge>
                    </Td>
                    <Td className="text-ink-muted">{version.description ?? '—'}</Td>
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
