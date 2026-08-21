import Link from 'next/link';
import {
  formatAcres,
  formatCents,
  formatPercent,
  humanizeEnum,
  type AccessClass,
  type BuildabilityRating,
  type ConfidenceLevel,
} from '@land-alpha/shared';
import { Badge } from '@/components/ui/badge';
import { Value } from '@/components/ui/value';
import {
  accessTone,
  alphaScoreTone,
  basisRatioTone,
  buildabilityTone,
  confidenceTone,
  tierTone,
  titleRiskTone,
} from '@/lib/utils';

/**
 * The Land Alpha decision card.
 *
 * The single most important element in the product: everything needed to
 * decide *whether to spend more time on this parcel* in one glance, with the
 * unanswered questions given the same visual weight as the attractions.
 *
 * The asterisk on a GREEN buildability rating is not decorative — it is a
 * required disclaimer, and it is rendered inline where the rating is read
 * rather than buried in a footnote.
 */
export function DecisionCard({
  parcel,
  actions,
}: {
  parcel: {
    id: string;
    state: string;
    county: string;
    apn: string | null;
    acreage: number | null;
    alphaScore: number | null;
    confidenceLevel: ConfidenceLevel;
    acquisitionPriceCents: number | null;
    allInBasisCents: number | null;
    quickSaleValueCents: number | null;
    retailValueCents: number | null;
    basisToQsv: number | null;
    grossProfitCents: number | null;
    roiAtQsv: number | null;
    accessClass: AccessClass;
    buildability: BuildabilityRating;
    titleRiskScore: number | null;
    environmentalRiskScore: number | null;
    valuationConfidence: ConfidenceLevel;
    economicsTier: string | null;
    whyInteresting: string[];
    remainingQuestions: string[];
    recommendedMaxBidCents: number | null;
    rejected: boolean;
    rejectionReasons: { rule: string; explanation: string; overridable: boolean }[];
  };
  actions?: React.ReactNode;
}) {
  return (
    <section className="panel rounded-sm">
      <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="num text-[10px] uppercase tracking-widest text-ink-faint">
              Land Alpha
            </span>
            <span className="text-sm text-ink">
              {parcel.county} County, {parcel.state}
            </span>
          </div>
          <p className="num mt-0.5 text-xs text-ink-muted">
            APN <Value>{parcel.apn}</Value>
            <span className="mx-2 text-line-strong">·</span>
            <Value>{parcel.acreage == null ? null : formatAcres(parcel.acreage)}</Value>
          </p>
        </div>
        <div className="text-right">
          <p className="rule-label">Score</p>
          <p
            className={`num text-3xl font-semibold leading-none ${alphaScoreTone(parcel.alphaScore)}`}
          >
            <Value>{parcel.alphaScore == null ? null : Math.round(parcel.alphaScore)}</Value>
          </p>
          <p
            className={`mt-1 text-[10px] uppercase tracking-wider ${confidenceTone(parcel.confidenceLevel)}`}
          >
            {parcel.confidenceLevel} confidence
          </p>
        </div>
      </header>

      {parcel.rejected ? (
        <div className="border-b border-bad/30 bg-bad/10 px-4 py-2">
          <p className="text-xs font-medium text-bad">
            Rejected by the screening rules — not an acquisition candidate.
          </p>
          <ul className="mt-1 space-y-0.5">
            {parcel.rejectionReasons.map((reason) => (
              <li key={reason.rule} className="text-[11px] text-bad/90">
                <span className="num uppercase">{reason.rule.replace(/_/g, ' ')}</span> —{' '}
                {reason.explanation}
                {reason.overridable ? (
                  <span className="ml-1 text-ink-faint">(analyst override available)</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {/* --- Economics ---------------------------------------------------- */}
        <div className="px-4 py-3">
          <Row label="County price" value={formatCents(parcel.acquisitionPriceCents)} />
          <Row
            label="Est. all-in basis"
            value={formatCents(parcel.allInBasisCents)}
            tone="text-ink-muted"
          />
          <Row label="Quick sale value" value={formatCents(parcel.quickSaleValueCents)} />
          <Row
            label="Retail value"
            value={formatCents(parcel.retailValueCents)}
            tone="text-ink-muted"
          />
          <div className="my-2 border-t border-line" />
          <Row
            label="Basis / QSV"
            value={parcel.basisToQsv == null ? null : formatPercent(parcel.basisToQsv, 1)}
            tone={basisRatioTone(parcel.basisToQsv)}
            emphasis
          />
          <Row
            label="Potential gross profit"
            value={formatCents(parcel.grossProfitCents)}
            tone={
              parcel.grossProfitCents != null && parcel.grossProfitCents > 0
                ? 'text-good'
                : 'text-bad'
            }
          />
          <Row
            label="ROI at QSV"
            value={parcel.roiAtQsv == null ? null : formatPercent(parcel.roiAtQsv, 0)}
            tone={parcel.roiAtQsv != null && parcel.roiAtQsv > 0 ? 'text-good' : 'text-bad'}
          />
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="rule-label">Recommendation</span>
            <span className={`num text-xs font-semibold ${tierTone(parcel.economicsTier)}`}>
              {parcel.rejected
                ? 'REJECT'
                : parcel.economicsTier === 'EXCEPTIONAL'
                  ? 'STRONG BUY CANDIDATE'
                  : parcel.economicsTier === 'STRONG'
                    ? 'BUY CANDIDATE'
                    : parcel.economicsTier === 'POTENTIAL'
                      ? 'WORTH REVIEW'
                      : parcel.economicsTier === 'WEAK'
                        ? 'PASS'
                        : 'INSUFFICIENT DATA'}
            </span>
          </div>
        </div>

        {/* --- Risk profile ------------------------------------------------- */}
        <div className="px-4 py-3">
          <Row
            label="Access"
            value={parcel.accessClass === 'UNKNOWN' ? null : parcel.accessClass}
            tone={accessTone(parcel.accessClass)}
            emphasis
          />
          <Row
            label="Buildability"
            value={
              parcel.buildability === 'UNKNOWN' ? null : (
                <>
                  {parcel.buildability}
                  {parcel.buildability === 'GREEN' ? (
                    <span className="text-ink-faint">*</span>
                  ) : null}
                </>
              )
            }
            tone={buildabilityTone(parcel.buildability)}
          />
          <Row
            label="Title risk"
            value={
              parcel.titleRiskScore == null ? null : `${Math.round(parcel.titleRiskScore)} / 100`
            }
            tone={titleRiskTone(parcel.titleRiskScore)}
          />
          <Row
            label="Environmental risk"
            value={
              parcel.environmentalRiskScore == null
                ? null
                : parcel.environmentalRiskScore <= 15
                  ? 'LOW'
                  : parcel.environmentalRiskScore <= 40
                    ? 'MODERATE'
                    : parcel.environmentalRiskScore <= 65
                      ? 'ELEVATED'
                      : 'HIGH'
            }
            tone={
              parcel.environmentalRiskScore == null
                ? undefined
                : parcel.environmentalRiskScore <= 15
                  ? 'text-good'
                  : parcel.environmentalRiskScore <= 40
                    ? 'text-warn'
                    : 'text-bad'
            }
          />
          <Row
            label="Valuation confidence"
            value={parcel.valuationConfidence}
            tone={confidenceTone(parcel.valuationConfidence)}
          />
          <div className="mt-2 border-t border-line pt-2">
            <Row
              label="Recommended maximum bid"
              value={formatCents(parcel.recommendedMaxBidCents)}
              tone="text-alpha"
              emphasis
            />
            <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
              The bid at which the all-in basis still lands inside the target basis/QSV ratio. Not
              an instruction to bid.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="px-4 py-3">
          <p className="rule-label mb-1.5">Why interesting</p>
          {parcel.whyInteresting.length === 0 ? (
            <p className="text-xs text-ink-faint">Nothing distinguishing identified.</p>
          ) : (
            <ul className="space-y-1">
              {parcel.whyInteresting.map((point) => (
                <li key={point} className="flex gap-1.5 text-xs text-ink-muted">
                  <span className="text-good">•</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="px-4 py-3">
          <p className="rule-label mb-1.5">Remaining questions</p>
          {parcel.remainingQuestions.length === 0 ? (
            <p className="text-xs text-ink-faint">None recorded.</p>
          ) : (
            <ul className="space-y-1">
              {parcel.remainingQuestions.map((question) => (
                <li key={question} className="flex gap-1.5 text-xs text-ink-muted">
                  <span className="text-warn">?</span>
                  <span>{question}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {actions ? (
        <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
          <p className="text-[10px] leading-relaxed text-ink-faint">
            <span className="text-ink-muted">*</span> Buildability is a preliminary screening
            conclusion, not a zoning determination, permit or septic approval. Land Alpha never
            submits a bid or binds a purchase — every acquisition step requires explicit human
            action.
          </p>
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </footer>
      ) : null}
    </section>
  );
}

function Row({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="rule-label">{label}</span>
      <span className={`num ${emphasis ? 'text-sm font-semibold' : 'text-xs'} ${tone ?? ''}`}>
        <Value>{value}</Value>
      </span>
    </div>
  );
}

export function ParcelBreadcrumb({ county, state }: { county: string; state: string }) {
  return (
    <nav className="flex items-center gap-1 text-[11px] text-ink-faint">
      <Link href="/opportunities" className="hover:text-alpha">
        Opportunities
      </Link>
      <span>/</span>
      <span className="text-ink-muted">
        {county} {humanizeEnum(state)}
      </span>
    </nav>
  );
}

export { Badge };
