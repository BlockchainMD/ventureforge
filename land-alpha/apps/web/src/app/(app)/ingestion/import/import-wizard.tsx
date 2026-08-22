'use client';

import { useRef, useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable, Td, Th, Thead, Tr } from '@/components/ui/table';
import { commitImportAction, previewImportAction } from './actions';

interface Preview {
  columns: string[];
  sampleRows: Record<string, string>[];
  rowCount: number;
  suggestedMapping: Record<string, string>;
  warnings: string[];
}

interface ManualSource {
  key: string;
  name: string;
  state: string;
  county: string;
}

/**
 * Upload, check how the columns were read, then import.
 *
 * The mapping step is not a formality. These files are county exports with
 * whatever headings a clerk chose, and a column silently read as the wrong
 * field is how a minimum bid becomes an acreage — an error that would then
 * propagate through valuation, scoring and the ranked list without ever
 * looking wrong.
 */
export function ImportWizard({
  sources,
  targetFields,
}: {
  sources: ManualSource[];
  /**
   * Passed in rather than imported. The ingestion package reaches for
   * `child_process` and `worker_threads` through its spreadsheet and PDF
   * readers, and importing it from a client component drags all of that into
   * the browser bundle — which is a build failure, and would be dead weight
   * even if it were not.
   */
  targetFields: readonly string[];
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? '');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    rejected: number;
    warnings: string[];
  } | null>(null);

  const onPreview = (): void => {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setError(null);
    setResult(null);
    const form = new FormData();
    form.set('file', file);
    startTransition(async () => {
      const response = await previewImportAction(form);
      if (!response.ok) {
        setError(response.error);
        setPreview(null);
        return;
      }
      setPreview(response.preview as Preview);
      setMapping(response.preview.suggestedMapping as Record<string, string>);
    });
  };

  const onCommit = (): void => {
    const file = fileInput.current?.files?.[0];
    if (!file || !preview) return;
    setError(null);
    const form = new FormData();
    form.set('file', file);
    form.set('sourceKey', sourceKey);
    // Only columns the analyst left mapped are sent.
    form.set(
      'mapping',
      JSON.stringify(
        Object.fromEntries(Object.entries(mapping).filter(([, field]) => field !== '')),
      ),
    );
    startTransition(async () => {
      const response = await commitImportAction(form);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setResult(response);
      setPreview(null);
    });
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHeader
          title="1 · Choose the source and the file"
          subtitle="CSV, Excel or a copied HTML table. The parser works out which it is."
        />
        <PanelBody className="flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="block w-64">
            <span className="rule-label">Source</span>
            <Select
              className="mt-0.5"
              value={sourceKey}
              onChange={(event) => setSourceKey(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.key} value={source.key}>
                  {source.county} {source.state} — {source.name.slice(0, 48)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block min-w-0 flex-1">
            <span className="rule-label">File</span>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.xlsx,.xls,.html,.htm,.txt"
              className="focus-ring mt-0.5 block h-7 w-full rounded-sm border border-line-strong bg-surface px-2 text-xs text-ink file:mr-2 file:border-0 file:bg-raised file:px-2 file:py-0.5 file:text-[11px] file:text-ink"
            />
          </label>
          <Button onClick={onPreview} disabled={pending} variant="default">
            <Upload className="size-3" />
            {pending ? 'Reading…' : 'Read file'}
          </Button>
        </PanelBody>
      </Panel>

      {error ? (
        <Panel className="border-bad/40">
          <PanelBody>
            <p className="flex gap-2 text-xs text-bad">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          </PanelBody>
        </Panel>
      ) : null}

      {result ? (
        <Panel className="border-good/40">
          <PanelBody className="space-y-1">
            <p className="flex gap-2 text-xs text-good">
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
              Imported {result.created} new {result.created === 1 ? 'parcel' : 'parcels'} and
              updated {result.updated}
              {result.rejected > 0 ? `, rejecting ${result.rejected} unusable rows` : ''}. They will
              be enriched, valued and scored on the next pipeline run.
            </p>
            {result.warnings.map((warning) => (
              <p key={warning} className="pl-5 text-[11px] text-warn">
                {warning}
              </p>
            ))}
          </PanelBody>
        </Panel>
      ) : null}

      {preview ? (
        <Panel>
          <PanelHeader
            title="2 · Check how the columns were read"
            subtitle="A column read as the wrong field would carry that error through valuation and scoring without ever looking wrong."
            actions={
              <div className="flex items-center gap-2">
                <Badge tone="muted">
                  {preview.rowCount} rows · {mappedCount} of {preview.columns.length} columns mapped
                </Badge>
                <Button
                  onClick={onCommit}
                  disabled={pending || mappedCount === 0}
                  variant="default"
                >
                  {pending ? 'Importing…' : 'Import'}
                </Button>
              </div>
            }
          />
          <PanelBody className="space-y-3">
            {preview.warnings.map((warning) => (
              <p key={warning} className="flex gap-2 text-[11px] text-warn">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                {warning}
              </p>
            ))}

            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {preview.columns.map((column) => (
                <label key={column} className="block min-w-0">
                  <span className="rule-label truncate" title={column}>
                    {column}
                  </span>
                  <Select
                    className="mt-0.5"
                    value={mapping[column] ?? ''}
                    onChange={(event) => setMapping({ ...mapping, [column]: event.target.value })}
                  >
                    <option value="">— ignore —</option>
                    {targetFields.map((field) => (
                      <option key={field} value={field}>
                        {field}
                      </option>
                    ))}
                  </Select>
                </label>
              ))}
            </div>
          </PanelBody>

          <DataTable>
            <Thead>
              <Tr>
                {preview.columns.map((column) => (
                  <Th key={column}>
                    {column}
                    {mapping[column] ? (
                      <span className="ml-1 normal-case text-alpha">→ {mapping[column]}</span>
                    ) : null}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <tbody>
              {preview.sampleRows.map((row, index) => (
                <Tr key={index}>
                  {preview.columns.map((column) => (
                    <Td key={column} className="max-w-56 truncate text-ink-muted">
                      {row[column] ?? ''}
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      ) : null}
    </div>
  );
}
