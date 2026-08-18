'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff, RefreshCw, ShieldAlert, ThumbsDown, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  approveMaxBidAction,
  overrideRejectionAction,
  refreshParcelAction,
  setDispositionAction,
  startDueDiligenceAction,
  toggleWatchlistAction,
} from './actions';

export function ParcelActions({
  parcelId,
  watchlisted,
  hasDeal,
  canAct,
}: {
  parcelId: string;
  watchlisted: boolean;
  hasDeal: boolean;
  canAct: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!canAct) {
    return <span className="text-[11px] text-ink-faint">Read-only access</span>;
  }

  const run = (fn: () => Promise<{ ok: boolean; message: string }>): void => {
    startTransition(async () => {
      const result = await fn();
      setMessage(result.message);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      {message ? <span className="mr-1 text-[11px] text-good">{message}</span> : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => refreshParcelAction(parcelId))}
      >
        <RefreshCw className="size-3" />
        Re-score
      </Button>
      <Button
        size="sm"
        disabled={pending}
        onClick={() => run(() => toggleWatchlistAction(parcelId))}
      >
        {watchlisted ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
        {watchlisted ? 'Unwatch' : 'Watch'}
      </Button>
      <Button
        size="sm"
        variant="danger"
        disabled={pending}
        onClick={() => run(() => setDispositionAction(parcelId, 'PASS'))}
      >
        <ThumbsDown className="size-3" />
        Reject
      </Button>
      <Button
        size="sm"
        variant="default"
        disabled={pending || hasDeal}
        onClick={() => run(() => startDueDiligenceAction(parcelId))}
      >
        <ClipboardCheck className="size-3" />
        {hasDeal ? 'In due diligence' : 'Start due diligence'}
      </Button>
    </div>
  );
}

/**
 * Maximum-bid approval.
 *
 * The confirmation step is not friction for its own sake: it is the point at
 * which a human, not the system, takes responsibility for a number. Above
 * $25,000 the checklist acknowledgement is mandatory and enforced server-side.
 */
export function MaxBidControl({
  parcelId,
  recommendedDollars,
  approvedDollars,
  canAct,
}: {
  parcelId: string;
  recommendedDollars: number | null;
  approvedDollars: number | null;
  canAct: boolean;
}) {
  const [value, setValue] = useState(
    approvedDollars != null
      ? String(approvedDollars)
      : recommendedDollars != null
        ? String(recommendedDollars)
        : '',
  );
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = Number(value);
  const highValue = Number.isFinite(amount) && amount >= 25_000;

  if (!canAct) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="block w-40">
          <span className="rule-label">Approve maximum bid ($)</span>
          <Input
            className="mt-0.5"
            type="number"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={recommendedDollars != null ? String(recommendedDollars) : '0'}
          />
        </label>
        <Button
          size="default"
          variant="default"
          disabled={
            pending || !Number.isFinite(amount) || amount <= 0 || (highValue && !acknowledged)
          }
          onClick={() =>
            startTransition(async () => {
              const result = await approveMaxBidAction(parcelId, amount, acknowledged);
              setMessage(result.message);
            })
          }
        >
          Record approval
        </Button>
      </div>

      {highValue ? (
        <label className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/5 px-2 py-1.5">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span className="text-[11px] leading-relaxed text-warn">
            I confirm the due-diligence checklist has been reviewed for this parcel, including legal
            access, title and environmental items, and that Land Alpha’s outputs are screening
            conclusions rather than professional determinations.
          </span>
        </label>
      ) : null}

      {message ? <p className="text-[11px] text-good">{message}</p> : null}

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Recording an approval does not place a bid. Land Alpha never submits bids, signs purchase
        agreements, wires funds or accepts a government auction on your behalf.
      </p>
    </div>
  );
}

export function RejectionOverride({ parcelId, rule }: { parcelId: string; rule: string }) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-2 flex items-end gap-2">
      <label className="block flex-1">
        <span className="rule-label">Override reason (recorded and audited)</span>
        <Input
          className="mt-0.5"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this rule wrong for this parcel?"
        />
      </label>
      <Button
        size="default"
        variant="danger"
        disabled={pending || reason.trim().length < 12}
        onClick={() =>
          startTransition(async () => {
            const result = await overrideRejectionAction(parcelId, rule, reason);
            setMessage(result.message);
          })
        }
      >
        <ShieldAlert className="size-3" />
        Override
      </Button>
      {message ? <span className="pb-1.5 text-[11px] text-warn">{message}</span> : null}
    </div>
  );
}
