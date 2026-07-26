-- Burger Brothers: allgemeine Android/iOS Web-Push-Infrastruktur

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "expirationTime" TIMESTAMP(3),
    "deviceTokenHash" TEXT NOT NULL,
    "deviceId" TEXT,
    "customerId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "platform" TEXT,
    "userAgent" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'de',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPushAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "orderUpdates" BOOLEAN NOT NULL DEFAULT true,
    "campaigns" BOOLEAN NOT NULL DEFAULT false,
    "coupons" BOOLEAN NOT NULL DEFAULT false,
    "nearbyDelivery" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT NOT NULL DEFAULT '1',
    "orderConsentedAt" TIMESTAMP(3),
    "marketingConsentedAt" TIMESTAMP(3),
    "plz" TEXT,
    "street" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "nearbyRadiusM" INTEGER NOT NULL DEFAULT 800,
    "nearbyCooldownDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationCampaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "imageUrl" TEXT,
    "audience" JSONB,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "campaignId" TEXT,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "imageUrl" TEXT,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "campaignId" TEXT,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "error" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushSubscription_tenantId_endpoint_key" ON "PushSubscription"("tenantId", "endpoint");
CREATE UNIQUE INDEX "PushSubscription_tenantId_deviceTokenHash_key" ON "PushSubscription"("tenantId", "deviceTokenHash");
CREATE INDEX "PushSubscription_tenantId_active_idx" ON "PushSubscription"("tenantId", "active");
CREATE INDEX "PushSubscription_tenantId_phone_idx" ON "PushSubscription"("tenantId", "phone");
CREATE INDEX "PushSubscription_tenantId_email_idx" ON "PushSubscription"("tenantId", "email");
CREATE INDEX "PushSubscription_tenantId_customerId_idx" ON "PushSubscription"("tenantId", "customerId");

CREATE UNIQUE INDEX "NotificationPreference_subscriptionId_key" ON "NotificationPreference"("subscriptionId");
CREATE INDEX "NotificationPreference_tenantId_campaigns_idx" ON "NotificationPreference"("tenantId", "campaigns");
CREATE INDEX "NotificationPreference_tenantId_coupons_idx" ON "NotificationPreference"("tenantId", "coupons");
CREATE INDEX "NotificationPreference_tenantId_nearbyDelivery_idx" ON "NotificationPreference"("tenantId", "nearbyDelivery");
CREATE INDEX "NotificationPreference_tenantId_plz_idx" ON "NotificationPreference"("tenantId", "plz");

CREATE INDEX "NotificationCampaign_tenantId_status_idx" ON "NotificationCampaign"("tenantId", "status");
CREATE INDEX "NotificationCampaign_tenantId_createdAt_idx" ON "NotificationCampaign"("tenantId", "createdAt");
CREATE INDEX "NotificationCampaign_tenantId_scheduledAt_idx" ON "NotificationCampaign"("tenantId", "scheduledAt");

CREATE UNIQUE INDEX "NotificationEvent_tenantId_dedupeKey_key" ON "NotificationEvent"("tenantId", "dedupeKey");
CREATE INDEX "NotificationEvent_tenantId_subscriptionId_status_availableAt_idx" ON "NotificationEvent"("tenantId", "subscriptionId", "status", "availableAt");
CREATE INDEX "NotificationEvent_tenantId_orderId_idx" ON "NotificationEvent"("tenantId", "orderId");
CREATE INDEX "NotificationEvent_tenantId_type_createdAt_idx" ON "NotificationEvent"("tenantId", "type", "createdAt");

CREATE INDEX "NotificationDelivery_tenantId_status_idx" ON "NotificationDelivery"("tenantId", "status");
CREATE INDEX "NotificationDelivery_tenantId_subscriptionId_attemptedAt_idx" ON "NotificationDelivery"("tenantId", "subscriptionId", "attemptedAt");
CREATE INDEX "NotificationDelivery_tenantId_campaignId_idx" ON "NotificationDelivery"("tenantId", "campaignId");

ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
