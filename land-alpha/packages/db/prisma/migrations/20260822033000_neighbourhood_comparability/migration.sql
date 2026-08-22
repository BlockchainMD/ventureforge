-- Comparable selection by the assessor's neighbourhood.
--
-- Florida comparables span $166k to $6.3M per acre inside ten kilometres, which
-- is why every Florida valuation is capped at LOW however many sales support
-- it, and why a half-acre parcel assessed at $65,000 was valued here at
-- $821,404. A radius is a poor proxy for comparability in a metropolitan
-- county; the assessor's neighbourhood code is the boundary the county itself
-- drew around land it considers to trade alike, and both the DOR roll
-- (NBRHD_CD) and the parcel layer (NBHD_CODE) publish it.
ALTER TABLE "ComparableSale" ADD COLUMN "neighborhood" TEXT;
ALTER TABLE "ParcelOpportunity" ADD COLUMN "neighborhood" TEXT;

CREATE INDEX "ComparableSale_state_county_neighborhood_idx"
  ON "ComparableSale"("state", "county", "neighborhood");
