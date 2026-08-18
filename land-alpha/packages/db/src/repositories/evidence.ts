import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import type { EvidenceInput } from '@land-alpha/shared';

/**
 * Evidence writes.
 *
 * Evidence is append-only per (parcel, field): a later observation does not
 * erase an earlier one, because "the county said $3,140 in March and $2,100 in
 * July" is exactly the kind of history the product exists to notice. Readers
 * take the most recent row per field.
 */

export async function recordEvidence(
  parcelId: string,
  rows: readonly EvidenceInput[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await prisma.evidence.createMany({
    data: rows.map((row) => ({
      parcelId,
      field: row.field,
      value: row.value.slice(0, 8000),
      source: row.source,
      sourceUrl: row.sourceUrl ?? null,
      documentKey: row.documentKey ?? null,
      extractedText: row.extractedText?.slice(0, 8000) ?? null,
      retrievalDate: row.retrievedAt,
      confidence: row.confidence,
      extractionMethod: row.extractionMethod,
      notes: row.notes ?? null,
    })) satisfies Prisma.EvidenceCreateManyInput[],
  });
  return result.count;
}

/** Latest evidence row per field, which is what the detail page renders. */
export async function latestEvidenceByField(
  parcelId: string,
): Promise<Map<string, Awaited<ReturnType<typeof prisma.evidence.findMany>>[number]>> {
  const rows = await prisma.evidence.findMany({
    where: { parcelId },
    orderBy: { createdAt: 'desc' },
  });
  const out = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!out.has(row.field)) out.set(row.field, row);
  }
  return out;
}

export async function evidenceForField(parcelId: string, field: string) {
  return prisma.evidence.findMany({
    where: { parcelId, field },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}
