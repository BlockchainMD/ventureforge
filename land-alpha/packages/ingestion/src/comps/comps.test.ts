import { describe, expect, it } from 'vitest';
import {
  classifyArmsLength,
  classifyVacant,
  defineCompsSources,
  parseEsriDate,
  validateComparables,
  type ComparableSaleInput,
} from './index';
import { isAffirmative, isAffirmativeVacant, mapHeaders } from './csv-import';

/**
 * The comparable-sales guardrails.
 *
 * These are the tests that matter most in the valuation path: a comparable that
 * should have been rejected does not add noise, it moves the median an
 * acquisition is decided against. Every case below is a transfer that a naive
 * importer would happily treat as evidence of market value.
 */

const BASE: ComparableSaleInput = {
  state: 'MN',
  county: 'Grant',
  apn: '01-0001-000',
  saleDate: new Date('2024-06-01T00:00:00Z'),
  salePriceCents: 4_500_000, // $45,000
  acreage: 10,
  latitude: 45.9,
  longitude: -96.0,
  zoning: null,
  landUse: 'BARE LAND',
  hasUtilities: null,
  isVacantLand: true,
  isArmsLength: true,
  deedType: 'WARRANTY DEED',
  source: 'Grant County MN Assessor sales',
  sourceUrl: 'https://example.gov/layer',
};

const NOW = new Date('2026-01-01T00:00:00Z');
const row = (overrides: Partial<ComparableSaleInput>): ComparableSaleInput => ({
  ...BASE,
  ...overrides,
});
const reasons = (rows: ComparableSaleInput[]): string[] =>
  validateComparables(rows, NOW).rejected.map((entry) => entry.reason);

