-- General Web Push must target customer-installed app devices only.
-- Existing rows stay "unknown" for safety. A customer app with an already granted
-- notification permission re-registers itself silently on its next launch.
ALTER TABLE "PushSubscription"
ADD COLUMN IF NOT EXISTS "appScope" TEXT NOT NULL DEFAULT 'unknown';

CREATE INDEX IF NOT EXISTS "PushSubscription_tenantId_appScope_active_idx"
ON "PushSubscription"("tenantId", "appScope", "active");
