-- Schnellbestellung şanslı sipariş, geçici müşteri fotoğrafı,
-- Showcase canlı kutlama olayı ve admin onay bildirimleri.

CREATE TABLE "SchnellRewardWin" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "deviceTokenHash" TEXT,
    "rewardType" TEXT NOT NULL,
    "rewardCode" TEXT NOT NULL,
    "rewardLabel" TEXT NOT NULL,
    "rewardData" JSONB NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'won',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchnellRewardWin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SchnellWinnerSubmission" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rewardWinId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "moderationStatus" TEXT NOT NULL DEFAULT 'pending',
    "photoStatus" TEXT NOT NULL DEFAULT 'none',
    "photoStoragePath" TEXT,
    "photoMimeType" TEXT,
    "photoSize" INTEGER,
    "consentVersion" TEXT,
    "consentedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deleteAfter" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SchnellWinnerSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShowcaseLiveEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "screenSlug" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "playedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShowcaseLiveEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminInboxNotification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "readAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminInboxNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchnellRewardWin_orderId_key" ON "SchnellRewardWin"("orderId");
CREATE UNIQUE INDEX "SchnellRewardWin_tenantId_businessDate_slotIndex_key" ON "SchnellRewardWin"("tenantId", "businessDate", "slotIndex");
CREATE INDEX "SchnellRewardWin_tenantId_businessDate_idx" ON "SchnellRewardWin"("tenantId", "businessDate");
CREATE INDEX "SchnellRewardWin_tenantId_deviceTokenHash_businessDate_idx" ON "SchnellRewardWin"("tenantId", "deviceTokenHash", "businessDate");

CREATE UNIQUE INDEX "SchnellWinnerSubmission_rewardWinId_key" ON "SchnellWinnerSubmission"("rewardWinId");
CREATE INDEX "SchnellWinnerSubmission_tenantId_moderationStatus_createdAt_idx" ON "SchnellWinnerSubmission"("tenantId", "moderationStatus", "createdAt");
CREATE INDEX "SchnellWinnerSubmission_tenantId_expiresAt_idx" ON "SchnellWinnerSubmission"("tenantId", "expiresAt");
CREATE INDEX "SchnellWinnerSubmission_tenantId_deleteAfter_idx" ON "SchnellWinnerSubmission"("tenantId", "deleteAfter");

CREATE INDEX "ShowcaseLiveEvent_tenantId_screenSlug_status_scheduledAt_idx" ON "ShowcaseLiveEvent"("tenantId", "screenSlug", "status", "scheduledAt");
CREATE INDEX "ShowcaseLiveEvent_tenantId_sourceType_sourceId_idx" ON "ShowcaseLiveEvent"("tenantId", "sourceType", "sourceId");
CREATE INDEX "ShowcaseLiveEvent_tenantId_expiresAt_idx" ON "ShowcaseLiveEvent"("tenantId", "expiresAt");

CREATE UNIQUE INDEX "AdminInboxNotification_tenantId_dedupeKey_key" ON "AdminInboxNotification"("tenantId", "dedupeKey");
CREATE INDEX "AdminInboxNotification_tenantId_status_createdAt_idx" ON "AdminInboxNotification"("tenantId", "status", "createdAt");
CREATE INDEX "AdminInboxNotification_tenantId_sourceType_sourceId_idx" ON "AdminInboxNotification"("tenantId", "sourceType", "sourceId");

ALTER TABLE "SchnellRewardWin" ADD CONSTRAINT "SchnellRewardWin_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchnellRewardWin" ADD CONSTRAINT "SchnellRewardWin_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchnellWinnerSubmission" ADD CONSTRAINT "SchnellWinnerSubmission_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchnellWinnerSubmission" ADD CONSTRAINT "SchnellWinnerSubmission_rewardWinId_fkey" FOREIGN KEY ("rewardWinId") REFERENCES "SchnellRewardWin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowcaseLiveEvent" ADD CONSTRAINT "ShowcaseLiveEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminInboxNotification" ADD CONSTRAINT "AdminInboxNotification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
