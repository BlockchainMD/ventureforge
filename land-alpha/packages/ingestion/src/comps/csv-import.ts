import { parse as parseCsv } from 'csv-parse/sync';
import { ParseError } from '@land-alpha/shared';
import { parseLooseDate, parseMoney, parseNumber } from '../manual-import';
import { persistComparables } from './pipeline';
import { validateComparables, type ComparableSaleInput, type CompsImportResult } from './types';

/**
 * Analyst CSV import for comparable sales.
 *
 * The documented path for the counties that publish no usable sales API —
 * St. Louis County MN behind a token, Ottawa County MI with no sale data at
 * all. An analyst exports the county's sales file and imports it here, and the
 * result is indistinguishable downstream from an automated source.
 *
 * Vacant and arm's-length classification is required, not inferred: if the file
 * does not say, the row is rejected rather than assumed. Silently importing an
 * improved-property sale as a land comparable would inflate every valuation
 * that touched it.
 */

const HEADER_SYNONYMS: Record<string, string[]> = {
  apn: ['apn', 'parcel', 'parcel id', 'parcel number', 'pin', 'property id'],
  saleDate: ['sale date', 'date', 'transfer date', 'closing date', 'recorded date', 'transdt'],
  salePrice: ['sale price', 'price', 'amount', 'consideration', 'saleamnt', 'sale amount'],
  acreage: ['acres', 'acreage', 'deeded acres', 'land size', 'size'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
  zoning: ['zoning', 'zone', 'zoning district'],
  landUse: ['land use', 'property class', 'use code', 'class', 'dor code'],
  vacant: ['vacant', 'vacant improved', 'vacant/improved', 'improvement status', 'is vacant'],
  qualified: ['qualified', 'good sale', 'arms length', "arm's length", 'valid sale', 'qual code'],
  deedType: ['deed', 'deed type', 'instrument', 'docname', 'document type'],
};

export interface CsvCompsOptions {
  readonly state: string;
  readonly county: string;
  readonly sourceLabel: string;
  readonly sourceUrl?: string | null;
  /**
   * When the file carries no vacant/qualified columns, the analyst can assert
   * that the whole file is already filtered to qualified vacant-land sales.
   * Explicit, recorded, and never the default.
   */
  readonly assertAllVacantArmsLength?: boolean;
}

export async function importComparablesCsv(
  body: Buffer,
  options: CsvCompsOptions,
): Promise<CompsImportResult> {
  const records = parseCsv(body, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new ParseError('The comparable-sales file contained no rows.');
  }

  const columns = Object.keys(records[0]!);
  const mapping = mapHeaders(columns);

  const missing = (['saleDate', 'salePrice', 'acreage'] as const).filter(
    (field) => !mapping[field],
  );
  if (missing.length > 0) {
    throw new ParseError(
      `The file is missing required columns: ${missing.join(', ')}. A comparable sale needs at least a date, a price and an acreage.`,
      { columns },
    );
  }

  const warnings: string[] = [];
  if (!mapping.vacant && !options.assertAllVacantArmsLength) {
    warnings.push(
      'No vacant/improved column was found. Every row will be rejected unless you confirm the file contains only vacant-land sales.',
    );
  }
  if (!mapping.qualified && !options.assertAllVacantArmsLength) {
    warnings.push(
      'No qualified/arm’s-length column was found. Every row will be rejected unless you confirm the file contains only qualified sales.',
    );
  }

  const rows: ComparableSaleInput[] = [];
  for (const record of records) {
    const saleDate = parseLooseDate(record[mapping.saleDate!]);
    const salePriceCents = parseMoney(record[mapping.salePrice!]);
    const acreage = parseNumber(record[mapping.acreage!]);
    if (!saleDate || salePriceCents == null || acreage == null) continue;

    rows.push({
      state: options.state,
      county: options.county,
      apn: mapping.apn ? (record[mapping.apn] ?? null) : null,
      saleDate,
      salePriceCents,
      acreage,
      latitude: mapping.latitude ? parseNumber(record[mapping.latitude]) : null,
      longitude: mapping.longitude ? parseNumber(record[mapping.longitude]) : null,
      zoning: mapping.zoning ? (record[mapping.zoning] ?? null) : null,
      landUse: mapping.landUse ? (record[mapping.landUse] ?? null) : null,
      hasUtilities: null,
      isVacantLand: mapping.vacant
        ? isAffirmativeVacant(record[mapping.vacant])
        : Boolean(options.assertAllVacantArmsLength),
      isArmsLength: mapping.qualified
        ? isAffirmative(record[mapping.qualified])
        : Boolean(options.assertAllVacantArmsLength),
      deedType: mapping.deedType ? (record[mapping.deedType] ?? null) : null,
      source: options.sourceLabel,
      sourceUrl: options.sourceUrl ?? null,
    });
  }

  const { accepted, rejected } = validateComparables(rows);
  const written = await persistComparables(accepted);

  return { discovered: records.length, accepted: written, rejected, warnings };
}

export function mapHeaders(columns: readonly string[]): Record<string, string | undefined> {
  const mapping: Record<string, string | undefined> = {};
  const claimed = new Set<string>();

  for (const column of columns) {
    const normalized = column
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // County exports run words together as often as they space them —
    // "goodsale", "saleamnt", "DEEDED_ACRES" — so match both spellings.
    const squashed = normalized.replace(/ /g, '');
    let best: { field: string; score: number } | null = null;

    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (claimed.has(field)) continue;
      for (const synonym of synonyms) {
        const score = Math.max(
          matchScore(normalized, synonym),
          matchScore(squashed, synonym.replace(/ /g, '')),
        );
        if (score > 0 && (!best || score > best.score)) best = { field, score };
      }
    }
    if (best) {
      mapping[best.field] = column;
      claimed.add(best.field);
    }
  }
  return mapping;
}

function matchScore(candidate: string, synonym: string): number {
  if (candidate === synonym) return 3;
  if (candidate.startsWith(synonym)) return 2;
  return candidate.includes(synonym) ? 1 : 0;
}

/** "VACANT", "V", "Y" mean vacant; "IMPROVED" explicitly does not. */
export function isAffirmativeVacant(value: string | undefined): boolean {
  if (!value) return false;
  const upper = value.trim().toUpperCase();
  if (upper.includes('IMPROVED') || upper.startsWith('I')) return false;
  return (
    upper.includes('VACANT') || upper.includes('BARE') || upper === 'V' || isAffirmative(value)
  );
}

export function isAffirmative(value: string | undefined): boolean {
  if (!value) return false;
  const upper = value.trim().toUpperCase();
  return ['Y', 'YES', 'TRUE', '1', 'Q', 'QUALIFIED', 'GOOD', 'GOOD SALE', 'ARMS LENGTH'].includes(
    upper,
  );
}
