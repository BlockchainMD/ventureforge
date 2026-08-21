import { z } from 'zod';
import {
  INGESTION_METHODS,
  SOURCE_TYPES,
  SOURCE_STATUSES,
  UPDATE_FREQUENCIES,
} from '@land-alpha/shared';

/**
 * The County Opportunity Registry.
 *
 * This is the strategic asset. It is not a list of URLs — it is a structured
 * record of *how each jurisdiction disposes of land nobody bought*, which is
 * the knowledge that makes the rest of the product possible and which
 * accumulates value over time.
 *
 * The registry is code-defined (typed, reviewable, diffable in git) and synced
 * into the `Source` table on startup. Adding a county is a data change plus, at
 * most, one adapter — never an architectural change.
 */

export const registryEntrySchema = z.object({
  /** Stable identifier, e.g. "mn-st-louis-tax-forfeited". Never reused. */
  key: z.string().regex(/^[a-z]{2}-[a-z0-9-]+$/),
  state: z.string().length(2),
  county: z.string().nullable(),
  municipality: z.string().nullable().default(null),
  fipsCode: z
    .string()
    .regex(/^\d{5}$/)
    .nullable()
    .default(null),
  timezone: z.string().default('America/Chicago'),

  name: z.string().min(3),
  sourceType: z.enum(SOURCE_TYPES),
  sourceUrl: z.string().url(),
  discoveryUrl: z.string().url().nullable().default(null),
  ingestionMethod: z.enum(INGESTION_METHODS),
  inventoryFormat: z.enum(['HTML', 'PDF', 'CSV', 'XLSX', 'GIS', 'JSON', 'MIXED']).default('GIS'),
  updateFrequency: z.enum(UPDATE_FREQUENCIES).default('UNKNOWN'),
  status: z.enum(SOURCE_STATUSES).default('CANDIDATE'),

  /**
   * The single most predictive jurisdiction attribute for the Land Alpha
   * thesis: does inventory that fails at auction roll into standing,
   * buy-it-now stock? Where it does, mispricing persists instead of being
   * competed away.
   */
  failedAuctionBecomesOtc: z.boolean().default(false),
  acquisitionMethod: z.string().nullable().default(null),

  /** Which adapter implementation handles this source. */
  adapterKey: z.string(),
  parserVersion: z.string().default('1'),

  officialUrl: z.string().url().nullable().default(null),
  assessorUrl: z.string().url().nullable().default(null),
  recorderUrl: z.string().url().nullable().default(null),
  gisUrl: z.string().url().nullable().default(null),
  taxSaleUrl: z.string().url().nullable().default(null),

  /** Attribution required by the publisher, reproduced wherever data is shown. */
  attribution: z.string().nullable().default(null),
  termsUrl: z.string().url().nullable().default(null),

  /**
   * How this jurisdiction actually disposes of failed inventory, in prose.
   * This is the proprietary intelligence layer; it starts as research notes and
   * accrues corrections from real acquisitions.
   */
  dispositionNotes: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),

  /** Adapter-specific configuration, validated by the adapter itself. */
  config: z.record(z.unknown()).default({}),

  /** Enabled sources are scheduled automatically. */
  enabled: z.boolean().default(false),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;
export type RegistryEntryInput = z.input<typeof registryEntrySchema>;

export function defineSource(entry: RegistryEntryInput): RegistryEntry {
  return registryEntrySchema.parse(entry);
}

export function defineSources(entries: RegistryEntryInput[]): RegistryEntry[] {
  const parsed = entries.map(defineSource);
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (seen.has(entry.key)) throw new Error(`Duplicate registry key: ${entry.key}`);
    seen.add(entry.key);
  }
  return parsed;
}
