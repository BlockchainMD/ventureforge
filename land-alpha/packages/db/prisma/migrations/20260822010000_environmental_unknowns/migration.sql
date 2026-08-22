-- Environmental screening gaps become first-class data.
--
-- The screening engine has always distinguished "the layer reports this parcel
-- is clear" from "the layer never answered", and has always dropped the second
-- on the floor at the persistence boundary. Three of the five public layers we
-- query are in fact unreachable under the access rules this project holds
-- itself to, so the dropped half was the common case.
ALTER TABLE "ParcelOpportunity"
  ADD COLUMN "environmentalUnknowns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
