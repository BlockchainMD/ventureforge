import {
  minConfidence,
  type ConfidenceLevel,
  type ContaminatedSiteHit,
  type EnvironmentalAssessment,
} from '@land-alpha/shared';

/**
 * Environmental screening.
 *
 * The connectors that actually talk to FEMA, USFWS, USDA NRCS, EPA and USGS
 * live in `@land-alpha/ingestion/enrichment` — this module is deliberately pure
 * so that the interpretation of the data is unit-testable and identical no
 * matter how the observations were obtained (live API, cached fixture, or
 * analyst entry).
 *
 * Nothing here is a determination. In particular, soil data is used only as a
 * *screening* signal; it does not establish septic suitability, which requires
 * a percolation test and a county health-department permit.
 */

export interface EnvironmentalObservations {
  readonly flood?: {
    readonly zones: readonly string[];
    /** Fraction of parcel area inside mapped flood hazard polygons, 0-1. */
    readonly overlapFraction: number | null;
    readonly available: boolean;
    readonly source: string;
  };
  readonly wetlands?: {
    readonly types: readonly string[];
    readonly overlapFraction: number | null;
    readonly available: boolean;
    readonly source: string;
  };
  readonly soils?: {
    readonly series: readonly string[];
    readonly drainageClasses: readonly string[];
    /** Fraction of the parcel mapped to hydric soils, 0-1. */
    readonly hydricFraction: number | null;
    readonly available: boolean;
    readonly source: string;
  };
  readonly contamination?: {
    readonly sites: readonly ContaminatedSiteHit[];
    readonly searchRadiusMeters: number;
    readonly available: boolean;
    readonly source: string;
  };
  readonly terrain?: {
    readonly meanElevationMeters: number | null;
    readonly minElevationMeters: number | null;
    readonly maxElevationMeters: number | null;
    readonly meanSlopePercent: number | null;
    readonly available: boolean;
    readonly source: string;
  };
}

/**
 * FEMA zone codes that denote a Special Flood Hazard Area (the 1%-annual-chance
 * floodplain). Zones X, B and C are outside it; V zones are coastal high hazard.
 */
const SFHA_ZONE_PREFIXES = ['A', 'V'];
const NON_SFHA_ZONES = new Set(['X', 'B', 'C', 'D', 'AREA NOT INCLUDED', 'OPEN WATER']);

