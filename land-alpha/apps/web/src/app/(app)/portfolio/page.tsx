import Link from 'next/link';
import { prisma, toCents } from '@land-alpha/db';
import {
  addCents,
  formatAcres,
  formatCents,
  formatDate,
  formatNumber,
  formatPercent,
} from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { Badge, statusTone } from '@/components/ui/badge';

export const metadata = { title: 'Portfolio — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * Portfolio.
 *
 * Realised and unrealised are kept strictly apart. Unrealised profit is an
 * estimate against quick-sale value; realised profit is money that actually
 * moved. Blending them is how land businesses talk themselves into believing
 * they are profitable.
 */
export default async function PortfolioPage() {
  const assets = await prisma.portfolioAsset.findMany({
    orderBy: [{ soldAt: 'asc' }, { acquiredAt: 'desc' }],
    include: {
      parcel: {
        select: {
          id: true,
          apn: true,
          county: true,
          state: true,
          acreage: true,
          status: true,
          quickSaleValue: true,
          publicSlug: true,
        },
      },
    },
  });

  const held = assets.filter((asset) => asset.soldAt == null);
  const sold = assets.filter((asset) => asset.soldAt != null);

  const investedCents = held.reduce(
    (sum, asset) =>
      sum +
      addCents(
        toCents(asset.acquisitionPrice),
        toCents(asset.closingCosts),
        toCents(asset.improvementCosts),
        toCents(asset.titleCosts),
        toCents(asset.taxesPaid),
        toCents(asset.carryingCosts),
        toCents(asset.marketingCosts),
      ),
    0,
  );
  const inventoryQsvCents = held.reduce(
    (sum, asset) => sum + (toCents(asset.parcel.quickSaleValue) ?? 0),
    0,
  );
  const realisedProfitCents = sold.reduce(
    (sum, asset) => sum + (toCents(asset.realizedProfit) ?? 0),
    0,
  );
  const averageDaysHeld =
    sold.length === 0
      ? null
      : Math.round(sold.reduce((sum, asset) => sum + (asset.daysHeld ?? 0), 0) / sold.length);

  return (
    <>
      <PageHeader
        title="Portfolio"
        subtitle={`${formatNumber(held.length)} held · ${formatNumber(sold.length)} sold`}
      />

      <div className="space-y-3 p-4">
        <Panel>
          <PanelBody>
            <MetricGrid columns={6}>
              <Metric label="Invested capital" hint="All costs to date on held inventory">
                {formatCents(investedCents)}
              </Metric>
              <Metric label="Inventory QSV" hint="Conservative quick-sale value of held parcels">
                {formatCents(inventoryQsvCents)}
              </Metric>
              <Metric
                label="Projected gross profit"
                hint="Unrealised — an estimate against quick-sale value, not money earned"
                tone={inventoryQsvCents - investedCents > 0 ? 'text-warn' : 'text-bad'}
              >
                {formatCents(inventoryQsvCents - investedCents)}
              </Metric>
              <Metric label="Properties held">{formatNumber(held.length)}</Metric>
              <Metric label="Realised profit" tone="text-good">
                {formatCents(realisedProfitCents)}
              </Metric>
              <Metric label="Average days held">
                <Value>{averageDaysHeld == null ? null : formatNumber(averageDaysHeld)}</Value>
              </Metric>
            </MetricGrid>
            <p className="mt-3 border-t border-line pt-2 text-[10px] leading-relaxed text-ink-faint">
              Projected gross profit is unrealised and estimated against quick-sale value. It is not
              revenue, and it is deliberately shown in a different colour from realised profit.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Held inventory" />
          <DataTable>
            <Thead>
              <tr>
                <Th>Parcel</Th>
                <Th>Location</Th>
                <Th align="right">Acres</Th>
                <Th>Acquired</Th>
                <Th align="right">Purchase</Th>
                <Th align="right">Total invested</Th>
                <Th align="right">QSV</Th>
                <Th align="right">Unrealised</Th>
                <Th align="right">Days held</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <tbody>
              {held.length === 0 ? (
                <EmptyRow colSpan={10}>
                  No acquired parcels yet. Record an acquisition from a deal room once you have
                  bought one.
                </EmptyRow>
              ) : (
                held.map((asset) => {
                  const invested = addCents(
                    toCents(asset.acquisitionPrice),
                    toCents(asset.closingCosts),
                    toCents(asset.improvementCosts),
                    toCents(asset.titleCosts),
                    toCents(asset.taxesPaid),
                    toCents(asset.carryingCosts),
                    toCents(asset.marketingCosts),
                  );
                  const qsv = toCents(asset.parcel.quickSaleValue);
                  const unrealised = qsv == null ? null : qsv - invested;
                  const days = Math.floor((Date.now() - asset.acquiredAt.getTime()) / 86_400_000);
                  return (
                    <Tr key={asset.id}>
                      <Td>
                        <Link
                          href={`/portfolio/${asset.id}`}
                          className="num text-ink hover:text-alpha"
                        >
                          <Value>{asset.parcel.apn}</Value>
                        </Link>
                      </Td>
                      <Td className="text-ink-muted">
                        {asset.parcel.county}, {asset.parcel.state}
                      </Td>
                      <Td align="right">
                        <Value>
                          {asset.parcel.acreage == null ? null : formatAcres(asset.parcel.acreage)}
                        </Value>
                      </Td>
                      <Td className="text-ink-faint">{formatDate(asset.acquiredAt)}</Td>
                      <Td align="right">{formatCents(toCents(asset.acquisitionPrice))}</Td>
                      <Td align="right">{formatCents(invested)}</Td>
                      <Td align="right">
                        <Value>{formatCents(qsv)}</Value>
                      </Td>
                      <Td
                        align="right"
                        className={unrealised != null && unrealised > 0 ? 'text-warn' : 'text-bad'}
                      >
                        <Value>{unrealised == null ? null : formatCents(unrealised)}</Value>
                      </Td>
                      <Td align="right">{formatNumber(days)}</Td>
                      <Td>
                        <Badge tone={statusTone(asset.parcel.status)}>{asset.parcel.status}</Badge>
                      </Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </Panel>

        {sold.length > 0 ? (
          <Panel>
            <PanelHeader title="Realised" subtitle="Closed positions — actual money" />
            <DataTable>
              <Thead>
                <tr>
                  <Th>Parcel</Th>
                  <Th>Location</Th>
                  <Th>Sold</Th>
                  <Th align="right">Sale price</Th>
                  <Th align="right">Realised profit</Th>
                  <Th align="right">ROI</Th>
                  <Th align="right">Days held</Th>
                </tr>
              </Thead>
              <tbody>
                {sold.map((asset) => (
                  <Tr key={asset.id}>
                    <Td className="num">
                      <Value>{asset.parcel.apn}</Value>
                    </Td>
                    <Td className="text-ink-muted">
                      {asset.parcel.county}, {asset.parcel.state}
                    </Td>
                    <Td className="text-ink-faint">{formatDate(asset.soldAt)}</Td>
                    <Td align="right">{formatCents(toCents(asset.salePrice))}</Td>
                    <Td
                      align="right"
                      className={
                        (toCents(asset.realizedProfit) ?? 0) > 0 ? 'text-good' : 'text-bad'
                      }
                    >
                      {formatCents(toCents(asset.realizedProfit))}
                    </Td>
                    <Td align="right">
                      <Value>
                        {asset.realizedRoi == null ? null : formatPercent(asset.realizedRoi, 0)}
                      </Value>
                    </Td>
                    <Td align="right">
                      <Value>{asset.daysHeld == null ? null : formatNumber(asset.daysHeld)}</Value>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
