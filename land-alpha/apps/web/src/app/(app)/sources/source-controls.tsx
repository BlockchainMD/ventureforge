'use client';

import { useState, useTransition } from 'react';
import { Play, Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setSourceEnabledAction, triggerIngestionAction } from './actions';

export function SourceControls({
  sourceId,
  enabled,
  manualOnly,
  canRun,
  canToggle,
}: {
  sourceId: string;
  enabled: boolean;
  manualOnly: boolean;
  canRun: boolean;
  canToggle: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-1.5">
      {message ? <span className="text-[10px] text-ink-muted">{message}</span> : null}
      {canRun ? (
        <Button
          size="sm"
          disabled={pending || manualOnly}
          title={manualOnly ? 'Manual-only source — import through the analyst workflow' : undefined}
          onClick={() =>
            startTransition(async () => {
              const result = await triggerIngestionAction(sourceId);
              setMessage(result.message);
            })
          }
        >
          <Play className="size-3" />
          Run
        </Button>
      ) : null}
      {canToggle ? (
        <Button
          size="sm"
          variant={enabled ? 'ghost' : 'good'}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setSourceEnabledAction(sourceId, !enabled);
              setMessage(result.message);
            })
          }
        >
          <Power className="size-3" />
          {enabled ? 'Disable' : 'Enable'}
        </Button>
      ) : null}
    </div>
  );
}
