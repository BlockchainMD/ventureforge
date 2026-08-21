import { describe, expect, it } from 'vitest';
import { matchCounty, parseRollFileName, type RollFile } from './catalog';
import {
  agreesVacant,
  parcelFactsFrom,
  qualifySdfRow,
  saleDateFrom,
  type NalRow,
  type SdfRow,
} from './parse';

/**
 * The Florida roll gates.
 *
 * Each of these corresponds to a class of transfer that would otherwise land in
 * the comp set and move a median an acquisition is decided against.
 */

const sdf = (overrides: Partial<SdfRow> = {}): SdfRow => ({
  PARCEL_ID: '022332122120130',
  VI_CD: 'V',
  QUAL_CD: '01',
  MULTI_PAR_SAL: '',
  SALE_PRC: '145000',
  SALE_YR: '2025',
  SALE_MO: '06',
  DOR_UC: '000',
  OR_BOOK: '11234',
  OR_PAGE: '0567',
  ...overrides,
});

describe('qualifySdfRow', () => {
  it('accepts a qualified vacant single-parcel sale', () => {
    const sale = qualifySdfRow(sdf());
    expect(sale).not.toBeNull();
    expect(sale!.salePriceCents).toBe(14_500_000);
    expect(sale!.saleDate.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(sale!.instrument).toBe('OR 11234/0567');
  });

  it('rejects an improved-property sale on the appraiser’s own flag', () => {
    expect(qualifySdfRow(sdf({ VI_CD: 'I' }))).toBeNull();
    expect(qualifySdfRow(sdf({ VI_CD: '' }))).toBeNull();
  });

  it('rejects every qualification code but the ones configured', () => {
    // 11, 14 and 19 sit at a median of $100 in Orange County's roll.
    for (const code of ['11', '14', '19', '05', '30', '']) {
      expect(qualifySdfRow(sdf({ QUAL_CD: code }))).toBeNull();
    }
    expect(
      qualifySdfRow(sdf({ QUAL_CD: '05' }), { qualifiedSaleCodes: ['01', '05'] }),
    ).not.toBeNull();
  });

  it('rejects a multi-parcel sale, whose price covers land we cannot see', () => {
    expect(qualifySdfRow(sdf({ MULTI_PAR_SAL: 'C' }))).toBeNull();
    expect(qualifySdfRow(sdf({ MULTI_PAR_SAL: 'D' }))).toBeNull();
  });

  it('honours the soldSince cutoff', () => {
    const options = { soldSince: new Date('2024-01-01T00:00:00Z') };
    expect(qualifySdfRow(sdf({ SALE_YR: '2023', SALE_MO: '12' }), options)).toBeNull();
    expect(qualifySdfRow(sdf({ SALE_YR: '2024', SALE_MO: '01' }), options)).not.toBeNull();
  });

  it('rejects a row with no usable price or date', () => {
    expect(qualifySdfRow(sdf({ SALE_PRC: '0' }))).toBeNull();
    expect(qualifySdfRow(sdf({ SALE_PRC: '' }))).toBeNull();
    expect(qualifySdfRow(sdf({ SALE_MO: '13' }))).toBeNull();
    expect(qualifySdfRow(sdf({ SALE_YR: '' }))).toBeNull();
    expect(qualifySdfRow(sdf({ PARCEL_ID: '  ' }))).toBeNull();
  });
});

describe('saleDateFrom', () => {
  it('dates a sale to the first of its month, because that is all the file knows', () => {
    expect(saleDateFrom('2026', '01')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(saleDateFrom('2025', '12')?.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });

  it('rejects impossible months and years', () => {
    expect(saleDateFrom('2025', '00')).toBeNull();
    expect(saleDateFrom('2025', '13')).toBeNull();
    expect(saleDateFrom('1899', '06')).toBeNull();
    expect(saleDateFrom(undefined, undefined)).toBeNull();
  });
});

describe('parcelFactsFrom / agreesVacant', () => {
  const nal = (overrides: Partial<NalRow> = {}): NalRow => ({
    LND_SQFOOT: '43560',
    NO_BULDNG: '0',
    TOT_LVG_AREA: '0',
    DOR_UC: '000',
    ...overrides,
  });

  it('converts square feet to acres', () => {
    expect(parcelFactsFrom(nal()).acreage).toBeCloseTo(1, 6);
    expect(parcelFactsFrom(nal({ LND_SQFOOT: '21780' })).acreage).toBeCloseTo(0.5, 6);
  });

  it('falls back to land units when the unit code says acres', () => {
    const facts = parcelFactsFrom(nal({ LND_SQFOOT: '', NO_LND_UNTS: '40', LND_UNTS_CD: '1' }));
    expect(facts.acreage).toBe(40);
  });

  it('does not read a non-acre unit count as acres', () => {
    expect(
      parcelFactsFrom(nal({ LND_SQFOOT: '', NO_LND_UNTS: '40', LND_UNTS_CD: '2' })).acreage,
    ).toBeNull();
    expect(parcelFactsFrom(nal({ LND_SQFOOT: '0' })).acreage).toBeNull();
  });

  it('lets the roll veto the sale file on vacancy', () => {
    // The gate that mattered most in practice: 185 of Orange County's
    // appraiser-marked-vacant sales carry a building on the roll.
    expect(agreesVacant(parcelFactsFrom(nal()))).toBe(true);
    expect(agreesVacant(parcelFactsFrom(nal({ NO_BULDNG: '1' })))).toBe(false);
    expect(agreesVacant(parcelFactsFrom(nal({ TOT_LVG_AREA: '1450' })))).toBe(false);
  });
});

describe('parseRollFileName', () => {
  it('reads county, code and kind from a published file name', () => {
    expect(parseRollFileName('Orange 58 Preliminary SDF 2026.zip')).toEqual({
      county: 'Orange',
      countyCode: 58,
      kind: 'SDF',
      year: 2026,
    });
    expect(parseRollFileName('Saint Lucie 66 Preliminary NAL 2026.zip')).toEqual({
      county: 'Saint Lucie',
      countyCode: 66,
      kind: 'NAL',
      year: 2026,
    });
  });

  it('tolerates a missing county number, which PTO does omit', () => {
    // Broward's 2026 preliminary SDF is published without one.
    expect(parseRollFileName('Broward Preliminary SDF 2026.zip')).toEqual({
      county: 'Broward',
      countyCode: null,
      kind: 'SDF',
      year: 2026,
    });
  });

  it('ignores roll kinds that are not comparable-sales inputs', () => {
    expect(parseRollFileName('Orange 58 Preliminary NAP 2026.zip')).toBeNull();
    expect(parseRollFileName('readme.txt')).toBeNull();
  });
});

describe('matchCounty', () => {
  const files = [
    { county: 'Saint Lucie', countyCode: 66, kind: 'SDF', vintage: '2026P', url: 'u', bytes: 1 },
    { county: 'Orange', countyCode: 58, kind: 'SDF', vintage: '2026P', url: 'u', bytes: 1 },
  ] as RollFile[];

  it('resolves the abbreviation PTO does not use', () => {
    expect(matchCounty(files, 'St. Lucie')?.countyCode).toBe(66);
    expect(matchCounty(files, 'st lucie')?.countyCode).toBe(66);
    expect(matchCounty(files, 'ORANGE')?.countyCode).toBe(58);
  });

  it('returns null rather than a near miss', () => {
    expect(matchCounty(files, 'Orangeburg')).toBeNull();
  });
});
