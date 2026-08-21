import { redirect } from 'next/navigation';
import Link from 'next/link';
import { listOpportunities, prisma } from '@land-alpha/db';
import { formatNumber, activeFilterCount, type OpportunityFilter } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { OpportunityTable } from '../opportunities/opportunity-table';
import { getSessionUser } from '@/server/auth';

export const metadata = { title: 'Watchlists — Land Alpha' };
export const dynamic = 'force-dynamic';

export default async function WatchlistsPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const [watched, savedSearches, alertRules, notifications] = await Promise.all([
    listOpportunities({ watchlistedOnly: true, pageSize: 100 }),
    prisma.savedSearch.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }),
    prisma.alertRule.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }),
    prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Watchlists and alerts"
        subtitle={`${formatNumber(watched.total)} watched parcels · ${savedSearches.length} saved searches · ${alertRules.filter((rule) => rule.enabled).length} active alerts`}
      />

      <div className="space-y-3 p-3 sm:p-4">
        <Panel>
          <PanelHeader title="Watched parcels" />
          <OpportunityTable
            rows={watched.rows}
            emptyMessage="No parcels watched yet. Use “Watch” on any parcel to track it here."
          />
        </Panel>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Panel>
            <PanelHeader
              title="Saved searches"
              subtitle="A saved search is a stored filter — the same one the table runs."
            />
            <PanelBody className="space-y-1.5">
              {savedSearches.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-faint">
                  No saved searches. Save one from the opportunities screen.
                </p>
              ) : (
                savedSearches.map((search) => {
                  const filters = search.filters as unknown as OpportunityFilter;
                  const params = new URLSearchParams();
                  for (const [key, value] of Object.entries(filters ?? {})) {
                    if (value == null) continue;
                    if (Array.isArray(value)) {
                      if (value.length) params.set(key, value.join(','));
                    } else if (typeof value === 'boolean') {
                      if (value) params.set(key, 'true');
                    } else {
                      params.set(key, String(value));
                    }
                  }
                  return (
                    <div key={search.id} className="flex items-center justify-between gap-2">
                      <Link
                        href={`/opportunities?${params.toString()}`}
                        className="text-xs text-ink hover:text-alpha"
                      >
                        {search.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        {search.isPinned ? <Badge tone="muted">starter</Badge> : null}
                        <span className="num text-[10px] text-ink-faint">
                          {activeFilterCount(filters ?? {})} filters
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Alert rules"
              subtitle="Evaluated by the worker; matches arrive in-app and by email."
            />
            <PanelBody className="space-y-1.5">
              {alertRules.length === 0 ? (
                <p className="py-4 text-center text-xs text-ink-faint">
                  No alert rules. Use “Save + alert” on a filtered view.
                </p>
              ) : (
                alertRules.map((rule) => (
                  <div key={rule.id} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-ink">{rule.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="num text-[10px] text-ink-faint">
                        {rule.matchCount} matches
                      </span>
                      <Badge tone={rule.enabled ? 'good' : 'muted'}>
                        {rule.enabled ? 'active' : 'paused'}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>
        </div>

        <Panel>
          <PanelHeader title="Notifications" />
          <PanelBody className="space-y-1.5">
            {notifications.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-faint">
                Nothing yet. Alerts fire when new inventory matches one of your rules.
              </p>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} className="border-b border-line/60 pb-1.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-ink">{notification.title}</span>
                    {notification.readAt == null ? <Badge tone="alpha">new</Badge> : null}
                  </div>
                  <p className="text-[11px] text-ink-muted">{notification.body}</p>
                  {notification.linkPath ? (
                    <Link
                      href={notification.linkPath}
                      className="text-[10px] text-info hover:underline"
                    >
                      Open →
                    </Link>
                  ) : null}
                </div>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
