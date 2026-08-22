import type { ContaminatedSiteHit } from '@land-alpha/shared';
import type { EnrichmentContext, EnrichmentTarget } from './types';

/**
 * EPA regulated-cleanup-site screening.
 *
 * Proximity to a Superfund, brownfield or RCRA corrective-action site is a
 * screening signal, not a finding about the parcel itself. A neighbouring site
 * does not mean this land is contaminated — but it does mean a buyer's lender
 * will ask, which is why the rejection rule it feeds is weighted heavily and
 * why an analyst can override it.
 *
 * This adapter does not automate the screen, because as of August 2026 no EPA
 * endpoint both carries facility coordinates and permits automated queries:
 *
 *  - The Envirofacts REST interface (`data.epa.gov/efservice`) still serves the
 *    FRS tables, but `frs_facility_site` and `frs_program_facility` no longer
 *    expose `latitude83`/`longitude83` at all. Worse, its parser accepts a
 *    numeric range filter and then ignores it — a query bounded to Duluth
 *    returns facilities in Massachusetts with a 200. A source that answers
 *    confidently with the wrong rows is more dangerous than one that fails.
 *  - The FRS geospatial services on `geopub.epa.gov` do carry coordinates, and
 *    that host's robots.txt disallows `/arcgis/` outright.
 *
 * So the screen is a MANUAL_SOURCE. Returning `available: false` with a reason
 * is the whole point: the environmental engine turns that into a named unknown,
 * the unknown suppresses the buildability rating, and nothing downstream is
 * able to treat "we never looked" as "nothing there". Writing a plausible
 * adapter against an endpoint that returns the wrong rows would defeat every
 * one of those protections while looking like progress.
 */

export interface ContaminationObservation {
  readonly sites: ContaminatedSiteHit[];
  readonly searchRadiusMeters: number;
  readonly available: boolean;
  readonly source: string;
  readonly note: string | null;
}

/** Where an analyst screens a parcel by hand. */
export const EPA_MANUAL_SCREEN_URL = 'https://geopub.epa.gov/myem/efmap/index.html';

export async function fetchContamination(
  _ctx: EnrichmentContext,
  _target: EnrichmentTarget,
  radiusMeters = 1600,
): Promise<ContaminationObservation> {
  const source = 'EPA Facility Registry Service';
  return {
    sites: [],
    searchRadiusMeters: radiusMeters,
    available: false,
    source,
    note:
      'EPA publishes no facility-coordinate endpoint that permits automated ' +
      `queries, so cleanup sites near the parcel must be screened by hand at ${EPA_MANUAL_SCREEN_URL}`,
  };
}
