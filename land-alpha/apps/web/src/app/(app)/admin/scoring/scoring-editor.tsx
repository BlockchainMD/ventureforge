'use client';

import { useState, useTransition } from 'react';
import type {
  CostModel,
  RejectionRuleConfig,
  ScoringConfigValue,
  ScoringThresholds,
  ScoringWeights,
} from '@land-alpha/shared';
import { formatPercent } from '@land-alpha/shared';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { rescoreAllAction, saveScoringConfigAction } from './actions';

const WEIGHT_LABELS: { key: keyof ScoringWeights; label: string; rationale: string }[] = [
  {
    key: 'discountToQsv',
    label: 'Discount to quick-sale value',
    rationale: 'The core of the thesis: what you pay against what it conservatively sells for.',
  },
  {
    key: 'access',
    label: 'Access',
    rationale: 'The difference between a $26,000 parcel and a $2,000 one.',
  },
  {
    key: 'buildability',
    label: 'Buildability',
    rationale: 'Whether the most likely buyer can do anything with it.',
  },
  {
    key: 'titleSimplicity',
    label: 'Title simplicity',
    rationale: 'Curative work is cost and delay, and sometimes a dead end.',
  },
  {
    key: 'liquidity',
    label: 'Liquidity',
    rationale: 'How readily it resells, and to how many buyers.',
  },
  {
    key: 'carryingCost',
    label: 'Carrying cost',
    rationale: 'Taxes and capital cost over the hold.',
  },
  {
    key: 'shape',
    label: 'Shape and topography',
    rationale: 'Whether the geometry is usable at all.',
  },
  {
    key: 'desirability',
    label: 'Unique desirability',
    rationale:
      'Failed auctions, stale inventory, standing OTC stock — where competition is absent.',
  },
];

