import type { ParcelGeometry, Position } from '@land-alpha/shared';

/**
 * Development fixture parcels.
 *
 * Thirty-two hand-specified parcels covering every archetype the pipeline has
 * to handle correctly, including the ones it must *reject*. These exist so the
 * entire product — dashboard, filters, detail page, deal room, listing
 * generation — is exercisable with no network and no county cooperation, and so
 * that a change to a rejection rule has a visible, reviewable effect.
 *
 * Each fixture states, in `expectation`, what the pipeline is supposed to
 * conclude about it. The integration test asserts against that field, which
 * makes this file a specification rather than just sample data.
 */

export interface FixtureParcel {
  readonly key: string;
  readonly registryKey: string;
  readonly state: string;
  readonly county: string;
  readonly apn: string;
  readonly label: string;
  readonly center: Position;
  readonly acreage: number;
  /** Long-axis / short-axis. > 8 produces a narrow strip. */
  readonly aspect: number;
  readonly minimumBidDollars: number | null;
  readonly askingPriceDollars: number | null;
  readonly landAssessedDollars: number | null;
  readonly annualTaxDollars: number | null;
  readonly zoning: string | null;
  readonly minimumLotSizeAcres: number | null;
  readonly legalDescription: string;
  readonly failedSaleCount: number;
  readonly otcEligible: boolean;
  readonly saleType: 'AUCTION' | 'OVER_THE_COUNTER' | 'SEALED_BID' | 'UNKNOWN';
  readonly auctionInDays: number | null;
  readonly firstSeenDaysAgo: number;
  /** Pre-set enrichment so fixtures do not require live federal services. */
  readonly enrichment: {
    readonly roadFrontageMeters: number;
    readonly nearestRoadMeters: number;
    readonly nearestRoadName: string | null;
    readonly roadIsPublic: boolean | null;
    readonly roadIsPaved: boolean | null;
    readonly floodZones: string[];
    readonly floodOverlapFraction: number | null;
    readonly wetlandTypes: string[];
    readonly wetlandOverlapFraction: number | null;
    readonly meanSlopePercent: number | null;
    readonly nearestContaminatedSiteMeters: number | null;
    readonly titleRiskScore: number | null;
  };
  readonly expectation: {
    readonly rejected: boolean;
    readonly rejectionRule?: string;
    readonly accessClass?: 'A' | 'B' | 'C' | 'D' | 'UNKNOWN';
    readonly buildability?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    readonly note: string;
  };
}

const MN: Position = [-92.35, 47.35];
const MI: Position = [-86.0, 42.95];
const FL: Position = [-81.35, 28.5];

function near(base: Position, dx: number, dy: number): Position {
  return [base[0] + dx, base[1] + dy];
}

