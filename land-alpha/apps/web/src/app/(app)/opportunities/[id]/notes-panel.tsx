'use client';

import { useState, useTransition } from 'react';
import { formatDateTime } from '@land-alpha/shared';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { addNoteAction } from './actions';

export function NotesPanel({
  parcelId,
  notes,
  canAct,
}: {
  parcelId: string;
  notes: {
    id: string;
    body: string;
    pinned: boolean;
    createdAt: Date;
    user: { name: string } | null;
  }[];
  canAct: boolean;
}) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Panel>
      <PanelHeader title="Analyst notes" subtitle={`${notes.length} recorded`} />
      <PanelBody className="space-y-2">
        {canAct ? (
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="What did you find? Notes are permanent and attributed."
            />
            <Button
              size="default"
              disabled={pending || !body.trim()}
              onClick={() =>
                startTransition(async () => {
                  await addNoteAction(parcelId, body);
                  setBody('');
                })
              }
            >
              Add
            </Button>
          </div>
        ) : null}

        {notes.length === 0 ? (
          <p className="py-3 text-center text-xs text-ink-faint">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="border-b border-line/60 pb-2 last:border-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-muted">{note.user?.name ?? 'system'}</span>
                <div className="flex items-center gap-2">
                  {note.pinned ? <Badge tone="warn">pinned</Badge> : null}
                  <span className="num text-[10px] text-ink-faint">
                    {formatDateTime(note.createdAt)}
                  </span>
                </div>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink">{note.body}</p>
            </div>
          ))
        )}
      </PanelBody>
    </Panel>
  );
}
