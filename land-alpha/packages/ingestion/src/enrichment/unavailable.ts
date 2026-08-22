import { AccessRestrictedError, RateLimitedError } from '@land-alpha/shared';

/**
 * Explains a failed enrichment call in the terms an analyst has to act on.
 *
 * There are two ways a public layer produces nothing, and they demand opposite
 * responses. A timeout is worth retrying tonight. A publisher that forbids
 * automated access is a permanent condition: the only way that parcel ever gets
 * screened is a person opening the map viewer, so the note has to say that, and
 * has to say where.
 */
export function describeUnavailable(error: unknown, manualUrl: string | null): string {
  if (error instanceof AccessRestrictedError) {
    return manualUrl
      ? `the publisher does not permit automated queries against this service, so it must be checked by hand at ${manualUrl}`
      : 'the publisher does not permit automated queries against this service, so it must be checked by hand';
  }
  if (error instanceof RateLimitedError) {
    // A third category, distinct from both a permanent restriction and a random
    // outage: the service is willing but we asked too often. The fix is on our
    // side, and saying so stops it being read as "this parcel has nothing here".
    return manualUrl
      ? `the service asked us to slow down and the query was not retried further. It can be checked by hand at ${manualUrl}`
      : 'the service asked us to slow down and the query was not retried further';
  }
  const detail = error instanceof Error ? error.message : String(error);
  const trimmed = detail.length > 180 ? `${detail.slice(0, 177)}…` : detail;
  return manualUrl
    ? `the service did not answer (${trimmed}). It can be checked by hand at ${manualUrl}`
    : `the service did not answer (${trimmed})`;
}