export function isSpecialFloodHazardZone(zone: string): boolean {
  const normalized = zone.trim().toUpperCase();
  if (NON_SFHA_ZONES.has(normalized)) return false;
  if (normalized.startsWith('X')) return false;
  return SFHA_ZONE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function assessEnvironment(
  observations: EnvironmentalObservations,
): EnvironmentalAssessment {
  const evidence: string[] = [];
  const unknowns: string[] = [];
  let confidence: ConfidenceLevel = 'HIGH';

  // ---- Flood ---------------------------------------------------------------
  const floodZones = observations.flood?.available ? [...(observations.flood.zones ?? [])] : [];
  const floodOverlapFraction = observations.flood?.available
    ? (observations.flood.overlapFraction ?? null)
    : null;
  const sfhaZones = floodZones.filter(isSpecialFloodHazardZone);
  const inSpecialFloodHazardArea = observations.flood?.available
    ? sfhaZones.length > 0
    : null;

  if (observations.flood?.available) {
    if (sfhaZones.length > 0) {
      evidence.push(
        `Parcel intersects FEMA flood zone${sfhaZones.length > 1 ? 's' : ''} ${sfhaZones.join(', ')}${
          floodOverlapFraction != null ? ` across ~${pct(floodOverlapFraction)} of its area` : ''
        } (${observations.flood.source}).`,
      );
    } else {
      evidence.push(
        `No Special Flood Hazard Area intersects the parcel${floodZones.length ? ` (mapped zone${floodZones.length > 1 ? 's' : ''}: ${floodZones.join(', ')})` : ''} (${observations.flood.source}).`,
      );
    }
    if (floodOverlapFraction == null && sfhaZones.length > 0) {
      unknowns.push('The share of the parcel inside the flood hazard area could not be measured.');
      confidence = minConfidence(confidence, 'MEDIUM');
    }
  } else {
    unknowns.push('FEMA flood hazard data was not available for this location.');
    confidence = minConfidence(confidence, 'MEDIUM');
  }

  // ---- Wetlands ------------------------------------------------------------
  const wetlandTypes = observations.wetlands?.available ? [...(observations.wetlands.types ?? [])] : [];
  const wetlandOverlapFraction = observations.wetlands?.available
    ? (observations.wetlands.overlapFraction ?? null)
    : null;

  if (observations.wetlands?.available) {
    if (wetlandTypes.length > 0) {
      evidence.push(
        `National Wetlands Inventory maps ${wetlandTypes.join(', ')} on the parcel${
          wetlandOverlapFraction != null ? `, covering ~${pct(wetlandOverlapFraction)} of its area` : ''
        } (${observations.wetlands.source}).`,
      );
      unknowns.push(
        'NWI mapping is a screening layer, not a delineation. A wetland delineation is required before relying on the buildable area.',
      );
    } else {
      evidence.push(`No NWI wetlands intersect the parcel (${observations.wetlands.source}).`);
      unknowns.push(
        'Absence from the NWI does not prove absence of jurisdictional wetlands on the ground.',
      );
    }
  } else {
    unknowns.push('National Wetlands Inventory data was not available for this location.');
    confidence = minConfidence(confidence, 'MEDIUM');
  }

  // ---- Soils ---------------------------------------------------------------
  const soilSeries = observations.soils?.available ? [...(observations.soils.series ?? [])] : [];
  const soilDrainageClasses = observations.soils?.available
    ? [...(observations.soils.drainageClasses ?? [])]
    : [];
  const hydricSoilFraction = observations.soils?.available
    ? (observations.soils.hydricFraction ?? null)
    : null;

  if (observations.soils?.available && soilSeries.length > 0) {
    evidence.push(
      `NRCS soil survey maps ${soilSeries.slice(0, 4).join(', ')}${soilSeries.length > 4 ? ' and others' : ''}${
        soilDrainageClasses.length ? ` (drainage: ${soilDrainageClasses.join(', ')})` : ''
      } (${observations.soils.source}).`,
    );
    // Stated explicitly and always, because this is the exact inference the
    // brief forbids and the one a reader is most tempted to make.
    unknowns.push(
      'Soil survey data does not establish septic suitability. On-site percolation testing and county health-department approval are required.',
    );
  } else {
    unknowns.push('NRCS soil survey data was not available for this location.');
  }

  // ---- Contamination -------------------------------------------------------
  const contaminatedSites = observations.contamination?.available
    ? [...(observations.contamination.sites ?? [])].sort(
        (a, b) => a.distanceMeters - b.distanceMeters,
      )
    : [];
  const nearestContaminatedSiteMeters = contaminatedSites[0]?.distanceMeters ?? null;

  if (observations.contamination?.available) {
    if (contaminatedSites.length > 0) {
      const nearest = contaminatedSites[0]!;
      evidence.push(
        `${contaminatedSites.length} regulated cleanup site${contaminatedSites.length > 1 ? 's' : ''} within ${Math.round(observations.contamination.searchRadiusMeters)} m; nearest is ${nearest.name} (${nearest.program}) at ~${Math.round(nearest.distanceMeters)} m (${observations.contamination.source}).`,
      );
    } else {
      evidence.push(
        `No EPA-regulated cleanup sites within ${Math.round(observations.contamination.searchRadiusMeters)} m (${observations.contamination.source}).`,
      );
    }
  } else {
    unknowns.push('EPA contaminated-site data was not available for this location.');
    confidence = minConfidence(confidence, 'MEDIUM');
  }

  // ---- Terrain -------------------------------------------------------------
  const terrain = observations.terrain?.available ? observations.terrain : null;
  if (terrain) {
    evidence.push(
      `Elevation ranges ${fmt(terrain.minElevationMeters)}–${fmt(terrain.maxElevationMeters)} m${
        terrain.meanSlopePercent != null ? ` with a mean slope of ${terrain.meanSlopePercent.toFixed(1)}%` : ''
      } (${terrain.source}).`,
    );
  } else {
    unknowns.push('Elevation and slope data was not available for this location.');
  }

  const environmentalRiskScore = computeEnvironmentalRisk({
    inSfha: inSpecialFloodHazardArea,
    floodOverlapFraction,
    wetlandOverlapFraction,
    wetlandMapped: wetlandTypes.length > 0,
    hydricSoilFraction,
    nearestContaminatedSiteMeters,
    meanSlopePercent: terrain?.meanSlopePercent ?? null,
  });

  const availableLayers = [
    observations.flood?.available,
    observations.wetlands?.available,
    observations.soils?.available,
    observations.contamination?.available,
    observations.terrain?.available,
  ].filter(Boolean).length;

  if (availableLayers === 0) confidence = 'UNKNOWN';
  else if (availableLayers <= 2) confidence = minConfidence(confidence, 'LOW');

  return {
    floodZones,
    floodOverlapFraction,
    inSpecialFloodHazardArea,
    wetlandTypes,
    wetlandOverlapFraction,
    soilSeries,
    soilDrainageClasses,
    hydricSoilFraction,
    contaminatedSites,
    nearestContaminatedSiteMeters,
    meanElevationMeters: terrain?.meanElevationMeters ?? null,
    minElevationMeters: terrain?.minElevationMeters ?? null,
    maxElevationMeters: terrain?.maxElevationMeters ?? null,
    meanSlopePercent: terrain?.meanSlopePercent ?? null,
    environmentalRiskScore,
    evidence,
    unknowns,
    confidence,
  };
}

/**
 * 0-100 environmental risk. Higher is worse.
 *
 * Unknown layers contribute no risk — an unmeasured wetland is not evidence of
 * a wetland. The *confidence* field is where missing data is penalised, not the
 * risk score, because conflating "risky" with "unmeasured" would make every new
 * parcel look dangerous and every stale one look clean.
 */
export function computeEnvironmentalRisk(input: {
  inSfha: boolean | null;
  floodOverlapFraction: number | null;
  wetlandOverlapFraction: number | null;
  wetlandMapped: boolean;
  hydricSoilFraction: number | null;
  nearestContaminatedSiteMeters: number | null;
  meanSlopePercent: number | null;
}): number {
  let risk = 0;

  if (input.inSfha === true) {
    const share = input.floodOverlapFraction ?? 0.5;
    risk += 15 + share * 35; // 15-50
  }

  if (input.wetlandMapped) {
    const share = input.wetlandOverlapFraction ?? 0.4;
    risk += 10 + share * 40; // 10-50
  }

  if (input.hydricSoilFraction != null && input.hydricSoilFraction > 0.5) {
    risk += 10;
  }

  if (input.nearestContaminatedSiteMeters != null) {
    if (input.nearestContaminatedSiteMeters < 150) risk += 45;
    else if (input.nearestContaminatedSiteMeters < 500) risk += 22;
    else if (input.nearestContaminatedSiteMeters < 1600) risk += 8;
  }

  if (input.meanSlopePercent != null) {
    if (input.meanSlopePercent > 25) risk += 20;
    else if (input.meanSlopePercent > 15) risk += 10;
  }

  return Math.round(Math.min(100, risk));
}

export const ENVIRONMENTAL_DISCLAIMER =
  'Environmental screening uses public mapping layers at their published scale. It is not a Phase I Environmental Site Assessment, a wetland delineation, a flood elevation certificate, or a septic suitability determination.';

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function fmt(value: number | null): string {
  return value == null ? '?' : value.toFixed(0);
}
