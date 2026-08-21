import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { extractText, getDocumentProxy } from 'unpdf';
import { dollarsToCents, ParseError, type ParcelOpportunityInput } from '@land-alpha/shared';
import { createLogger } from '@land-alpha/shared/logger';
import { validateNormalized } from './adapter';

/**
 * Manual import.
 *
 * The counterpart to the MANUAL_SOURCE registry status. Where a source sits
 * behind a CAPTCHA, a login or a format too unstable to parse, an analyst
 * downloads the published list and imports it here — and it becomes exactly the
 * same `ParcelOpportunity` record an automated adapter would produce, with the
 * same provenance and the same downstream treatment.
 *
 * This is what keeps "we do not circumvent access controls" from meaning "we
 * lose the county".
 */

const logger = createLogger({ component: 'manual-import' });

export const IMPORT_TARGET_FIELDS = [
  'apn',
  'minimumBid',
  'askingPrice',
  'acreage',
  'legalDescription',
  'auctionDate',
  'situsAddress',
  'municipality',
  'zip',
  'sourceUrl',
  'taxesDue',
  'assessedValue',
  'landAssessedValue',
  'annualTaxEstimate',
  'currentOwner',
  'zoning',
  'latitude',
  'longitude',
] as const;
export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

export interface ParsedSheet {
  readonly columns: string[];
  readonly rows: Record<string, string>[];
  readonly warnings: string[];
}

/** Parse an uploaded file into rows, whatever format it arrived in. */
export async function parseImportFile(filename: string, body: Buffer): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    return parseDelimited(body, lower.endsWith('.tsv') ? '\t' : ',');
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    return parseWorkbook(body);
  }
  if (lower.endsWith('.pdf')) {
    return parsePdfTable(body);
  }
  if (lower.endsWith('.xls')) {
    throw new ParseError(
      'Legacy .xls files are not supported. Open the file and re-save it as .xlsx or .csv, then upload again.',
      { filename },
    );
  }
  throw new ParseError(`Unsupported file type: ${filename}`, { filename });
}

function parseDelimited(body: Buffer, delimiter: string): ParsedSheet {
  const records = parseCsv(body, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
    delimiter,
  }) as Record<string, string>[];

  if (records.length === 0) return { columns: [], rows: [], warnings: ['File contained no rows.'] };
  return { columns: Object.keys(records[0]!), rows: records, warnings: [] };
}

async function parseWorkbook(body: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { columns: [], rows: [], warnings: ['Workbook contained no sheets.'] };

  const warnings: string[] = [];
  if (workbook.worksheets.length > 1) {
    warnings.push(
      `Workbook has ${workbook.worksheets.length} sheets; only "${sheet.name}" was imported.`,
    );
  }

  // County spreadsheets frequently carry a title block above the real header.
  // The header is taken to be the first row with three or more non-empty cells.
  let headerRowNumber = 1;
  for (let i = 1; i <= Math.min(sheet.rowCount, 15); i += 1) {
    const values = sheet.getRow(i).values as unknown[];
    const filled = Array.isArray(values)
      ? values.filter((v) => v != null && String(v).trim()).length
      : 0;
    if (filled >= 3) {
      headerRowNumber = i;
      break;
    }
  }
  if (headerRowNumber > 1) {
    warnings.push(`Detected the header on row ${headerRowNumber}; rows above it were skipped.`);
  }

  const headerValues = sheet.getRow(headerRowNumber).values as unknown[];
  const columns = (Array.isArray(headerValues) ? headerValues.slice(1) : []).map((value, index) =>
    value == null || String(value).trim() === '' ? `column_${index + 1}` : String(value).trim(),
  );

  const rows: Record<string, string>[] = [];
  for (let i = headerRowNumber + 1; i <= sheet.rowCount; i += 1) {
    const values = sheet.getRow(i).values as unknown[];
    if (!Array.isArray(values)) continue;
    const cells = values.slice(1);
    if (cells.every((cell) => cell == null || String(cell).trim() === '')) continue;

    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      const cell = cells[index];
      row[column] =
        cell == null
          ? ''
          : String(
              typeof cell === 'object' && 'text' in (cell as object)
                ? (cell as { text: string }).text
                : cell,
            ).trim();
    });
    rows.push(row);
  }

  return { columns, rows, warnings };
}

