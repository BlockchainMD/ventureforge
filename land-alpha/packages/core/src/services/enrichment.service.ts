import {
  EvidenceCollector,
  type ConfidenceLevel,
  type EnvironmentalAssessment,
  type ParcelGeometry,
  type Position,
  type ShapeMetrics,
} from '@land-alpha/shared';
import { env } from '@land-alpha/shared/env';
import { createLogger } from '@land-alpha/shared/logger';
import { prisma, recordEvidence, spatial } from '@land-alpha/db';
import { analyzeShape, acreageAgreement } from '@land-alpha/gis';
import { IngestHttpClient, enrichment } from '@land-alpha/ingestion';
import { registryByKey } from '@land-alpha/source-registry';
import { assessAccess, type RoadObservation as AccessRoad } from '../access.js';
import { assessEnvironment } from '../environmental.js';
import { assessBuildability, type UtilityContext, type ZoningContext } from '../buildability.js';

/**
 * Enrichment orchestration.
 *
 * Takes a parcel from "we know a county published it" to "we know enough to
 * underwrite it": geometry metrics, road adjacency, environmental overlays,
 * and a buildability screen — each written back with evidence rows so every
 * derived field on the detail page can be traced to where it came from.
 *
 * The ordering matters. Overlays are measured against the parcel polygon in
 * PostGIS, so geometry must be established first; buildability consumes access
 * and environment, so it runs last.
 */

const logger = createLogger({ component: 'enrichment-service' });

export interface EnrichmentOptions {
  readonly stages?: readonly ('geometry' | 'access' | 'environmental' | 'buildability')[];
  readonly signal?: AbortSignal;
  readonly http?: IngestHttpClient;
}

export interface EnrichmentSummary {
  readonly parcelId: string;
  readonly stagesRun: string[];
  readonly warnings: string[];
  readonly accessClass: string | null;
  readonly buildability: string | null;
  readonly environmentalRiskScore: number | null;
}

