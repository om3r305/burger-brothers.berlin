// lib/db.ts
import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };

// Development’da Prisma'nın yeniden oluşturulmasını engelle
export const prisma =
  g.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/* ──────────────────────────────────────────────
   TENANT (Multi-Tenant)
   Uygulamanın TEK giriş noktası — %100 DB bağlantısı
   ────────────────────────────────────────────── */

export { Prisma } from "@prisma/client";

/**
 * Varsayılan tenant bilgiler (env → yoksa fallback)
 * Domain bazlı tenant'a geçmek istediğimizde
 * bu alan tek noktadan kontrol edilecek.
 */
const DEFAULT_TENANT_SLUG =
  process.env.DEFAULT_TENANT_SLUG ||
  process.env.TENANT_SLUG ||
  "burger-brothers";

const DEFAULT_TENANT_NAME =
  process.env.DEFAULT_TENANT_NAME ||
  process.env.TENANT_NAME ||
  "Burger Brothers Berlin";

/**
 * getTenantId()
 * DB’de tenant yoksa otomatik oluşturur.
 * Tüm API route’ları buradan tenantId alacak.
 */
export async function getTenantId(): Promise<string> {
  try {
    const tenant = await prisma.tenant.upsert({
      where: {
        slug: DEFAULT_TENANT_SLUG,
      },
      update: {
        name: DEFAULT_TENANT_NAME,
      },
      create: {
        slug: DEFAULT_TENANT_SLUG,
        name: DEFAULT_TENANT_NAME,
      },
      select: {
        id: true,
      },
    });

    return tenant.id;
  } catch (err) {
    console.error("❌ Tenant yüklenirken hata:", err);
    throw new Error("Tenant yüklenemedi (DB bağlantısı kontrol edin)");
  }
}