/**
 * Extract a table from a PDF.
 *
 * PDFs have no table structure — only positioned text — so this recovers rows
 * by line and splits on runs of whitespace. It works on the fixed-width tabular
 * PDFs counties actually publish and fails visibly on anything else, which is
 * the right behaviour: a silently mis-parsed PDF is worse than a rejected one.
 */
async function parsePdfTable(body: Buffer): Promise<ParsedSheet> {
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const { text } = await extractText(pdf, { mergePages: true });
  const content = Array.isArray(text) ? text.join('\n') : text;

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const warnings: string[] = [
    'Extracted from a PDF by line and whitespace. Review the mapping carefully before importing — PDFs carry no table structure.',
  ];

  // The header is the first line with at least three whitespace-separated
  // groups that are not predominantly numeric.
  const headerIndex = lines.findIndex((line) => {
    const parts = line.split(/\s{2,}/).filter(Boolean);
    return parts.length >= 3 && parts.filter((part) => /[A-Za-z]{3,}/.test(part)).length >= 2;
  });

  if (headerIndex === -1) {
    return {
      columns: [],
      rows: [],
      warnings: [...warnings, 'No table header could be identified.'],
    };
  }

  const columns = lines[headerIndex]!.split(/\s{2,}/).filter(Boolean);
  const rows: Record<string, string>[] = [];

  for (const line of lines.slice(headerIndex + 1)) {
    const parts = line.split(/\s{2,}/).filter(Boolean);
    if (parts.length < 2) continue;
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = parts[index] ?? '';
    });
    rows.push(row);
  }

  if (rows.length === 0) warnings.push('No data rows were recovered below the header.');
  return { columns, rows, warnings };
}

/**
 * Suggest a column mapping.
 *
 * Deterministic, not AI: matching "Parcel Number" to `apn` is a synonym lookup,
 * and a synonym lookup that an engineer can read and extend beats a model call
 * that occasionally maps the tax amount to the sale price.
 */
