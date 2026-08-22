-- Analyst-recorded environmental screening.
--
-- Flood, wetlands and cleanup-site data are published behind robots directives
-- and bot protection this project does not work around, so a person opening the
-- public map viewer is the only way those layers are ever screened. Recording
-- what they saw lets the screening engine consume it on the same footing as an
-- API response, with the observation naming who made it.
CREATE TYPE "EnvironmentalLayer" AS ENUM ('FLOOD', 'WETLANDS', 'CONTAMINATION', 'SOILS');

CREATE TABLE "ManualEnvironmentalScreen" (
  "id"                TEXT NOT NULL,
  "parcelId"          TEXT NOT NULL,
  "layer"             "EnvironmentalLayer" NOT NULL,
  "findings"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "overlapFraction"   DOUBLE PRECISION,
  "nearestSiteMeters" DOUBLE PRECISION,
  "clear"             BOOLEAN NOT NULL DEFAULT false,
  "sourceUrl"         TEXT,
  "notes"             TEXT,
  "screenedById"      TEXT,
  "screenedByLabel"   TEXT NOT NULL,
  "screenedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt"      TIMESTAMP(3),
  CONSTRAINT "ManualEnvironmentalScreen_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManualEnvironmentalScreen_parcelId_layer_supersededAt_idx"
  ON "ManualEnvironmentalScreen"("parcelId", "layer", "supersededAt");

ALTER TABLE "ManualEnvironmentalScreen"
  ADD CONSTRAINT "ManualEnvironmentalScreen_parcelId_fkey"
  FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManualEnvironmentalScreen"
  ADD CONSTRAINT "ManualEnvironmentalScreen_screenedById_fkey"
  FOREIGN KEY ("screenedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
