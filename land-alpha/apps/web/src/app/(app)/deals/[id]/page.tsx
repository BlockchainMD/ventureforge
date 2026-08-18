import { notFound } from 'next/navigation';
import Link from 'next/link';
import { prisma, toCents } from '@land-alpha/db';
import {
  formatAcres,
  formatCents,
  formatDate,
  formatPercent,
  humanizeEnum,
} from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { Badge } from '@/components/ui/badge';
import { getSessionUser, hasRole } from '@/server/auth';
import { guidanceFor } from '@/server/deal-checklist';
import { Checklist } from './checklist';
import { AcquisitionForm } from './acquisition-form';

export const dynamic = 'force-dynamic';

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [deal, user] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: {
        parcel: { include: { source: true } },
        checklistItems: { orderBy: { ordering: 'asc' } },
        notes: { orderBy: { createdAt: 'desc' } },
        documents: { orderBy: { createdAt: 'desc' } },
      },
    }),
    getSessionUser(),
  ]);
  if (!deal) notFound();

  const canAct = user != null && hasRole(user, 'ANALYST');
  const required = deal.checklistItems.filter((item) => item.required);
  const done = required.filter(
    (item) => item.status === 'COMPLETE' || item.status === 'NOT_APPLICABLE',
  ).length;
  const ready = required.length > 0 && done === required.length;

  return (
    <>
      <PageHeader
        title={`Deal room — ${deal.parcel.county} County, ${deal.parcel.state}`}
        subtitle={
          <span className="num">
            APN <Value>{deal.parcel.apn}</Value>
            <span className="mx-2 text-line-strong">·</span>
            <Value>{deal.parcel.acreage == null ? null : formatAcres(deal.parcel.acreage)}</Value>
            <span className="mx-2 text-line-strong">·</span>
            opened {formatDate(deal.openedAt)}
          </span>
        }
        actions={
          <>
            <Badge tone={ready ? 'good' : 'warn'}>
              {done} / {required.length} required complete
            </Badge>
            <Link
              href={`/opportunities/${deal.parcelId}`}
              className="text-[11px] text-ink-muted hover:text-alpha"
            >
              Open underwriting →
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="col-span-2 space-y-3">
          <Panel>
            <PanelHeader
              title="Due-diligence checklist"
              subtitle="Every required item must be resolved before a maximum bid can be relied on."
            />
            <Checklist
              canAct={canAct}
              items={deal.checklistItems.map((item) => ({
                id: item.id,
                key: item.key,
                label: item.label,
                category: item.category,
                required: item.required,
                status: item.status,
                findings: item.findings,
                completedAt: item.completedAt,
                guidance: guidanceFor(item.key),
              }))}
            />
          </Panel>

          <Panel>
            <PanelHeader
              title="Record the outcome"
              subtitle="After you have bid, won or lost, capture what actually happened."
            />
            <PanelBody>
              <AcquisitionForm parcelId={deal.parcelId} canAct={canAct} />
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Economics at open" />
            <PanelBody>
              <MetricGrid columns={2}>
                <Metric label="Alpha score" tone="text-alpha">
                  <Value>
                    {deal.parcel.alphaScore == null ? null : Math.round(deal.parcel.alphaScore)}
                  </Value>
                </Metric>
                <Metric label="Confidence">{deal.parcel.confidenceLevel}</Metric>
                <Metric label="All-in basis">
                  <Value>{formatCents(toCents(deal.parcel.estimatedAllInBasis))}</Value>
                </Metric>
                <Metric label="Quick sale value">
                  <Value>{formatCents(toCents(deal.parcel.quickSaleValue))}</Value>
                </Metric>
                <Metric label="Basis / QSV">
                  <Value>
                    {deal.parcel.basisToQsv == null
                      ? null
                      : formatPercent(deal.parcel.basisToQsv, 1)}
                  </Value>
                </Metric>
                <Metric label="Approved max bid" tone="text-good">
                  <Value>{formatCents(toCents(deal.approvedMaxBid))}</Value>
                </Metric>
              </MetricGrid>
              {deal.dueDiligenceAcknowledgedAt ? (
                <p className="mt-3 border-t border-line pt-2 text-[11px] text-good">
                  Due-diligence acknowledgement recorded{' '}
                  {formatDate(deal.dueDiligenceAcknowledgedAt)}.
                </p>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Risk summary" />
            <PanelBody className="space-y-1.5">
              <Row label="Access" value={deal.parcel.accessClass} />
              <Row label="Legal access" value={humanizeEnum(deal.parcel.legalAccessStatus)} />
              <Row
                label="Buildability"
                value={`${deal.parcel.buildability}${deal.parcel.buildability === 'GREEN' ? '*' : ''}`}
              />
              <Row
                label="Title risk"
                value={
                  deal.parcel.titleRiskScore == null
                    ? null
                    : `${Math.round(deal.parcel.titleRiskScore)} / 100`
                }
              />
              <Row
                label="Environmental risk"
                value={
                  deal.parcel.environmentalRiskScore == null
                    ? null
                    : `${Math.round(deal.parcel.environmentalRiskScore)} / 100`
                }
              />
              <Row label="Source" value={deal.parcel.source.name} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Documents" subtitle={`${deal.documents.length} attached`} />
            <PanelBody>
              {deal.documents.length === 0 ? (
                <p className="text-xs text-ink-faint">
                  No documents attached. Deeds, plats, permits and correspondence belong here.
                </p>
              ) : (
                <ul className="space-y-1">
                  {deal.documents.map((document) => (
                    <li key={document.id} className="text-[11px] text-ink-muted">
                      {document.title}
                    </li>
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="rule-label">{label}</span>
      <span className="num text-xs text-ink-muted">
        <Value>{value}</Value>
      </span>
    </div>
  );
}
