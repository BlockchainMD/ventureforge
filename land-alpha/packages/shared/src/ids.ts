import { createHash, randomUUID } from 'node:crypto';

/** Identity helpers: stable keys, APN normalisation, URL slugs. */

export function newId(): string {
  return randomUUID();
}

/**
 * Normalise an assessor parcel number for comparison.
 *
 * Counties print the same APN a dozen ways ("010-0123-00010", "010 0123 00010",
 * "0100123-00010"). Matching on the raw string produces duplicate parcels, which
 * is an explicit hard-rejection condition, so normalisation happens once at
 * ingestion and the normalised form is what we key on.
 *
 * The display form is always preserved separately; this is only for matching.
 */
export function normalizeApn(apn: string): string {
  return apn
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/^0+(?=\d)/, (match) => match); // keep leading zeros: they are significant
}

/** True when two APNs refer to the same parcel after normalisation. */
export function apnEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeApn(a) === normalizeApn(b);
}

/**
 * Deterministic natural key for a parcel record from a given source.
 *
 * Ingestion is idempotent: re-running a county import must update rows, not
 * duplicate them. The key is (sourceId, sourceRecordId ?? normalised APN).
 */
export function parcelNaturalKey(input: {
  sourceId: string;
  sourceRecordId?: string | null;
  apn?: string | null;
}): string {
  const discriminator = input.sourceRecordId?.trim()
    ? `rec:${input.sourceRecordId.trim()}`
    : input.apn
      ? `apn:${normalizeApn(input.apn)}`
      : null;
  if (!discriminator) {
    throw new Error('parcelNaturalKey requires either sourceRecordId or apn');
  }
  return `${input.sourceId}|${discriminator}`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function shortHash(value: string, length = 10): string {
  return sha256(value).slice(0, length);
}

/** Content hash of a raw source payload, used for change detection. */
export function contentHash(buffer: Buffer | string): string {
  return createHash('sha256')
    .update(typeof buffer === 'string' ? Buffer.from(buffer, 'utf8') : buffer)
    .digest('hex');
}

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Public listing slug: human-readable and collision-resistant.
 * e.g. "5-23-acres-st-louis-county-mn-7f3a91c2"
 */
export function listingSlug(input: {
  acreage?: number | null;
  county: string;
  state: string;
  parcelId: string;
}): string {
  const acreagePart =
    input.acreage != null && input.acreage > 0
      ? `${input.acreage.toFixed(2).replace(/\.?0+$/, '').replace('.', '-')}-acres`
      : 'land';
  const place = slugify(`${input.county}-county-${input.state}`);
  return `${slugify(acreagePart)}-${place}-${shortHash(input.parcelId, 8)}`;
}

/** FIPS helpers. State FIPS is 2 digits, county FIPS is the 5-digit combined code. */
export function isValidCountyFips(value: string): boolean {
  return /^\d{5}$/.test(value);
}

export function stateFipsFromCountyFips(countyFips: string): string | null {
  return isValidCountyFips(countyFips) ? countyFips.slice(0, 2) : null;
}
