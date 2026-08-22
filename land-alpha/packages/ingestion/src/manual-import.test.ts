import { describe, expect, it } from 'vitest';
import {
  applyMapping,
  parseImportFile,
  parseLooseDate,
  parseMoney,
  parseNumber,
  suggestMapping,
} from './manual-import';
import { parseRobotsTxt, isAllowed, crawlDelayMs } from './fetch/robots';
import { detectChanges, isPriceReduction, requiresRescore } from './change-detection';
import { validateNormalized } from './adapter';
import { chunkByLength, parcelIdCandidates, parseDate } from './adapters/arcgis-tax-sale-points';

describe('parseImportFile — CSV', () => {
  it('parses a county CSV export', async () => {
    const csv = [
      'Parcel Number,Minimum Bid,Acres,Legal Description,Sale Date',
      '"010-0001-00010","$3,140",5.23,"NE1/4 of SW1/4","09/24/2026"',
      '"010-0001-00020","$4,800",20.40,"Government Lot 3","09/24/2026"',
    ].join('\n');

    const sheet = await parseImportFile('inventory.csv', Buffer.from(csv, 'utf8'));
    expect(sheet.columns).toContain('Parcel Number');
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]!['Minimum Bid']).toBe('$3,140');
  });

  it('refuses legacy .xls with actionable guidance rather than mis-parsing it', async () => {
    await expect(parseImportFile('list.xls', Buffer.from('junk'))).rejects.toThrow(
      /re-save it as/i,
    );
  });

  it('rejects an unknown file type', async () => {
    await expect(parseImportFile('list.docx', Buffer.from('junk'))).rejects.toThrow(/Unsupported/i);
  });
});

