import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma, toCents } from '@land-alpha/db';
import { addCents, formatAcres, formatCents, formatDate, formatNumber } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

export default async function PortfolioAssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await prisma.portfolioAsset.findUnique({
    where: { id },
    include: {
      parcel: { include: { listing: true, leads: { orderBy: { createdAt: 'desc' } } } },
      transactions: { orderBy: { occurredAt: 'desc' } },
    },
  });
  if (!asset) notFound();

  const invested = addCents(
    toCents(asset.acquisitionPrice),
    toCents(asset.closingCosts),
    toCents(asset.improvementCosts),
    toCents(asset.titleCosts),
    toCents(asset.taxesPaid),
    toCents(asset.carryingCosts),
    toCents(asset.marketingCosts),
  );

  return (
    <>
      <PageHeader
        title={`${asset.parcel.county} County, ${asset.parcel.state}`}
        subtitle={
          <span className="num">
            APN <Value>{asset.parcel.apn}</Value>
            <span className="mx-2 text-line-strong">·</span>
            <Value>
              {asset.parcel.acreage == null ? null : formatAcres(asset.parcel.acreage)}
            </Value>
            <span className="mx-2 text-line-strong">·</span>
            acquired {formatDate(asset.acquiredAt)}
          </span>
        }
        actions={
          <Link
            href={`/opportunities/${asset.parcelId}`}
            className="text-[11px] text-ink-muted hover:text-alpha"
          >
            Underwriting →
          </Link>
        }
      />

      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="col-span-2 space-y-3">
          <Panel>
            <PanelHeader title="Cost basis" />
            <PanelBody>
              <MetricGrid columns={4}>
                <Metric label="Acquisition">{formatCents(toCents(asset.acquisitionPrice))}</Metric>
                <Metric label="Closing costs">{formatCents(toCents(asset.closingCosts))}</Metric>
                <Metric label="Title costs">{formatCents(toCents(asset.titleCosts))}</Metric>
                <Metric label="Improvements">{formatCents(toCents(asset.improvementCosts))}</Metric>
                <Metric label="Taxes paid">{formatCents(toCents(asset.taxesPaid))}</Metric>
                <Metric label="Carrying">{formatCents(toCents(asset.carryingCosts))}</Metric>
                <Metric label="Marketing">{formatCents(toCents(asset.marketingCosts))}</Metric>
                <Metric label="Total invested" tone="text-ink">
                  {formatCents(invested)}
                </Metric>
              </MetricGrid>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Transactions" />
            <DataTable>
              <Thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Kind</Th>
                  <Th align="right">Amount</Th>
                  <Th>Memo</Th>
                </tr>
              </Thead>
              <tbody>
                {asset.transactions.length === 0 ? (
                  <EmptyRow colSpan={4}>No transactions recorded beyond the acquisition.</EmptyRow>
                ) : (
                  asset.transactions.map((transaction) => (
                    <Tr key={transaction.id}>
                      <Td className="text-ink-muted">{formatDate(transaction.occurredAt)}</Td>
                      <Td>{transaction.kind}</Td>
                      <Td align="right">{formatCents(toCents(transaction.amount))}</Td>
                      <Td className="text-ink-faint">{transaction.memo ?? ''}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Position" />
            <PanelBody>
              <MetricGrid columns={2}>
                <Metric label="Quick sale value">
                  <Value>{formatCents(toCents(asset.parcel.quickSaleValue))}</Value>
                </Metric>
                <Metric label="List price">
                  <Value>{formatCents(toCents(asset.listPrice))}</Value>
                </Metric>
                <Metric label="Days held">
                  {formatNumber(
                    asset.daysHeld ??
                      Math.floor((Date.now() - asset.acquiredAt.getTime()) / 86_400_000),
                  )}
                </Metric>
                <Metric label="Realised profit" tone="text-good">
                  <Value>{formatCents(toCents(asset.realizedProfit))}</Value>
                </Metric>
              </MetricGrid>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Listing"
              subtitle={asset.parcel.listing ? 'Marketing package generated' : 'Not yet listed'}
            />
            <PanelBody>
              {asset.parcel.listing ? (
                <div className="space-y-1">
                  <p className="text-xs text-ink">{asset.parcel.listing.title}</p>
                  {asset.parcel.publicSlug ? (
                    <Link
                      href={`/properties/${asset.parcel.publicSlug}`}
                      className="text-[11px] text-info hover:underline"
                    >
                      View public page →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-ink-faint">
                  Move the parcel to “ready to list” and generate a marketing package.
                </p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Leads" subtitle={`${asset.parcel.leads.length} enquiries`} />
            <PanelBody className="space-y-1">
              {asset.parcel.leads.length === 0 ? (
                <p className="text-xs text-ink-faint">No enquiries yet.</p>
              ) : (
                asset.parcel.leads.slice(0, 8).map((lead) => (
                  <div key={lead.id} className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[11px] text-ink">{lead.name}</span>
                    <span className="num text-[10px] text-ink-faint">{lead.status}</span>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}
