import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { getParcelDetail, spatial, toCents, getActiveScoringConfig } from '@land-alpha/db';
import {
  ACCESS_CLASS_LABELS,
  centsToDollars,
  formatAcres,
  formatCents,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  humanizeEnum,
  metersToFeet,
} from '@land-alpha/shared';
import { maximumBidForTargetRatio } from '@land-alpha/valuation';
import {
  ACCESS_DISCLAIMER,
  BUILDABILITY_DISCLAIMER,
  ENVIRONMENTAL_DISCLAIMER,
} from '@land-alpha/core';
import { TITLE_DISCLAIMER } from '@land-alpha/title-research';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Badge, statusTone } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { ParcelMap } from '@/components/ui/parcel-map';
import { getSessionUser, hasRole } from '@/server/auth';
import { DecisionCard } from './decision-card';
import { MaxBidControl, ParcelActions, RejectionOverride } from './parcel-actions';
import { NotesPanel } from './notes-panel';
import { ListingPanel, MemoPanel } from './memo-panel';

export const dynamic = 'force-dynamic';

export default async function ParcelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [parcel, geometry, user, config] = await Promise.all([
    getParcelDetail(id),
    spatial.readParcelGeometry(id),
    getSessionUser(),
    getActiveScoringConfig(),
  ]);

  if (!parcel) notFound();
  const canAct = user != null && hasRole(user, 'ANALYST');

  const acquisitionPriceCents =
    toCents(parcel.askingPrice) ??
    toCents(parcel.minimumBid) ??
    toCents(parcel.estimatedAcquisitionCost);
  const quickSaleValueCents = toCents(parcel.quickSaleValue);

  const recommendedMaxBidCents =
    quickSaleValueCents == null
      ? null
      : maximumBidForTargetRatio({
          quickSaleValueCents,
          targetBasisToQsv: config.thresholds.strongBasisToQsv,
          costs: config.costModel,
          governmentFeesCents: toCents(parcel.fees) ?? 0,
          annualTaxCents: toCents(parcel.annualTaxEstimate),
          titleCurativeCents: toCents(parcel.estimatedCurativeCost),
        });

  const rejectionReasons = (parcel.rejectionReasons ?? []) as {
    rule: string;
    explanation: string;
    overridable: boolean;
  }[];

  return (
    <>
      <PageHeader
        title={`${parcel.county} County, ${parcel.state}`}
        subtitle={
          <span className="num">
            APN <Value>{parcel.apn}</Value>
            <span className="mx-2 text-line-strong">·</span>
            <Value>{parcel.acreage == null ? null : formatAcres(parcel.acreage)}</Value>
            <span className="mx-2 text-line-strong">·</span>
            {parcel.source.name}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={statusTone(parcel.status)}>{humanizeEnum(parcel.status)}</Badge>
            <ParcelActions
              parcelId={parcel.id}
              watchlisted={parcel.watchlisted}
              hasDeal={parcel.deal != null}
              canAct={canAct}
            />
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3 p-4">
        {/* ================= Left column ================= */}
        <div className="col-span-2 space-y-3">
          <DecisionCard
            parcel={{
              id: parcel.id,
              state: parcel.state,
              county: parcel.county,
              apn: parcel.apn,
              acreage: parcel.acreage,
              alphaScore: parcel.alphaScore,
              confidenceLevel: parcel.confidenceLevel,
              acquisitionPriceCents,
              allInBasisCents: toCents(parcel.estimatedAllInBasis),
              quickSaleValueCents,
              retailValueCents: toCents(parcel.retailValue),
              basisToQsv: parcel.basisToQsv,
              grossProfitCents: toCents(parcel.expectedGrossMargin),
              roiAtQsv: parcel.roiAtQsv,
              accessClass: parcel.accessClass,
              buildability: parcel.buildability,
              titleRiskScore: parcel.titleRiskScore,
              environmentalRiskScore: parcel.environmentalRiskScore,
              valuationConfidence: parcel.valuationConfidence,
              economicsTier: parcel.economicsTier,
              whyInteresting: parcel.whyInteresting,
              remainingQuestions: parcel.remainingQuestions,
              recommendedMaxBidCents,
              rejected: parcel.rejected,
              rejectionReasons,
            }}
          />

          {parcel.rejected && canAct
            ? rejectionReasons
                .filter((reason) => reason.overridable)
                .map((reason) => (
                  <Panel key={reason.rule}>
                    <PanelHeader
                      title={`Override — ${reason.rule.replace(/_/g, ' ')}`}
                      subtitle="Overrides are recorded against your account and pinned to the parcel notes."
                    />
                    <PanelBody>
                      <RejectionOverride parcelId={parcel.id} rule={reason.rule} />
                    </PanelBody>
                  </Panel>
                ))
            : null}

          {/* --- Map ------------------------------------------------------- */}
          <Panel>
            <PanelHeader
              title="Parcel"
              subtitle={
                parcel.geometrySource
                  ? `Geometry: ${parcel.geometrySource} (${parcel.geometryConfidence.toLowerCase()} confidence)`
                  : 'No authoritative geometry available'
              }
            />
            <ParcelMap
              geometry={geometry}
              centroid={
                parcel.longitude != null && parcel.latitude != null
                  ? [parcel.longitude, parcel.latitude]
                  : null
              }
              height={340}
              className="border-x-0 border-b-0"
            />
            <PanelBody>
              <MetricGrid columns={5}>
                <Metric label="Acreage">
                  <Value>{parcel.acreage == null ? null : formatAcres(parcel.acreage)}</Value>
                </Metric>
                <Metric label="Perimeter">
                  <Value>
                    {parcel.perimeterMeters == null
                      ? null
                      : `${formatNumber(Math.round(metersToFeet(parcel.perimeterMeters)))} ft`}
                  </Value>
                </Metric>
                <Metric label="Compactness" hint="4πA/P² — 1.0 is a circle, below 0.12 is a sliver">
                  <Value>{parcel.compactness == null ? null : parcel.compactness.toFixed(2)}</Value>
                </Metric>
                <Metric label="Aspect ratio">
                  <Value>{parcel.aspectRatio == null ? null : parcel.aspectRatio.toFixed(1)}</Value>
                </Metric>
                <Metric label="Coordinates">
                  <Value>
                    {parcel.latitude == null || parcel.longitude == null
                      ? null
                      : `${parcel.latitude.toFixed(5)}, ${parcel.longitude.toFixed(5)}`}
                  </Value>
                </Metric>
              </MetricGrid>
              {parcel.shapeFlags.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {parcel.shapeFlags.map((flag) => (
                    <Badge
                      key={flag}
                      tone={flag.includes('REMNANT') || flag === 'SLIVER' ? 'bad' : 'warn'}
                    >
                      {flag.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </PanelBody>
          </Panel>

          {/* --- Valuation ------------------------------------------------- */}
          <Panel>
            <PanelHeader
              title="Valuation"
              subtitle={parcel.valuationMethod ?? 'No valuation has been produced.'}
              actions={<Badge tone="muted">{parcel.comparableCount} comps</Badge>}
            />
            <PanelBody>
              <MetricGrid columns={4}>
                <Metric label="Retail (low / mid / high)">
                  <Value>
                    {parcel.retailValue == null
                      ? null
                      : `${formatCents(toCents(parcel.retailValueLow))} · ${formatCents(toCents(parcel.retailValue))} · ${formatCents(toCents(parcel.retailValueHigh))}`}
                  </Value>
                </Metric>
                <Metric label="Quick sale value" tone="text-good">
                  <Value>{formatCents(quickSaleValueCents)}</Value>
                </Metric>
                <Metric label="Investor liquidation">
                  <Value>{formatCents(toCents(parcel.investorLiquidationValue))}</Value>
                </Metric>
                <Metric label="Confidence">{parcel.valuationConfidence}</Metric>
              </MetricGrid>

              {parcel.comparableLinks.some((link) =>
                link.comparable.source.startsWith('Development fixture'),
              ) ? (
                <p className="mt-3 rounded-sm border border-bad/40 bg-bad/10 px-2 py-1.5 text-[11px] leading-relaxed text-bad">
                  This valuation is built on development fixture data, not recorded sales. It
                  demonstrates the pipeline; it is not an underwriting input. Import real comparable
                  sales for {parcel.county} County before acting on these figures.
                </p>
              ) : null}

              {parcel.valuationWarnings.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-line pt-2">
                  {parcel.valuationWarnings.map((warning) => (
                    <li key={warning} className="text-[11px] text-warn">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}
            </PanelBody>

            <DataTable>
              <Thead>
                <tr>
                  <Th>Comparable</Th>
                  <Th>Sold</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Acres</Th>
                  <Th align="right">$/ac raw</Th>
                  <Th align="right">$/ac adj.</Th>
                  <Th align="right">Distance</Th>
                  <Th align="right">Weight</Th>
                </tr>
              </Thead>
              <tbody>
                {parcel.comparableLinks.length === 0 ? (
                  <EmptyRow colSpan={8}>
                    No comparable sales were used. Import recorded sales for this county to enable a
                    comps-based valuation.
                  </EmptyRow>
                ) : (
                  parcel.comparableLinks.slice(0, 12).map((link) => (
                    <Tr key={link.id}>
                      <Td>
                        <span className="num text-[11px] text-ink-muted">
                          <Value>{link.comparable.apn}</Value>
                        </span>
                        {link.comparable.source.startsWith('Development fixture') ? (
                          <Badge tone="bad" className="ml-1.5">
                            fixture
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>{formatDate(link.comparable.saleDate)}</Td>
                      <Td align="right">{formatCents(toCents(link.comparable.salePrice))}</Td>
                      <Td align="right">{formatAcres(link.comparable.acreage)}</Td>
                      <Td align="right" className="text-ink-faint">
                        {formatCents(
                          Math.round(
                            (toCents(link.comparable.salePrice) ?? 0) / link.comparable.acreage,
                          ),
                        )}
                      </Td>
                      <Td align="right">{formatCents(toCents(link.adjustedPricePerAcre))}</Td>
                      <Td align="right">
                        <Value>
                          {link.distanceMeters == null
                            ? null
                            : `${(link.distanceMeters / 1609.344).toFixed(1)} mi`}
                        </Value>
                      </Td>
                      <Td align="right">{link.weight.toFixed(2)}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </DataTable>
          </Panel>

          {/* --- Access ---------------------------------------------------- */}
          <Panel>
            <PanelHeader title="Access" subtitle={ACCESS_CLASS_LABELS[parcel.accessClass]} />
            <PanelBody>
              <MetricGrid columns={4}>
                <Metric label="Access class">{parcel.accessClass}</Metric>
                <Metric label="Physical access score">
                  <Value>
                    {parcel.physicalAccessScore == null
                      ? null
                      : Math.round(parcel.physicalAccessScore)}
                  </Value>
                </Metric>
                <Metric label="Legal access status" tone="text-warn">
                  {humanizeEnum(parcel.legalAccessStatus)}
                </Metric>
                <Metric label="Road frontage">
                  <Value>
                    {parcel.roadFrontageMeters == null
                      ? null
                      : `${formatNumber(Math.round(metersToFeet(parcel.roadFrontageMeters)))} ft`}
                  </Value>
                </Metric>
                <Metric label="Nearest road">
                  <Value>{parcel.nearestRoadName}</Value>
                </Metric>
                <Metric label="Distance to road">
                  <Value>
                    {parcel.nearestRoadMeters == null
                      ? null
                      : `${formatNumber(Math.round(metersToFeet(parcel.nearestRoadMeters)))} ft`}
                  </Value>
                </Metric>
                <Metric label="Nearest paved road">
                  <Value>{parcel.nearestPavedRoadName}</Value>
                </Metric>
                <Metric
                  label="Potentially landlocked"
                  tone={parcel.potentiallyLandlocked ? 'text-bad' : undefined}
                >
                  {parcel.potentiallyLandlocked == null
                    ? '—'
                    : parcel.potentiallyLandlocked
                      ? 'YES'
                      : 'No'}
                </Metric>
              </MetricGrid>

              <EvidenceList items={parcel.accessEvidence} unknowns={parcel.accessUnknowns} />
              <Disclaimer>{ACCESS_DISCLAIMER}</Disclaimer>
            </PanelBody>
          </Panel>

          {/* --- Zoning & buildability -------------------------------------- */}
          <Panel>
            <PanelHeader
              title="Zoning and buildability"
              subtitle={`Screened ${parcel.buildability}${parcel.buildability === 'GREEN' ? '*' : ''}`}
            />
            <PanelBody>
              <MetricGrid columns={4}>
                <Metric label="Zoning">
                  <Value>{parcel.zoning}</Value>
                </Metric>
                <Metric label="Zoning source">
                  <Value mono={false}>{parcel.zoningSource}</Value>
                </Metric>
                <Metric label="Minimum lot size">
                  <Value>
                    {parcel.minimumLotSizeAcres == null
                      ? null
                      : formatAcres(parcel.minimumLotSizeAcres)}
                  </Value>
                </Metric>
                <Metric label="Property class">
                  <Value>{parcel.propertyClass}</Value>
                </Metric>
              </MetricGrid>

              <EvidenceList
                items={parcel.buildabilityReasons}
                unknowns={parcel.buildabilityUnknowns}
                blockers={parcel.buildabilityBlockers}
              />
              <Disclaimer>{BUILDABILITY_DISCLAIMER}</Disclaimer>
            </PanelBody>
          </Panel>

          {/* --- Environmental --------------------------------------------- */}
          <Panel>
            <PanelHeader title="Environmental" subtitle="Public screening layers" />
            <PanelBody>
              <MetricGrid columns={4}>
                <Metric label="Flood zones">
                  <Value>{parcel.floodZones.join(', ') || null}</Value>
                </Metric>
                <Metric
                  label="Flood overlap"
                  tone={parcel.inSpecialFloodHazardArea ? 'text-bad' : undefined}
                >
                  <Value>
                    {parcel.floodOverlapFraction == null
                      ? null
                      : formatPercent(parcel.floodOverlapFraction, 0)}
                  </Value>
                </Metric>
                <Metric label="Wetland types">
                  <Value>{parcel.wetlandTypes.join(', ') || null}</Value>
                </Metric>
                <Metric label="Wetland overlap">
                  <Value>
                    {parcel.wetlandOverlapFraction == null
                      ? null
                      : formatPercent(parcel.wetlandOverlapFraction, 0)}
                  </Value>
                </Metric>
                <Metric label="Mean slope">
                  <Value>
                    {parcel.meanSlopePercent == null
                      ? null
                      : `${parcel.meanSlopePercent.toFixed(1)}%`}
                  </Value>
                </Metric>
                <Metric label="Elevation range">
                  <Value>
                    {parcel.minElevationMeters == null || parcel.maxElevationMeters == null
                      ? null
                      : `${Math.round(parcel.minElevationMeters)}–${Math.round(parcel.maxElevationMeters)} m`}
                  </Value>
                </Metric>
                <Metric label="Soils">
                  <Value>{parcel.soilSeries.slice(0, 2).join(', ') || null}</Value>
                </Metric>
                <Metric
                  label="Nearest cleanup site"
                  tone={
                    parcel.nearestContaminatedSiteMeters != null &&
                    parcel.nearestContaminatedSiteMeters < 500
                      ? 'text-bad'
                      : undefined
                  }
                >
                  <Value>
                    {parcel.nearestContaminatedSiteMeters == null
                      ? null
                      : `${formatNumber(Math.round(parcel.nearestContaminatedSiteMeters))} m`}
                  </Value>
                </Metric>
              </MetricGrid>
              <Disclaimer>{ENVIRONMENTAL_DISCLAIMER}</Disclaimer>
            </PanelBody>
          </Panel>

          {/* --- Title ------------------------------------------------------ */}
          <Panel>
            <PanelHeader
              title="Title pre-screen"
              subtitle={
                parcel.titleRiskScore == null
                  ? 'No title research has been performed for this parcel.'
                  : `Risk ${Math.round(parcel.titleRiskScore)} / 100`
              }
            />
            <DataTable>
              <Thead>
                <tr>
                  <Th>Instrument</Th>
                  <Th>Recorded</Th>
                  <Th>Grantor</Th>
                  <Th>Grantee</Th>
                  <Th>Severity</Th>
                </tr>
              </Thead>
              <tbody>
                {parcel.titleInstruments.length === 0 ? (
                  <EmptyRow colSpan={5}>
                    No recorded instruments have been retrieved. Where the county recorder cannot be
                    searched programmatically, a research task is queued for a person.
                  </EmptyRow>
                ) : (
                  parcel.titleInstruments.map((instrument) => (
                    <Tr key={instrument.id}>
                      <Td>{humanizeEnum(instrument.instrumentType)}</Td>
                      <Td>{formatDate(instrument.recordedDate)}</Td>
                      <Td>
                        <Value mono={false}>{instrument.grantor}</Value>
                      </Td>
                      <Td>
                        <Value mono={false}>{instrument.grantee}</Value>
                      </Td>
                      <Td>
                        <Badge tone={instrument.severity === 'INFO' ? 'muted' : 'warn'}>
                          {instrument.severity}
                        </Badge>
                      </Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </DataTable>
            <PanelBody>
              {parcel.titleResearchTasks.length > 0 ? (
                <div className="mb-2">
                  <p className="rule-label mb-1">Open research tasks</p>
                  <ul className="space-y-1">
                    {parcel.titleResearchTasks.map((task) => (
                      <li key={task.id} className="text-[11px] text-ink-muted">
                        <Badge tone="warn">{task.status}</Badge>{' '}
                        <span className="ml-1">{humanizeEnum(task.taskType)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Disclaimer>{TITLE_DISCLAIMER}</Disclaimer>
            </PanelBody>
          </Panel>

          <MemoPanel
            parcelId={parcel.id}
            canAct={canAct}
            memo={
              parcel.memos[0]
                ? {
                    version: parcel.memos[0].version,
                    provider: parcel.memos[0].provider,
                    model: parcel.memos[0].model,
                    recommendation: parcel.memos[0].recommendation,
                    createdAt: parcel.memos[0].createdAt,
                    sections: parcel.memos[0].sections as unknown as Record<string, string>,
                    unknowns: parcel.memos[0].unknowns,
                  }
                : null
            }
          />

          <ListingPanel
            parcelId={parcel.id}
            canAct={canAct}
            slug={parcel.publicSlug}
            title={parcel.listing?.title ?? null}
            published={parcel.listing?.published ?? false}
            withheldClaims={
              (parcel.listing?.variants?.[0]?.metadata as { withheldClaims?: string[] } | null)
                ?.withheldClaims ?? []
            }
          />

          <NotesPanel parcelId={parcel.id} notes={parcel.notes} canAct={canAct} />
        </div>

        {/* ================= Right column ================= */}
        <div className="space-y-3">
          <Panel>
            <PanelHeader title="Acquisition" />
            <PanelBody className="space-y-2">
              <KeyValue label="Sale type" value={humanizeEnum(parcel.saleType)} />
              <KeyValue label="Sale status" value={humanizeEnum(parcel.saleStatus)} />
              <KeyValue label="Minimum bid" value={formatCents(toCents(parcel.minimumBid))} />
              <KeyValue label="Asking price" value={formatCents(toCents(parcel.askingPrice))} />
              <KeyValue label="Taxes due" value={formatCents(toCents(parcel.taxesDue))} />
              <KeyValue label="Fees" value={formatCents(toCents(parcel.fees))} />
              <KeyValue label="Auction date" value={formatDate(parcel.auctionDate)} />
              <KeyValue label="Offer deadline" value={formatDate(parcel.offerDeadline)} />
              <KeyValue label="Failed sales" value={String(parcel.failedSaleCount)} />
              <KeyValue
                label="OTC eligible"
                value={parcel.otcEligible == null ? null : parcel.otcEligible ? 'Yes' : 'No'}
              />
              <div className="border-t border-line pt-2">
                <p className="rule-label">Source</p>
                <p className="mt-0.5 text-xs text-ink">{parcel.source.name}</p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {humanizeEnum(parcel.source.sourceType)} ·{' '}
                  {humanizeEnum(parcel.source.ingestionMethod)}
                </p>
                {parcel.sourceUrl ? (
                  <a
                    href={parcel.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-info hover:underline"
                  >
                    Official source <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
              {parcel.acquisitionInstructions ? (
                <p className="border-t border-line pt-2 text-[11px] leading-relaxed text-warn">
                  {parcel.acquisitionInstructions}
                </p>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Approve maximum bid" />
            <PanelBody>
              <MaxBidControl
                parcelId={parcel.id}
                recommendedDollars={
                  recommendedMaxBidCents == null
                    ? null
                    : Math.round(centsToDollars(recommendedMaxBidCents))
                }
                approvedDollars={
                  parcel.approvedMaxBid == null
                    ? null
                    : Math.round(centsToDollars(toCents(parcel.approvedMaxBid) ?? 0))
                }
                canAct={canAct}
              />
              {parcel.approvedMaxBidAt ? (
                <p className="mt-2 border-t border-line pt-2 text-[11px] text-good">
                  Approved {formatCents(toCents(parcel.approvedMaxBid))} on{' '}
                  {formatDateTime(parcel.approvedMaxBidAt)}.
                </p>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Cost breakdown"
              subtitle="Every dollar between the bid and resale"
            />
            <PanelBody className="space-y-1">
              <KeyValue label="Acquisition" value={formatCents(acquisitionPriceCents)} />
              <KeyValue label="Government fees" value={formatCents(toCents(parcel.fees))} />
              <KeyValue
                label="Recording"
                value={formatCents(toCents(parcel.estimatedRecordingCost))}
              />
              <KeyValue label="Title" value={formatCents(toCents(parcel.estimatedTitleCost))} />
              <KeyValue
                label="Curative"
                value={formatCents(toCents(parcel.estimatedCurativeCost))}
              />
              <KeyValue
                label="Carrying"
                value={formatCents(toCents(parcel.estimatedCarryingCost))}
              />
              <KeyValue
                label="Marketing"
                value={formatCents(toCents(parcel.estimatedMarketingCost))}
              />
              <div className="border-t border-line pt-1">
                <KeyValue
                  label="All-in basis"
                  value={formatCents(toCents(parcel.estimatedAllInBasis))}
                  emphasis
                />
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Taxes and assessment" />
            <PanelBody className="space-y-1">
              <KeyValue label="Assessed value" value={formatCents(toCents(parcel.assessedValue))} />
              <KeyValue label="Land value" value={formatCents(toCents(parcel.landAssessedValue))} />
              <KeyValue label="Taxable value" value={formatCents(toCents(parcel.taxableValue))} />
              <KeyValue label="Annual tax" value={formatCents(toCents(parcel.annualTaxEstimate))} />
              <KeyValue label="Owner" value={parcel.currentOwner} />
              <KeyValue label="Owner type" value={humanizeEnum(parcel.ownerType)} />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Legal description"
              subtitle={parcel.legalDescription ? undefined : 'Not published by the source'}
            />
            {parcel.legalDescription ? (
              <PanelBody>
                <p className="text-[11px] leading-relaxed text-ink-muted">
                  {parcel.legalDescription}
                </p>
              </PanelBody>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Activity"
              subtitle={`First seen ${formatDate(parcel.firstSeenAt)} · last seen ${formatDate(parcel.lastSeenAt)}`}
            />
            <PanelBody className="space-y-1.5">
              {parcel.changes.length === 0 ? (
                <p className="text-xs text-ink-faint">No changes recorded.</p>
              ) : (
                parcel.changes.slice(0, 12).map((change) => (
                  <div key={change.id} className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-ink-muted">
                      {humanizeEnum(change.kind)}
                      {change.field ? (
                        <span className="text-ink-faint"> · {change.field}</span>
                      ) : null}
                    </span>
                    <span className="num text-[10px] text-ink-faint">
                      {formatDate(change.detectedAt)}
                    </span>
                  </div>
                ))
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Evidence"
              subtitle={`${parcel.evidence.length} recorded facts with provenance`}
              actions={
                <Link
                  href={`/opportunities/${parcel.id}/evidence`}
                  className="text-[11px] text-ink-muted hover:text-alpha"
                >
                  View all
                </Link>
              }
            />
            <PanelBody className="space-y-1.5">
              {parcel.evidence.slice(0, 8).map((row) => (
                <div key={row.id} className="border-b border-line/50 pb-1.5 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num text-[11px] text-ink">{row.field}</span>
                    <Badge
                      tone={
                        row.confidence === 'VERIFIED' || row.confidence === 'HIGH'
                          ? 'good'
                          : 'muted'
                      }
                    >
                      {row.confidence}
                    </Badge>
                  </div>
                  <p className="truncate text-[10px] text-ink-faint" title={row.value}>
                    {row.value}
                  </p>
                  <p className="text-[10px] text-ink-faint">
                    {row.source} · {formatDate(row.retrievalDate)}
                  </p>
                </div>
              ))}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  );
}

function KeyValue({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="rule-label">{label}</span>
      <span
        className={`num ${emphasis ? 'text-sm font-semibold text-ink' : 'text-xs text-ink-muted'}`}
      >
        <Value>{value}</Value>
      </span>
    </div>
  );
}

function EvidenceList({
  items,
  unknowns,
  blockers,
}: {
  items: readonly string[];
  unknowns: readonly string[];
  blockers?: readonly string[];
}) {
  if (items.length === 0 && unknowns.length === 0 && (blockers?.length ?? 0) === 0) return null;
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-2">
      {blockers && blockers.length > 0 ? (
        <div>
          <p className="rule-label text-bad">Blocking issues</p>
          <ul className="mt-1 space-y-0.5">
            {blockers.map((item) => (
              <li key={item} className="text-[11px] text-bad">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {items.length > 0 ? (
        <div>
          <p className="rule-label">Evidence</p>
          <ul className="mt-1 space-y-0.5">
            {items.map((item) => (
              <li key={item} className="text-[11px] text-ink-muted">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unknowns.length > 0 ? (
        <div>
          <p className="rule-label text-warn">Unknown — verification required</p>
          <ul className="mt-1 space-y-0.5">
            {unknowns.map((item) => (
              <li key={item} className="text-[11px] text-ink-faint">
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Disclaimer({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 border-t border-line pt-2 text-[10px] leading-relaxed text-ink-faint">
      {children}
    </p>
  );
}
