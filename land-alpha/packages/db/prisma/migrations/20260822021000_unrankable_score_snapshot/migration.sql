-- A score snapshot may record that a parcel could not be ranked.
--
-- The Alpha Score estimates return. Without a value estimate there is no
-- return to estimate, and a weighted mean over unknowns lands near the neutral
-- 50 — which is how a parcel nobody knows anything about came to outrank one
-- that had been assessed and found ordinary. "Unranked" is now a value the
-- score can take, and the history has to be able to hold it.
ALTER TABLE "ParcelScoreSnapshot" ALTER COLUMN "alphaScore" DROP NOT NULL;
