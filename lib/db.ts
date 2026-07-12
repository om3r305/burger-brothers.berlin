// lib/db.ts
import { PrismaClient } from "@prisma/client";

type PrismaGlobal = {
  __prisma?: PrismaClient;
  __tenantId?: string;
  __tenantPromise?: Promise<string>;
};

const g = globalThis as unknown as PrismaGlobal;

/*
  PrismaClient'i hem development hem production'da globalde tutuyoruz.
  Vercel'de aynı sıcak function instance tekrar kullanıldığında yeni connection açılmaz.
*/
export const prisma =
  g.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

g.__prisma = prisma;

export { Prisma } from "@prisma/client";

const DEFAULT_TENANT_SLUG =
  process.env.DEFAULT_TENANT_SLUG ||
  process.env.TENANT_SLUG ||
  "burger-brothers";

const DEFAULT_TENANT_NAME =
  process.env.DEFAULT_TENANT_NAME ||
  process.env.TENANT_NAME ||
  "Burger Brothers Berlin";

/*
  Tenant ID uygulama boyunca değişmediği için her API isteğinde upsert çalıştırmıyoruz.
  Önce process cache kullanılır; cache boşsa findUnique, tenant gerçekten yoksa upsert yapılır.
*/
async function loadTenantId(): Promise<string> {
  const existing = await prisma.tenant.findUnique({
    where: {
      slug: DEFAULT_TENANT_SLUG,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    return existing.id;
  }

  const created = await prisma.tenant.upsert({
    where: {
      slug: DEFAULT_TENANT_SLUG,
    },
    update: {},
    create: {
      slug: DEFAULT_TENANT_SLUG,
      name: DEFAULT_TENANT_NAME,
    },
    select: {
      id: true,
    },
  });

  return created.id;
}

export async function getTenantId(): Promise<string> {
  if (g.__tenantId) {
    return g.__tenantId;
  }

  if (!g.__tenantPromise) {
    g.__tenantPromise = loadTenantId()
      .then((tenantId) => {
        g.__tenantId = tenantId;
        return tenantId;
      })
      .catch((error) => {
        g.__tenantPromise = undefined;
        console.error("❌ Tenant yüklenirken hata:", error);
        throw new Error("Tenant yüklenemedi (DB bağlantısı kontrol edin)");
      });
  }

  return g.__tenantPromise;
}
