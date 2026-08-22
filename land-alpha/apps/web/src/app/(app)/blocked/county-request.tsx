'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { recordPricesInBulkAction } from '../opportunities/[id]/actions';

/**
 * One county, one request, one paste.
 *
 * A county holds one list and answers one enquiry. Forty-six Orange County
 * parcels are waiting on a payoff figure from a single Comptroller's office;
 * the reply comes back as a list, and re-typing it one parcel page at a time
 * is where this work stops getting done.
 */
export function CountyRequest({
  state,
  county,
  references,
  acquisitionMethod,
  canAct,
}: {
  state: string;
  county: string;
  references: string[];
  acquisitionMethod: string | null;
  canAct: boolean;
}) {
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const referenceBlock = references.join('\n');

  const copy = (): void => {
    void navigator.clipboard?.writeText(referenceBlock).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  const submit = (): void => {
    startTransition(async () => {
      const result = await recordPricesInBulkAction(state, county, pasted);
      setMessage(result.message);
      setUnmatched(result.unmatched);
      if (result.applied > 0) setPasted('');
    });
  };

  return (
    <div className="space-y-3">
      {acquisitionMethod ? (
        <p className="text-[11px] leading-relaxed text-ink-muted">{acquisitionMethod}</p>
      ) : null}

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
            References to send ({references.length})
          </span>
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy list'}
          </Button>
        </div>
        <pre className="num mt-1 max-h-32 overflow-auto rounded-sm border border-line bg-surface p-2 text-[10px] leading-relaxed text-ink-muted">
          {referenceBlock}
        </pre>
      </div>

      {canAct ? (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
            Paste the reply
          </span>
          <Textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={5}
            placeholder={'2024-16234, 4275.00\n2022-9704_1\t3810\n2023-11190 $6,204.55'}
            disabled={pending}
            className="mt-1 font-mono text-[11px]"
          />
          <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
            One parcel per line: a reference and an amount, separated by anything. The amount is the
            last number on the line, so a reply pasted straight out of a spreadsheet or an email
            works without cleaning it up.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" variant="good" onClick={submit} disabled={pending || !pasted.trim()}>
              {pending ? 'Recording…' : 'Record prices'}
            </Button>
            {message ? <span className="text-[11px] text-ink-muted">{message}</span> : null}
          </div>
          {unmatched.length > 0 ? (
            <div className="mt-2 rounded-sm border border-warn/30 bg-warn/5 p-2">
              <p className="text-[10px] uppercase tracking-wide text-warn">Did not match</p>
              <pre className="num mt-1 max-h-24 overflow-auto text-[10px] text-ink-muted">
                {unmatched.join('\n')}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
