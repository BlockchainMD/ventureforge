import Link from 'next/link';
import { prisma, toCents } from '@land-alpha/db';
import { formatCents, formatDate, formatNumber, humanizeEnum } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Value } from '@/components/ui/value';

export const metadata = { title: 'Leads — Land Alpha' };
export const dynamic = 'force-dynamic';

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'muted' | 'alpha';

const STATUS_TONE: Record<string, Tone> = {
  NEW: 'alpha',
  CONTACTED: 'info',
  QUALIFIED: 'info',
  OFFER: 'warn',
  NEGOTIATING: 'warn',
  CONTRACT: 'good',
  CLOSED: 'good',
  LOST: 'muted',
};

export default async function LeadsPage() {
  const [leads, counts] = await Promise.all([
    prisma.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        parcel: { select: { id: true, apn: true, county: true, state: true, publicSlug: true } },
      },
    }),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={
          counts.map((row) => `${row._count._all} ${row.status.toLowerCase()}`).join(' · ') ||
          'No enquiries yet'
        }
      />
      <div className="p-4">
        <Panel>
          <PanelHeader
            title="Buyer enquiries"
            subtitle="From public property pages and make-an-offer forms."
          />
          <DataTable>
            <Thead>
              <tr>
                <Th>Received</Th>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>Property</Th>
                <Th align="right">Offer</Th>
                <Th>Financing</Th>
                <Th>Status</Th>
                <Th>Source</Th>
              </tr>
            </Thead>
            <tbody>
              {leads.length === 0 ? (
                <EmptyRow colSpan={8}>
                  No enquiries yet. They arrive from the public property pages once a parcel is
                  listed.
                </EmptyRow>
              ) : (
                leads.map((lead) => (
                  <Tr key={lead.id}>
                    <Td className="text-ink-faint">{formatDate(lead.createdAt)}</Td>
                    <Td className="text-ink">{lead.name}</Td>
                    <Td className="text-ink-muted">
                      <span className="num text-[11px]">{lead.email}</span>
                      {lead.phone ? (
                        <span className="num ml-2 text-[11px] text-ink-faint">{lead.phone}</span>
                      ) : null}
                    </Td>
                    <Td>
                      {lead.parcel ? (
                        <Link
                          href={`/opportunities/${lead.parcel.id}`}
                          className="num text-[11px] hover:text-alpha"
                        >
                          {lead.parcel.apn ?? lead.parcel.county}
                        </Link>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      <Value>{formatCents(toCents(lead.offerAmount))}</Value>
                    </Td>
                    <Td className="text-ink-faint">
                      <Value mono={false}>{lead.financing}</Value>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[lead.status] ?? 'neutral'}>
                        {humanizeEnum(lead.status)}
                      </Badge>
                    </Td>
                    <Td className="text-ink-faint">{humanizeEnum(lead.source)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>
        <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
          {formatNumber(leads.length)} enquiries shown. AI-drafted replies are always based on
          verified parcel facts and never assert buildability, zoning approval or legal access.
        </p>
      </div>
    </>
  );
}
