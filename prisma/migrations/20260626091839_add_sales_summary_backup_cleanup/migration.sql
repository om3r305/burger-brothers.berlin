-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DailySalesSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "pickupCount" INTEGER NOT NULL DEFAULT 0,
    "deliveryCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "merchandise" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discounts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "surcharges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "couponDiscounts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "onlineTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "contactlessTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "splitTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "topItems" JSONB,
    "byHour" JSONB,
    "byMode" JSONB,
    "byPayment" JSONB,
    "extra" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySalesSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlySalesSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "pickupCount" INTEGER NOT NULL DEFAULT 0,
    "deliveryCount" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "grossSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netSales" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "merchandise" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "discounts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "surcharges" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "couponDiscounts" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cashTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "onlineTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "contactlessTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "splitTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "topItems" JSONB,
    "byDay" JSONB,
    "byMode" JSONB,
    "byPayment" JSONB,
    "extra" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlySalesSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "fileName" TEXT,
    "fileUrl" TEXT,
    "sizeBytes" INTEGER,
    "checksum" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "meta" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupJobLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "affectedOrders" INTEGER NOT NULL DEFAULT 0,
    "affectedCustomers" INTEGER NOT NULL DEFAULT 0,
    "affectedLogs" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "meta" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanupJobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailySalesSummary_tenantId_idx" ON "DailySalesSummary"("tenantId");

-- CreateIndex
CREATE INDEX "DailySalesSummary_tenantId_date_idx" ON "DailySalesSummary"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailySalesSummary_tenantId_date_key" ON "DailySalesSummary"("tenantId", "date");

-- CreateIndex
CREATE INDEX "MonthlySalesSummary_tenantId_idx" ON "MonthlySalesSummary"("tenantId");

-- CreateIndex
CREATE INDEX "MonthlySalesSummary_tenantId_year_idx" ON "MonthlySalesSummary"("tenantId", "year");

-- CreateIndex
CREATE INDEX "MonthlySalesSummary_tenantId_year_month_idx" ON "MonthlySalesSummary"("tenantId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySalesSummary_tenantId_year_month_key" ON "MonthlySalesSummary"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "BackupLog_tenantId_idx" ON "BackupLog"("tenantId");

-- CreateIndex
CREATE INDEX "BackupLog_tenantId_type_idx" ON "BackupLog"("tenantId", "type");

-- CreateIndex
CREATE INDEX "BackupLog_tenantId_status_idx" ON "BackupLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "BackupLog_tenantId_startedAt_idx" ON "BackupLog"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "CleanupJobLog_tenantId_idx" ON "CleanupJobLog"("tenantId");

-- CreateIndex
CREATE INDEX "CleanupJobLog_tenantId_jobType_idx" ON "CleanupJobLog"("tenantId", "jobType");

-- CreateIndex
CREATE INDEX "CleanupJobLog_tenantId_status_idx" ON "CleanupJobLog"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CleanupJobLog_tenantId_startedAt_idx" ON "CleanupJobLog"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_archivedAt_idx" ON "Order"("tenantId", "archivedAt");

-- CreateIndex
CREATE INDEX "Order_tenantId_anonymizedAt_idx" ON "Order"("tenantId", "anonymizedAt");

-- AddForeignKey
ALTER TABLE "DailySalesSummary" ADD CONSTRAINT "DailySalesSummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySalesSummary" ADD CONSTRAINT "MonthlySalesSummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupLog" ADD CONSTRAINT "BackupLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleanupJobLog" ADD CONSTRAINT "CleanupJobLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
