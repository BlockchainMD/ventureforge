-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "parcelChangeId" TEXT,
ADD COLUMN     "urgency" TEXT NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE INDEX "Notification_userId_urgency_createdAt_idx" ON "Notification"("userId", "urgency", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_alertRuleId_parcelChangeId_key" ON "Notification"("alertRuleId", "parcelChangeId");