export async function enrichParcel(
  parcelId: string,
  options: EnrichmentOptions = {},
): Promise<EnrichmentSummary> {
  const stages = new Set(
    options.stages ?? (['geometry', 'access', 'environmental', 'buildability'] as const),
  );
  const warnings: string[] = [];
  const stagesRun: string[] = [];
  const evidence = new EvidenceCollector();

  const parcel = await prisma.parcelOpportunity.findUnique({
    where: { id: parcelId },
    include: { source: true },
  });
  if (!parcel) throw new Error(`Parcel not found: ${parcelId}`);

  const config = env();
  const http = options.http ?? new IngestHttpClient({ signal: options.signal });
  const ctx: enrichment.EnrichmentContext = {
    http,
    mode: config.ENRICHMENT_MODE,
    signal: options.signal,
  };

  const geometry = await spatial.readParcelGeometry(parcelId);
  const centroid: Position | null =
    parcel.longitude != null && parcel.latitude != null
      ? [parcel.longitude, parcel.latitude]
      : geometry
        ? analyzeShape(geometry).centroid
        : null;

  if (!centroid) {
    warnings.push('Parcel has neither geometry nor a point location; enrichment cannot proceed.');
    return {
      parcelId,
      stagesRun,
      warnings,
      accessClass: null,
      buildability: null,
      environmentalRiskScore: null,
    };
  }

  const target: enrichment.EnrichmentTarget = {
    parcelId,
    centroid,
    geometry,
    acreage: parcel.acreage,
  };

  // ---- Geometry ------------------------------------------------------------
  let shape: ShapeMetrics | null = null;
  if (stages.has('geometry') && geometry) {
    shape = analyzeShape(geometry);
    const agreement = acreageAgreement(parcel.acreage, shape.acreage);
    if (agreement.note) warnings.push(agreement.note);

    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        perimeterMeters: shape.perimeterMeters,
        compactness: shape.compactness,
        aspectRatio: shape.aspectRatio,
        shapeFlags: [...shape.flags],
        shapeScore: shape.shapeScore,
        bboxWest: shape.bbox[0],
        bboxSouth: shape.bbox[1],
        bboxEast: shape.bbox[2],
        bboxNorth: shape.bbox[3],
        // Only adopt the mapped acreage when the county published none: the
        // county figure is the legal one, and silently overwriting it would
        // erase a discrepancy an analyst needs to see.
        acreage: parcel.acreage ?? shape.acreage,
      },
    });

    evidence.addDerived('shapeMetrics', {
      compactness: Number(shape.compactness.toFixed(3)),
      aspectRatio: Number(shape.aspectRatio.toFixed(2)),
      flags: shape.flags,
    }, {
      engine: 'GIS shape analysis (PostGIS + turf)',
      confidence: 'HIGH',
      inputs: ['parcel polygon'],
    });
    stagesRun.push('geometry');
  }

  // ---- Access --------------------------------------------------------------
  let access = null;
  if (stages.has('access')) {
    const registryEntry = registryByKey(parcel.source.registryKey);
    const countyRoadLayerUrl =
      (registryEntry?.config as { roadsLayerUrl?: string } | undefined)?.roadsLayerUrl ?? null;

    const observation = await enrichment.fetchRoads(ctx, target, { countyRoadLayerUrl });

    // When no road network could be obtained, fall back to whatever adjacency
    // is already recorded for the parcel rather than overwriting known values
    // with "unavailable". A failed federal or Overpass call must never turn a
    // parcel with measured frontage into an apparently landlocked one.
    const measured = observation.available
      ? await measureRoads(parcelId, geometry, centroid, observation.roads)
      : storedRoadObservation(parcel);
    const roadDataAvailable = observation.available || measured.length > 0;

    access = assessAccess({
      hasGeometry: Boolean(geometry),
      roads: measured,
      apparentDriveway: observation.available
        ? enrichment.hasApparentDriveway(observation.roads)
        : parcel.apparentDriveway,
      roadDataAvailable,
    });

    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        accessClass: access.accessClass,
        physicalAccessScore: access.physicalAccessScore,
        legalAccessStatus: access.legalAccessStatus,
        legalAccessConfidence: access.legalAccessConfidence,
        accessConfidence: access.confidence,
        touchesPublicRoad: access.touchesPublicRoad,
        touchesNamedRoad: access.touchesNamedRoad,
        roadFrontageMeters: access.roadFrontageMeters,
        nearestRoadName: access.nearestRoadName,
        nearestRoadMeters: access.nearestRoadMeters,
        nearestPavedRoadName: access.nearestPavedRoadName,
        nearestPavedRoadMeters: access.nearestPavedRoadMeters,
        apparentDriveway: access.apparentDriveway,
        potentiallyLandlocked: access.potentiallyLandlocked,
        accessEvidence: [...access.evidence],
        accessUnknowns: [...access.unknowns],
      },
    });

    evidence.addDerived('accessClass', access.accessClass, {
      engine: `Access Engine (${observation.source})`,
      confidence: access.confidence,
      notes: access.evidence.join(' '),
      inputs: ['parcel geometry', 'road network'],
    });
    if (observation.note) warnings.push(observation.note);
    stagesRun.push('access');
  }

  // ---- Environmental -------------------------------------------------------
  let environmental: EnvironmentalAssessment | null = null;
  if (stages.has('environmental')) {
    const [flood, wetlands, contamination, terrain] = await Promise.all([
      enrichment.fetchFloodHazard(ctx, target),
      enrichment.fetchWetlands(ctx, target),
      enrichment.fetchContamination(ctx, target),
      enrichment.fetchTerrain(ctx, target),
    ]);

    // Overlap is measured in PostGIS against the actual parcel polygon, not
    // inferred from whether a query returned rows. A parcel that clips the
    // corner of a flood polygon is a different asset from one inside it.
    const floodOverlap = geometry
      ? await spatial.overlayCoverageFractionMany(parcelId, flood.polygons)
      : null;
    const wetlandOverlap = geometry
      ? await spatial.overlayCoverageFractionMany(parcelId, wetlands.polygons)
      : null;

    // Same principle as access: an unavailable layer falls back to what is
    // already recorded instead of erasing it.
    const floodStored = parcel.floodZones.length > 0 || parcel.inSpecialFloodHazardArea != null;
    const wetlandStored = parcel.wetlandTypes.length > 0 || parcel.wetlandOverlapFraction != null;

    environmental = assessEnvironment({
      flood: flood.available
        ? {
            zones: flood.zones,
            overlapFraction: floodOverlap,
            available: true,
            source: flood.source,
          }
        : {
            zones: parcel.floodZones,
            overlapFraction: parcel.floodOverlapFraction,
            available: floodStored,
            source: 'Previously recorded observation',
          },
      wetlands: wetlands.available
        ? {
            types: wetlands.types,
            overlapFraction: wetlandOverlap,
            available: true,
            source: wetlands.source,
          }
        : {
            types: parcel.wetlandTypes,
            overlapFraction: parcel.wetlandOverlapFraction,
            available: wetlandStored,
            source: 'Previously recorded observation',
          },
      contamination: contamination.available
        ? {
            sites: contamination.sites,
            searchRadiusMeters: contamination.searchRadiusMeters,
            available: true,
            source: contamination.source,
          }
        : {
            sites:
              parcel.nearestContaminatedSiteMeters == null
                ? []
                : [
                    {
                      program: 'OTHER' as const,
                      name: 'Previously recorded regulated site',
                      distanceMeters: parcel.nearestContaminatedSiteMeters,
                    },
                  ],
            searchRadiusMeters: contamination.searchRadiusMeters,
            available: parcel.nearestContaminatedSiteMeters != null,
            source: 'Previously recorded observation',
          },
      terrain: terrain.available
        ? {
            meanElevationMeters: terrain.meanElevationMeters,
            minElevationMeters: terrain.minElevationMeters,
            maxElevationMeters: terrain.maxElevationMeters,
            meanSlopePercent: terrain.meanSlopePercent,
            available: true,
            source: terrain.source,
          }
        : {
            meanElevationMeters: parcel.meanElevationMeters,
            minElevationMeters: parcel.minElevationMeters,
            maxElevationMeters: parcel.maxElevationMeters,
            meanSlopePercent: parcel.meanSlopePercent,
            available: parcel.meanSlopePercent != null,
            source: 'Previously recorded observation',
          },
    });

    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        floodZones: [...environmental.floodZones],
        floodOverlapFraction: environmental.floodOverlapFraction,
        inSpecialFloodHazardArea: environmental.inSpecialFloodHazardArea,
        wetlandTypes: [...environmental.wetlandTypes],
        wetlandOverlapFraction: environmental.wetlandOverlapFraction,
        soilSeries: [...environmental.soilSeries],
        soilDrainageClasses: [...environmental.soilDrainageClasses],
        hydricSoilFraction: environmental.hydricSoilFraction,
        contaminatedSites: environmental.contaminatedSites as unknown as object,
        nearestContaminatedSiteMeters: environmental.nearestContaminatedSiteMeters,
        meanElevationMeters: environmental.meanElevationMeters,
        minElevationMeters: environmental.minElevationMeters,
        maxElevationMeters: environmental.maxElevationMeters,
        meanSlopePercent: environmental.meanSlopePercent,
        environmentalRiskScore: environmental.environmentalRiskScore,
        environmentalConfidence: environmental.confidence,
      },
    });

    for (const line of environmental.evidence) {
      evidence.addDerived('environmental', line, {
        engine: 'Environmental screening',
        confidence: environmental.confidence,
      });
    }
    stagesRun.push('environmental');
  }

  // ---- Buildability --------------------------------------------------------
  let buildability = null;
  if (stages.has('buildability') && access && environmental) {
    const zoning: ZoningContext = {
      code: parcel.zoning,
      description: null,
      minimumLotSizeAcres: parcel.minimumLotSizeAcres,
      minimumFrontageMeters: null,
      residentialUseAllowed: null,
      source: parcel.zoningSource,
      confidence: parcel.zoningConfidence as ConfidenceLevel,
    };
    const utilities: UtilityContext = {
      publicWaterAvailable: parcel.knownUtilities.includes('WATER') ? true : null,
      publicSewerAvailable: parcel.knownUtilities.includes('SEWER') ? true : null,
      electricNearby: parcel.knownUtilities.includes('ELECTRIC') ? true : null,
      source: null,
    };

    buildability = assessBuildability({
      acreage: parcel.acreage,
      shape,
      access,
      environmental,
      zoning,
      utilities,
    });

    await prisma.parcelOpportunity.update({
      where: { id: parcelId },
      data: {
        buildability: buildability.rating,
        buildabilityScore: buildability.score,
        buildabilityReasons: [...buildability.reasons],
        buildabilityUnknowns: [...buildability.unknowns],
        buildabilityBlockers: [...buildability.blockingIssues],
        buildabilityConfidence: buildability.confidence,
      },
    });

    evidence.addDerived('buildability', buildability.rating, {
      engine: 'Buildability screening',
      confidence: buildability.confidence,
      notes: buildability.reasons.join(' '),
      inputs: ['zoning', 'acreage', 'access', 'environmental', 'shape'],
    });
    stagesRun.push('buildability');
  }

  await recordEvidence(parcelId, evidence.all());
  await prisma.parcelOpportunity.update({
    where: { id: parcelId },
    data: { enrichedAt: new Date(), status: parcel.status === 'DISCOVERED' ? 'ENRICHING' : parcel.status },
  });

  logger.info('enriched parcel', { parcelId, stages: stagesRun, warnings: warnings.length });

  return {
    parcelId,
    stagesRun,
    warnings,
    accessClass: access?.accessClass ?? null,
    buildability: buildability?.rating ?? null,
    environmentalRiskScore: environmental?.environmentalRiskScore ?? null,
  };
}