export const FIXTURE_PARCELS: FixtureParcel[] = [
  // ---- The thesis case ----------------------------------------------------
  {
    key: 'fx-mn-flagship',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0001-00010',
    label: 'Failed-auction OTC acreage with county road frontage',
    center: near(MN, 0.02, 0.01),
    acreage: 5.23,
    aspect: 1.15,
    minimumBidDollars: 3140,
    askingPriceDollars: null,
    landAssessedDollars: 8600,
    annualTaxDollars: 118,
    zoning: 'RR',
    minimumLotSizeAcres: 2,
    legalDescription: 'NE1/4 of SW1/4, Section 12, Township 55N, Range 15W, 5.23 acres more or less',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 420,
    enrichment: {
      roadFrontageMeters: 132,
      nearestRoadMeters: 2,
      nearestRoadName: 'County Road 88',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 3.2,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 18,
    },
    expectation: {
      rejected: false,
      accessClass: 'A',
      buildability: 'GREEN',
      note: 'The canonical Land Alpha find: failed auction, standing OTC inventory, deep discount, clean geometry, apparent public frontage.',
    },
  },
  {
    key: 'fx-mn-exceptional',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0001-00020',
    label: 'Twice-failed 20 acres at a fraction of assessed value',
    center: near(MN, -0.08, 0.05),
    acreage: 20.4,
    aspect: 1.3,
    minimumBidDollars: 4800,
    askingPriceDollars: null,
    landAssessedDollars: 31_000,
    annualTaxDollars: 340,
    zoning: 'FAM',
    minimumLotSizeAcres: 10,
    legalDescription: 'Government Lot 3, Section 8, Township 56N, Range 14W',
    failedSaleCount: 2,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 700,
    enrichment: {
      roadFrontageMeters: 210,
      nearestRoadMeters: 1,
      nearestRoadName: 'Forest Road 112',
      roadIsPublic: true,
      roadIsPaved: false,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: ['PFO1B'],
      wetlandOverlapFraction: 0.12,
      meanSlopePercent: 5.1,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 22,
    },
    expectation: {
      rejected: false,
      accessClass: 'A',
      buildability: 'YELLOW',
      note: 'Exceptional economics with a minor wetland fringe — should score high but not GREEN.',
    },
  },

  // ---- Rejections ---------------------------------------------------------
  {
    key: 'fx-mn-roadway-remnant',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0002-00010',
    label: 'Narrow strip: apparent roadway remnant',
    center: near(MN, 0.05, -0.03),
    acreage: 0.9,
    aspect: 40,
    minimumBidDollars: 400,
    askingPriceDollars: null,
    landAssessedDollars: 900,
    annualTaxDollars: 12,
    zoning: 'RR',
    minimumLotSizeAcres: 2,
    legalDescription: 'That part of the SW1/4 lying within the former railroad right of way',
    failedSaleCount: 3,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 900,
    enrichment: {
      roadFrontageMeters: 380,
      nearestRoadMeters: 1,
      nearestRoadName: 'Old Highway 53',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 2,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 30,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'ROADWAY_REMNANT',
      note: 'Cheap, has "frontage", three failed sales — looks like a bargain in a table and is worthless. Must be rejected on geometry alone.',
    },
  },
  {
    key: 'fx-mn-landlocked',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0002-00020',
    label: 'Landlocked 40 acres, no recorded easement',
    center: near(MN, -0.15, -0.12),
    acreage: 40.1,
    aspect: 1.05,
    minimumBidDollars: 12_000,
    askingPriceDollars: null,
    landAssessedDollars: 46_000,
    annualTaxDollars: 520,
    zoning: 'FAM',
    minimumLotSizeAcres: 10,
    legalDescription: 'SE1/4 of NE1/4, Section 22, Township 57N, Range 16W',
    failedSaleCount: 2,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 600,
    enrichment: {
      roadFrontageMeters: 0,
      nearestRoadMeters: 780,
      nearestRoadName: 'County Road 4',
      roadIsPublic: true,
      roadIsPaved: false,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 4,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 25,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'NO_ACCESS_WITHOUT_EXCEPTIONAL_DISCOUNT',
      accessClass: 'D',
      buildability: 'RED',
      note: '40 acres for $12,000 reads well until you notice there is no way to reach it.',
    },
  },
  {
    key: 'fx-mn-wetland',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0002-00030',
    label: 'Almost entirely mapped wetland',
    center: near(MN, 0.12, 0.14),
    acreage: 12.6,
    aspect: 1.4,
    minimumBidDollars: 1800,
    askingPriceDollars: null,
    landAssessedDollars: 4200,
    annualTaxDollars: 48,
    zoning: 'FAM',
    minimumLotSizeAcres: 10,
    legalDescription: 'Part of Government Lot 1, Section 30, Township 54N, Range 17W',
    failedSaleCount: 4,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 1100,
    enrichment: {
      roadFrontageMeters: 90,
      nearestRoadMeters: 3,
      nearestRoadName: 'Township Road 9',
      roadIsPublic: true,
      roadIsPaved: false,
      floodZones: ['A'],
      floodOverlapFraction: 0.7,
      wetlandTypes: ['PEM1C', 'PUBHh'],
      wetlandOverlapFraction: 0.97,
      meanSlopePercent: 1,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 20,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'SUBMERGED_OR_FULL_WETLAND',
      buildability: 'RED',
      note: 'Four failed sales is the market telling you why.',
    },
  },
  {
    key: 'fx-mi-contaminated',
    registryKey: 'mi-ottawa-treasurer-inventory',
    state: 'MI',
    county: 'Ottawa',
    apn: 'FX-70-01-01-100-001',
    label: 'Vacant lot adjoining a regulated cleanup site',
    center: near(MI, 0.02, 0.01),
    acreage: 1.1,
    aspect: 1.6,
    minimumBidDollars: 3000,
    askingPriceDollars: null,
    landAssessedDollars: 22_000,
    annualTaxDollars: 380,
    zoning: 'R-1',
    minimumLotSizeAcres: 0.25,
    legalDescription: 'Lot 14, Riverside Industrial Addition',
    failedSaleCount: 1,
    otcEligible: false,
    saleType: 'AUCTION',
    auctionInDays: 26,
    firstSeenDaysAgo: 40,
    enrichment: {
      roadFrontageMeters: 48,
      nearestRoadMeters: 2,
      nearestRoadName: 'Commerce Road',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 2,
      nearestContaminatedSiteMeters: 85,
      titleRiskScore: 34,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'CONTAMINATED_SITE',
      note: 'Good access, good zoning, real discount — and a Superfund site 85 m away. Overridable, but only deliberately.',
    },
  },
  {
    key: 'fx-mi-too-small',
    registryKey: 'mi-ottawa-treasurer-inventory',
    state: 'MI',
    county: 'Ottawa',
    apn: 'FX-70-01-01-100-002',
    label: 'Utility sliver too small for any use',
    center: near(MI, -0.01, 0.02),
    acreage: 0.03,
    aspect: 3,
    minimumBidDollars: 150,
    askingPriceDollars: null,
    landAssessedDollars: 400,
    annualTaxDollars: 10,
    zoning: 'R-1',
    minimumLotSizeAcres: 0.25,
    legalDescription: 'The North 12 feet of Lot 9, Maple Grove Plat',
    failedSaleCount: 2,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 500,
    enrichment: {
      roadFrontageMeters: 12,
      nearestRoadMeters: 1,
      nearestRoadName: 'Maple Street',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 1,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 12,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'PARCEL_TOO_SMALL',
      note: 'Only worth anything to the adjoining owner; not an acquisition.',
    },
  },
  {
    key: 'fx-fl-overpriced',
    registryKey: 'fl-orange-lands-available',
    state: 'FL',
    county: 'Orange',
    apn: 'FX-05-23-29-0000-01-010',
    label: 'Lands Available parcel priced above what it is worth',
    center: near(FL, 0.03, -0.02),
    acreage: 0.28,
    aspect: 1.8,
    minimumBidDollars: 41_000,
    askingPriceDollars: 41_000,
    landAssessedDollars: 18_000,
    annualTaxDollars: 640,
    zoning: 'R-1A',
    minimumLotSizeAcres: 0.17,
    legalDescription: 'Lot 21, Block C, Pine Hills Section 4',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 200,
    enrichment: {
      roadFrontageMeters: 22,
      nearestRoadMeters: 1,
      nearestRoadName: 'Sunset Drive',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 1,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 28,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'BASIS_EXCEEDS_QSV',
      note: 'Accrued taxes have pushed the statutory price past the land value. Common and easy to miss.',
    },
  },

  // ---- Hazard cases that survive but must be marked down -------------------
  {
    key: 'fx-fl-floodplain',
    registryKey: 'fl-orange-lands-available',
    state: 'FL',
    county: 'Orange',
    apn: 'FX-05-23-29-0000-01-020',
    label: 'Partly in a Special Flood Hazard Area',
    center: near(FL, -0.04, 0.03),
    acreage: 2.4,
    aspect: 1.5,
    minimumBidDollars: 9200,
    askingPriceDollars: 9200,
    landAssessedDollars: 44_000,
    annualTaxDollars: 720,
    zoning: 'A-1',
    minimumLotSizeAcres: 1,
    legalDescription: 'The West 300 feet of Tract 8, Lake Region Groves',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 150,
    enrichment: {
      roadFrontageMeters: 66,
      nearestRoadMeters: 2,
      nearestRoadName: 'Grove Road',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['AE'],
      floodOverlapFraction: 0.42,
      wetlandTypes: [],
      wetlandOverlapFraction: 0.05,
      meanSlopePercent: 1,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 26,
    },
    expectation: {
      rejected: false,
      buildability: 'YELLOW',
      note: 'Buildable in principle with a smaller envelope; must not read as GREEN.',
    },
  },
  {
    key: 'fx-mn-title-risk',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0003-00010',
    label: 'Chain passes through an estate with a federal lien',
    center: near(MN, -0.03, 0.09),
    acreage: 8.7,
    aspect: 1.2,
    minimumBidDollars: 5200,
    askingPriceDollars: null,
    landAssessedDollars: 24_000,
    annualTaxDollars: 260,
    zoning: 'RR',
    minimumLotSizeAcres: 2,
    legalDescription: 'The South Half of the NW1/4 of the SE1/4, Section 19, Township 53N, Range 15W',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 320,
    enrichment: {
      roadFrontageMeters: 95,
      nearestRoadMeters: 2,
      nearestRoadName: 'Birch Lake Road',
      roadIsPublic: true,
      roadIsPaved: false,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 6,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 84,
    },
    expectation: {
      rejected: true,
      rejectionRule: 'SEVERE_TITLE_RISK',
      note: 'Economics are fine; title is not. Rejected on title alone, overridable after professional review.',
    },
  },
  {
    key: 'fx-mn-steep',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0003-00020',
    label: 'Steep ridge parcel with unpaved access',
    center: near(MN, 0.18, -0.09),
    acreage: 14.2,
    aspect: 2.2,
    minimumBidDollars: 6400,
    askingPriceDollars: null,
    landAssessedDollars: 19_000,
    annualTaxDollars: 210,
    zoning: 'FAM',
    minimumLotSizeAcres: 10,
    legalDescription: 'Part of the NE1/4, Section 3, Township 58N, Range 13W',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 260,
    enrichment: {
      roadFrontageMeters: 40,
      nearestRoadMeters: 4,
      nearestRoadName: 'Ridge Trail',
      roadIsPublic: null,
      roadIsPaved: false,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 28,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 24,
    },
    expectation: {
      rejected: false,
      accessClass: 'B',
      buildability: 'YELLOW',
      note: 'Slope raises development cost and the road may be private — both must show up as YELLOW plus unknowns.',
    },
  },
  {
    key: 'fx-mi-suburban-infill',
    registryKey: 'mi-ottawa-treasurer-inventory',
    state: 'MI',
    county: 'Ottawa',
    apn: 'FX-70-01-02-200-010',
    label: 'Suburban infill lot with utilities',
    center: near(MI, 0.04, -0.02),
    acreage: 0.42,
    aspect: 2.1,
    minimumBidDollars: 8500,
    askingPriceDollars: null,
    landAssessedDollars: 39_000,
    annualTaxDollars: 690,
    zoning: 'R-2',
    minimumLotSizeAcres: 0.2,
    legalDescription: 'Lot 7, Willow Creek Estates No. 2',
    failedSaleCount: 0,
    otcEligible: false,
    saleType: 'AUCTION',
    auctionInDays: 12,
    firstSeenDaysAgo: 18,
    enrichment: {
      roadFrontageMeters: 30,
      nearestRoadMeters: 1,
      nearestRoadName: 'Willow Creek Drive',
      roadIsPublic: true,
      roadIsPaved: true,
      floodZones: ['X'],
      floodOverlapFraction: 0,
      wetlandTypes: [],
      wetlandOverlapFraction: 0,
      meanSlopePercent: 2,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: 15,
    },
    expectation: {
      rejected: false,
      accessClass: 'A',
      buildability: 'GREEN',
      note: 'Liquid, conventional, auction in under two weeks — the urgency case for alerts.',
    },
  },
  {
    key: 'fx-mn-no-geometry',
    registryKey: 'mn-st-louis-tax-forfeited',
    state: 'MN',
    county: 'St. Louis',
    apn: 'FX-010-0004-00010',
    label: 'Point-only record with no published polygon',
    center: near(MN, -0.2, 0.02),
    acreage: 6.8,
    aspect: 1,
    minimumBidDollars: 3900,
    askingPriceDollars: null,
    landAssessedDollars: 15_000,
    annualTaxDollars: 170,
    zoning: null,
    minimumLotSizeAcres: null,
    legalDescription: 'Part of Section 15, Township 55N, Range 18W',
    failedSaleCount: 1,
    otcEligible: true,
    saleType: 'OVER_THE_COUNTER',
    auctionInDays: null,
    firstSeenDaysAgo: 95,
    enrichment: {
      roadFrontageMeters: 0,
      nearestRoadMeters: 55,
      nearestRoadName: 'Unnamed road',
      roadIsPublic: null,
      roadIsPaved: null,
      floodZones: [],
      floodOverlapFraction: null,
      wetlandTypes: [],
      wetlandOverlapFraction: null,
      meanSlopePercent: null,
      nearestContaminatedSiteMeters: null,
      titleRiskScore: null,
    },
    expectation: {
      rejected: false,
      accessClass: 'C',
      buildability: 'UNKNOWN',
      note: 'The sparse-data case: must survive with low confidence rather than being scored as if it were known.',
    },
  },
];

