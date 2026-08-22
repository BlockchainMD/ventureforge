import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { planAllocation } from '@land-alpha/core';
import { formatCents, formatCentsCompact, formatNumber, formatPercent } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { BudgetForm } from './budget-form';

export const metadata = { title: 'Capital allocation — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * Which set of parcels should this money buy?
 *
 * The opportunities list answers "which parcel is best". This answers the
 * question an investor with finite capital actually has, which is not the same
 * one — and the two lists frequently disagree.
 */
export default async function AllocatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const budgetDollars = Math.max(1000, Number(params.budget ?? 50_000) || 50_000);
  const maxHoldMonths = Math.max(1, Number(params.months ?? 24) || 24);
  const minConfidence = (typeof params.confidence === 'string' ? params.confidence : 'LOW') as
    'LOW' | 'MEDIUM' | 'HIGH';

  const plan = await planAllocation({
    budgetCents: Math.round(budgetDollars * 100),
    maxHoldDays: Math.round(maxHoldMonths * 30.4),
    minConfidence,
  });

  return (
    <>
      <PageHeader
        title="Capital allocation"
        subtitle="Ranked on expected profit per dollar per year, subject to your budget and concentration limits — not on Alpha Score."
      />

      <div className="space-y-3 p-3 sm:p-4">
        <Panel>
          <PanelBody>
            <BudgetForm budget={budgetDollars} months={maxHoldMonths} confidence={minConfidence} />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelBody>
            <MetricGrid columns={5}>
              <Metric label="Budget">{formatCentsCompact(plan.budgetCents)}</Metric>
              <Metric label="Committed">{formatCentsCompact(plan.committedCents)}</Metric>
              <Metric label="Parcels">{formatNumber(plan.picks.length)}</Metric>
              <Metric label="Expected profit" tone="text-good">
                {formatCentsCompact(plan.expectedProfitCents)}
              </Metric>
              <Metric label="Return on deployed" tone="text-good">
                <Value>
                  {plan.expectedReturnOnDeployed == null
                    ? null
                    : formatPercent(plan.expectedReturnOnDeployed, 0)}
                </Value>
              </Metric>
            </MetricGrid>
          </PanelBody>
        </Panel>

        {plan.warnings.length > 0 ? (
          <Panel className="border-warn/40">
            <PanelBody className="space-y-1.5">
              {plan.warnings.map((warning) => (
                <p key={warning} className="flex gap-2 text-xs text-warn">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{warning}</span>
                </p>
              ))}
            </PanelBody>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Proposed basket"
            subtitle="A shortlist to verify, not a buy order. Nothing here commits money."
            actions={
              plan.byCounty.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {plan.byCounty.map((county) => (
                    <Badge key={county.county} tone="muted">
                      {county.county} · {county.parcels}
                    </Badge>
                  ))}
                </div>
              ) : null
            }
          />
          <DataTable>
            <Thead>
              <Tr>
                <Th align="right">#</Th>
                <Th>APN</Th>
                <Th>Location</Th>
                <Th align="right">Basis</Th>
                <Th align="right">QSV</Th>
                <Th align="right">Profit</Th>
                <Th align="right">Hold</Th>
                <Th align="right">Per $/yr</Th>
                <Th>Conf</Th>
              </Tr>
            </Thead>
            <tbody>
              {plan.picks.length === 0 ? (
                <EmptyRow colSpan={9}>
                  Nothing currently clears the bar for committing money.
                </EmptyRow>
              ) : (
                plan.picks.map((pick, index) => (
                  <Tr key={pick.parcelId}>
                    <Td align="right" className="num text-ink-faint">
                      {index + 1}
                    </Td>
                    <Td>
                      <Link
                        href={`/opportunities/${pick.parcelId}`}
                        className="num text-ink hover:text-alpha"
                      >
                        {pick.apn ?? '—'}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">
                      {pick.county} <span className="text-ink-faint">{pick.state}</span>
                    </Td>
                    <Td align="right" className="num">
                      {formatCents(pick.allInBasisCents)}
                    </Td>
                    <Td align="right" className="num">
                      {formatCents(pick.quickSaleValueCents ?? 0)}
                    </Td>
                    <Td align="right" className="num text-good">
                      {formatCents(pick.expectedProfitCents)}
                    </Td>
                    <Td align="right" className="num text-ink-muted">
                      {Math.round((pick.expectedHoldDays ?? 180) / 30.4)}mo
                    </Td>
                    <Td align="right" className="num font-medium text-alpha">
                      {formatPercent(pick.returnPerDollarYear, 0)}
                    </Td>
                    <Td>
                      <span className="text-[10px] uppercase text-ink-faint">
                        {pick.valuationConfidence ?? 'unknown'}
                      </span>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        {plan.skipped.length > 0 ? (
          <Panel>
            <PanelHeader
              title={`Left out (${formatNumber(plan.skipped.length)})`}
              subtitle="Why each parcel did not make the basket. A parcel excluded for concentration is not a bad parcel."
            />
            <PanelBody className="max-h-72 space-y-1 overflow-y-auto">
              {plan.skipped.slice(0, 60).map((entry) => (
                <p key={entry.parcelId} className="flex gap-2 text-[11px]">
                  <Link
                    href={`/opportunities/${entry.parcelId}`}
                    className="num shrink-0 text-ink-muted hover:text-alpha"
                  >
                    {entry.apn ?? entry.parcelId.slice(0, 8)}
                  </Link>
                  <span className="text-ink-faint">{entry.reason}</span>
                </p>
              ))}
            </PanelBody>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
