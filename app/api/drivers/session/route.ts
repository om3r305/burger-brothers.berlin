import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSessionSubject,
  requireSessionRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function storedDrivers(value: unknown) {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const list = Array.isArray(value)
    ? value
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.drivers)
        ? root.drivers
        : [];

  return list
    .map((entry) => {
      const item = entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
      const id = clean(item.id || item.name);
      const name = clean(item.name || item.id);
      return id && name ? { id, name } : null;
    })
    .filter((item): item is { id: string; name: string } => Boolean(item));
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "driver");
  if (authError) return authError;

  const subject = await getSessionSubject(req, "driver");
  if (!subject) return json({ ok: false, error: "driver_session_subject_missing" }, 401);

  const tenantId = await getTenantId();
  const row = await prisma.setting.findFirst({
    where: { tenantId, key: "drivers" },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });

  const driver = storedDrivers(row?.value).find((item) => item.id === subject);
  if (!driver) {
    return json({ ok: false, error: "driver_identity_unknown" }, 401);
  }

  return json({
    ok: true,
    driver,
  });
}
