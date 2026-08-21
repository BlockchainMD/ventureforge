import { AlertTriangle } from 'lucide-react';
import { formatCents, formatPercent } from '@land-alpha/shared';
import type { AmortizationSchedule, FinanceComparison, FinanceTerms } from '@land-alpha/valuation';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { Metric, MetricGrid, Value } from '@/components/ui/value';

/**
 * The same parcel, sold two ways.
 *
 * Financing nearly always wins on nominal total and nearly always loses on how
 * long the capital is tied up, so the headline is the annualised comparison
 * rather than the bigger number.
 */
export function FinancingPanel({
  terms,
  schedule,
  comparison,
}: {
  terms: FinanceTerms;
  schedule: AmortizationSchedule;
  comparison: FinanceComparison;
}) {
  const tone =
    comparison.recommendation === 'FINANCE'
      ? 'good'
      : comparison.recommendation === 'CASH'
        ? 'info'
        : 'muted';

  return (
    <Panel>
      <PanelHeader
        title="Exit: cash or seller financing"
        subtitle="Financing raises the nominal total and widens the buyer pool; cash frees the capital to buy the next parcel."
        actions={<Badge tone={tone}>{comparison.recommendation}</Badge>}
      />
      <PanelBody className="space-y-3">
        <MetricGrid columns={4}>
          <Metric label="Cash proceeds" hint="Expected quick-sale price">
            {formatCents(comparison.cashProceedsCents)}
          </Metric>
          <Metric label="Financed nominal" hint="Deposit, fees and every scheduled payment">
            {formatCents(comparison.financedNominalCents)}
          </Metric>
          <Metric
            label="Nominal uplift"
            tone={comparison.upliftCents > 0 ? 'text-good' : 'text-bad'}
          >
            {formatPercent(comparison.upliftRatio, 0)}
          </Metric>
          <Metric label="Monthly payment">{formatCents(schedule.monthlyPaymentCents)}</Metric>
        </MetricGrid>

        <div className="grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <MetricGrid columns={2}>
            <Metric label="Financed IRR" hint="Annualised return of the payment stream">
              <Value>
                {comparison.financedIrr == null ? null : formatPercent(comparison.financedIrr, 0)}
              </Value>
            </Metric>
            <Metric
              label="Cash annualised"
              hint="Return per year of a cash sale at the expected hold"
            >
              <Value>
                {comparison.cashAnnualizedRoi == null
                  ? null
                  : formatPercent(comparison.cashAnnualizedRoi, 0)}
              </Value>
            </Metric>
          </MetricGrid>
          <MetricGrid columns={3}>
            <Metric label="Deposit">{formatCents(terms.downPaymentCents)}</Metric>
            <Metric label="Rate">{formatPercent(terms.annualRate, 1)}</Metric>
            <Metric label="Term">{terms.termMonths} mo</Metric>
          </MetricGrid>
        </div>

        <p className="border-t border-line pt-3 text-xs text-ink-muted">{comparison.rationale}</p>

        <div className="space-y-1">
          {comparison.warnings.map((warning) => (
            <p key={warning} className="flex gap-2 text-[11px] text-warn">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
          <p className="flex gap-2 text-[11px] text-ink-faint">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span>
              These are proposed terms, not legal advice. Seller-financed land sales sit outside
              most federal residential-mortgage rules, but that depends on the parcel, the
              buyer&rsquo;s intent and the state, and several states regulate land-contract
              forfeiture closely. Have any note reviewed before it is offered.
            </span>
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}
