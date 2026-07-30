CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sessionHash" TEXT,
    "props" JSONB,
    "consentVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_tenantId_createdAt_idx"
ON "AnalyticsEvent"("tenantId", "createdAt");

CREATE INDEX "AnalyticsEvent_tenantId_event_createdAt_idx"
ON "AnalyticsEvent"("tenantId", "event", "createdAt");

CREATE INDEX "AnalyticsEvent_tenantId_sessionHash_createdAt_idx"
ON "AnalyticsEvent"("tenantId", "sessionHash", "createdAt");

ALTER TABLE "AnalyticsEvent"
ADD CONSTRAINT "AnalyticsEvent_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
