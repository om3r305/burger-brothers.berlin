-- Burger Brothers: sichere additive Erweiterung für automatische Benachrichtigungen.
-- Diese Migration verändert oder löscht keine vorhandenen Daten.

ALTER TABLE "NotificationCampaign"
  ADD COLUMN IF NOT EXISTS "sourceKey" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceHash" TEXT;

ALTER TABLE "NotificationEvent"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationCampaign_tenantId_sourceKey_key"
  ON "NotificationCampaign"("tenantId", "sourceKey");

CREATE INDEX IF NOT EXISTS "NotificationCampaign_tenantId_kind_sourceKey_idx"
  ON "NotificationCampaign"("tenantId", "kind", "sourceKey");
