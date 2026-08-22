import { describe, expect, it } from 'vitest';
import { findDocumentUrl, parseLandsAvailablePdfText } from './fl-lands-available-pdf';

/**
 * Text taken verbatim from Marion County's August 2026 price sheet, as unpdf
 * extracts it. The cover letter is repeated above every parcel in the real
 * document; one copy is enough to prove the block splitter does not mistake it
 * for a parcel.
 */
const SHEET = `Purchase of property on list of Lands Available for Taxes
PROPERTY IS SOLD BUYER BEWARE: CHECKS WILL NOT BE RETURNED UNLESS PROPERTY IS NO LONGER
AVAILABLE. THESE CALCULATIONS MAY NOT INCLUDE CURRENT YEAR TAXES.
Calculation for August 2026
SALE # 296268
CERTIFICATE NUMBER # 17663-2018
SALE DATE 05/14/2025
PARCEL # 4033-003-029
Description: SEC 30 TWP 16 RGE 25
MOSS BLUFF RIDGE
BLK C LOTS 29 THRU 39 & LOTS 56 THRU 66 BEING MORE FULLY DESC AS FOLLOWS:
PLAT BOOK UNR PAGE 084
PURCHASE AMOUNT $24,843.16
RECORDING FEE $ 35.50
DOC. STAMPS $ 174.30
TOTAL: $ 209.80
MAKE SEPARATE CHECK FOR RECORDING FEES & DOC STAMPS
Calculation for August 2026
SALE # 296632
CERTIFICATE NUMBER # 21914-2020
SALE DATE 10/08/2025
PARCEL # 5067-420-000
Description: SEC 21 TWP 17 RGE 25
BIG TREE CAMPSITES SEC B
PURCHASE AMOUNT $26,098.63
RECORDING FEE $ 27.00
DOC. STAMPS $ 182.70
TOTAL: $ 209.70`;

describe('parseLandsAvailablePdfText', () => {
  it('reads the purchase amount the clerk published, to the cent', () => {
    // This is the number the whole product was missing. Across three counties
    // and 304 parcels of inventory, not one carried an acquisition price.
    const { blocks } = parseLandsAvailablePdfText(SHEET);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.parcelId).toBe('4033-003-029');
    expect(blocks[0]!.purchaseAmount).toBe(24_843.16);
    expect(blocks[1]!.parcelId).toBe('5067-420-000');
    expect(blocks[1]!.purchaseAmount).toBe(26_098.63);
  });

  it('carries the sale, certificate and date that identify the parcel to the clerk', () => {
    // Buying one means quoting these back on the purchase request form.
    const { blocks } = parseLandsAvailablePdfText(SHEET);
    expect(blocks[0]!.saleNumber).toBe('296268');
    expect(blocks[0]!.certificateNumber).toBe('17663-2018');
    expect(blocks[0]!.saleDate).toBe('05/14/2025');
  });

  it('keeps the legal description whole across the lines it is wrapped over', () => {
    const { blocks } = parseLandsAvailablePdfText(SHEET);
    expect(blocks[0]!.legalDescription).toContain('SEC 30 TWP 16 RGE 25');
    expect(blocks[0]!.legalDescription).toContain('PLAT BOOK UNR PAGE 084');
    // The cover letter sits above the description and must not be swept into it.
    expect(blocks[0]!.legalDescription).not.toContain('BUYER BEWARE');
  });

  it('does not read the repeated cover letter as a parcel', () => {
    const { blocks } = parseLandsAvailablePdfText(SHEET);
    expect(blocks.every((block) => block.parcelId.length > 0)).toBe(true);
  });

  it('says so rather than returning nothing when the clerk changes the layout', () => {
    // Silence here would look identical to an empty list, and an empty lands-
    // available list is a perfectly normal thing for a county to have.
    const { blocks, warnings } = parseLandsAvailablePdfText('a cover letter and nothing else');
    expect(blocks).toHaveLength(0);
    expect(warnings[0]).toContain('changed the document layout');
  });

  it('reports a block whose amount will not parse instead of pricing it at zero', () => {
    const broken = SHEET.replace('PURCHASE AMOUNT $24,843.16', 'PURCHASE AMOUNT CALL OFFICE');
    const { blocks } = parseLandsAvailablePdfText(broken);
    expect(blocks[0]!.purchaseAmount).toBeNull();
  });
});

describe('findDocumentUrl', () => {
  const html = `<a href="/uploads/2026/01/LAT-List-Cover.pdf">Cover</a>
    <a href="/uploads/2026/07/LAT-List-updated3.13.2026-1.pdf">List</a>
    <a href="/uploads/2026/08/2026-August-LAT-Purchase-Amounts-1.pdf">Prices</a>`;

  it('finds this month’s price sheet among the other documents', () => {
    // The clerk renames the file every month, so it is discovered rather than
    // pinned — and the inventory list sits next to it under a similar name.
    const url = findDocumentUrl(
      html,
      /LAT[-_ ]?Purchase[-_ ]?Amounts/i,
      'https://example.gov/lat/',
    );
    expect(url).toBe('https://example.gov/uploads/2026/08/2026-August-LAT-Purchase-Amounts-1.pdf');
  });

  it('returns null rather than the wrong document when nothing matches', () => {
    expect(findDocumentUrl(html, /Nonexistent/i, 'https://example.gov/lat/')).toBeNull();
  });
});
