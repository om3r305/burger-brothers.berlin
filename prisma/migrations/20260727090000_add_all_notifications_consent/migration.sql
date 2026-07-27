-- Add one master consent flag without removing or changing existing preference fields.
ALTER TABLE "NotificationPreference"
ADD COLUMN IF NOT EXISTS "allNotifications" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the intent of devices that had already enabled every existing category.
UPDATE "NotificationPreference"
SET "allNotifications" = true
WHERE "allNotifications" = false
  AND "orderUpdates" = true
  AND "campaigns" = true
  AND "coupons" = true
  AND "nearbyDelivery" = true
  AND "marketingConsentedAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "NotificationPreference_tenantId_allNotifications_idx"
ON "NotificationPreference"("tenantId", "allNotifications");
