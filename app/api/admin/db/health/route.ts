// app/api/admin/db/health/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId, getPrismaRuntimeDiagnostics } from "@/lib/db";
import { currentMode, usingPrisma, usingSQLite } from "@/lib/server/db";
import { requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  const info: Record<string, any> = {
    ok: true,
    source: "db",
    mode: currentMode(),
    usingPrisma: usingPrisma(),
    usingSQLite: usingSQLite(),
    databaseUrl: process.env.DATABASE_URL ? "set" : "missing",
    directUrl: process.env.DIRECT_URL ? "set" : "missing",
    checkedAt: new Date().toISOString(),
  };

  try {
    const startedAt = performance.now();
    const tenantStartedAt = performance.now();
    const tenantId = await getTenantId();
    const tenantMs = Math.round(performance.now() - tenantStartedAt);

    const pingStartedAt = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const pingMs = Math.round(performance.now() - pingStartedAt);

    info.tenantId = tenantId;
    info.connection = "ok";
    info.pool = getPrismaRuntimeDiagnostics();
    info.timingsMs = {
      tenant: tenantMs,
      ping: pingMs,
      total: Math.round(performance.now() - startedAt),
    };
  } catch (error: any) {
    info.ok = false;
    info.connection = "failed";
    info.error = error?.message || "DB_HEALTH_FAILED";
  }

  return NextResponse.json(info, {
    status: info.ok ? 200 : 500,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
