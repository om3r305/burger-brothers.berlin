// app/api/admin/db/health/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { currentMode, usingPrisma, usingSQLite } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
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
    const tenantId = await getTenantId();

    await prisma.$queryRaw`SELECT 1`;

    info.tenantId = tenantId;
    info.connection = "ok";
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