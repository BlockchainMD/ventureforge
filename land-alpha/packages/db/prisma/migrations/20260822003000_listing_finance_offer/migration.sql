-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "financeAnnualRate" DOUBLE PRECISION,
ADD COLUMN     "financeDocumentFee" DECIMAL(14,2),
ADD COLUMN     "financeDownPayment" DECIMAL(14,2),
ADD COLUMN     "financeMonthlyPayment" DECIMAL(14,2),
ADD COLUMN     "financeOffered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "financeTermMonths" INTEGER;

