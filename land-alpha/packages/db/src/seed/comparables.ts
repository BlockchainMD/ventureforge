import { Prisma } from '@prisma/client';
import { prisma } from '../client.js';
import { toDecimal } from '../mappers.js';
import { createRandom } from './random.js';

/**
 * Synthetic comparable sales.
 *
 * Land Alpha's valuation engine is only as good as its recorded-sale data, and
 * that data is acquired per county from deed and assessor files. Until those
 * imports are wired for a given county, the product must still be
 * demonstrable — so development seeds a plausible sales market per county.
 *
 * These rows are clearly marked `Development fixture` in the `source` column and
 * are excluded from production seeding. They are shaped to behave like a real
 * market: a base price per acre that varies by county, a genuine size curve
 * (small parcels cost more per acre), access and utility premiums, and a
 * scattering of outliers — including $1 family transfers — so the weighted
 * median has something to be robust against.
 */

export const FIXTURE_COMP_SOURCE = 'Development fixture — synthetic recorded sale';

interface MarketProfile {
  state: string;
  county: string;
  center: [number, number];
  /** Dollars per acre at the 5-acre reference size. */
  basePricePerAcre: number;
  spreadDegrees: number;
  zonings: string[];
  utilitiesProbability: number;
  count: number;
}

const MARKETS: MarketProfile[] = [
  {
    state: 'MN',
    county: 'St. Louis',
    center: [-92.35, 47.35],
    basePricePerAcre: 5_200,
    spreadDegrees: 0.55,
    zonings: ['RR', 'FAM', 'RES-1', 'SMU'],
    utilitiesProbability: 0.15,
    count: 220,
  },
  {
    state: 'MI',
    county: 'Ottawa',
    center: [-86.0, 42.95],
    basePricePerAcre: 14_000,
    spreadDegrees: 0.25,
    zonings: ['AG', 'R-1', 'R-2', 'RR'],
    utilitiesProbability: 0.45,
    count: 180,
  },
  {
    state: 'FL',
    county: 'Orange',
    center: [-81.35, 28.5],
    basePricePerAcre: 38_000,
    spreadDegrees: 0.2,
    zonings: ['A-1', 'A-2', 'R-CE', 'R-1A'],
    utilitiesProbability: 0.6,
    count: 160,
  },
];

/** Same elasticity the valuation engine uses, so fixtures exercise the curve. */
const SIZE_ELASTICITY = 0.35;
const REFERENCE_ACRES = 5;

export async function seedComparables(now = new Date()): Promise<number> {
  const rows: Prisma.ComparableSaleCreateManyInput[] = [];
  let seedCounter = 1;

  for (const market of MARKETS) {
    const random = createRandom(0x1a4d + seedCounter * 7919);
    seedCounter += 1;

    for (let i = 0; i < market.count; i += 1) {
      const acreage = Number(
        (random.bool(0.55) ? random.float(0.3, 12) : random.float(12, 90)).toFixed(2),
      );

      // Size curve: smaller parcels trade at a higher rate per acre.
      const sizeMultiplier = Math.pow(REFERENCE_ACRES / Math.max(acreage, 0.2), SIZE_ELASTICITY);

      const accessClass = random.bool(0.72) ? (random.bool(0.6) ? 'A' : 'B') : random.bool(0.6) ? 'C' : 'D';
      const accessMultiplier =
        accessClass === 'A' ? 1.12 : accessClass === 'B' ? 1.0 : accessClass === 'C' ? 0.74 : 0.45;

      const hasUtilities = random.bool(market.utilitiesProbability);
      const utilitiesMultiplier = hasUtilities ? 1.25 : 1;

      const pricePerAcre =
        market.basePricePerAcre *
        sizeMultiplier *
        accessMultiplier *
        utilitiesMultiplier *
        random.jitter(1, 0.16);

      const daysAgo = random.int(20, 1000);
      const saleDate = new Date(now.getTime() - daysAgo * 86_400_000);

      // A realistic minority of recorded transfers are not arm's length: $1
      // family conveyances, estate distributions, and the occasional wild
      // outlier. The engine must survive them, so the fixtures include them.
      const isArmsLength = random.bool(0.9);
      const salePrice = isArmsLength
        ? Math.max(500, Math.round((pricePerAcre * acreage) / 50) * 50)
        : random.bool(0.6)
          ? 1
          : Math.round(pricePerAcre * acreage * random.float(3, 6));

      rows.push({
        state: market.state,
        county: market.county,
        apn: `FIX-${market.state}-${String(i).padStart(5, '0')}`,
        saleDate,
        salePrice: toDecimal(salePrice * 100)!,
        acreage,
        latitude: market.center[1] + random.float(-market.spreadDegrees, market.spreadDegrees),
        longitude: market.center[0] + random.float(-market.spreadDegrees, market.spreadDegrees),
        zoning: random.pick(market.zonings),
        landUse: 'Vacant land',
        accessClass: accessClass as 'A' | 'B' | 'C' | 'D',
        hasUtilities,
        isVacantLand: true,
        isArmsLength,
        deedType: random.pick(['Warranty Deed', 'Quit Claim Deed', 'Personal Rep Deed']),
        source: FIXTURE_COMP_SOURCE,
      });
    }
  }

  await prisma.comparableSale.createMany({ data: rows, skipDuplicates: true });

  // Populate the PostGIS centroid so the spatial comp search can use its index.
  const written = await prisma.$executeRaw`
    UPDATE "ComparableSale"
    SET "centroid" = ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)
    WHERE "centroid" IS NULL AND "longitude" IS NOT NULL AND "latitude" IS NOT NULL
  `;
  void written;

  return rows.length;
}

export async function clearFixtureComparables(): Promise<number> {
  const result = await prisma.comparableSale.deleteMany({
    where: { source: FIXTURE_COMP_SOURCE },
  });
  return result.count;
}