/** Build a rectangular polygon of the requested acreage and aspect ratio. */
export function fixtureGeometry(parcel: FixtureParcel): ParcelGeometry {
  const areaSqMeters = parcel.acreage * 4046.8564224;
  const width = Math.sqrt(areaSqMeters / parcel.aspect);
  const height = width * parcel.aspect;
  const [lon, lat] = parcel.center;
  const degPerMeterLat = 1 / 110_574;
  const degPerMeterLon = 1 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dx = (width / 2) * degPerMeterLon;
  const dy = (height / 2) * degPerMeterLat;
  const ring: Position[] = [
    [lon - dx, lat - dy],
    [lon + dx, lat - dy],
    [lon + dx, lat + dy],
    [lon - dx, lat + dy],
    [lon - dx, lat - dy],
  ];
  return { type: 'Polygon', coordinates: [ring] };
}

/**
 * Additional inventory.
 *
 * The thirteen fixtures above are the *specification*: each states what the
 * pipeline must conclude, and the integration test asserts it. These further
 * parcels are ordinary inventory, generated deterministically, so that the
 * dashboard, filters, sorting and pagination are exercised against a realistic
 * distribution rather than a dozen carefully-chosen edge cases. Together they
 * bring the fixture set to 33.
 *
 * They are intentionally unremarkable: mostly mediocre deals, a few good ones,
 * some with missing data. That mix is what the product actually faces, and it
 * is what makes the "ten exceptional candidates beat 100,000 unranked parcels"
 * claim testable.
 */
