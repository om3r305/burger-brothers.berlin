import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY = "drivers";

type DriverRole = "fahrer" | "admin";

type Driver = {
  id: string;
  name: string;
  password: string;
  role: DriverRole;
};

function clean(value: any) {
  return String(value ?? "").trim();
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function normalizeDrivers(value: any): Driver[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.drivers)
        ? value.drivers
        : [];

  const map = new Map<string, Driver>();

  for (const driver of list) {
    const name = clean(driver?.name);
    const id = clean(driver?.id || name);
    const password = clean(driver?.password || driver?.pin || driver?.code);
    const role: DriverRole = driver?.role === "admin" ? "admin" : "fahrer";

    if (!id || !name || !password) continue;

    map.set(id, {
      id,
      name,
      password,
      role,
    });
  }

  return Array.from(map.values());
}

function jsonResponse(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

export async function GET() {
  try {
    const tenantId = await getTenantId();

    const row = await prisma.setting.findFirst({
      where: {
        tenantId,
        key: KEY,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        value: true,
      },
    });

    const items = normalizeDrivers(row?.value);

    return jsonResponse({
      ok: true,
      source: "db",
      items,
      drivers: items,
    });
  } catch (error: any) {
    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "DRIVERS_GET_FAILED",
      },
      500
    );
  }
}

export async function PUT(req: Request) {
  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({}));
    const items = normalizeDrivers(body);
    const value = sanitizeJson(items);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.setting.findFirst({
        where: {
          tenantId,
          key: KEY,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
        },
      });

      if (existing?.id) {
        await tx.setting.update({
          where: {
            id: existing.id,
          },
          data: {
            value: value as any,
          },
        });

        await tx.setting.deleteMany({
          where: {
            tenantId,
            key: KEY,
            id: {
              not: existing.id,
            },
          },
        });

        return;
      }

      await tx.setting.create({
        data: {
          tenantId,
          key: KEY,
          value: value as any,
        },
      });
    });

    return jsonResponse({
      ok: true,
      source: "db",
      saved: items.length,
      items,
      drivers: items,
    });
  } catch (error: any) {
    return jsonResponse(
      {
        ok: false,
        source: "db",
        error: error?.message || "DRIVERS_PUT_FAILED",
      },
      500
    );
  }
}

export async function POST(req: Request) {
  return PUT(req);
}