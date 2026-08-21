import type { IngestHttpClient } from '../../fetch/http';

/**
 * Discovery for the Florida Department of Revenue tax-roll library.
 *
 * Florida is the only state in scope that publishes one sales file format for
 * every one of its 67 counties. Property appraisers submit three rolls to
 * Property Tax Oversight on a published schedule — preliminary in July, initial
 * final in October, final after value-adjustment-board certification — and PTO
 * republishes them. Two of those rolls matter here:
 *
 *   NAL  Name-Address-Legal: the real property roll. One row per parcel, with
 *        land area, DOR use code, assessed values and building counts.
 *   SDF  Sale Data File: one row per recorded transfer, carrying the appraiser's
 *        own vacant/improved determination and sale qualification code.
 *
 * Neither file alone is a comparable. The SDF knows a sale happened and whether
 * the appraiser qualified it; only the NAL knows how big the parcel is, and a
 * price without an area cannot produce a price per acre. The importer joins
 * them on (county, parcel id).
 *
 * The library is a SharePoint document store whose folder listing is rendered
 * client-side, so this reads the same content through SharePoint's public REST
 * API rather than scraping the rendered page. No credentials, no token, no
 * access control circumvented — the API is anonymous because the documents are
 * public records.
 */

const SITE = 'https://floridarevenue.com/property/dataportal';
const LIBRARY = '/property/dataportal/Documents/PTO Data Portal/Tax Roll Data Files';

export type RollKind = 'NAL' | 'SDF';

/** A submission round, e.g. `2026P`. The letter is the roll stage. */
export interface RollVintage {
  readonly folder: string;
  readonly year: number;
  /** `P` preliminary · `F` final · anything else PTO chooses to publish. */
  readonly stage: string;
}

export interface RollFile {
  readonly county: string;
  /** The DOR county number, absent from a handful of file names. */
  readonly countyCode: number | null;
  readonly kind: RollKind;
  readonly vintage: string;
  readonly url: string;
  readonly bytes: number;
}

interface SpFolder {
  Name: string;
  ItemCount: number;
  ServerRelativeUrl: string;
}
interface SpFile {
  Name: string;
  Length: string | number;
  ServerRelativeUrl: string;
}

const api = (serverRelativePath: string, child: 'Folders' | 'Files'): string =>
  `${SITE}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(serverRelativePath)}')/${child}`;

export const absoluteUrl = (serverRelativeUrl: string): string =>
  `https://floridarevenue.com${serverRelativeUrl.split('/').map(encodeURIComponent).join('/')}`;

/**
 * Available submission rounds for a roll kind, newest first.
 *
 * PTO keeps only the most current version of each roll on the site, so this is
 * usually a single entry — but it is read rather than assumed, because the
 * folder that exists in July is not the folder that exists in November.
 */
export async function listVintages(http: IngestHttpClient, kind: RollKind): Promise<RollVintage[]> {
  const body = await http.getJson<{ value: SpFolder[] }>(api(`${LIBRARY}/${kind}`, 'Folders'));
  return body.value
    .map((folder) => {
      const match = /^(\d{4})([A-Z]*)$/.exec(folder.Name.trim());
      if (!match) return null;
      return { folder: folder.Name, year: Number(match[1]), stage: match[2] || '' };
    })
    .filter((vintage): vintage is RollVintage => vintage != null)
    .sort((a, b) => b.year - a.year || b.stage.localeCompare(a.stage));
}

export async function listRollFiles(
  http: IngestHttpClient,
  kind: RollKind,
  vintage: string,
): Promise<RollFile[]> {
  const body = await http.getJson<{ value: SpFile[] }>(
    api(`${LIBRARY}/${kind}/${vintage}`, 'Files'),
  );
  return body.value
    .map((file) => {
      const parsed = parseRollFileName(file.Name);
      if (!parsed || parsed.kind !== kind) return null;
      return {
        county: parsed.county,
        countyCode: parsed.countyCode,
        kind,
        vintage,
        url: absoluteUrl(file.ServerRelativeUrl),
        bytes: Number(file.Length) || 0,
      };
    })
    .filter((file): file is RollFile => file != null);
}

/**
 * `Orange 58 Preliminary SDF 2026.zip` → county, code, kind.
 *
 * The county number is optional because PTO does not always include it —
 * Broward's 2026 preliminary SDF is published as `Broward Preliminary SDF
 * 2026.zip`. The name is the identifier that is always present, so it is the
 * one we match on.
 */
export function parseRollFileName(
  name: string,
): { county: string; countyCode: number | null; kind: RollKind; year: number } | null {
  const match = /^(.+?)\s+(?:(\d{1,2})\s+)?[A-Za-z ]*?(NAL|SDF|NAP|NAV)\s+(\d{4})\.zip$/i.exec(
    name.trim(),
  );
  if (!match) return null;
  const kind = match[3]!.toUpperCase();
  if (kind !== 'NAL' && kind !== 'SDF') return null;
  return {
    county: match[1]!.trim(),
    countyCode: match[2] ? Number(match[2]) : null,
    kind,
    year: Number(match[4]),
  };
}

/** Case- and punctuation-insensitive, so `St. Lucie` finds `Saint Lucie`. */
export function matchCounty(files: readonly RollFile[], county: string): RollFile | null {
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/\bst\.?\b/g, 'saint')
      .replace(/[^a-z]/g, '');
  const target = normalize(county);
  return files.find((file) => normalize(file.county) === target) ?? null;
}