describe('validateComparables', () => {
  it('accepts a qualified vacant-land sale', () => {
    const { accepted, rejected } = validateComparables([BASE], NOW);
    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it('rejects improved-property and non-arm’s-length transfers', () => {
    expect(reasons([row({ isVacantLand: false })])).toEqual(['not vacant land']);
    expect(reasons([row({ isArmsLength: false })])).toEqual(['not an arm’s-length sale']);
  });

  it('rejects the $1 family transfer that would otherwise crater a median', () => {
    expect(reasons([row({ salePriceCents: 100 })])).toEqual([
      'price below the nominal-transfer floor',
    ]);
  });

  it('rejects acreage that is missing, zero or not a number', () => {
    expect(reasons([row({ acreage: 0 })])).toEqual(['missing or invalid acreage']);
    expect(reasons([row({ acreage: Number.NaN })])).toEqual(['missing or invalid acreage']);
  });

  it('rejects dates in the future and dates before recorded history is useful', () => {
    expect(reasons([row({ saleDate: new Date('2027-01-01T00:00:00Z') })])).toEqual([
      'sale date in the future',
    ]);
    expect(reasons([row({ saleDate: new Date('1965-01-01T00:00:00Z') })])).toEqual([
      'sale date implausibly old',
    ]);
    expect(reasons([row({ saleDate: new Date('nonsense') })])).toEqual(['invalid sale date']);
  });

  it('rejects a price per acre that can only be a unit error', () => {
    // $45,000 across a whole section: the acreage is the section, not the parcel.
    expect(reasons([row({ acreage: 640 })])).toEqual(['price per acre implausibly low (<$100/ac)']);
    // $45,000 on a tenth of an acre implies the price included a house.
    expect(reasons([row({ acreage: 0.05 })])).toEqual([
      'price per acre implausibly high (>$500k/ac)',
    ]);
  });

  it('counts rejections by reason so an import can be audited', () => {
    const { accepted, rejected } = validateComparables(
      [
        BASE,
        row({ isVacantLand: false }),
        row({ isVacantLand: false }),
        row({ isArmsLength: false }),
      ],
      NOW,
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toEqual([
      { reason: 'not vacant land', count: 2 },
      { reason: 'not an arm’s-length sale', count: 1 },
    ]);
  });
});

describe('classifyVacant', () => {
  const config = { vacantClassPatterns: ['BARE LAND', 'VACANT'] } as never;

  it('trusts an explicit vacant flag over the class text', () => {
    expect(classifyVacant('RESIDENTIAL', 'VACANT', config)).toBe(true);
    expect(classifyVacant('BARE LAND', 'IMPROVED', config)).toBe(false);
  });

  it('falls back to the county’s property-class vocabulary', () => {
    expect(classifyVacant('BARE LAND 34.5 ACRES OR LESS', null, config)).toBe(true);
    expect(classifyVacant('RES 1 UNIT', null, config)).toBe(false);
  });

  it('does not read "LAND W/ BLDG" as vacant land', () => {
    expect(classifyVacant('VACANT LAND W/ BLDG', null, config)).toBe(false);
    expect(classifyVacant('BARE LAND WITH BUILDING', null, config)).toBe(false);
  });

  it('treats an unrecognised class as improved rather than guessing', () => {
    expect(classifyVacant(null, null, config)).toBe(false);
    expect(classifyVacant('SOMETHING NEW', null, config)).toBe(false);
  });
});

describe('classifyArmsLength', () => {
  const map = {
    apn: 'PID',
    saleDate: 'D',
    salePrice: 'P',
    acreage: 'A',
    qualifiedFlag: 'goodsale',
  } as never;
  const config = { qualifiedValues: ['Yes', 'Y'] } as never;

  it('accepts the assessor’s qualified determination', () => {
    expect(classifyArmsLength({ goodsale: 'Yes' }, map, config)).toBe(true);
  });

  it('treats an empty qualified flag as unqualified by omission', () => {
    expect(classifyArmsLength({ goodsale: '' }, map, config)).toBe(false);
    expect(classifyArmsLength({ goodsale: null }, map, config)).toBe(false);
    expect(classifyArmsLength({ goodsale: 'No' }, map, config)).toBe(false);
  });

  it('lets a disqualifying deed veto a positive flag', () => {
    expect(classifyArmsLength({ goodsale: 'Yes', DOCNAME: 'QUIT CLAIM DEED' }, map, config)).toBe(
      false,
    );
    expect(
      classifyArmsLength({ goodsale: 'Yes', SALE_REASON: 'SALE TO RELATIVE' }, map, config),
    ).toBe(false);
    expect(
      classifyArmsLength({ goodsale: 'Yes', DEED_DESC: 'SHERIFF FORECLOSURE' }, map, config),
    ).toBe(false);
  });

  it('accepts when the county publishes no qualified flag at all', () => {
    const noFlag = { apn: 'PID', saleDate: 'D', salePrice: 'P', acreage: 'A' } as never;
    expect(classifyArmsLength({ DOCNAME: 'WARRANTY DEED' }, noFlag, config)).toBe(true);
  });
});

describe('parseEsriDate', () => {
  it('reads Esri epoch milliseconds', () => {
    expect(parseEsriDate(1_717_200_000_000)?.toISOString()).toBe('2024-06-01T00:00:00.000Z');
  });

  it('reads ISO strings and rejects sentinels', () => {
    expect(parseEsriDate('2024-06-01')?.getUTCFullYear()).toBe(2024);
    expect(parseEsriDate(0)).toBeNull();
    expect(parseEsriDate(-1)).toBeNull();
    expect(parseEsriDate('')).toBeNull();
    expect(parseEsriDate(null)).toBeNull();
    expect(parseEsriDate('1899-12-30')).toBeNull();
  });
});

describe('CSV header mapping', () => {
  it('maps a county sales export onto the canonical fields', () => {
    const mapping = mapHeaders([
      'PARCELID',
      'TRANSDT',
      'SALEAMNT',
      'DEEDED_ACRES',
      'SALE_VACANT_IMPROVED',
      'goodsale',
      'DOCNAME',
    ]);
    expect(mapping.apn).toBe('PARCELID');
    expect(mapping.saleDate).toBe('TRANSDT');
    expect(mapping.salePrice).toBe('SALEAMNT');
    expect(mapping.acreage).toBe('DEEDED_ACRES');
    expect(mapping.vacant).toBe('SALE_VACANT_IMPROVED');
    expect(mapping.qualified).toBe('goodsale');
    expect(mapping.deedType).toBe('DOCNAME');
  });

  it('claims each canonical field only once', () => {
    const mapping = mapHeaders(['Sale Date', 'Recorded Date']);
    expect(mapping.saleDate).toBe('Sale Date');
    expect(Object.values(mapping).filter((column) => column === 'Recorded Date')).toHaveLength(0);
  });

  it('leaves unmatched fields undefined rather than guessing', () => {
    const mapping = mapHeaders(['Sale Date', 'Price', 'Acres']);
    expect(mapping.vacant).toBeUndefined();
    expect(mapping.qualified).toBeUndefined();
  });
});

describe('CSV affirmative parsing', () => {
  it('reads vacancy without ever reading "IMPROVED" as vacant', () => {
    expect(isAffirmativeVacant('VACANT')).toBe(true);
    expect(isAffirmativeVacant('BARE LAND')).toBe(true);
    expect(isAffirmativeVacant('V')).toBe(true);
    expect(isAffirmativeVacant('IMPROVED')).toBe(false);
    expect(isAffirmativeVacant('I')).toBe(false);
    expect(isAffirmativeVacant('VACANT IMPROVED')).toBe(false);
    expect(isAffirmativeVacant(undefined)).toBe(false);
    expect(isAffirmativeVacant('')).toBe(false);
  });

  it('reads qualified-sale flags and rejects anything it does not recognise', () => {
    expect(isAffirmative('Yes')).toBe(true);
    expect(isAffirmative('Q')).toBe(true);
    expect(isAffirmative('good sale')).toBe(true);
    expect(isAffirmative('No')).toBe(false);
    expect(isAffirmative('U')).toBe(false);
    expect(isAffirmative(undefined)).toBe(false);
  });
});

describe('defineCompsSources', () => {
  const entry = {
    key: 'mn-example-sales',
    state: 'MN',
    county: 'Example',
    name: 'Example County MN assessor sales',
    adapterKey: 'arcgis-assessor-sales',
    sourceUrl: 'https://gis.example.gov/arcgis/rest/services/X/FeatureServer/0',
    status: 'ACTIVE' as const,
  };

  it('defaults a source to disabled until it is deliberately turned on', () => {
    expect(defineCompsSources([entry])[0]!.enabled).toBe(false);
  });

  it('rejects duplicate keys', () => {
    expect(() => defineCompsSources([entry, entry])).toThrow(/Duplicate comps source key/);
  });

  it('rejects a key that does not carry its state and the -sales suffix', () => {
    expect(() => defineCompsSources([{ ...entry, key: 'example-sales' }])).toThrow();
    expect(() => defineCompsSources([{ ...entry, key: 'mn-example' }])).toThrow();
  });
});
