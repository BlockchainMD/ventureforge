'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FileText, Megaphone } from 'lucide-react';
import { formatDateTime } from '@land-alpha/shared';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { generateListingAction, generateMemoAction, setListingPublishedAction } from './actions';

export interface MemoView {
  version: number;
  provider: string;
  model: string;
  recommendation: string;
  createdAt: Date;
  sections: Record<string, string>;
  unknowns: string[];
}

export function MemoPanel({
  parcelId,
  memo,
  canAct,
}: {
  parcelId: string;
  memo: MemoView | null;
  canAct: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Panel>
      <PanelHeader
        title="AI investment memo"
        subtitle={
          memo
            ? `v${memo.version} · ${memo.provider}/${memo.model} · ${formatDateTime(memo.createdAt)}`
            : 'Not yet generated'
        }
        actions={
          canAct ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await generateMemoAction(parcelId);
                  setMessage(result.message);
                })
              }
            >
              <FileText className="size-3" />
              {memo ? 'Regenerate' : 'Generate'}
            </Button>
          ) : null
        }
      />
      <PanelBody className="space-y-3">
        {message ? <p className="text-[11px] text-good">{message}</p> : null}

        {!memo ? (
          <p className="text-xs text-ink-faint">
            The memo is assembled from the evidence and engine outputs on this page. It never
            introduces a figure the pipeline did not establish, and anything unknown is carried
            through as “UNKNOWN — verification required”.
          </p>
        ) : (
          <>
            <p className="text-xs font-medium text-alpha">{memo.recommendation}</p>
            {Object.entries(memo.sections).map(([heading, body]) =>
              body?.trim() ? (
                <div key={heading}>
                  <p className="rule-label">{heading}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
                    {body}
                  </p>
                </div>
              ) : null,
            )}
            {memo.unknowns.length > 0 ? (
              <div className="border-t border-line pt-2">
                <p className="rule-label text-warn">Unknowns carried into the memo</p>
                <ul className="mt-1 space-y-0.5">
                  {memo.unknowns.map((unknown) => (
                    <li key={unknown} className="text-[11px] text-ink-faint">
                      {unknown}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}

export function ListingPanel({
  parcelId,
  slug,
  title,
  published,
  withheldClaims,
  canAct,
}: {
  parcelId: string;
  slug: string | null;
  title: string | null;
  published: boolean;
  withheldClaims: string[];
  canAct: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Panel>
      <PanelHeader
        title="Listing"
        subtitle={title ?? 'No marketing package generated'}
        actions={
          canAct ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await generateListingAction(parcelId);
                    setMessage(result.message);
                  })
                }
              >
                <Megaphone className="size-3" />
                {title ? 'Regenerate' : 'Generate'}
              </Button>
              {title ? (
                <Button
                  size="sm"
                  variant={published ? 'ghost' : 'good'}
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await setListingPublishedAction(parcelId, !published);
                      setMessage(result.message);
                    })
                  }
                >
                  {published ? 'Unpublish' : 'Publish'}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      <PanelBody className="space-y-2">
        {message ? <p className="text-[11px] text-good">{message}</p> : null}

        {slug ? (
          <div className="flex items-center gap-2">
            <Badge tone={published ? 'good' : 'muted'}>{published ? 'published' : 'draft'}</Badge>
            <Link href={`/properties/${slug}`} className="text-[11px] text-info hover:underline">
              /properties/{slug}
            </Link>
          </div>
        ) : (
          <p className="text-xs text-ink-faint">
            The listing is generated from verified public facts only. Internal underwriting is not
            passed to the generator, so it cannot appear on a public page.
          </p>
        )}

        {withheldClaims.length > 0 ? (
          <div className="border-t border-line pt-2">
            <p className="rule-label text-warn">Claims withheld as unsupported</p>
            <ul className="mt-1 space-y-0.5">
              {withheldClaims.map((claim) => (
                <li key={claim} className="text-[10px] leading-relaxed text-ink-faint">
                  {claim}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