describe('suggestMapping', () => {
  it('maps the column names counties actually use', () => {
    const mapping = suggestMapping([
      'Parcel Number',
      'Minimum Bid',
      'Acres',
      'Legal Description',
      'Sale Date',
      'Owner Name',
    ]);
    expect(mapping['Parcel Number']).toBe('apn');
    expect(mapping['Minimum Bid']).toBe('minimumBid');
    expect(mapping['Acres']).toBe('acreage');
    expect(mapping['Legal Description']).toBe('legalDescription');
    expect(mapping['Sale Date']).toBe('auctionDate');
    expect(mapping['Owner Name']).toBe('currentOwner');
  });

  it('never assigns the same target field to two columns', () => {
    const mapping = suggestMapping(['Parcel', 'Parcel ID', 'PIN']);
    const targets = Object.values(mapping);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('leaves columns it does not recognise unmapped', () => {
    const mapping = suggestMapping(['Widget Code', 'Internal Ref']);
    expect(Object.keys(mapping)).toHaveLength(0);
  });
});

describe('applyMapping', () => {
  const context = { sourceId: 'src-1', state: 'MN', county: 'St. Louis' };

  it('produces canonical parcels with analyst-entry provenance', () => {
    const result = applyMapping(
      {
        columns: ['Parcel Number', 'Minimum Bid', 'Acres'],
        rows: [{ 'Parcel Number': '010-0001-00010', 'Minimum Bid': '$3,140', Acres: '5.23' }],
        warnings: [],
      },
      { 'Parcel Number': 'apn', 'Minimum Bid': 'minimumBid', Acres: 'acreage' },
      context,
    );

    expect(result.items).toHaveLength(1);
    const parcel = result.items[0]!;
    expect(parcel.apn).toBe('010-0001-00010');
    expect(parcel.minimumBid).toBe(314_000);
    expect(parcel.acreage).toBeCloseTo(5.23);
    expect(parcel.evidence?.every((row) => row.extractionMethod === 'ANALYST_ENTRY')).toBe(true);
  });

  it('rejects rows with no identifier and reports why', () => {
    const result = applyMapping(
      {
        columns: ['Parcel Number', 'Acres'],
        rows: [{ 'Parcel Number': '', Acres: '5' }],
        warnings: [],
      },
      { 'Parcel Number': 'apn', Acres: 'acreage' },
      context,
    );
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/neither an APN nor a source record identifier/);
  });
});

describe('money and date parsing', () => {
  it('parses the money formats counties publish', () => {
    expect(parseMoney('$3,140')).toBe(314_000);
    expect(parseMoney('3140.00')).toBe(314_000);
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('n/a')).toBeNull();
  });

  it('parses unambiguous dates and refuses ambiguous ones', () => {
    expect(parseLooseDate('09/24/2026')?.toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(parseLooseDate('2026-09-24')?.toISOString().slice(0, 10)).toBe('2026-09-24');
    // 24/09/2026 is day-first; guessing would risk a wrong auction date.
    expect(parseLooseDate('24/09/2026')).toBeNull();
    expect(parseLooseDate('sometime in the fall')).toBeNull();
  });

  it('parses numbers with separators', () => {
    expect(parseNumber('1,234.5')).toBeCloseTo(1234.5);
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('robots.txt', () => {
  const robots = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Crawl-delay: 5

User-agent: LandAlphaBot
Disallow: /admin/
Allow: /admin/public/
  `);

  it('applies the most specific matching group', () => {
    expect(isAllowed(robots, 'LandAlphaBot/0.1', '/private/list')).toBe(true);
    expect(isAllowed(robots, 'LandAlphaBot/0.1', '/admin/secret')).toBe(false);
    expect(isAllowed(robots, 'OtherBot/1.0', '/private/list')).toBe(false);
  });

  it('gives the longest matching rule precedence', () => {
    expect(isAllowed(robots, 'LandAlphaBot/0.1', '/admin/public/inventory.csv')).toBe(true);
  });

  it('reads crawl-delay from the applicable group', () => {
    expect(crawlDelayMs(robots, 'OtherBot/1.0')).toBe(5000);
  });

  it('treats an absent robots.txt as permissive', () => {
    expect(isAllowed({ groups: [], sitemaps: [], absent: true }, 'LandAlphaBot', '/anything')).toBe(
      true,
    );
  });

  it('honours wildcards and end-anchors', () => {
    const wildcards = parseRobotsTxt('User-agent: *\nDisallow: /*.pdf$');
    expect(isAllowed(wildcards, 'LandAlphaBot', '/files/list.pdf')).toBe(false);
    expect(isAllowed(wildcards, 'LandAlphaBot', '/files/list.csv')).toBe(true);
  });
});

describe('change detection', () => {
  const base = {
    minimumBid: 3140,
    askingPrice: null,
    auctionDate: new Date('2026-09-24'),
    offerDeadline: null,
    saleStatus: 'AVAILABLE',
    acreage: 5.23,
    taxesDue: 200,
    legalDescription: 'NE1/4',
    currentOwner: 'State of MN',
  };

  it('detects a price cut and flags it as a reduction', () => {
    const changes = detectChanges(base, { ...base, minimumBid: 2400 });
    expect(changes.some((change) => change.kind === 'PRICE_CHANGED')).toBe(true);
    expect(isPriceReduction(changes)).toBe(true);
    expect(requiresRescore(changes)).toBe(true);
  });

  it('does not flag a price rise as a reduction', () => {
    expect(isPriceReduction(detectChanges(base, { ...base, minimumBid: 4000 }))).toBe(false);
  });

  it('ignores whitespace-only text differences', () => {
    const changes = detectChanges(base, { ...base, legalDescription: '  NE1/4  ' });
    expect(changes).toHaveLength(0);
  });

  it('flags a material acreage correction but ignores rounding noise', () => {
    expect(detectChanges(base, { ...base, acreage: 5.24 })).toHaveLength(0);
    const corrected = detectChanges(base, { ...base, acreage: 2.5 });
    expect(corrected.some((change) => change.field === 'acreage')).toBe(true);
  });

  it('detects an auction date move', () => {
    const changes = detectChanges(base, { ...base, auctionDate: new Date('2026-11-12') });
    expect(changes.some((change) => change.kind === 'AUCTION_DATE_CHANGED')).toBe(true);
  });
});

describe('validateNormalized', () => {
  const parcel = {
    sourceId: 's',
    state: 'MN',
    county: 'St. Louis',
    apn: '010-1',
  };

  it('rejects an implausible acreage rather than storing it', () => {
    const result = validateNormalized([{ ...parcel, acreage: 120_000 }]);
    expect(result.items).toHaveLength(0);
    expect(result.rejected[0]!.reason).toMatch(/implausible acreage/);
  });

  it('rejects out-of-range coordinates', () => {
    const result = validateNormalized([{ ...parcel, latitude: 200, longitude: -92 }]);
    expect(result.rejected[0]!.reason).toMatch(/latitude out of range/);
  });

  it('rejects a duplicate within the same batch', () => {
    const result = validateNormalized([parcel, parcel]);
    expect(result.items).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/duplicate/);
  });

  it('rejects a bad state code', () => {
    const result = validateNormalized([{ ...parcel, state: 'Minnesota' }]);
    expect(result.rejected[0]!.reason).toMatch(/invalid state code/);
  });
});

describe('ArcGIS helpers', () => {
  it('chunks candidate ids to keep query strings under the server limit', () => {
    const values = Array.from({ length: 200 }, (_, i) => `PARCEL${String(i).padStart(10, '0')}`);
    const chunks = chunkByLength(values, 1400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const cost = chunk.reduce((sum, value) => sum + value.length + 4, 0);
      expect(cost).toBeLessThanOrEqual(1400 + 24);
    }
    expect(chunks.flat()).toHaveLength(values.length);
  });

  it('produces the ordering Orange County’s parcel layer actually uses', () => {
    // The tax-sale layer publishes section-township-range and the parcel layer
    // stores range-township-section, so the join hinges on reversing the first
    // three groups. Verified against the live layer: this form matched all 55
    // Orange records, and the unreversed one matched none.
    expect(parcelIdCandidates('24-22-32-6214-00-280')).toContain('322224621400280');
  });

  it('reverses a bare fifteen-digit id, not only a hyphenated one', () => {
    // Florida's tax roll publishes parcel IDs unpunctuated. Only the
    // hyphenated form was ever reordered, so 655 Orange comparables matched
    // nothing at all against the county parcel layer.
    expect(parcelIdCandidates('032229262817070')).toContain('292203262817070');
    expect(parcelIdCandidates('062332102705001')).toContain('322306102705001');
  });

  it('leaves an id that is not fifteen digits alone', () => {
    const candidates = parcelIdCandidates('010-0070-00070');
    expect(candidates).toContain('010007000070');
  });

  it('generates plausible parcel-id orderings without duplicates', () => {
    const candidates = parcelIdCandidates('05-23-29-7398-05-150');
    expect(candidates).toContain('052329739805150');
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('parses ArcGIS epoch dates and rejects sentinels', () => {
    expect(parseDate(1_790_000_000_000)?.getUTCFullYear()).toBeGreaterThan(2020);
    expect(parseDate(-99_999_999_999_999)).toBeNull();
    expect(parseDate('09/24/2026')?.toISOString().slice(0, 10)).toBe('2026-09-24');
    expect(parseDate('')).toBeNull();
  });
});
