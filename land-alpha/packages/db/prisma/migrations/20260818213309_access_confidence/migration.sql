-- DropIndex
DROP INDEX "ComparableSale_centroid_gist";

-- DropIndex
DROP INDEX "ComparableSale_lookup_idx";

-- DropIndex
DROP INDEX "Evidence_recent_idx";

-- DropIndex
DROP INDEX "ParcelOpportunity_centroid_gist";

-- DropIndex
DROP INDEX "ParcelOpportunity_geometry_gist";

-- AlterTable
ALTER TABLE "ParcelOpportunity" ADD COLUMN     "accessConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN';
