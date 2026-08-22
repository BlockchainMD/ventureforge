-- Record which environmental layers actually answered.
--
-- An empty wetlandTypes array is produced both by "the inventory maps no
-- wetlands on this parcel" and by "the inventory refused the query", and the
-- memo generator has been rendering the second as the first. Storing the list
-- of layers that returned data lets every downstream claim of absence be gated
-- on the layer having been asked.
ALTER TABLE "ParcelOpportunity"
  ADD COLUMN "environmentalLayersScreened" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
