import { prisma, toDecimal } from '@land-alpha/db';
import { valuateParcel } from './valuation.service';
import { scoreParcelById } from './scoring.service';

/**
 * Recording acquisition prices in bulk.
 *
 * A county holds one list and answers one enquiry. Forty-six Orange County
 * parcels are waiting on a payoff figure from a single Comptroller's office,
 * and the reply comes back as a list. If recording it means re-typing
 * forty-six figures one parcel page at a time, the queue does not move — so
 * this parses whatever shape the reply arrives in.
 */

export interface BulkPriceOutcome {
  readonly applied: number;
  readonly unmatched: readonly string[];
}

export async function recordPricesInBulk(
  state: string,
  county: string,
  pasted: string,
): Promise<BulkPriceOutcome> {
  const lines = pasted
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { applied: 0, unmatched: [] };

  const parcels = await prisma.parcelOpportunity.findMany({
    where: { state, county, removedFromSourceAt: null },
    select: { id: true, apn: true, apnNormalized: true, sourceRecordId: true },
  });

  // A county's reply may cite the tax-deed number or the parcel number, and
  // either may carry punctuation the other system strips.
  const byReference = new Map<string, string>();
  for (const parcel of parcels) {
    for (const key of [parcel.sourceRecordId, parcel.apn, parcel.apnNormalized]) {
      if (key) byReference.set(normalizeReference(key), parcel.id);
    }
  }

  const touched: string[] = [];
  const unmatched: string[] = [];

  for (const line of lines) {
    // The amount is the last number on the line and the reference is whatever
    // precedes it. That reads "2024-16234, Orange County, $4,275.00" without
    // asking anyone to reformat an email first.
    const match = /^(.*?)[\s,\t]+\$?([\d,]+(?:\.\d{1,2})?)\s*$/.exec(line);
    if (!match) {
      unmatched.push(line);
      continue;
    }
    const parcelId = byReference.get(normalizeReference(match[1] ?? ''));
    const amount = Number((match[2] ?? '').replace(/,/g, ''));
    if (!parcelId || !Number.isFinite(amount) || amount < 0) {
      unmatched.push(line);
      continue;
    }
    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: { askingPrice: toDecimal(Math.round(amount * 100)) },
    });
    touched.push(parcelId);
  }

  // Re-price and re-rank. A figure recorded and not acted on is the same as no
  // figure at all.
  for (const parcelId of touched) {
    await valuateParcel(parcelId);
    await scoreParcelById(parcelId);
  }

  return { applied: touched.length, unmatched };
}

/** Reference keys differ only by punctuation and case between systems. */
function normalizeReference(value: string): string {
  return value.replace(/[^0-9a-z]/gi, '').toUpperCase();
}
