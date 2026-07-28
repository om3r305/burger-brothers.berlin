// lib/db.ts
import { PrismaClient } from "@prisma/client";

type PrismaRuntimeDiagnostics = {
  urlPresent: boolean;
  hostType:
    | "supabase_transaction_pooler"
    | "supabase_session_pooler"
    | "supabase_direct"
    | "other"
    | "unparsed";
  port: string;
  connectionLimit: number | null;
  poolTimeoutSeconds: number | null;
  connectTimeoutSeconds: number | null;
  pgbouncer: boolean | null;
};

type PrismaGlobal = {
  __prisma?: PrismaClient;
  __tenantId?: string;
  __tenantPromise?: Promise<string>;
  __prismaRuntimeDiagnostics?: PrismaRuntimeDiagnostics;
  __prismaDiagnosticsLogged?: boolean;
};

const g = globalThis as unknown as PrismaGlobal;

function positiveInteger(value: unknown, fallback: number | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function booleanValue(value: unknown) {
  const text = String(value ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return null;
}

function runtimeDatasource() {
  const raw = String(process.env.DATABASE_URL || "").trim();
  const fallbackDiagnostics: PrismaRuntimeDiagnostics = {
    urlPresent: Boolean(raw),
    hostType: "unparsed",
    port: "",
    connectionLimit: null,
    poolTimeoutSeconds: null,
    connectTimeoutSeconds: null,
    pgbouncer: null,
  };

  if (!raw) {
    return { url: raw, diagnostics: fallbackDiagnostics };
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const port = url.port || "5432";
    const supabasePooler = host.endsWith(".pooler.supabase.com");
    const supabaseDirect = host.endsWith(".supabase.co") && !supabasePooler;
    const transactionPooler = supabasePooler && port === "6543";
    const sessionPooler = supabasePooler && port === "5432";

    const envConnectionLimit = positiveInteger(
      process.env.PRISMA_CONNECTION_LIMIT,
      null,
    );
    const currentConnectionLimit = positiveInteger(
      url.searchParams.get("connection_limit"),
      null,
    );

    /*
      Supavisor transaction/session pooler zaten dış bağlantı havuzudur.
      connection_limit=1 aynı sıcak Vercel function instance içindeki paralel
      sorguları seri hale getirip P2024 kuyruğu oluşturuyordu. Dış pooler
      kullanıldığında 3 bağlantı hâlâ muhafazakâr bir değerdir ve env ile
      istenirse açıkça değiştirilebilir.
    */
    const desiredConnectionLimit =
      envConnectionLimit ??
      (supabasePooler
        ? Math.max(3, currentConnectionLimit || 0)
        : currentConnectionLimit || 1);

    url.searchParams.set(
      "connection_limit",
      String(Math.max(1, Math.min(10, desiredConnectionLimit))),
    );

    const poolTimeout = positiveInteger(
      process.env.PRISMA_POOL_TIMEOUT_SECONDS,
      positiveInteger(url.searchParams.get("pool_timeout"), 20),
    );
    const connectTimeout = positiveInteger(
      process.env.PRISMA_CONNECT_TIMEOUT_SECONDS,
      positiveInteger(url.searchParams.get("connect_timeout"), 10),
    );

    url.searchParams.set("pool_timeout", String(Math.max(5, poolTimeout || 20)));
    url.searchParams.set(
      "connect_timeout",
      String(Math.max(3, connectTimeout || 10)),
    );

    if (transactionPooler) {
      url.searchParams.set("pgbouncer", "true");
    }

    const diagnostics: PrismaRuntimeDiagnostics = {
      urlPresent: true,
      hostType: transactionPooler
        ? "supabase_transaction_pooler"
        : sessionPooler
          ? "supabase_session_pooler"
          : supabaseDirect
            ? "supabase_direct"
            : "other",
      port,
      connectionLimit: positiveInteger(
        url.searchParams.get("connection_limit"),
        null,
      ),
      poolTimeoutSeconds: positiveInteger(
        url.searchParams.get("pool_timeout"),
        null,
      ),
      connectTimeoutSeconds: positiveInteger(
        url.searchParams.get("connect_timeout"),
        null,
      ),
      pgbouncer: booleanValue(url.searchParams.get("pgbouncer")),
    };

    return { url: url.toString(), diagnostics };
  } catch {
    return { url: raw, diagnostics: fallbackDiagnostics };
  }
}

const datasource = runtimeDatasource();
g.__prismaRuntimeDiagnostics = datasource.diagnostics;

/*
  PrismaClient hem development hem production'da globalde tutulur.
  Aynı sıcak Vercel function instance tekrar kullanıldığında yeni client/pool açılmaz.
*/
export const prisma =
  g.__prisma ??
  new PrismaClient({
    ...(datasource.url
      ? {
          datasources: {
            db: {
              url: datasource.url,
            },
          },
        }
      : {}),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : process.env.PRISMA_POOL_DIAGNOSTICS === "1"
          ? ["info", "warn", "error"]
          : ["error"],
  });

g.__prisma = prisma;

if (
  process.env.PRISMA_POOL_DIAGNOSTICS === "1" &&
  !g.__prismaDiagnosticsLogged
) {
  g.__prismaDiagnosticsLogged = true;
  console.info("[db] Prisma runtime pool", datasource.diagnostics);
}

export function getPrismaRuntimeDiagnostics() {
  return {
    ...(g.__prismaRuntimeDiagnostics || datasource.diagnostics),
  };
}

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
