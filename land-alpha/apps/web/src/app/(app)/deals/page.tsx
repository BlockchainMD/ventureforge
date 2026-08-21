import Link from 'next/link';
import { prisma, toCents } from '@land-alpha/db';
import { formatAcres, formatCents, formatDate, formatNumber } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Value } from '@/components/ui/value';

export const metadata = { title: 'Deal rooms — Land Alpha' };
export const dynamic = 'force-dynamic';

export default async function DealsPage() {
  const deals = await prisma.deal.findMany({
    orderBy: { openedAt: 'desc' },
    include: {
      parcel: {
        select: {
          id: true,
          apn: true,
          county: true,
          state: true,
          acreage: true,
          alphaScore: true,
          status: true,
          quickSaleValue: true,
        },
      },
      checklistItems: { select: { status: true, required: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Deal rooms"
        subtitle={`${formatNumber(deals.length)} parcels in due diligence`}
      />
      <div className="p-3 sm:p-4">
        <Panel>
          <PanelHeader
            title="Open deals"
            subtitle="A deal room commits to doing the work, not to buying the parcel."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Parcel</Th>
                <Th>Location</Th>
                <Th align="right">Acres</Th>
                <Th align="right">Alpha</Th>
                <Th align="right">QSV</Th>
                <Th align="right">Approved max bid</Th>
                <Th>Checklist</Th>
                <Th>Status</Th>
                <Th>Opened</Th>
              </tr>
            </Thead>
            <tbody>
              {deals.length === 0 ? (
                <EmptyRow colSpan={9}>
                  No deal rooms yet. Open one from a parcel with “Start due diligence”.
                </EmptyRow>
              ) : (
                deals.map((deal) => {
                  const required = deal.checklistItems.filter((item) => item.required);
                  const done = required.filter(
                    (item) => item.status === 'COMPLETE' || item.status === 'NOT_APPLICABLE',
                  ).length;
                  const ready = done === required.length && required.length > 0;
                  return (
                    <Tr key={deal.id}>
                      <Td>
                        <Link href={`/deals/${deal.id}`} className="num text-ink hover:text-alpha">
                          <Value>{deal.parcel.apn}</Value>
                        </Link>
                      </Td>
                      <Td className="text-ink-muted">
                        {deal.parcel.county}, {deal.parcel.state}
                      </Td>
                      <Td align="right">
                        <Value>
                          {deal.parcel.acreage == null ? null : formatAcres(deal.parcel.acreage)}
                        </Value>
                      </Td>
                      <Td align="right" className="text-alpha">
                        <Value>
                          {deal.parcel.alphaScore == null
                            ? null
                            : Math.round(deal.parcel.alphaScore)}
                        </Value>
                      </Td>
                      <Td align="right">
                        <Value>{formatCents(toCents(deal.parcel.quickSaleValue))}</Value>
                      </Td>
                      <Td align="right" className="text-good">
                        <Value>{formatCents(toCents(deal.approvedMaxBid))}</Value>
                      </Td>
                      <Td>
                        <span className={`num text-[11px] ${ready ? 'text-good' : 'text-warn'}`}>
                          {done} / {required.length} required
                        </span>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(deal.parcel.status)}>{deal.parcel.status}</Badge>
                      </Td>
                      <Td className="text-ink-faint">{formatDate(deal.openedAt)}</Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </>
  );
}
