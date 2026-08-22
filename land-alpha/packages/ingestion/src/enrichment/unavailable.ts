import { AccessRestrictedError } from '@land-alpha/shared';

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
  const detail = error instanceof Error ? error.message : String(error);
  const trimmed = detail.length > 180 ? `${detail.slice(0, 177)}…` : detail;
  return manualUrl
    ? `the service did not answer (${trimmed}). It can be checked by hand at ${manualUrl}`
    : `the service did not answer (${trimmed})`;
}
