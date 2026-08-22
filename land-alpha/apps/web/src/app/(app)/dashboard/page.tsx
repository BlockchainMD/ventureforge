import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { dashboardStats, listOpportunities, listSourceHealth, prisma } from '@land-alpha/db';
import { formatCents, formatCentsCompact, formatNumber, formatPercent } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelHeader, PanelBody } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { OpportunityTable } from '../opportunities/opportunity-table';
import { basisRatioTone } from '@/lib/utils';

export const metadata = { title: 'Dashboard — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * The dashboard answers one question in the first screenful: *what should I
 * look at right now?* Everything else is secondary, so the top strip is
 * inventory economics and the first table is the ranked shortlist — not a chart.
 */
export default async function DashboardPage() {
  const [stats, top, health, recentChanges] = await Promise.all([
    dashboardStats(),
    listOpportunities({
      minAlphaScore: 60,
      includeRejected: false,
      sort: 'alphaScore',
      direction: 'desc',
      pageSize: 12,
      page: 1,
    }),
    listSourceHealth(),
    prisma.parcelChange.findMany({
      where: { kind: { in: ['PRICE_CHANGED', 'REAPPEARED', 'CREATED'] } },
      orderBy: { detectedAt: 'desc' },
      take: 8,
      include: { parcel: { select: { id: true, apn: true, county: true, state: true } } },
    }),
  ]);

  // Only enabled sources can go stale. A CANDIDATE that has never run is a
  // lead someone wrote down, not a feed that has stopped — counting it as
  // needing attention put "3 sources need attention" directly beneath "3 of 4
  // enabled sources healthy", which cannot both be read as true.
  const staleSources = health.filter(
    (s) => s.enabled && (s.staleness === 'STALE' || s.staleness === 'NEVER_RUN'),
  );
  const unexploredSources = health.filter(
    (s) => !s.enabled && (s.staleness === 'STALE' || s.staleness === 'NEVER_RUN'),
  );

  return (
    <>
      <PageHeader
        title="Acquisition dashboard"
        subtitle={
          <>
            <span className="text-ink">
              {formatNumber(stats.offeredForSale)} parcels a county has actually offered
            </span>
            , out of {formatNumber(stats.activeOpportunities)} held across{' '}
            {formatNumber(stats.sourcesMonitored)} monitored sources.{' '}
            <span className="text-ink-faint">
              {formatNumber(stats.rejectedCount)} rejected by the screening rules and kept out of
              your way.
            </span>
          </>
        }
      />

      <div className="space-y-3 p-3 sm:p-4">
        {/* --- Inventory economics ------------------------------------------ */}
        <Panel>
          <PanelBody>
            <MetricGrid columns={6}>
              <Metric
                label="Offered for sale"
                hint="A county has put these up: status AVAILABLE or SCHEDULED. This is the inventory you can actually act on."
                tone={stats.offeredForSale > 0 ? 'text-alpha' : undefined}
              >
                {formatNumber(stats.offeredForSale)}
              </Metric>
              <Metric
                label="Held, not offered"
                hint="Found in a government inventory with no offering attached. St. Louis County publishes its whole tax-forfeited roll and says in its own notes that appearing on it is not the same as being for sale — so these need an offering confirmed before anything else."
              >
                {formatNumber(stats.activeOpportunities - stats.offeredForSale)}
              </Metric>
              <Metric label="New today">
                <span className={stats.newToday > 0 ? 'text-alpha' : undefined}>
                  {formatNumber(stats.newToday)}
                </span>
              </Metric>
              <Metric label="New this week">{formatNumber(stats.newThisWeek)}</Metric>
              <Metric label="Total asking" hint="Sum of asking prices or minimum bids">
                {formatCentsCompact(stats.totalAskingCents)}
              </Metric>
              <Metric label="Estimated QSV" hint="Sum of conservative quick-sale values">
                {formatCentsCompact(stats.estimatedQsvCents)}
              </Metric>
              <Metric
                label="Implied discount"
                hint={`1 − (all-in basis ÷ quick-sale value), across the ${stats.pricedParcelCount} parcels that have both a published cost and an established value`}
                tone={stats.aggregateImpliedDiscount != null ? 'text-good' : undefined}
              >
                <Value>
                  {stats.aggregateImpliedDiscount == null
                    ? null
                    : formatPercent(stats.aggregateImpliedDiscount, 0)}
                </Value>
                <span className="ml-1 text-[10px] text-ink-faint">
                  n={formatNumber(stats.pricedParcelCount)}
                </span>
              </Metric>
            </MetricGrid>

            <div className="mt-4 border-t border-line pt-3">
              <MetricGrid columns={6}>
                <Metric label="Exceptional tier" hint="All-in basis ≤ 10% of quick-sale value">
                  <span className="text-alpha">{formatNumber(stats.exceptionalCount)}</span>
                </Metric>
                <Metric label="Failed-auction inventory" hint="Re-offer, OTC and Lands Available">
                  {formatNumber(stats.distressedInventoryCount)}
                </Metric>
                <Metric label="Auctions in 14 days">
                  <span className={stats.auctionsNext14Days > 0 ? 'text-warn' : undefined}>
                    {formatNumber(stats.auctionsNext14Days)}
                  </span>
                </Metric>
                <Metric
                  label="Sale date passed"
                  hint="Still listed after their auction or offer deadline. A passed date does not say the parcel sold — an unsold Florida parcel moving to a lands-available list is how the best inventory appears — so these need re-checking against the source, not deleting."
                >
                  <Link
                    href="/opportunities?deadlinePassed=true"
                    className={stats.deadlinePassed > 0 ? 'text-bad hover:underline' : undefined}
                  >
                    {formatNumber(stats.deadlinePassed)}
                  </Link>
                </Metric>
                <Metric label="Watchlisted">{formatNumber(stats.watchlisted)}</Metric>
                <Metric label="In due diligence">{formatNumber(stats.inDueDiligence)}</Metric>
                <Metric label="Source refresh rate" hint="Successful ingestion runs, last 30 days">
                  <Value>
                    {stats.sourceRefreshSuccessRate == null
                      ? null
                      : formatPercent(stats.sourceRefreshSuccessRate, 0)}
                  </Value>
                </Metric>
              </MetricGrid>
            </div>
          </PanelBody>
        </Panel>

        {/* --- The shortlist ------------------------------------------------- */}
        <Panel>
          <PanelHeader
            title="Highest-conviction opportunities"
            subtitle="Alpha Score 60 or better, ranked. This is the list the product exists to produce."
            actions={
              <Link
                href="/opportunities"
                className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-alpha"
              >
                All opportunities <ArrowRight className="size-3" />
              </Link>
            }
          />
          <OpportunityTable
            rows={top.rows}
            emptyMessage="No parcel currently scores 60 or better. Run ingestion and the pipeline, or lower the bar on the opportunities screen."
          />
        </Panel>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* --- Source health --------------------------------------------- */}
          <Panel>
            <PanelHeader
              title="Source health"
              subtitle={`${stats.sourcesHealthy} of ${stats.sourcesMonitored} enabled sources healthy`}
              actions={
                <Link href="/sources" className="text-[11px] text-ink-muted hover:text-alpha">
                  Manage
                </Link>
              }
            />
            <PanelBody className="space-y-1.5">
              {health.slice(0, 8).map((source) => (
                <div key={source.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/sources/${source.id}`}
                      className="block truncate text-xs text-ink hover:text-alpha"
                    >
                      {source.name}
                    </Link>
                    <p className="text-[10px] text-ink-faint">
                      {source.state}
                      {source.county ? ` · ${source.county}` : ''} ·{' '}
                      {formatNumber(source.liveParcelCount)} live
                    </p>
                  </div>
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
                </div>
              ))}
              {staleSources.length > 0 || unexploredSources.length > 0 ? (
                <p className="border-t border-line pt-2 text-[10px] text-ink-faint">
                  {staleSources.length > 0 ? (
                    <>
                      {staleSources.length} enabled source
                      {staleSources.length === 1 ? '' : 's'} need
                      {staleSources.length === 1 ? 's' : ''} attention. Inventory from a stale
                      source may no longer be available.{' '}
                    </>
                  ) : null}
                  {unexploredSources.length > 0 ? (
                    <>
                      {unexploredSources.length}{' '}
                      {unexploredSources.length === 1 ? 'candidate county' : 'candidate counties'}{' '}
                      in the registry {unexploredSources.length === 1 ? 'has' : 'have'} never been
                      switched on.
                    </>
                  ) : null}
                </p>
              ) : null}
            </PanelBody>
          </Panel>

          {/* --- Change feed ------------------------------------------------ */}
          <Panel>
            <PanelHeader
              title="Recent inventory changes"
              subtitle="Price cuts and reappearances are the strongest signals this system watches for."
            />
            <PanelBody className="space-y-1.5">
              {recentChanges.length === 0 ? (
                <p className="py-6 text-center text-xs text-ink-faint">
                  No changes recorded yet. Run ingestion twice to start building history.
                </p>
              ) : (
                recentChanges.map((change) => (
                  <div key={change.id} className="flex items-center justify-between gap-3">
                    <Link
                      href={`/opportunities/${change.parcel.id}`}
                      className="block min-w-0 truncate text-xs text-ink hover:text-alpha"
                    >
                      <span className="num">{change.parcel.apn ?? 'unknown APN'}</span>
                      <span className="ml-2 text-ink-faint">
                        {change.parcel.county}, {change.parcel.state}
                      </span>
                    </Link>
                    <div className="flex shrink-0 items-center gap-2">
                      {change.kind === 'PRICE_CHANGED' && change.oldValue && change.newValue ? (
                        <span
                          className={`num text-[11px] ${
                            Number(change.newValue) < Number(change.oldValue)
                              ? 'text-good'
                              : 'text-bad'
                          }`}
                        >
                          {formatCents(Number(change.oldValue) * 100)} →{' '}
                          {formatCents(Number(change.newValue) * 100)}
                        </span>
                      ) : null}
                      <Badge tone={change.kind === 'PRICE_CHANGED' ? 'alpha' : 'neutral'}>
                        {change.kind.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>
        </div>

        <p className="px-1 text-[10px] leading-relaxed text-ink-faint">
          Buildability ratings are preliminary screening conclusions, not zoning determinations or
          permits. Title figures are automated pre-screens, not title opinions or commitments.
          Access classes describe the strength of evidence for physical access and are not
          determinations of legal access.{' '}
          <span className={basisRatioTone(0.15)}>Verify everything before bidding.</span>
        </p>
      </div>
    </>
  );
}
