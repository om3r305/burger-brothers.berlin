-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "channel" TEXT,
    "status" TEXT NOT NULL,
    "merchandise" DECIMAL(10,2),
    "discount" DECIMAL(10,2),
    "surcharges" DECIMAL(10,2),
    "total" DECIMAL(10,2) NOT NULL,
    "coupon" TEXT,
    "couponDiscount" DECIMAL(10,2),
    "customer" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "meta" JSONB,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planned" TEXT,
    "etaMin" INTEGER,
    "etaAdjustMin" INTEGER,
    "driver" JSONB,
    "doneAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "history" JSONB,
    "print" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_tenantId_status_idx" ON "Order"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Order_tenantId_mode_idx" ON "Order"("tenantId", "mode");

-- CreateIndex
CREATE INDEX "Order_tenantId_ts_idx" ON "Order"("tenantId", "ts");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
