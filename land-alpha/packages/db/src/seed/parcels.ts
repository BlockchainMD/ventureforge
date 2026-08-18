import { prisma } from '../client';
import { toDecimal } from '../mappers';
import { writeParcelGeometry } from '../spatial';
import { parcelNaturalKey, normalizeApn, listingSlug } from '@land-alpha/shared/ids';
import { allFixtureParcels, fixtureGeometry, type FixtureParcel } from './fixture-parcels';

/**
 * Load the fixture parcels into the database.
 *
 * Fixtures are attached to the same `Source` rows the real adapters use, so
 * they flow through exactly the same enrichment, valuation and scoring code as
 * live inventory — there is no fixture-only code path, which is the whole point
 * of having them.
 *
 * Pre-computed enrichment (flood, wetlands, roads, slope) is written directly
 * so that the fixture set is usable with no network access at all. The live
 * enrichment services will overwrite these values when they run.
 */

export interface FixtureSeedResult {
  readonly created: number;
  readonly updated: number;
  readonly skipped: string[];
}

export async function seedFixtureParcels(now = new Date()): Promise<FixtureSeedResult> {
  const fixtures = allFixtureParcels();
  const skipped: string[] = [];
  let created = 0;
  let updated = 0;

  const sources = new Map(
    (
      await prisma.source.findMany({
        select: { id: true, registryKey: true, jurisdictionId: true },
      })
    ).map((source) => [source.registryKey, source]),
  );

  for (const fixture of fixtures) {
    const source = sources.get(fixture.registryKey);
    if (!source) {
      skipped.push(`${fixture.key}: source ${fixture.registryKey} is not synced`);
      continue;
    }

    const naturalKey = parcelNaturalKey({ sourceId: source.id, apn: fixture.apn });
    const geometry = fixtureGeometry(fixture);
    const existing = await prisma.parcelOpportunity.findUnique({
      where: { naturalKey },
      select: { id: true },
    });

    const data = buildParcelData(fixture, source, now);

    if (existing) {
      await prisma.parcelOpportunity.update({ where: { id: existing.id }, data });
      await writeParcelGeometry(existing.id, geometry);
      updated += 1;
      continue;
    }

    const parcel = await prisma.parcelOpportunity.create({
      data: {
        ...data,
        naturalKey,
        publicSlug: listingSlug({
          acreage: fixture.acreage,
          county: fixture.county,
          state: fixture.state,
          parcelId: naturalKey,
        }),
      },
      select: { id: true },
    });
    await writeParcelGeometry(parcel.id, geometry);
    await prisma.parcelChange.create({
      data: { parcelId: parcel.id, kind: 'CREATED' },
    });
    created += 1;
  }

  return { created, updated, skipped };
}

function buildParcelData(
  fixture: FixtureParcel,
  source: { id: string; jurisdictionId: string },
  now: Date,
) {
  const e = fixture.enrichment;
  const firstSeenAt = new Date(now.getTime() - fixture.firstSeenDaysAgo * 86_400_000);

  return {
    state: fixture.state,
    county: fixture.county,
    jurisdictionId: source.jurisdictionId,
    apn: fixture.apn,
    apnNormalized: normalizeApn(fixture.apn),
    sourceId: source.id,
    sourceRecordId: fixture.apn,
    sourceUrl: null,

    saleType: fixture.saleType,
    saleStatus: 'AVAILABLE' as const,
    auctionDate:
      fixture.auctionInDays == null
        ? null
        : new Date(now.getTime() + fixture.auctionInDays * 86_400_000),
    minimumBid: toDecimal(
      fixture.minimumBidDollars == null ? null : fixture.minimumBidDollars * 100,
    ),
    askingPrice: toDecimal(
      fixture.askingPriceDollars == null ? null : fixture.askingPriceDollars * 100,
    ),
    annualTaxEstimate: toDecimal(
      fixture.annualTaxDollars == null ? null : fixture.annualTaxDollars * 100,
    ),
    landAssessedValue: toDecimal(
      fixture.landAssessedDollars == null ? null : fixture.landAssessedDollars * 100,
    ),
    failedSaleCount: fixture.failedSaleCount,
    otcEligible: fixture.otcEligible,
    acquisitionInstructions:
      'Development fixture. Confirm availability and payoff with the issuing office before acting.',

    latitude: fixture.center[1],
    longitude: fixture.center[0],
    acreage: fixture.acreage,
    legalDescription: fixture.legalDescription,
    zoning: fixture.zoning,
    zoningSource: fixture.zoning ? 'County zoning GIS (fixture)' : null,
    zoningConfidence: (fixture.zoning ? 'HIGH' : 'UNKNOWN') as 'HIGH' | 'UNKNOWN',
    minimumLotSizeAcres: fixture.minimumLotSizeAcres,
    isVacant: true,
    ownerType: 'STATE' as const,
    currentOwner: `${fixture.county} County (${fixture.state}) — government-held inventory`,
    geometrySource: 'Development fixture',
    geometryConfidence: 'MEDIUM' as const,

    // Pre-computed enrichment so fixtures work entirely offline.
    roadFrontageMeters: e.roadFrontageMeters,
    nearestRoadMeters: e.nearestRoadMeters,
    nearestRoadName: e.nearestRoadName,
    nearestPavedRoadName: e.roadIsPaved ? e.nearestRoadName : null,
    nearestPavedRoadMeters: e.roadIsPaved ? e.nearestRoadMeters : null,
    touchesPublicRoad: e.roadFrontageMeters > 8 ? e.roadIsPublic : false,
    touchesNamedRoad: e.roadFrontageMeters > 8 && Boolean(e.nearestRoadName),
    potentiallyLandlocked: e.roadFrontageMeters === 0 && e.nearestRoadMeters > 60,

    floodZones: e.floodZones,
    floodOverlapFraction: e.floodOverlapFraction,
    inSpecialFloodHazardArea:
      e.floodZones.length === 0 ? null : e.floodZones.some((zone) => /^(A|V)/.test(zone)),
    wetlandTypes: e.wetlandTypes,
    wetlandOverlapFraction: e.wetlandOverlapFraction,
    meanSlopePercent: e.meanSlopePercent,
    nearestContaminatedSiteMeters: e.nearestContaminatedSiteMeters,
    environmentalConfidence: (e.floodOverlapFraction == null ? 'UNKNOWN' : 'HIGH') as
      | 'UNKNOWN'
      | 'HIGH',
    titleRiskScore: e.titleRiskScore,

    firstSeenAt,
    lastSeenAt: now,
    removedFromSourceAt: null,
    status: 'DISCOVERED' as const,
  };
}
