import Link from 'next/link';
import { availableCounties, listOpportunities, countMatching } from '@land-alpha/db';
import {
  activeFilterCount,
  filterFromSearchParams,
  filterToSearchParams,
  formatNumber,
  OPPORTUNITY_SORTS,
} from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { FilterBar } from './filter-bar';
import { OpportunityTable } from './opportunity-table';
import { SaveSearchButton } from './save-search';

export const metadata = { title: 'Opportunities — Land Alpha' };
export const dynamic = 'force-dynamic';

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = await searchParams;
  const filter = filterFromSearchParams(resolved);

  const [page, counties, rejectedCount] = await Promise.all([
    listOpportunities(filter),
    availableCounties(),
    countMatching({ ...filter, includeRejected: true }),
  ]);

  const hiddenByRules = filter.includeRejected ? 0 : Math.max(0, rejectedCount - page.total);

  return (
    <>
      <PageHeader
        title="Opportunities"
        subtitle={
          <>
            {formatNumber(page.total)} parcel{page.total === 1 ? '' : 's'} match
            {page.total === 1 ? 'es' : ''} these filters
            {hiddenByRules > 0 ? (
              <>
                {' · '}
                <span className="text-ink-faint">
                  {formatNumber(hiddenByRules)} more rejected by the screening rules
                </span>
              </>
            ) : null}
            {activeFilterCount(filter) > 0 ? ` · ${activeFilterCount(filter)} filters active` : ''}
          </>
        }
        actions={<SaveSearchButton filter={filter} />}
      />

      <FilterBar counties={counties} />

      <div className="p-4">
        <Panel>
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
            <SortControls filter={filter} />
            <Pagination page={page} filter={filter} />
          </div>
          <OpportunityTable
            rows={page.rows}
            emptyMessage={
              activeFilterCount(filter) > 0
                ? 'No parcels match these filters. Widen them, or enable "Show rejected" to see what the screening rules removed.'
                : 'No inventory yet. Run an ingestion from the Sources screen, then the enrichment pipeline.'
            }
          />
          <div className="flex items-center justify-end border-t border-line px-3 py-1.5">
            <Pagination page={page} filter={filter} />
          </div>
        </Panel>
      </div>
    </>
  );
}

function SortControls({ filter }: { filter: ReturnType<typeof filterFromSearchParams> }) {
  return (
    <div className="flex items-center gap-1">
      <span className="rule-label">Sort</span>
      {OPPORTUNITY_SORTS.map((sort) => {
        const active = (filter.sort ?? 'alphaScore') === sort;
        const params = filterToSearchParams({
          ...filter,
          sort,
          direction: active && filter.direction === 'desc' ? 'asc' : 'desc',
          page: 1,
        });
        return (
          <Link
            key={sort}
            href={`/opportunities?${params.toString()}`}
            className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
              active ? 'bg-raised text-alpha' : 'text-ink-faint hover:text-ink'
            }`}
          >
            {sort.replace(/([A-Z])/g, ' $1').trim()}
            {active ? (filter.direction === 'asc' ? ' ↑' : ' ↓') : ''}
          </Link>
        );
      })}
    </div>
  );
}

function Pagination({
  page,
  filter,
}: {
  page: { page: number; pageCount: number; total: number };
  filter: ReturnType<typeof filterFromSearchParams>;
}) {
  const linkFor = (target: number): string =>
    `/opportunities?${filterToSearchParams({ ...filter, page: target }).toString()}`;

  return (
    <div className="flex items-center gap-2">
      <span className="num text-[11px] text-ink-faint">
        page {page.page} / {page.pageCount}
      </span>
      <Button asChild size="sm" variant="ghost" disabled={page.page <= 1}>
        <Link href={linkFor(Math.max(1, page.page - 1))}>Prev</Link>
      </Button>
      <Button asChild size="sm" variant="ghost" disabled={page.page >= page.pageCount}>
        <Link href={linkFor(Math.min(page.pageCount, page.page + 1))}>Next</Link>
      </Button>
    </div>
  );
}