const FIELD_SYNONYMS: Record<ImportTargetField, string[]> = {
  apn: [
    'apn',
    'parcel',
    'parcel number',
    'parcel id',
    'pin',
    'parcel no',
    'property id',
    'tax id',
    'prcl',
  ],
  minimumBid: ['minimum bid', 'min bid', 'opening bid', 'starting bid', 'bid amount', 'minimum'],
  askingPrice: [
    'price',
    'asking price',
    'sale price',
    'list price',
    'amount due',
    'purchase price',
  ],
  acreage: ['acres', 'acreage', 'deeded acres', 'gis acres', 'size'],
  legalDescription: ['legal', 'legal description', 'description', 'property description'],
  auctionDate: ['auction date', 'sale date', 'date of sale', 'sale', 'auction'],
  situsAddress: ['address', 'property address', 'situs', 'situs address', 'location'],
  municipality: ['city', 'township', 'municipality', 'town', 'twp'],
  zip: ['zip', 'zip code', 'postal code', 'zipcode'],
  sourceUrl: ['url', 'link', 'detail url', 'more info'],
  taxesDue: ['taxes due', 'tax due', 'delinquent taxes', 'back taxes', 'balance due'],
  assessedValue: ['assessed value', 'total assessed', 'market value', 'total value'],
  landAssessedValue: ['land value', 'land assessed', 'assessed land'],
  annualTaxEstimate: ['annual tax', 'tax amount', 'yearly tax', 'net tax'],
  currentOwner: ['owner', 'owner name', 'current owner', 'vested owner'],
  zoning: ['zoning', 'zone', 'zoning district', 'land use'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lon', 'lng', 'long', 'x'],
};

export function suggestMapping(columns: readonly string[]): Record<string, ImportTargetField> {
  const mapping: Record<string, ImportTargetField> = {};
  const claimed = new Set<ImportTargetField>();

  for (const column of columns) {
    const normalized = column
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    let best: { field: ImportTargetField; score: number } | null = null;
    for (const [field, synonyms] of Object.entries(FIELD_SYNONYMS) as [
      ImportTargetField,
      string[],
    ][]) {
      if (claimed.has(field)) continue;
      for (const synonym of synonyms) {
        // Exact match beats prefix beats contains, so "tax amount" does not
        // steal the column that "amount due" should claim.
        const score =
          normalized === synonym
            ? 3
            : normalized.startsWith(synonym)
              ? 2
              : normalized.includes(synonym)
                ? 1
                : 0;
        if (score > 0 && (!best || score > best.score)) best = { field, score };
      }
    }

    if (best) {
      mapping[column] = best.field;
      claimed.add(best.field);
    }
  }

  return mapping;
}

export interface ImportResult {
  readonly items: ParcelOpportunityInput[];
  readonly rejected: { index: number; reason: string }[];
  readonly warnings: string[];
}

/** Apply a mapping and normalise rows into canonical parcel inputs. */
export function applyMapping(
  sheet: ParsedSheet,
  mapping: Record<string, ImportTargetField>,
  context: { sourceId: string; state: string; county: string },
): ImportResult {
  const items: ParcelOpportunityInput[] = [];
  const warnings = [...sheet.warnings];

  sheet.rows.forEach((row) => {
    const mapped: Partial<Record<ImportTargetField, string>> = {};
    for (const [column, field] of Object.entries(mapping)) {
      const value = row[column];
      if (value != null && String(value).trim() !== '') mapped[field] = String(value).trim();
    }

    items.push({
      sourceId: context.sourceId,
      sourceRecordId: mapped.apn ?? null,
      sourceUrl: mapped.sourceUrl ?? null,
      state: context.state,
      county: context.county,
      apn: mapped.apn ?? null,
      saleType: 'UNKNOWN',
      saleStatus: 'AVAILABLE',
      auctionDate: parseLooseDate(mapped.auctionDate),
      minimumBid: parseMoney(mapped.minimumBid),
      askingPrice: parseMoney(mapped.askingPrice),
      taxesDue: parseMoney(mapped.taxesDue),
      acreage: parseNumber(mapped.acreage),
      legalDescription: mapped.legalDescription ?? null,
      situsAddress: mapped.situsAddress ?? null,
      municipality: mapped.municipality ?? null,
      zip: mapped.zip?.replace(/\D/g, '').slice(0, 5) || null,
      assessedValue: parseMoney(mapped.assessedValue),
      landAssessedValue: parseMoney(mapped.landAssessedValue),
      annualTaxEstimate: parseMoney(mapped.annualTaxEstimate),
      currentOwner: mapped.currentOwner ?? null,
      zoning: mapped.zoning ?? null,
      latitude: parseNumber(mapped.latitude),
      longitude: parseNumber(mapped.longitude),
      evidence: Object.entries(mapped).map(([field, value]) => ({
        field,
        value,
        source: 'Analyst manual import',
        sourceUrl: mapped.sourceUrl ?? null,
        documentKey: null,
        extractedText: null,
        retrievedAt: new Date(),
        // An analyst transcribing an official list is a strong source, but the
        // transcription itself is not machine-verified.
        confidence: 'HIGH' as const,
        extractionMethod: 'ANALYST_ENTRY' as const,
        notes: null,
      })),
      rawRecord: row,
    });
  });

  const validated = validateNormalized(items);
  logger.info('manual import mapped', {
    rows: sheet.rows.length,
    accepted: validated.items.length,
    rejected: validated.rejected.length,
  });

  return {
    items: validated.items,
    rejected: validated.rejected.map((entry) => ({ index: entry.index, reason: entry.reason })),
    warnings,
  };
}

export function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return dollarsToCents(parsed);
}

export function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse the date formats that appear in county spreadsheets. Ambiguous or
 * unrecognised values return null rather than a guess — a wrong auction date is
 * worse than a missing one, because an analyst plans around it.
 */
export function parseLooseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const text = value.trim();

  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text);
  if (mdy) {
    const year = Number(mdy[3]!.length === 2 ? `20${mdy[3]}` : mdy[3]);
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    if (month > 12) return null; // day/month order — ambiguous, so refuse
    return new Date(Date.UTC(year, month - 1, day));
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  return date.getUTCFullYear() > 1900 && date.getUTCFullYear() < 2100 ? date : null;
}