export function generateOrdinaryFixtures(): FixtureParcel[] {
  const specs: {
    state: string;
    county: string;
    registryKey: string;
    base: Position;
    prefix: string;
    zonings: (string | null)[];
    minLot: number | null;
  }[] = [
    {
      state: 'MN',
      county: 'St. Louis',
      registryKey: 'mn-st-louis-tax-forfeited',
      base: MN,
      prefix: 'FX-010-0100',
      zonings: ['RR', 'FAM', 'RES-1', null],
      minLot: 2,
    },
    {
      state: 'MI',
      county: 'Ottawa',
      registryKey: 'mi-ottawa-treasurer-inventory',
      base: MI,
      prefix: 'FX-70-01-05',
      zonings: ['AG', 'R-1', 'RR'],
      minLot: 0.25,
    },
    {
      state: 'FL',
      county: 'Orange',
      registryKey: 'fl-orange-lands-available',
      base: FL,
      prefix: 'FX-05-23-30',
      zonings: ['A-1', 'A-2', 'R-CE'],
      minLot: 0.5,
    },
  ];

  const out: FixtureParcel[] = [];
  let counter = 0;

  for (const spec of specs) {
    for (let i = 0; i < 7; i += 1) {
      counter += 1;
      // Deterministic pseudo-variation without importing a PRNG into a data file.
      const t = (counter * 2654435761) % 1000;
      const u = (counter * 40503) % 997;
      const v = (counter * 92821) % 991;

      const acreage = Number((0.4 + (t / 1000) * 24).toFixed(2));
      const frontage = v % 5 === 0 ? 0 : 20 + (v % 120);
      const nearestRoad = frontage > 0 ? 2 : 40 + (v % 400);
      const assessedPerAcre = spec.state === 'FL' ? 24_000 : spec.state === 'MI' ? 9_000 : 1_800;
      const landAssessed = Math.round(acreage * assessedPerAcre * (0.6 + (u / 997) * 0.9));
      // Most inventory is priced sensibly relative to value; a minority is not.
      const bidRatio = u % 7 === 0 ? 0.9 : 0.1 + (u / 997) * 0.4;

      out.push({
        key: `fx-ordinary-${counter}`,
        registryKey: spec.registryKey,
        state: spec.state,
        county: spec.county,
        apn: `${spec.prefix}-${String(counter).padStart(5, '0')}`,
        label: `${spec.county} County inventory parcel ${counter}`,
        center: near(spec.base, ((t % 100) - 50) / 400, ((u % 100) - 50) / 400),
        acreage,
        aspect: 1 + (v % 40) / 12,
        minimumBidDollars: Math.max(300, Math.round((landAssessed * bidRatio) / 50) * 50),
        askingPriceDollars: null,
        landAssessedDollars: landAssessed,
        annualTaxDollars: Math.round(landAssessed * 0.014),
        zoning: spec.zonings[counter % spec.zonings.length] ?? null,
        minimumLotSizeAcres: spec.minLot,
        legalDescription: `Part of Section ${1 + (counter % 36)}, per county records`,
        failedSaleCount: counter % 4 === 0 ? 2 : counter % 3 === 0 ? 1 : 0,
        otcEligible: counter % 3 !== 0,
        saleType: counter % 3 === 0 ? 'AUCTION' : 'OVER_THE_COUNTER',
        auctionInDays: counter % 3 === 0 ? 10 + (v % 60) : null,
        firstSeenDaysAgo: 5 + (t % 900),
        enrichment: {
          roadFrontageMeters: frontage,
          nearestRoadMeters: nearestRoad,
          nearestRoadName: frontage > 0 ? `County Road ${10 + (v % 80)}` : 'Unnamed road',
          roadIsPublic: v % 3 === 0 ? null : true,
          roadIsPaved: v % 2 === 0,
          floodZones: u % 6 === 0 ? ['AE'] : ['X'],
          floodOverlapFraction: u % 6 === 0 ? 0.2 + (u % 40) / 200 : 0,
          wetlandTypes: t % 5 === 0 ? ['PFO1A'] : [],
          wetlandOverlapFraction: t % 5 === 0 ? 0.1 + (t % 30) / 200 : 0,
          meanSlopePercent: 1 + (v % 18),
          nearestContaminatedSiteMeters: counter % 11 === 0 ? 900 : null,
          titleRiskScore: 12 + (u % 45),
        },
        expectation: {
          rejected: false,
          note: 'Ordinary inventory generated to give the dashboard a realistic distribution.',
        },
      });
    }
  }

  return out;
}

/** Every fixture parcel: the specification cases plus ordinary inventory. */
export function allFixtureParcels(): FixtureParcel[] {
  return [...FIXTURE_PARCELS, ...generateOrdinaryFixtures()];
}
