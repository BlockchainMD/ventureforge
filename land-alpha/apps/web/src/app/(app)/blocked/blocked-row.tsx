'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setAcquisitionPriceAction } from '../opportunities/[id]/actions';

/**
 * One parcel, one field.
 *
 * The row is the whole interaction: read the value and the bid ceiling, ring
 * the county, type the figure, move to the next line. Sending the analyst to a
 * detail page and back for each of fifty-five parcels is how a queue like this
 * stops being worked.
 */
export function BlockedRow({
  parcelId,
  apn,
  location,
  acreage,
  accessClass,
  quickSaleValue,
  maxBid,
  reference,
  canAct,
}: {
  parcelId: string;
  apn: string;
  location: string;
  acreage: string | null;
  accessClass: string;
  quickSaleValue: string;
  maxBid: string;
  reference: string | null;
  canAct: boolean;
}) {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (): void => {
    if (!value.trim()) return;
    startTransition(async () => {
      const result = await setAcquisitionPriceAction(parcelId, value, 'Entered from the worklist');
      if (result.ok) {
        setSaved(value);
        setError(null);
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <tr className={saved ? 'border-b border-line/60 opacity-50' : 'border-b border-line/60'}>
      <td className="px-3 py-1.5">
        <Link href={`/opportunities/${parcelId}`} className="num text-alpha hover:underline">
          {apn}
        </Link>
        <span className="ml-2 text-[10px] text-ink-faint">{location}</span>
      </td>
      <td className="num px-3 py-1.5 text-ink-muted">{acreage ?? '—'}</td>
      {/* A landlocked parcel is worth a call only if the value is large enough
          to survive an exit that runs through the neighbour. Saying so here
          stops the call being spent finding that out. */}
      <td
        className={
          accessClass === 'D'
            ? 'num px-3 py-1.5 text-bad'
            : accessClass === 'UNKNOWN'
              ? 'num px-3 py-1.5 text-ink-faint'
              : 'num px-3 py-1.5 text-ink-muted'
        }
        title={accessClass === 'D' ? 'Appears landlocked' : undefined}
      >
        {accessClass === 'UNKNOWN' ? '—' : accessClass}
      </td>
      <td className="num px-3 py-1.5 text-ink">{quickSaleValue}</td>
      <td className="num px-3 py-1.5 text-good">{maxBid}</td>
      <td className="num px-3 py-1.5 text-[10px] text-ink-faint">{reference ?? '—'}</td>
      <td className="px-3 py-1.5">
        {saved ? (
          <span className="text-[11px] text-good">Recorded {saved}</span>
        ) : canAct ? (
          <div className="flex items-center gap-1">
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
              placeholder="4,275"
              inputMode="decimal"
              disabled={pending}
              className="h-6 w-24"
            />
            <Button size="sm" variant="good" onClick={submit} disabled={pending || !value.trim()}>
              {pending ? '…' : 'Save'}
            </Button>
            {error ? <span className="text-[10px] text-bad">{error}</span> : null}
          </div>
        ) : (
          <span className="text-[10px] text-ink-faint">Read-only</span>
        )}
      </td>
    </tr>
  );
}
