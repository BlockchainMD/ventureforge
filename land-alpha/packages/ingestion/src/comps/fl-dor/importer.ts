import { createLogger } from '@land-alpha/shared/logger';
import type { IngestHttpClient } from '../../fetch/http';
import type { ComparableSaleInput, CompsImportResult, CompsSource } from '../types';
import { validateComparables } from '../types';
import { listRollFiles, listVintages, matchCounty, type RollFile } from './catalog';
import { streamZippedCsv } from './stream';
import {
  agreesVacant,
  parcelFactsFrom,
  qualifySdfRow,
  type NalRow,
  type QualifiedSale,
  type SdfRow,
} from './parse';

/**
 * The Florida roll importer.
 *
 * Two files per county per year. The SDF is small enough to hold — a few
 * megabytes — but the NAL is not: Orange County's 2026 preliminary roll is 35MB
 * compressed and 266MB expanded, and there are 67 counties. So the NAL is never
 * materialised. It is inflated and parsed as a stream, and a row is kept only if
 * its parcel appeared in the SDF's qualified-sale set, which for Orange County
 * means holding 806 rows out of roughly half a million.
 *
 * Order matters: SDF first to learn which parcels are interesting, NAL second to
 * look only those up.
 */

const logger = createLogger({ component: 'comps-fl-dor' });

export interface FlDorConfig {
  /** County as PTO spells it; `St.` and `Saint` both resolve. */
  county: string;
  /** Pin a submission round (`2026P`); omit to take the newest published. */
  vintage?: string;
  qualifiedSaleCodes?: string[];
  soldSince?: string;
  /** Stop after this many accepted comparables. Unbounded when absent. */
  maxComparables?: number;
}

export async function fetchFloridaRollSales(
  source: CompsSource,
  http: IngestHttpClient,
  options: { signal?: AbortSignal } = {},
): Promise<{ rows: ComparableSaleInput[]; warnings: string[] }> {
  const config = source.config as unknown as FlDorConfig;
  if (!config?.county) throw new Error(`Comps source ${source.key} needs config.county`);

  const warnings: string[] = [];
  const soldSince = config.soldSince ? new Date(config.soldSince) : undefined;

  const [sdfFile, nalFile] = await Promise.all([
    resolveFile(http, 'SDF', config),
    resolveFile(http, 'NAL', config),
  ]);
  if (!sdfFile) throw new Error(`No Florida SDF published for ${config.county}`);
  if (!nalFile) throw new Error(`No Florida NAL published for ${config.county}`);
  logger.info('florida roll files resolved', {
    source: source.key,
    sdf: `${sdfFile.vintage} ${(sdfFile.bytes / 1e6).toFixed(1)}MB`,
    nal: `${nalFile.vintage} ${(nalFile.bytes / 1e6).toFixed(1)}MB`,
  });

  // ---- Pass 1: the sale file ------------------------------------------------
  const sales = new Map<string, QualifiedSale[]>();
  let sdfRows = 0;
  await streamZippedCsv<SdfRow>(http, sdfFile.url, options.signal, (row) => {
    sdfRows += 1;
    const sale = qualifySdfRow(row, {
      qualifiedSaleCodes: config.qualifiedSaleCodes,
      soldSince,
    });
    if (!sale) return;
    const existing = sales.get(sale.parcelId);
    if (existing) existing.push(sale);
    else sales.set(sale.parcelId, [sale]);
  });
  const qualifiedCount = [...sales.values()].reduce((sum, list) => sum + list.length, 0);
  logger.info('florida sale file parsed', {
    source: source.key,
    transfers: sdfRows,
    qualifiedVacant: qualifiedCount,
    parcels: sales.size,
  });
  if (sales.size === 0) {
    warnings.push(
      `${config.county} County's sale file held ${sdfRows} transfers but none were a qualified vacant-land sale of a single parcel.`,
    );
    return { rows: [], warnings };
  }

  // ---- Pass 2: the property roll -------------------------------------------
  const facts = new Map<string, ReturnType<typeof parcelFactsFrom>>();
  let nalRows = 0;
  await streamZippedCsv<NalRow>(http, nalFile.url, options.signal, (row) => {
    nalRows += 1;
    const parcelId = (row.PARCEL_ID ?? '').trim();
    if (!parcelId || !sales.has(parcelId) || facts.has(parcelId)) return;
    facts.set(parcelId, parcelFactsFrom(row));
  });
  logger.info('florida property roll parsed', {
    source: source.key,
    parcels: nalRows,
    matched: facts.size,
    unmatched: sales.size - facts.size,
  });

  // ---- Join -----------------------------------------------------------------
  const rows: ComparableSaleInput[] = [];
  let missingParcel = 0;
  let missingAcreage = 0;
  let rollDisagreed = 0;

  for (const [parcelId, parcelSales] of sales) {
    const parcel = facts.get(parcelId);
    if (!parcel) {
      missingParcel += 1;
      continue;
    }
    if (!agreesVacant(parcel)) {
      rollDisagreed += 1;
      continue;
    }
    if (parcel.acreage == null || parcel.acreage <= 0) {
      missingAcreage += 1;
      continue;
    }
    for (const sale of parcelSales) {
      rows.push({
        state: source.state,
        county: source.county,
        apn: parcelId,
        saleDate: sale.saleDate,
        salePriceCents: sale.salePriceCents,
        acreage: parcel.acreage,
        latitude: null,
        longitude: null,
        zoning: null,
        landUse: sale.dorUseCode ?? parcel.dorUseCode,
        hasUtilities: null,
        isVacantLand: true,
        isArmsLength: true,
        deedType: sale.instrument,
        source: source.name,
        sourceUrl: source.sourceUrl,
      });
      if (config.maxComparables && rows.length >= config.maxComparables) break;
    }
    if (config.maxComparables && rows.length >= config.maxComparables) break;
  }

  if (rollDisagreed > 0) {
    warnings.push(
      `${rollDisagreed} sales the appraiser marked vacant were dropped because the property roll shows a building on the parcel.`,
    );
  }
  if (missingAcreage > 0) {
    warnings.push(
      `${missingAcreage} parcels publish no land area, so no price per acre is derivable.`,
    );
  }
  if (missingParcel > 0) {
    warnings.push(
      `${missingParcel} sold parcels are absent from the property roll — likely split or combined since the sale.`,
    );
  }

  return { rows, warnings };
}

/** Runs the whole import for one source and reports what happened. */
export function summariseFloridaImport(
  rows: readonly ComparableSaleInput[],
  warnings: readonly string[],
  written: number,
): CompsImportResult {
  const { rejected } = validateComparables(rows);
  return { discovered: rows.length, accepted: written, rejected, warnings: [...warnings] };
}

async function resolveFile(
  http: IngestHttpClient,
  kind: 'NAL' | 'SDF',
  config: FlDorConfig,
): Promise<RollFile | null> {
  let vintage = config.vintage;
  if (!vintage) {
    const vintages = await listVintages(http, kind);
    if (vintages.length === 0) return null;
    vintage = vintages[0]!.folder;
  }
  const files = await listRollFiles(http, kind, vintage);
  return matchCounty(files, config.county);
}
