'use client';

import { useState, useTransition } from 'react';
import { Bookmark, BellPlus } from 'lucide-react';
import type { OpportunityFilter } from '@land-alpha/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveSearchAction, createAlertRuleAction } from './actions';

/**
 * A saved search and an alert rule are the same object with a different
 * delivery decision, so they are created from the same control.
 */
export function SaveSearchButton({ filter }: { filter: OpportunityFilter }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (asAlert: boolean): void => {
    if (!name.trim()) return;
    startTransition(async () => {
      const result = asAlert
        ? await createAlertRuleAction(name.trim(), filter)
        : await saveSearchAction(name.trim(), filter);
      setMessage(result.message);
      if (result.ok) {
        setName('');
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <div className="flex items-center gap-2">
        {message ? <span className="text-[11px] text-good">{message}</span> : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          <Bookmark className="size-3" />
          Save this view
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name this search"
        className="w-48"
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit(false);
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <Button
        size="sm"
        variant="default"
        disabled={pending || !name.trim()}
        onClick={() => submit(false)}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || !name.trim()}
        onClick={() => submit(true)}
      >
        <BellPlus className="size-3" />
        Save + alert
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
