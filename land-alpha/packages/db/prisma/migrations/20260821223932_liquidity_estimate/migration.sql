-- AlterTable
ALTER TABLE "ParcelOpportunity" ADD COLUMN     "expectedHoldDays" INTEGER,
ADD COLUMN     "liquidityConfidence" "ConfidenceLevel" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "liquidityFactors" JSONB;
