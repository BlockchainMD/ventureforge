-- PostGIS spatial indexes and integrity constraints.
--
-- Prisma cannot express GiST indexes on Unsupported() columns, so they are
-- declared here. Every spatial predicate in packages/db/src/spatial.ts is
-- served by one of these.

-- Parcel polygon: the workhorse index for map-viewport queries, overlay
-- intersections (flood, wetlands) and neighbour lookups.
CREATE INDEX IF NOT EXISTS "ParcelOpportunity_geometry_gist"
  ON "ParcelOpportunity" USING GIST ("geometry");

-- Parcel centroid: used for radius searches when a parcel has only a point.
CREATE INDEX IF NOT EXISTS "ParcelOpportunity_centroid_gist"
  ON "ParcelOpportunity" USING GIST ("centroid");

-- Comparable sales are always queried "near this parcel, sold recently".
CREATE INDEX IF NOT EXISTS "ComparableSale_centroid_gist"
  ON "ComparableSale" USING GIST ("centroid");

CREATE INDEX IF NOT EXISTS "ComparableSale_lookup_idx"
  ON "ComparableSale" ("state", "county", "isVacantLand", "isArmsLength", "saleDate" DESC);

-- Reject geometry that is not polygonal or is in the wrong SRID before it can
-- corrupt an acreage calculation.
ALTER TABLE "ParcelOpportunity"
  DROP CONSTRAINT IF EXISTS "ParcelOpportunity_geometry_polygonal";
ALTER TABLE "ParcelOpportunity"
  ADD CONSTRAINT "ParcelOpportunity_geometry_polygonal"
  CHECK (
    "geometry" IS NULL
    OR (
      ST_SRID("geometry") = 4326
      AND GeometryType("geometry") IN ('POLYGON', 'MULTIPOLYGON')
    )
  );

-- The opportunity table's default view is "live, unrejected, ranked". A partial
-- index keeps that fast as rejected inventory accumulates (and it will: the
-- system is designed to reject aggressively).
CREATE INDEX IF NOT EXISTS "ParcelOpportunity_live_ranked_idx"
  ON "ParcelOpportunity" ("alphaScore" DESC NULLS LAST)
  WHERE "rejected" = false AND "removedFromSourceAt" IS NULL;

-- Case-insensitive APN search from the omnibox.
CREATE INDEX IF NOT EXISTS "ParcelOpportunity_apn_trgm_idx"
  ON "ParcelOpportunity" ("apnNormalized" text_pattern_ops);

-- Evidence is read per-parcel-per-field constantly on the detail page.
CREATE INDEX IF NOT EXISTS "Evidence_recent_idx"
  ON "Evidence" ("parcelId", "field", "createdAt" DESC);
