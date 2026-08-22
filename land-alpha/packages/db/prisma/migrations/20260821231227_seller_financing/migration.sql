-- CreateEnum
CREATE TYPE "FinanceNoteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAID_OFF', 'DELINQUENT', 'DEFAULTED', 'FORFEITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancePaymentKind" AS ENUM ('DOWN_PAYMENT', 'SCHEDULED', 'EXTRA_PRINCIPAL', 'PAYOFF', 'LATE_FEE', 'DOCUMENT_FEE', 'REFUND');

-- CreateTable
CREATE TABLE "FinanceNote" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "buyerLeadId" TEXT,
    "status" "FinanceNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "salePrice" DECIMAL(14,2) NOT NULL,
    "downPayment" DECIMAL(14,2) NOT NULL,
    "annualRate" DOUBLE PRECISION NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "documentFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthlyFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "lateFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "graceDays" INTEGER NOT NULL DEFAULT 10,
    "firstPaymentDate" TIMESTAMP(3) NOT NULL,
    "signedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closureReason" TEXT,
    "scheduleSnapshot" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayment" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" "FinancePaymentKind" NOT NULL DEFAULT 'SCHEDULED',
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "appliesToPaymentNumber" INTEGER,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinanceNote_parcelId_key" ON "FinanceNote"("parcelId");

-- CreateIndex
CREATE INDEX "FinanceNote_status_idx" ON "FinanceNote"("status");

-- CreateIndex
CREATE INDEX "FinanceNote_firstPaymentDate_idx" ON "FinanceNote"("firstPaymentDate");

-- CreateIndex
CREATE INDEX "FinancePayment_noteId_receivedAt_idx" ON "FinancePayment"("noteId", "receivedAt");

-- AddForeignKey
ALTER TABLE "FinanceNote" ADD CONSTRAINT "FinanceNote_parcelId_fkey" FOREIGN KEY ("parcelId") REFERENCES "ParcelOpportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinanceNote" ADD CONSTRAINT "FinanceNote_buyerLeadId_fkey" FOREIGN KEY ("buyerLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "FinanceNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
