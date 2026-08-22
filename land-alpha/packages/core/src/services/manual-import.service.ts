import { createLogger } from '@land-alpha/shared/logger';
import { prisma } from '@land-alpha/db';
import { registryByKey, SOURCE_REGISTRY } from '@land-alpha/source-registry';
import {
  applyMapping,
  parseImportFile,
  suggestMapping,
  upsertParcel,
  type ImportTargetField,
  type ParsedSheet,
} from '@land-alpha/ingestion';

/**
 * The analyst import path.
 *
 * Five sources in the registry are marked MANUAL_ONLY, and every one of them is
 * marked that way on purpose: a CAPTCHA on the Ottawa treasurer list, a 403 on
 * Marion's and Citrus's auction platform, a token on St. Louis County's
 * assessor service. Land Alpha does not work around any of those, so the
 * registry routes them here — and until now "here" did not exist. The parsing
 * engine was written and tested and had no service and no screen, which meant
 * those sources were not really registered as manual, they were registered as
 * unreachable.
 *
 * That matters most in Marion and Citrus, where 7,821 geocoded comparable sales
 * are waiting for inventory that a person can download in a minute.
 *
 * An imported parcel is deliberately indistinguishable downstream from a
 * scraped one: it goes through the same upsert, gets the same natural key, and
 * is enriched, valued and scored by the same pipeline. The only difference is
 * how it arrived, which is recorded on the ingestion run.
 */

const logger = createLogger({ component: 'manual-import-service' });

export interface ImportPreview {
  readonly columns: string[];
  readonly sampleRows: Record<string, string>[];
  readonly rowCount: number;
  readonly suggestedMapping: Record<string, ImportTargetField>;
  readonly warnings: string[];
}

/** Parse and propose a mapping, without writing anything. */
export async function previewImport(filename: string, body: Buffer): Promise<ImportPreview> {
  const sheet = await parseImportFile(filename, body);
  return {
    columns: sheet.columns,
    sampleRows: sheet.rows.slice(0, 8),
    rowCount: sheet.rows.length,
    suggestedMapping: suggestMapping(sheet.columns),
    warnings: sheet.warnings,
  };
}

export interface ManualImportOutcome {
  readonly runId: string;
  readonly discovered: number;
  readonly created: number;
  readonly updated: number;
  readonly rejected: { index: number; reason: string }[];
  readonly warnings: string[];
  readonly parcelIds: string[];
}

export async function commitImport(options: {
  filename: string;
  body: Buffer;
  sourceKey: string;
  mapping: Record<string, ImportTargetField>;
  importedById?: string | null;
}): Promise<ManualImportOutcome> {
  const registryEntry = registryByKey(options.sourceKey);
  if (!registryEntry) throw new Error(`Unknown source: ${options.sourceKey}`);

  const source = await prisma.source.findUnique({
    where: { registryKey: options.sourceKey },
    select: { id: true },
  });
  if (!source) {
    throw new Error(
      `${options.sourceKey} is in the registry but not in the database. Run the source sync first.`,
    );
  }

  const sheet: ParsedSheet = await parseImportFile(options.filename, options.body);
  const mapped = applyMapping(sheet, options.mapping, {
    sourceId: source.id,
    state: registryEntry.state,
    county: registryEntry.county ?? '',
  });

  // Recorded as a run like any other, so an imported batch is auditable the
  // same way a scrape is — who, when, from which file.
  const run = await prisma.ingestionRun.create({
    data: {
      sourceId: source.id,
      status: 'RUNNING',
      parserVersion: 'analyst-import/1',
      triggeredBy: options.importedById ?? 'analyst',
      startedAt: new Date(),
      notes: `Analyst import of ${options.filename}${options.importedById ? ` by ${options.importedById}` : ''}`,
    },
    select: { id: true },
  });

  let created = 0;
  let updated = 0;
  const parcelIds: string[] = [];

  for (const item of mapped.items) {
    const result = await upsertParcel(item, registryEntry, run.id);
    if (result.outcome === 'created') created += 1;
    else updated += 1;
    parcelIds.push(result.parcelId);
  }

  await prisma.ingestionRun.update({
    where: { id: run.id },
    data: {
      status: mapped.rejected.length > 0 && mapped.items.length === 0 ? 'FAILED' : 'SUCCEEDED',
      completedAt: new Date(),
      recordsDiscovered: sheet.rows.length,
      recordsCreated: created,
      recordsChanged: updated,
      recordsRejected: mapped.rejected.length,
      warnings: [...mapped.warnings].slice(0, 20),
    },
  });

  logger.info('analyst import committed', {
    source: options.sourceKey,
    file: options.filename,
    discovered: sheet.rows.length,
    created,
    updated,
    rejected: mapped.rejected.length,
  });

  return {
    runId: run.id,
    discovered: sheet.rows.length,
    created,
    updated,
    rejected: mapped.rejected,
    warnings: mapped.warnings,
    parcelIds,
  };
}

/** Sources the registry says must be imported by hand, for the picker. */
export function manualSources(): {
  key: string;
  name: string;
  state: string;
  county: string;
  reason: string;
}[] {
  return SOURCE_REGISTRY.filter(
    (entry) => entry.status === 'MANUAL_ONLY' || entry.ingestionMethod === 'MANUAL_SOURCE',
  ).map((entry) => ({
    key: entry.key,
    name: entry.name,
    state: entry.state,
    county: entry.county ?? '',
    reason: entry.dispositionNotes ?? '',
  }));
}
