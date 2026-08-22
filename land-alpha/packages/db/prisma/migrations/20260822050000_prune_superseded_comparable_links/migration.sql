-- Remove comparable links left behind by superseded valuations.
--
-- Each valuation run wrote a fresh set of links and deleted none, so a parcel
-- accumulated one set per run — 96% of the 28,280 rows in this table belonged
-- to a valuation the parcel no longer carries. Every reader loads a parcel's
-- links by weight without naming a snapshot, so the comparables table and the
-- investment memo were quoting a mixture of runs: evidence that does not add
-- up to the figure printed above it.
--
-- The valuation each run produced is kept on ParcelValuationSnapshot, so no
-- history is lost here. What a link records is which sales stand behind the
-- number the parcel carries now.
DELETE FROM "ComparableLink" cl
WHERE cl."valuationSnapshotId" IS DISTINCT FROM (
  SELECT s.id
  FROM "ParcelValuationSnapshot" s
  WHERE s."parcelId" = cl."parcelId"
  ORDER BY s."createdAt" DESC
  LIMIT 1
);
