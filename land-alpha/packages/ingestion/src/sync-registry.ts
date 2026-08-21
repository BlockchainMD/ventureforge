/**
 * Registry sync is implemented in `@land-alpha/db` so that database seeding does
 * not depend on the ingestion package. Re-exported here because this is where
 * callers expect to find it.
 */
export { syncRegistry, resolveSource, type SyncResult } from '@land-alpha/db/seed/sources';