/**
 * Reconstruct an access observation from what is already stored on the parcel.
 * Used when live road data is unavailable, so a previously-measured parcel does
 * not silently regress to UNKNOWN.
 */
function storedRoadObservation(parcel: {
  roadFrontageMeters: number | null;
  nearestRoadMeters: number | null;
  nearestRoadName: string | null;
  nearestPavedRoadMeters: number | null;
  touchesPublicRoad: boolean | null;
}): AccessRoad[] {
  if (parcel.roadFrontageMeters == null && parcel.nearestRoadMeters == null) return [];
  return [
    {
      name: parcel.nearestRoadName,
      isPublic: parcel.touchesPublicRoad,
      isPaved: parcel.nearestPavedRoadMeters != null,
      distanceMeters: parcel.nearestRoadMeters ?? 0,
      frontageMeters: parcel.roadFrontageMeters ?? 0,
      classification: null,
      source: 'Previously recorded observation',
    },
  ];
}

/**
 * Turn raw road geometry into per-road adjacency measurements.
 *
 * Frontage is measured in PostGIS against the parcel boundary where a polygon
 * exists. With only a point, distance is all that can honestly be reported, and
 * frontage is left at zero rather than estimated.
 */
async function measureRoads(
  parcelId: string,
  geometry: ParcelGeometry | null,
  centroid: Position,
  roads: readonly enrichment.RoadFeature[],
): Promise<AccessRoad[]> {
  if (roads.length === 0) return [];

  if (!geometry) {
    const { distanceMeters } = await import('@land-alpha/gis');
    return roads.map((road) => ({
      name: road.name,
      isPublic: road.isPublic,
      isPaved: road.isPaved,
      distanceMeters: nearestVertexDistance(centroid, road, distanceMeters),
      frontageMeters: 0,
      classification: road.classification,
      source: road.source,
    }));
  }

  const measurements = await Promise.all(
    roads.map(async (road) => {
      const result = await spatial.measureRoadAdjacency({
        parcelId,
        roads: [{ name: road.name, paved: road.isPaved === true, geometry: road.geometry }],
      });
      return {
        name: road.name,
        isPublic: road.isPublic,
        isPaved: road.isPaved,
        distanceMeters: result?.nearestRoadMeters ?? Number.POSITIVE_INFINITY,
        frontageMeters: result?.frontageMeters ?? 0,
        classification: road.classification,
        source: road.source,
      } satisfies AccessRoad;
    }),
  );

  return measurements.filter((road) => Number.isFinite(road.distanceMeters));
}

function nearestVertexDistance(
  centroid: Position,
  road: enrichment.RoadFeature,
  distance: (a: Position, b: Position) => number,
): number {
  const positions: Position[] =
    road.geometry.type === 'LineString'
      ? (road.geometry.coordinates as Position[])
      : road.geometry.type === 'MultiLineString'
        ? (road.geometry.coordinates as Position[][]).flat()
        : [];
  let nearest = Number.POSITIVE_INFINITY;
  for (const position of positions) {
    const value = distance(centroid, position);
    if (value < nearest) nearest = value;
  }
  return nearest;
}
