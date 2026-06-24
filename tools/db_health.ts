// tools/db_health.ts
import { prisma, getTenantId } from "@/lib/db";

function maskDatabaseUrl(value?: string) {
  if (!value) return "(not set)";

  try {
    const url = new URL(value);

    if (url.password) url.password = "***";
    if (url.username) url.username = url.username ? "***" : "";

    return url.toString();
  } catch {
    return "(set, invalid URL format)";
  }
}

async function main() {
  console.log("Burger Brothers DB Health");
  console.log("NODE_ENV:", process.env.NODE_ENV || "(not set)");
  console.log("DATABASE_URL:", maskDatabaseUrl(process.env.DATABASE_URL));

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL fehlt. Bitte .env/.env.local prüfen.");
  }

  await prisma.$connect();

  const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
  console.log("Postgres connection:", result?.[0]?.ok === 1 ? "ok" : "unknown");

  const tenantId = await getTenantId();
  console.log("tenantId:", tenantId);

  const [products, settings, orders, customers, coupons, campaigns] =
    await Promise.all([
      prisma.product.count({ where: { tenantId } }),
      prisma.setting.count({ where: { tenantId } }),
      prisma.order.count({ where: { tenantId } }),
      prisma.customer.count({ where: { tenantId } }),
      prisma.coupon.count({ where: { tenantId } }),
      prisma.campaign.count({ where: { tenantId } }),
    ]);

  console.log("counts:", {
    products,
    settings,
    orders,
    customers,
    coupons,
    campaigns,
  });

  console.log("DB health: ok");
}

main()
  .catch((error) => {
    console.error("DB health: failed");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });