import {
  clampToExtractionMethod,
  dollarsToCents,
  type EvidenceInput,
  type ParcelOpportunityInput,
  type RejectedItem,
} from '@land-alpha/shared';
import { normalizeParcelGeometry, centroidOf } from '@land-alpha/gis';
import { ArcGisClient } from '../fetch/arcgis';
import { batchLookupParcels } from './parcel-lookup';
import {
  validateNormalized,
  type AdapterContext,
  type DiscoveredArtifact,
  type NormalizedBatch,
  type ParsedBatch,
  type SourceAdapter,
} from '../adapter';

/**
 * Florida "Lands Available for Taxes", read from the clerk's own price sheet.
 *
 * Every Florida clerk keeps this list under s.197.502(7): parcels offered at a
 * tax deed sale that nobody bought, purchasable by anyone after ninety days for
 * the opening bid plus omitted taxes. That figure is the single number this
 * product has never had. Across three counties and 304 parcels of inventory,
 * not one carried an acquisition price, so no return, margin or tier could be
 * computed for any of them.
 *
 * Most clerks make you ring for it. Marion County publishes it: a monthly PDF
 * with one block per parcel giving the sale number, the certificate, the parcel
 * ID, the legal description and the purchase amount to the cent. The list is
 * short — the whole point of the list is that it is what did not sell — but it
 * is priced, and a priced parcel is one the engine can underwrite end to end.
 *
 * The PDF carries embedded text, so this reads the text. It is not OCR and not
 * a scrape of a rendered page; nothing here defeats an access control, and the
 * clerk's robots.txt disallows nothing.
 *
 * What this adapter deliberately does not do is guess. A block whose purchase
 * amount will not parse is rejected with its reason rather than ingested at
 * zero, because a parcel wrongly recorded as free is exactly the failure this
 * whole price pathway exists to prevent.
 */

interface AdapterConfig {
  /** Page listing the current month's documents. The file names change monthly. */
  readonly indexUrl: string;
  /** Matches the price-sheet link on the index page. */
  readonly purchaseAmountsPattern: string;
  readonly acquisitionInstructions?: string;
  /**
   * The county's parcel layer. The price sheet gives an identifier, a legal
   * description and a figure; everything the engines need to decide whether
   * that figure is a good one — boundary, acreage, assessed values, zoning —
   * comes from here.
   */
  readonly parcelLayerUrl?: string;
  readonly parcelIdField?: string;
  readonly parcelFieldMap?: Record<string, string>;
}

/** One parcel block out of the price sheet. */
export interface LatBlock {
  readonly saleNumber: string;
  readonly certificateNumber: string | null;
  readonly saleDate: string | null;
  readonly parcelId: string;
  readonly legalDescription: string | null;
  readonly purchaseAmount: number | null;
  readonly recordingFee: number | null;
  readonly docStamps: number | null;
}

function readConfig(ctx: AdapterContext): AdapterConfig {
  const config = ctx.source.config as Partial<AdapterConfig>;
  if (!config.indexUrl) throw new Error(`${ctx.source.key}: config.indexUrl is required`);
  if (!config.purchaseAmountsPattern) {
    throw new Error(`${ctx.source.key}: config.purchaseAmountsPattern is required`);
  }
  return config as AdapterConfig;
}

const money = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const value = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) ? value : null;
};

const field = (block: string, pattern: RegExp): string | null => {
  const match = block.match(pattern);
  return match?.[1]?.trim() || null;
};

/**
 * Split the price sheet into one block per parcel and read each.
 *
 * The clerk repeats a full cover letter above every parcel, so the blocks are
 * delimited by the "Calculation for <Month> <Year>" heading rather than by page
 * breaks — a parcel with a long legal description runs over a page and a parcel
 * with a short one shares its page with the next letter.
 */
export function parseLandsAvailablePdfText(text: string): {
  blocks: LatBlock[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const segments = text.split(/Calculation for\s+[A-Za-z]+\s+\d{4}/g).slice(1);
  if (segments.length === 0) {
    warnings.push(
      'No "Calculation for <month> <year>" headings found in the price sheet. The clerk has changed the document layout and this adapter is reading nothing.',
    );
    return { blocks: [], warnings };
  }

  const blocks: LatBlock[] = [];
  for (const segment of segments) {
    const saleNumber = field(segment, /SALE #\s*([0-9]+)/);
    const parcelId = field(segment, /PARCEL #\s*([0-9A-Za-z-]+)/);
    if (!saleNumber || !parcelId) {
      warnings.push(
        `A parcel block carried ${saleNumber ? 'no parcel number' : 'no sale number'} and was skipped.`,
      );
      continue;
    }
    // The description runs from its label to the purchase amount, across as
    // many lines as the clerk needed for the metes and bounds.
    const description = segment
      .match(/Description:\s*([\s\S]*?)\s*PURCHASE AMOUNT/)?.[1]
      ?.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');

    blocks.push({
      saleNumber,
      certificateNumber: field(segment, /CERTIFICATE NUMBER #\s*([0-9A-Za-z-]+)/),
      saleDate: field(segment, /SALE DATE\s*(\d{2}\/\d{2}\/\d{4})/),
      parcelId,
      legalDescription: description || null,
      purchaseAmount: money(field(segment, /PURCHASE AMOUNT\s*\$?\s*([\d,]+\.\d{2})/) ?? undefined),
      recordingFee: money(field(segment, /RECORDING FEE\s*\$?\s*([\d,]+\.\d{2})/) ?? undefined),
      docStamps: money(field(segment, /DOC\.?\s*STAMPS\s*\$?\s*([\d,]+\.\d{2})/) ?? undefined),
    });
  }
  return { blocks, warnings };
}

/** Absolute URLs on the index page whose file name matches the pattern. */
export function findDocumentUrl(
  html: string,
  pattern: RegExp,
  baseUrl: string,
): string | null {
  const hrefs = [...html.matchAll(/href\s*=\s*["']([^"']+\.pdf)["']/gi)].map((m) => m[1]!);
  const match = hrefs.find((href) => pattern.test(href));
  return match ? new URL(match, baseUrl).toString() : null;
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
};

const DEFAULT_PARCEL_FIELDS: Record<string, string> = {
  acreage: 'ACRES',
  landAssessedValue: 'TOT_LND_VA',
  assessedValue: 'TOT_VAL',
  annualTaxEstimate: 'TOT_TAXES',
  zoning: 'ZONE1',
  neighborhood: 'MRKT_AREA',
  propertyClass: 'LND1',
};

const parseSaleDate = (raw: string | null): Date | null => {
  if (!raw) return null;
  const [month, day, year] = raw.split('/').map(Number);
  if (!month || !day || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const flLandsAvailablePdfAdapter: SourceAdapter = {
  key: 'fl-lands-available-pdf',
  description:
    'Florida clerk “Lands Available for Taxes” price sheet, published monthly as a text PDF with a purchase amount per parcel.',
  parserVersion: '1',

  async discover(ctx: AdapterContext): Promise<DiscoveredArtifact[]> {
    const config = readConfig(ctx);
    const index = await ctx.http.get(config.indexUrl);
    const url = findDocumentUrl(
      index.body.toString('utf8'),
      new RegExp(config.purchaseAmountsPattern, 'i'),
      config.indexUrl,
    );
    if (!url) {
      throw new Error(
        `${ctx.source.key}: no link matching /${config.purchaseAmountsPattern}/i on ${config.indexUrl}. The clerk republishes this file under a new name every month; the pattern needs updating rather than the file guessing.`,
      );
    }
    return [{ url, kind: 'PDF', label: `${ctx.source.name} purchase amounts` }];
  },

  async fetchAndParse(ctx: AdapterContext, artifact: DiscoveredArtifact): Promise<ParsedBatch> {
    const response = await ctx.http.get(artifact.url);
    const artifactKey = await ctx.persistArtifact('lands-available-purchase-amounts.pdf', response.body, {
      url: artifact.url,
      contentType: response.contentType,
    });

    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(response.body));
    const { text } = await extractText(pdf, { mergePages: true });

    const { blocks, warnings } = parseLandsAvailablePdfText(text);
    const records = blocks.map((block) => ({ ...block }) as unknown as Record<string, unknown>);

    const config = readConfig(ctx);
    if (config.parcelLayerUrl && records.length > 0) {
      const client = new ArcGisClient(ctx.http);
      const resolved = await batchLookupParcels(
        client,
        config.parcelLayerUrl,
        records.map((record) => String(record.parcelId)),
        { parcelIdField: config.parcelIdField, signal: ctx.signal },
      );
      let enriched = 0;
      for (const record of records) {
        const attributes = resolved.get(String(record.parcelId));
        if (attributes) {
          record.__parcel = attributes;
          enriched += 1;
        }
      }
      ctx.logger.info('parcel layer enrichment', {
        component: 'fl-lands-available-pdf',
        matched: enriched,
        of: records.length,
      });
      if (enriched < records.length) {
        warnings.push(
          `${records.length - enriched} of ${records.length} parcels did not match the county parcel layer, so they carry a price and no acreage. A price without an area cannot be underwritten.`,
        );
      }
    }

    return { records, artifactKey, sourceUrl: artifact.url, warnings };
  },

  async normalize(ctx: AdapterContext, batch: ParsedBatch): Promise<NormalizedBatch> {
    const config = readConfig(ctx);
    const items: ParcelOpportunityInput[] = [];
    const rejected: RejectedItem[] = [];
    const warnings: string[] = [...batch.warnings];

    batch.records.forEach((record, index) => {
      const block = record as unknown as LatBlock;
      if (block.purchaseAmount == null || block.purchaseAmount <= 0) {
        rejected.push({
          index,
          reason: `Parcel ${block.parcelId}: no purchase amount could be read. Ingesting it without one would put an unpriced parcel on a list whose entire value is that it is priced.`,
          raw: block,
        });
        return;
      }

      const evidence: EvidenceInput[] = [
        {
          field: 'askingPrice',
          value: String(block.purchaseAmount),
          source: `${ctx.source.name} — purchase amount sheet`,
          sourceUrl: batch.sourceUrl,
          retrievedAt: new Date(),
          confidence: clampToExtractionMethod('VERIFIED', 'PDF_TEXT'),
          extractionMethod: 'PDF_TEXT',
          notes:
            'The clerk’s own calculation of the opening bid plus omitted taxes. It rises monthly with accruing interest, so it is correct only for the month of the sheet it came from.',
        },
      ];

      const parcel = (record as { __parcel?: Record<string, unknown> }).__parcel;
      const fields = { ...DEFAULT_PARCEL_FIELDS, ...(config.parcelFieldMap ?? {}) };
      const attribute = (key: string): unknown =>
        parcel && fields[key] ? parcel[fields[key]!] : undefined;

      const { geometry, reason } = parcel?.__geometry
        ? normalizeParcelGeometry(parcel.__geometry)
        : { geometry: null, reason: null };
      if (reason) warnings.push(`${block.parcelId}: ${reason}`);
      const centroid = geometry ? centroidOf(geometry) : null;

      const landAssessed = num(attribute('landAssessedValue'));
      if (parcel) {
        evidence.push({
          field: 'acreage',
          value: String(num(attribute('acreage')) ?? ''),
          source: `${ctx.source.name} — county parcel layer`,
          sourceUrl: config.parcelLayerUrl ?? null,
          retrievedAt: new Date(),
          confidence: clampToExtractionMethod('VERIFIED', 'ARCGIS_QUERY'),
          extractionMethod: 'ARCGIS_QUERY',
          notes:
            'The price sheet names a parcel and a figure. Acreage, assessed values and zoning come from the county’s own parcel layer, matched on the same identifier.',
        });
      }

      items.push({
        sourceId: ctx.sourceId,
        sourceRecordId: block.saleNumber,
        sourceUrl: batch.sourceUrl,
        state: ctx.source.state,
        county: ctx.source.county ?? '',
        apn: block.parcelId,
        // Over the counter, not an auction: the sale already happened and
        // failed, which is precisely what put the parcel on this list.
        saleType: 'OVER_THE_COUNTER',
        // Purchasable on demand by anyone, first come first served. That is what
        // the statutory list is, and it is why these are worth more attention
        // than a parcel merely scheduled for a future auction.
        saleStatus: 'AVAILABLE',
        otcEligible: true,
        askingPrice: dollarsToCents(block.purchaseAmount),
        auctionDate: parseSaleDate(block.saleDate),
        legalDescription: block.legalDescription,
        acquisitionInstructions: config.acquisitionInstructions ?? null,

        geometry,
        latitude: centroid ? centroid[1] : null,
        longitude: centroid ? centroid[0] : null,
        acreage: num(attribute('acreage')),
        zoning: text(attribute('zoning')),
        neighborhood: text(attribute('neighborhood')),
        propertyClass: text(attribute('propertyClass')),
        landAssessedValue: landAssessed == null ? null : dollarsToCents(landAssessed),
        assessedValue: (() => {
          const total = num(attribute('assessedValue'));
          return total == null ? null : dollarsToCents(total);
        })(),
        annualTaxEstimate: (() => {
          const taxes = num(attribute('annualTaxEstimate'));
          return taxes == null ? null : dollarsToCents(taxes);
        })(),
        evidence,
        rawRecord: record,
        rawArtifactKey: batch.artifactKey,
      });
    });

    const validated = validateNormalized(items);
    return {
      items: validated.items,
      rejected: [...rejected, ...validated.rejected],
      warnings,
    };
  },
};
