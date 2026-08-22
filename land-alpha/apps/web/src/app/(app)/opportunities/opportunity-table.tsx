import Link from 'next/link';
import { Eye } from 'lucide-react';
import {
  deadlineStatus,
  formatAcres,
  formatCents,
  formatDate,
  formatPercent,
  humanizeEnum,
  type OpportunitySummary,
} from '@land-alpha/shared';
import { isFixtureApn } from '@land-alpha/shared/ids';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Badge, statusTone } from '@/components/ui/badge';
import { Value } from '@/components/ui/value';
import {
  accessTone,
  alphaScoreTone,
  basisRatioTone,
  buildabilityTone,
  confidenceTone,
  titleRiskTone,
} from '@/lib/utils';

/**
 * The opportunity table.
 *
 * Column order is the order an analyst actually reads: score first, then what
 * it is, then what it costs against what it is worth, then the three risks that
 * most often kill a deal (access, buildability, title), then the clock.
 *
 * Confidence is shown alongside the score rather than in a far column, because
 * an 88 built on three unknowns and an 88 built on verified data warrant
 * completely different attention.
 */
export function OpportunityTable({
  rows,
  emptyMessage = 'No parcels match these filters.',
  showSource = true,
}: {
  rows: readonly OpportunitySummary[];
  emptyMessage?: string;
  showSource?: boolean;
}) {
  return (
    <DataTable>
      <Thead>
        <tr>
          <Th align="right">Alpha</Th>
          <Th>Conf</Th>
          <Th>Location</Th>
          <Th>APN</Th>
          <Th align="right">Acres</Th>
          {showSource ? <Th>Source</Th> : null}
          <Th align="right">Price</Th>
          <Th align="right">Basis</Th>
          <Th align="right">QSV</Th>
          <Th align="right">Basis/QSV</Th>
          <Th align="right" title="Return per year of capital tied up">
            Ann. ROI
          </Th>
          <Th align="right" title="Estimated months to sell">
            Hold
          </Th>
          <Th align="center">Access</Th>
          <Th align="center">Build</Th>
          <Th align="right">Title</Th>
          <Th>Deadline</Th>
          <Th>Status</Th>
          <Th />
        </tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={showSource ? 16 : 15}>{emptyMessage}</EmptyRow>
        ) : (
          rows.map((row) => {
            const deadline = row.offerDeadline ?? row.auctionDate;
            // A date on its own asks the reader to know today's date and do
            // the subtraction. For a passed auction that arithmetic is the
            // difference between a parcel you can bid on and one that is gone.
            const deadlineState = deadlineStatus(deadline);
            return (
              <Tr key={row.id}>
                <Td align="right">
                  <Link href={`/opportunities/${row.id}`}>
                    <span className={`num text-sm font-semibold ${alphaScoreTone(row.alphaScore)}`}>
                      <Value>{row.alphaScore == null ? null : Math.round(row.alphaScore)}</Value>
                    </span>
                  </Link>
                </Td>
                <Td>
                  <span className={`text-[10px] uppercase ${confidenceTone(row.confidenceLevel)}`}>
                    {row.confidenceLevel == null
                      ? '—'
                      : row.confidenceLevel.slice(0, 4).toLowerCase()}
                  </span>
                </Td>
                <Td>
                  <Link href={`/opportunities/${row.id}`} className="hover:text-alpha">
                    <span className="text-ink">{row.county}</span>
                    <span className="ml-1 text-ink-faint">{row.state}</span>
                  </Link>
                </Td>
                <Td>
                  <span className="num text-[11px] text-ink-muted">
                    <Value>{row.apn}</Value>
                  </span>
                  {/* Fixtures are built to be indistinguishable from real
                      records to the engines. To a person deciding where to
                      send money they must not be. */}
                  {isFixtureApn(row.apn) ? (
                    <span
                      className="ml-1 rounded border border-ink-faint/40 px-1 text-[9px] uppercase tracking-wide text-ink-faint"
                      title="Synthetic development fixture, not a parcel any county has published."
                    >
                      fixture
                    </span>
                  ) : null}
                </Td>
                <Td align="right">
                  <Value>{row.acreage == null ? null : formatAcres(row.acreage)}</Value>
                </Td>
                {showSource ? (
                  <Td>
                    <span className="text-[11px] text-ink-faint" title={row.sourceName}>
                      {humanizeEnum(row.sourceType)}
                    </span>
                  </Td>
                ) : null}
                <Td align="right">
                  <Value>{row.askingPrice == null ? null : formatCents(row.askingPrice)}</Value>
                </Td>
                <Td align="right">
                  <span className="text-ink-muted">
                    <Value>{row.allInBasis == null ? null : formatCents(row.allInBasis)}</Value>
                  </span>
                </Td>
                <Td align="right">
                  <Value>
                    {row.quickSaleValue == null ? null : formatCents(row.quickSaleValue)}
                  </Value>
                </Td>
                <Td align="right">
                  <span className={`num font-medium ${basisRatioTone(row.basisToQsv)}`}>
                    <Value>
                      {row.basisToQsv == null ? null : formatPercent(row.basisToQsv, 0)}
                    </Value>
                  </span>
                </Td>
                <Td align="right">
                  <span
                    className={`num ${
                      row.annualizedRoiAtQsv != null && row.annualizedRoiAtQsv > 0
                        ? 'text-good'
                        : 'text-ink-muted'
                    }`}
                  >
                    <Value>
                      {row.annualizedRoiAtQsv == null
                        ? null
                        : formatPercent(row.annualizedRoiAtQsv, 0)}
                    </Value>
                  </span>
                </Td>
                <Td align="right">
                  <span className="num text-ink-muted">
                    <Value>
                      {row.expectedHoldDays == null
                        ? null
                        : `${(row.expectedHoldDays / 30.4).toFixed(0)}mo`}
                    </Value>
                  </span>
                </Td>
                <Td align="center">
                  <span className={`num font-semibold ${accessTone(row.accessClass)}`}>
                    {row.accessClass ?? '—'}
                  </span>
                </Td>
                <Td align="center">
                  <span
                    className={`text-[10px] font-medium ${buildabilityTone(row.buildability)}`}
                    title={
                      row.buildability === 'GREEN'
                        ? 'Preliminary screening only — not a zoning determination or permit.'
                        : undefined
                    }
                  >
                    {row.buildability === 'GREEN' ? 'GREEN*' : (row.buildability ?? '—')}
                  </span>
                </Td>
                <Td align="right">
                  <span className={`num ${titleRiskTone(row.titleRiskScore)}`}>
                    <Value>
                      {row.titleRiskScore == null ? null : Math.round(row.titleRiskScore)}
                    </Value>
                  </span>
                </Td>
                <Td>
                  {deadline == null ? (
                    <span className="num text-[11px] text-ink-muted">
                      <Value>{null}</Value>
                    </span>
                  ) : (
                    <span
                      className={`num text-[11px] ${
                        deadlineState.state === 'PASSED'
                          ? 'text-bad'
                          : deadlineState.state === 'IMMINENT'
                            ? 'text-warn'
                            : 'text-ink-muted'
                      }`}
                      title={
                        deadlineState.state === 'PASSED'
                          ? 'The sale date has gone by. Whether this parcel sold, was withdrawn or went unsold is not known until the source is checked again.'
                          : undefined
                      }
                    >
                      {formatDate(deadline)}
                      {deadlineState.state === 'PASSED' ? (
                        <span className="ml-1 uppercase">· {deadlineState.label}</span>
                      ) : null}
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={statusTone(row.status)}>{humanizeEnum(row.status)}</Badge>
                </Td>
                <Td align="center">
                  {row.watchlisted ? <Eye className="size-3 text-info" /> : null}
                </Td>
              </Tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}
