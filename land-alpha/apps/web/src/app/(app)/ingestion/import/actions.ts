'use server';

import { revalidatePath } from 'next/cache';
import { commitImport, previewImport, type ImportPreview } from '@land-alpha/core';
import { requireRole } from '@/server/auth';

/**
 * Two steps, deliberately separate: nothing is written until the analyst has
 * seen how the columns were read and agreed with it. A silently mis-mapped
 * column is how a minimum bid becomes an acreage.
 */

export async function previewImportAction(
  formData: FormData,
): Promise<{ ok: true; preview: ImportPreview; filename: string } | { ok: false; error: string }> {
  await requireRole('ANALYST');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'Choose a file to import.' };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: 'That file is larger than 25MB. Split it and import in batches.' };
  }
  try {
    const preview = await previewImport(file.name, Buffer.from(await file.arrayBuffer()));
    if (preview.rowCount === 0) return { ok: false, error: 'That file has no rows.' };
    return { ok: true, preview, filename: file.name };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not read that file.',
    };
  }
}

export async function commitImportAction(
  formData: FormData,
): Promise<
  | { ok: true; created: number; updated: number; rejected: number; warnings: string[] }
  | { ok: false; error: string }
> {
  const user = await requireRole('ANALYST');
  const file = formData.get('file');
  const sourceKey = String(formData.get('sourceKey') ?? '');
  const mappingRaw = String(formData.get('mapping') ?? '{}');

  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'File is missing.' };
  if (!sourceKey) return { ok: false, error: 'Choose which source this list came from.' };

  let mapping: Record<string, never>;
  try {
    mapping = JSON.parse(mappingRaw);
  } catch {
    return { ok: false, error: 'The column mapping was not readable.' };
  }

  try {
    const outcome = await commitImport({
      filename: file.name,
      body: Buffer.from(await file.arrayBuffer()),
      sourceKey,
      mapping,
      importedById: user.email,
    });
    revalidatePath('/ingestion');
    revalidatePath('/opportunities');
    return {
      ok: true,
      created: outcome.created,
      updated: outcome.updated,
      rejected: outcome.rejected.length,
      warnings: outcome.warnings.slice(0, 5),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Import failed.' };
  }
}
