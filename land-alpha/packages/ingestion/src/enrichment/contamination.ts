import { env } from '@land-alpha/shared/env';
import type { ContaminatedSiteHit } from '@land-alpha/shared';
import { distanceMeters } from '@land-alpha/gis';
import type { EnrichmentContext, EnrichmentTarget } from './types';

/**
 * EPA Facility Registry Service.
 *
 * Screens for regulated cleanup sites near the parcel: Superfund (NPL),
 * brownfields, RCRA corrective action and state cleanup programs.
 *
 * Proximity is a screening signal, not a finding about the parcel itself. A
 * neighbouring site does not mean this land is contaminated — but it does mean
 * a buyer's lender will ask, which is why it is weighted heavily and why the
 * rejection rule it feeds is explicitly overridable by an analyst.
 */

export interface ContaminationObservation {
  readonly sites: ContaminatedSiteHit[];
  readonly searchRadiusMeters: number;
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

interface FrsRecord {
  REGISTRY_ID?: string;
  PRIMARY_NAME?: string;
  LATITUDE83?: string | number;
  LONGITUDE83?: string | number;
  FED_FACILITY_CODE?: string;
  SITE_TYPE_NAME?: string;
  INTEREST_TYPES?: string;
}

export async function fetchContamination(
  ctx: EnrichmentContext,
  target: EnrichmentTarget,
  radiusMeters = 1600,
): Promise<ContaminationObservation> {
  const source = 'EPA Facility Registry Service';
  if (ctx.mode === 'fixture') {
    return { sites: [], searchRadiusMeters: radiusMeters, available: false, source, note: 'fixture mode' };
  }

  const [lon, lat] = target.centroid;
  // The FRS REST interface takes a bounding box; the radius filter is applied
  // afterwards so the reported distance is a true great-circle distance rather
  // than a box artefact.
  const padding = radiusMeters / 111_000;
  const url =
    `${env().EPA_FRS_URL}/frs.frs_facility_site/` +
    `latitude83/>/${(lat - padding).toFixed(5)}/latitude83/</${(lat + padding).toFixed(5)}/` +
    `longitude83/>/${(lon - padding).toFixed(5)}/longitude83/</${(lon + padding).toFixed(5)}/` +
    `rows/0:200/JSON`;

  try {
    const response = await ctx.http.getJson<FrsRecord[] | { Results?: FrsRecord[] }>(url);
    const records: FrsRecord[] = Array.isArray(response) ? response : (response.Results ?? []);

    const sites: ContaminatedSiteHit[] = [];
    for (const record of records) {
      const siteLat = Number(record.LATITUDE83);
      const siteLon = Number(record.LONGITUDE83);
      if (!Number.isFinite(siteLat) || !Number.isFinite(siteLon)) continue;
      const distance = distanceMeters([lon, lat], [siteLon, siteLat]);
      if (distance > radiusMeters) continue;

      const program = classifyProgram(record);
      // Only sites in a cleanup program matter here; the FRS also contains
      // every permitted facility in the country, which is noise for this purpose.
      if (!program) continue;

      sites.push({
        program,
        name: record.PRIMARY_NAME ?? 'Unnamed regulated site',
        distanceMeters: Math.round(distance),
        registryId: record.REGISTRY_ID ?? null,
        url: record.REGISTRY_ID
          ? `https://frs-public.epa.gov/ords/frs_public2/fii_query_dtl.disp_program_facility?p_registry_id=${record.REGISTRY_ID}`
          : null,
      });
    }

    sites.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return { sites, searchRadiusMeters: radiusMeters, available: true, source, note: null };
  } catch (error) {
    return {
      sites: [],
      searchRadiusMeters: radiusMeters,
      available: false,
      source,
      note: `unavailable: ${String(error)}`,
    };
  }
}

function classifyProgram(record: FrsRecord): ContaminatedSiteHit['program'] | null {
  const interests = `${record.INTEREST_TYPES ?? ''} ${record.SITE_TYPE_NAME ?? ''}`.toUpperCase();
  if (interests.includes('SUPERFUND') || interests.includes('NPL')) return 'SUPERFUND';
  if (interests.includes('BROWNFIELD')) return 'BROWNFIELD';
  if (interests.includes('CORRECTIVE ACTION') || interests.includes('RCRA')) return 'RCRA_CORRECTIVE';
  if (interests.includes('CLEANUP') || interests.includes('REMEDIATION')) return 'STATE_CLEANUP';
  return null;
}
