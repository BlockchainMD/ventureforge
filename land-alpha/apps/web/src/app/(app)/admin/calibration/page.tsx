import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { runCalibration } from '@land-alpha/core';
import { formatNumber, formatPercent } from '@land-alpha/shared';
import { PageHeader } from '@/components/layout/shell';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Badge } from '@/components/ui/badge';
import { DataTable, EmptyRow, Td, Th, Thead, Tr } from '@/components/ui/table';
import { Metric, MetricGrid, Value } from '@/components/ui/value';

export const metadata = { title: 'Calibration — Land Alpha' };
export const dynamic = 'force-dynamic';

/**
 * Is the model right?
 *
 * Every other screen shows what the engine predicts. This one shows whether
 * those predictions have held up, which is the only screen that can tell you
 * the engine is wrong.
 */
export default async function CalibrationPage() {
  const report = await runCalibration({ apply: false });
  const { overall } = report;

  const ratioTone = (ratio: number | null): string | undefined => {
    if (ratio == null) return undefined;
    if (ratio >= 0.95 && ratio <= 1.05) return 'text-good';
    return Math.abs(1 - ratio) > 0.2 ? 'text-bad' : 'text-warn';
  };

  return (
    <>
      <PageHeader
        title="Model calibration"
        subtitle="What the engine predicted, against what parcels actually sold for and how long they took."
        actions={
          <Badge tone={report.confidence === 'UNKNOWN' ? 'bad' : 'muted'}>
            {report.confidence}
          </Badge>
        }
      />

      <div className="space-y-3 p-3 sm:p-4">
        <Panel>
          <PanelBody>
            <MetricGrid columns={4}>
              <Metric
                label="Closed sales examined"
                hint="Parcels bought and sold, fixtures excluded"
              >
                {formatNumber(report.generatedFrom)}
              </Metric>
              <Metric
                label="Realised ÷ predicted value"
                hint="Above 1 means parcels sold for more than the engine expected"
                tone={ratioTone(overall.valueRatio)}
              >
                <Value>
                  {overall.valueRatio == null ? null : `${overall.valueRatio.toFixed(2)}×`}
                </Value>
              </Metric>
              <Metric
                label="Realised ÷ estimated hold"
                hint="Above 1 means parcels took longer to sell than estimated"
                tone={ratioTone(overall.holdRatio)}
              >
                <Value>
                  {overall.holdRatio == null ? null : `${overall.holdRatio.toFixed(2)}×`}
                </Value>
              </Metric>
              <Metric
                label="Markets corrected"
                hint="Markets with enough closed sales to justify a correction"
              >
                {formatNumber(Object.keys(report.valueCalibration).length)}
              </Metric>
            </MetricGrid>
          </PanelBody>
        </Panel>

        {report.warnings.length > 0 ? (
          <Panel className="border-warn/40">
            <PanelBody className="space-y-1.5">
              {report.warnings.map((warning) => (
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
            title="By market"
            subtitle="A correction is applied only where enough parcels have sold to support it. Below that threshold the observation is reported and ignored."
          />
          <DataTable>
            <Thead>
              <Tr>
                <Th>Market</Th>
                <Th align="right">Closed sales</Th>
                <Th align="right">Value ratio</Th>
                <Th align="right">Hold ratio</Th>
                <Th align="right">Spread</Th>
                <Th align="center">Applied</Th>
                <Th>What it means</Th>
              </Tr>
            </Thead>
            <tbody>
              {report.groups.length === 0 ? (
                <EmptyRow colSpan={7}>
                  Nothing has been bought and sold yet, so no prediction has been checked.
                </EmptyRow>
              ) : (
                report.groups.map((group) => (
                  <Tr key={group.key}>
                    <Td className="font-medium text-ink">{group.key}</Td>
                    <Td align="right" className="num">
                      {formatNumber(group.sampleSize)}
                    </Td>
                    <Td align="right" className={`num ${ratioTone(group.valueRatio) ?? ''}`}>
                      <Value>
                        {group.valueRatio == null ? null : `${group.valueRatio.toFixed(2)}×`}
                      </Value>
                    </Td>
                    <Td align="right" className={`num ${ratioTone(group.holdRatio) ?? ''}`}>
                      <Value>
                        {group.holdRatio == null ? null : `${group.holdRatio.toFixed(2)}×`}
                      </Value>
                    </Td>
                    <Td align="right" className="num text-ink-muted">
                      <Value>
                        {group.valueDispersion == null
                          ? null
                          : formatPercent(group.valueDispersion, 0)}
                      </Value>
                    </Td>
                    <Td align="center">
                      {group.applied ? (
                        <CheckCircle2 className="mx-auto size-3.5 text-good" />
                      ) : (
                        <span className="text-[10px] text-ink-faint">held</span>
                      )}
                    </Td>
                    <Td className="whitespace-normal text-ink-muted">{group.note}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
        </Panel>

        <p className="text-[11px] text-ink-faint">
          Predictions are graded against the valuation in force when the parcel was acquired, not
          the latest one — a later valuation has the benefit of sales recorded after the purchase.
          Run <code className="num text-ink-muted">pnpm calibrate --apply</code> to write these
          corrections into a new scoring config version.
        </p>
      </div>
    </>
  );
}
