import { prisma, toDecimal } from '@land-alpha/db';
import { createLogger } from '@land-alpha/shared/logger';
import type { IngestHttpClient } from '../../fetch/http';
import { listRollFiles, listVintages, matchCounty } from './catalog';
import { parcelFactsFrom, type NalRow } from './parse';
import { streamZippedCsv } from './stream';

/**
 * Enrich Florida inventory from the same roll that supplies the comparables.
 *
 * A tax-deed or lands-available list publishes what the county needs to sell a
 * parcel — a legal description, an opening bid — and rarely what is needed to
 * value one. Fifty-five of Orange County's sixty-four listed parcels arrived
 * with no acreage at all, and a parcel with no area cannot be valued against a
 * price per acre, so it fell out of the pipeline entirely.
 *
 * The NAL has all of it. Every parcel in the county is on the roll with its
 * land area, land and improvement values, use code and building count, and the
 * assessment roll's parcel id is the county's own parcel id with the formatting
 * removed — `24-24-28-5844-00-310` and `242428584400310` are the same parcel.
 * All fifty-five matched.
 *
 * Values are only ever filled in where the parcel has none. The county list is
 * the authority on what is for sale and at what price; the roll is the
 * authority on what the parcel is. Neither overwrites the other.
 */

const logger = createLogger({ component: 'fl-dor-enrich' });

export interface FloridaEnrichmentResult {
  readonly examined: number;
  readonly matched: number;
  readonly acreageFilled: number;
  readonly valuesFilled: number;
  readonly improvedFound: number;
  readonly warnings: string[];
}

/** Roll ids carry no punctuation; county lists usually do. */
export function normalizeFloridaParcelId(apn: string | null | undefined): string | null {
  const digits = (apn ?? '').replace(/[^0-9]/g, '');
  return digits.length === 0 ? null : digits;
}

export async function enrichFloridaParcels(
  http: IngestHttpClient,
  options: { state?: string; county: string; vintage?: string; signal?: AbortSignal },
): Promise<FloridaEnrichmentResult> {
  const state = options.state ?? 'FL';
  const warnings: string[] = [];

  const parcels = await prisma.parcelOpportunity.findMany({
    where: { state, county: options.county },
    select: {
      id: true,
      apn: true,
      acreage: true,
      landAssessedValue: true,
      improvementAssessedValue: true,
      assessedValue: true,
      propertyClass: true,
      isVacant: true,
    },
  });
  if (parcels.length === 0) {
    return {
      examined: 0,
      matched: 0,
      acreageFilled: 0,
      valuesFilled: 0,
      improvedFound: 0,
      warnings,
    };
  }

  const byRollId = new Map<string, (typeof parcels)[number][]>();
  for (const parcel of parcels) {
    const key = normalizeFloridaParcelId(parcel.apn);
    if (!key) continue;
    const bucket = byRollId.get(key);
    if (bucket) bucket.push(parcel);
    else byRollId.set(key, [parcel]);
  }

  let vintage = options.vintage;
  if (!vintage) {
    const vintages = await listVintages(http, 'NAL');
    if (vintages.length === 0) throw new Error('No Florida NAL roll is published');
    vintage = vintages[0]!.folder;
  }
  const nalFile = matchCounty(await listRollFiles(http, 'NAL', vintage), options.county);
  if (!nalFile) throw new Error(`No Florida NAL published for ${options.county}`);

  const found = new Map<
    string,
    ReturnType<typeof parcelFactsFrom> & { landValue: number | null; justValue: number | null }
  >();
  await streamZippedCsv<NalRow & { LND_VAL?: string; JV?: string }>(
    http,
    nalFile.url,
    options.signal,
    (row) => {
      const key = (row.PARCEL_ID ?? '').trim();
      if (!key || !byRollId.has(key) || found.has(key)) return;
      found.set(key, {
        ...parcelFactsFrom(row),
        landValue: numberOrNull(row.LND_VAL),
        justValue: numberOrNull(row.JV),
      });
    },
  );

  let acreageFilled = 0;
  let valuesFilled = 0;
  let improvedFound = 0;

  for (const [key, matches] of byRollId) {
    const facts = found.get(key);
    if (!facts) continue;
    for (const parcel of matches) {
      const data: Record<string, unknown> = {};

      if (
        (parcel.acreage == null || parcel.acreage <= 0) &&
        facts.acreage != null &&
        facts.acreage > 0
      ) {
        data.acreage = facts.acreage;
        acreageFilled += 1;
      }
      if (parcel.landAssessedValue == null && facts.landValue != null) {
        data.landAssessedValue = toDecimal(Math.round(facts.landValue * 100));
      }
      if (parcel.assessedValue == null && facts.justValue != null) {
        data.assessedValue = toDecimal(Math.round(facts.justValue * 100));
      }
      if (parcel.propertyClass == null && facts.dorUseCode) {
        data.propertyClass = `DOR ${facts.dorUseCode}`;
      }

      // A building on the roll is a material contradiction of a vacant-land
      // listing, and it is the sort of thing an analyst must be told rather
      // than have quietly averaged into a valuation.
      const rollSaysVacant = facts.buildingCount === 0 && facts.livingArea === 0;
      if (parcel.isVacant == null) data.isVacant = rollSaysVacant;
      if (!rollSaysVacant) improvedFound += 1;

      if (data.landAssessedValue != null || data.assessedValue != null) valuesFilled += 1;
      if (Object.keys(data).length > 0) {
        await prisma.parcelOpportunity.update({ where: { id: parcel.id }, data });
      }

      await prisma.evidence.create({
        data: {
          parcelId: parcel.id,
          field: 'acreage',
          value: facts.acreage == null ? 'unknown' : facts.acreage.toFixed(4),
          source: `Florida DOR ${vintage} NAL — ${options.county} County`,
          sourceUrl: nalFile.url,
          retrievalDate: new Date(),
          // The assessment roll is the county's own record of the parcel, not
          // an inference drawn from one.
          confidence: 'HIGH',
          extractionMethod: 'STRUCTURED_FIELD',
          notes: `Roll shows ${facts.buildingCount} building(s), ${facts.livingArea} sq ft living area.`,
        },
      });
    }
  }

  if (improvedFound > 0) {
    warnings.push(
      `${improvedFound} listed parcels carry a building on the assessment roll and are not vacant land.`,
    );
  }
  const unmatched = byRollId.size - found.size;
  if (unmatched > 0) {
    warnings.push(`${unmatched} listed parcels were not found on the ${vintage} roll.`);
  }

  logger.info('florida parcels enriched from roll', {
    county: options.county,
    examined: parcels.length,
    matched: found.size,
    acreageFilled,
    improvedFound,
  });

  return {
    examined: parcels.length,
    matched: found.size,
    acreageFilled,
    valuesFilled,
    improvedFound,
    warnings,
  };
}

function numberOrNull(value: string | undefined): number | null {
  const parsed = Number((value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
