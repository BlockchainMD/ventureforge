'use client';

import { useState, useTransition } from 'react';
import { Check, Circle, Minus, Loader2 } from 'lucide-react';
import { formatDateTime } from '@land-alpha/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { setChecklistItemAction } from '../actions';

type Status = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'NOT_APPLICABLE';

export interface ChecklistRow {
  id: string;
  key: string;
  label: string;
  category: string;
  required: boolean;
  status: string;
  findings: string | null;
  completedAt: Date | null;
  guidance: string;
}

/**
 * The due-diligence checklist.
 *
 * Findings are captured per item, not in a single free-text box, because
 * "legal access verified" is worthless without the instrument that verified it
 * — and that is exactly the field a person skips when there is nowhere to put it.
 */
export function Checklist({ items, canAct }: { items: ChecklistRow[]; canAct: boolean }) {
  const categories = [...new Set(items.map((item) => item.category))];

  return (
    <div className="divide-y divide-line">
      {categories.map((category) => (
        <div key={category} className="px-3 py-2">
          <p className="rule-label mb-1.5">{category}</p>
          <div className="space-y-1">
            {items
              .filter((item) => item.category === category)
              .map((item) => (
                <ChecklistItem key={item.id} item={item} canAct={canAct} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ChecklistItem({ item, canAct }: { item: ChecklistRow; canAct: boolean }) {
  const [status, setStatus] = useState<Status>(item.status as Status);
  const [findings, setFindings] = useState(item.findings ?? '');
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (nextStatus: Status): void => {
    setStatus(nextStatus);
    startTransition(async () => {
      await setChecklistItemAction(item.id, nextStatus, findings);
    });
  };

  const Icon =
    status === 'COMPLETE' ? Check : status === 'NOT_APPLICABLE' ? Minus : status === 'IN_PROGRESS' ? Loader2 : Circle;

  return (
    <div className="rounded-sm border border-line/70 px-2 py-1.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          disabled={!canAct || pending}
          onClick={() => save(status === 'COMPLETE' ? 'PENDING' : 'COMPLETE')}
          className={`mt-0.5 shrink-0 rounded-sm border p-0.5 transition-colors ${
            status === 'COMPLETE'
              ? 'border-good/50 bg-good/15 text-good'
              : status === 'NOT_APPLICABLE'
                ? 'border-line-strong text-ink-faint'
                : 'border-line-strong text-ink-faint hover:text-ink'
          }`}
          aria-label={`Mark ${item.label} complete`}
        >
          <Icon className="size-3" />
        </button>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="block w-full text-left"
          >
            <span
              className={`text-xs ${status === 'COMPLETE' ? 'text-ink-muted line-through' : 'text-ink'}`}
            >
              {item.label}
            </span>
            {item.required ? (
              <span className="ml-1.5 text-[10px] uppercase text-warn">required</span>
            ) : null}
            {item.completedAt ? (
              <span className="ml-2 num text-[10px] text-ink-faint">
                {formatDateTime(item.completedAt)}
              </span>
            ) : null}
          </button>

          {expanded ? (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[10px] leading-relaxed text-ink-faint">{item.guidance}</p>
              {canAct ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={findings}
                    onChange={(event) => setFindings(event.target.value)}
                    placeholder="What did you find? Cite the instrument or document."
                  />
                  <Button size="sm" disabled={pending} onClick={() => save(status)}>
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => save('NOT_APPLICABLE')}
                  >
                    N/A
                  </Button>
                </div>
              ) : item.findings ? (
                <p className="text-[11px] text-ink-muted">{item.findings}</p>
              ) : null}
            </div>
          ) : item.findings ? (
            <p className="truncate text-[10px] text-ink-faint" title={item.findings}>
              {item.findings}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
