'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setAcquisitionPriceAction } from './actions';

/**
 * Entering the payoff figure.
 *
 * This is the single field standing between a valued parcel and a rankable
 * one. Tax-deed inventory is published without a price, so until an analyst
 * obtains it there is no spread to compute — the panel says so rather than
 * showing a basis that quietly omits the largest number in it.
 */
export function AcquisitionPriceControl({
  parcelId,
  currentDollars,
  acquisitionUrl,
  canAct,
}: {
  parcelId: string;
  currentDollars: number | null;
  acquisitionUrl: string | null;
  canAct: boolean;
}) {
  const [value, setValue] = useState(currentDollars == null ? '' : String(currentDollars));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    startTransition(async () => {
      const result = await setAcquisitionPriceAction(parcelId, value, note);
      setMessage(result.message);
      if (result.ok) setNote('');
    });
  };

  if (!canAct) {
    return (
      <p className="text-xs text-ink-muted">
        {currentDollars == null
          ? 'No acquisition price has been obtained for this parcel.'
          : `Acquisition price $${currentDollars.toLocaleString('en-US')}.`}
      </p>
    );
  }

  return (
    <div>
      {currentDollars == null ? (
        <p className="mb-2 rounded-sm border border-warn/30 bg-warn/5 px-2 py-1.5 text-[11px] leading-relaxed text-ink-muted">
          No price is published for this parcel, so no return, margin or acquisition tier can be
          computed. The basis shown elsewhere is a floor covering closing and carrying costs only.
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <label className="block flex-1">
          <span className="text-[10px] text-ink-faint">Acquisition price (USD)</span>
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="4,275"
            inputMode="decimal"
            disabled={pending}
          />
        </label>
        <Button size="sm" variant="good" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <label className="mt-2 block">
        <span className="text-[10px] text-ink-faint">Where it came from</span>
        <Input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Comptroller payoff quote, 22 Aug"
          disabled={pending}
        />
      </label>

      {acquisitionUrl ? (
        <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{acquisitionUrl}</p>
      ) : null}
      {message ? <p className="mt-2 text-[11px] text-ink-muted">{message}</p> : null}
    </div>
  );
}
