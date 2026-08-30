import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const WHOLE_SETTINGS_KEYS = new Set(["settings", "bb_settings_v6", "app:settings"]);
const PUBLIC_RUNTIME_KEYS = [
  "site",
  "pickup",
  "delivery",
  "discount",
  "discounts",
  "apollon",
  "lifa",
] as const;

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  return Boolean(
    key && key !== "__proto__" && key !== "prototype" && key !== "constructor",
  );
}

function deepMerge(base: any, override: any): any {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }

  const result: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!isSafeKey(key)) continue;
    result[key] =
      isPlainObject(result[key]) && isPlainObject(value)
        ? deepMerge(result[key], value)
        : value;
  }
  return result;
}

function publicRuntimeView(settings: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const key of PUBLIC_RUNTIME_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }

  const site = isPlainObject(out.site) ? out.site : {};
  out.site = {
    closed: site.closed === true,
    message: typeof site.message === "string" ? site.message.slice(0, 500) : "",
    maintenanceStart:
      typeof site.maintenanceStart === "string" ? site.maintenanceStart : "",
    maintenanceEnd:
      typeof site.maintenanceEnd === "string" ? site.maintenanceEnd : "",
  };

  return out;
}

export async function GET() {
  try {
    const tenantId = getTenantId();
    const rows = await prisma.setting.findMany({
      where: { tenantId },
      select: { key: true, value: true },
      orderBy: { key: "asc" },
    });

    let legacy: Record<string, any> = {};
    let whole: Record<string, any> = {};

    for (const row of rows) {
      if (!isSafeKey(row.key)) continue;
      const value = row.value;

      if (WHOLE_SETTINGS_KEYS.has(row.key) && isPlainObject(value)) {
        whole = deepMerge(whole, value);
        continue;
      }

      if ((PUBLIC_RUNTIME_KEYS as readonly string[]).includes(row.key)) {
        legacy[row.key] = value;
      }
    }

    const settings = deepMerge(legacy, whole);
    return NextResponse.json(publicRuntimeView(settings), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[settings/runtime] GET failed", error);
    return NextResponse.json(
      {
        site: {
          closed: false,
          message: "",
          maintenanceStart: "",
          maintenanceEnd: "",
        },
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }
}