export function ScoringEditor({
  config,
  canEdit,
}: {
  config: ScoringConfigValue;
  canEdit: boolean;
}) {
  const [weights, setWeights] = useState<ScoringWeights>(config.weights);
  const [thresholds, setThresholds] = useState<ScoringThresholds>(config.thresholds);
  const [costModel, setCostModel] = useState<CostModel>(config.costModel);
  const [rules, setRules] = useState<RejectionRuleConfig[]>(config.rejectionRules);
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sum = Object.values(weights).reduce((total, value) => total + value, 0);
  const balanced = Math.abs(sum - 1) < 1e-6;

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="col-span-2 space-y-3">
        <Panel>
          <PanelHeader
            title="Alpha Score weights"
            subtitle="Must sum to 1.00. Saving creates a new immutable version rather than editing this one."
            actions={<Badge tone={balanced ? 'good' : 'bad'}>sum {sum.toFixed(3)}</Badge>}
          />
          <PanelBody className="space-y-2">
            {WEIGHT_LABELS.map(({ key, label, rationale }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-56 shrink-0">
                  <p className="text-xs text-ink">{label}</p>
                  <p className="text-[10px] leading-tight text-ink-faint">{rationale}</p>
                </div>
                <input
                  type="range"
                  min={0}
                  max={0.6}
                  step={0.01}
                  disabled={!canEdit}
                  value={weights[key]}
                  onChange={(event) =>
                    setWeights({ ...weights, [key]: Number(event.target.value) })
                  }
                  className="flex-1 accent-[var(--color-alpha)]"
                />
                <span className="num w-12 text-right text-xs text-alpha">
                  {formatPercent(weights[key], 0)}
                </span>
              </div>
            ))}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Rejection rules"
            subtitle="These remove parcels from the funnel entirely. Analyst attention is the scarce resource, not inventory."
          />
          <PanelBody className="space-y-1.5">
            {rules.map((rule, index) => (
              <div key={rule.key} className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={rule.enabled}
                    onChange={(event) => {
                      const next = [...rules];
                      next[index] = { ...rule, enabled: event.target.checked };
                      setRules(next);
                    }}
                  />
                  <span className="num text-[11px] text-ink">{rule.key.replace(/_/g, ' ')}</span>
                </label>
                <div className="flex items-center gap-2">
                  {rule.params
                    ? Object.entries(rule.params).map(([name, value]) => (
                        <span key={name} className="num text-[10px] text-ink-faint">
                          {name}={String(value)}
                        </span>
                      ))
                    : null}
                  <Badge tone={rule.overridable ? 'muted' : 'bad'}>
                    {rule.overridable ? 'overridable' : 'absolute'}
                  </Badge>
                </div>
              </div>
            ))}
          </PanelBody>
        </Panel>

        {canEdit ? (
          <Panel>
            <PanelBody className="space-y-2">
              <Field
                label="What changed and why"
                hint="Recorded against this configuration version."
              >
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. increased access weight after two landlocked acquisitions underperformed"
                />
              </Field>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  disabled={pending || !balanced}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await saveScoringConfigAction({
                        weights,
                        thresholds,
                        costModel,
                        rejectionRules: rules,
                        description,
                      });
                      setMessage(result.message);
                    })
                  }
                >
                  Save as new version
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await rescoreAllAction();
                      setMessage(result.message);
                    })
                  }
                >
                  Re-score all inventory
                </Button>
                {message ? <span className="text-[11px] text-good">{message}</span> : null}
              </div>
            </PanelBody>
          </Panel>
        ) : null}
      </div>

      <div className="space-y-3">
        <Panel>
          <PanelHeader title="Acquisition tiers" subtitle="All-in basis as a fraction of QSV" />
          <PanelBody className="space-y-2">
            <NumberField
              label="Exceptional ≤"
              value={thresholds.exceptionalBasisToQsv}
              disabled={!canEdit}
              onChange={(value) => setThresholds({ ...thresholds, exceptionalBasisToQsv: value })}
            />
            <NumberField
              label="Strong ≤"
              value={thresholds.strongBasisToQsv}
              disabled={!canEdit}
              onChange={(value) => setThresholds({ ...thresholds, strongBasisToQsv: value })}
            />
            <NumberField
              label="Potential ≤"
              value={thresholds.potentialBasisToQsv}
              disabled={!canEdit}
              onChange={(value) => setThresholds({ ...thresholds, potentialBasisToQsv: value })}
            />
            <NumberField
              label="Minimum acreage"
              value={thresholds.minAcreage}
              disabled={!canEdit}
              onChange={(value) => setThresholds({ ...thresholds, minAcreage: value })}
            />
            <NumberField
              label="Alert at Alpha ≥"
              value={thresholds.minAlphaForAlert}
              step={1}
              disabled={!canEdit}
              onChange={(value) => setThresholds({ ...thresholds, minAlphaForAlert: value })}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Cost model" subtitle="Used to build the all-in basis" />
          <PanelBody className="space-y-2">
            <NumberField
              label="Recording cost ($)"
              value={costModel.recordingCostCents / 100}
              step={5}
              disabled={!canEdit}
              onChange={(value) =>
                setCostModel({ ...costModel, recordingCostCents: Math.round(value * 100) })
              }
            />
            <NumberField
              label="Title cost ($)"
              value={costModel.titleCostCents / 100}
              step={25}
              disabled={!canEdit}
              onChange={(value) =>
                setCostModel({ ...costModel, titleCostCents: Math.round(value * 100) })
              }
            />
            <NumberField
              label="Marketing rate"
              value={costModel.marketingCostRate}
              disabled={!canEdit}
              onChange={(value) => setCostModel({ ...costModel, marketingCostRate: value })}
            />
            <NumberField
              label="Annual carry rate"
              value={costModel.annualCarryRate}
              disabled={!canEdit}
              onChange={(value) => setCostModel({ ...costModel, annualCarryRate: value })}
            />
            <NumberField
              label="Expected hold (days)"
              value={costModel.expectedHoldDays}
              step={15}
              disabled={!canEdit}
              onChange={(value) => setCostModel({ ...costModel, expectedHoldDays: value })}
            />
            <NumberField
              label="QSV discount from retail"
              value={costModel.quickSaleDiscountFromRetail}
              disabled={!canEdit}
              onChange={(value) =>
                setCostModel({ ...costModel, quickSaleDiscountFromRetail: value })
              }
            />
            <NumberField
              label="ILV discount from retail"
              value={costModel.investorLiquidationDiscountFromRetail}
              disabled={!canEdit}
              onChange={(value) =>
                setCostModel({ ...costModel, investorLiquidationDiscountFromRetail: value })
              }
            />
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 0.01,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="rule-label">{label}</span>
      <Input
        type="number"
        step={step}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-24 text-right"
      />
    </div>
  );
}
