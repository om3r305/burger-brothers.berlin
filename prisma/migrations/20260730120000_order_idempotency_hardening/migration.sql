ALTER TABLE "Order"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestHash" TEXT;

CREATE UNIQUE INDEX "order_tenant_idempotency_unique"
  ON "Order"("tenantId", "idempotencyKey");
