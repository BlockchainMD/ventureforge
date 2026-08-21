'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { recordAcquisitionAction, recordBidOutcomeAction } from '../actions';

/**
 * Records what a human did. Land Alpha never bids, signs or wires — it keeps
 * the record straight afterwards so the outcome history is real.
 */
export function AcquisitionForm({ parcelId, canAct }: { parcelId: string; canAct: boolean }) {
  const [price, setPrice] = useState('');
  const [closing, setClosing] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canAct) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Field label="Price paid ($)">
          <Input type="number" value={price} onChange={(event) => setPrice(event.target.value)} />
        </Field>
        <Field label="Closing costs ($)">
          <Input
            type="number"
            value={closing}
            onChange={(event) => setClosing(event.target.value)}
          />
        </Field>
        <Field label="Acquired on">
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="good"
          disabled={pending || !price}
          onClick={() =>
            startTransition(async () => {
              const result = await recordAcquisitionAction(parcelId, {
                pricePaidDollars: Number(price),
                closingCostsDollars: Number(closing || 0),
                acquiredOn: date,
              });
              setMessage(result.message);
            })
          }
        >
          Record acquisition
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await recordBidOutcomeAction(
                parcelId,
                'LOST',
                price ? Number(price) : null,
              );
              setMessage(result.message);
            })
          }
        >
          Record as lost
        </Button>
        {message ? <span className="text-[11px] text-good">{message}</span> : null}
      </div>

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Recording an outcome here does not transact. It captures what happened so the portfolio and
        the outcome history reflect reality — which is what eventually makes it possible to learn
        which counties and mechanisms actually produce returns.
      </p>
    </div>
  );
}
