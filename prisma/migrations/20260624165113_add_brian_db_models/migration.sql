-- CreateTable
CREATE TABLE "BrianLearnLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT,
    "driverId" TEXT,
    "driverName" TEXT,
    "primaryStreet" TEXT,
    "streets" JSONB NOT NULL,
    "peerStreets" JSONB,
    "status" TEXT,
    "source" TEXT,
    "raw" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrianLearnLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrianRouteModel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'current',
    "version" INTEGER NOT NULL DEFAULT 1,
    "model" JSONB NOT NULL,
    "stats" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrianRouteModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrianLearnLog_tenantId_idx" ON "BrianLearnLog"("tenantId");

-- CreateIndex
CREATE INDEX "BrianLearnLog_tenantId_occurredAt_idx" ON "BrianLearnLog"("tenantId", "occurredAt");

-- CreateIndex
CREATE INDEX "BrianLearnLog_tenantId_orderId_idx" ON "BrianLearnLog"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "BrianLearnLog_tenantId_primaryStreet_idx" ON "BrianLearnLog"("tenantId", "primaryStreet");

-- CreateIndex
CREATE INDEX "BrianRouteModel_tenantId_idx" ON "BrianRouteModel"("tenantId");

-- CreateIndex
CREATE INDEX "BrianRouteModel_tenantId_generatedAt_idx" ON "BrianRouteModel"("tenantId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrianRouteModel_tenantId_key_key" ON "BrianRouteModel"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "BrianLearnLog" ADD CONSTRAINT "BrianLearnLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrianRouteModel" ADD CONSTRAINT "BrianRouteModel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
