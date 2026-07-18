// app/api/tv/debug/route.ts
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { requireSessionRole } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function maskPin(pin: string) {
  const clean = String(pin || "").trim();
  if (!clean) return "";
  return `****${clean.slice(-4)}`;
}

function readPinFromSettings(value: any) {
  const settings = value && typeof value === "object" ? value : {};

  const candidates = [
    settings?.security?.tvPin,
    settings?.tv?.pin,
    settings?.tvPin,
    settings?.pin,
  ];

  for (const candidate of candidates) {
    const pin = String(candidate ?? "").trim();
    if (pin) return pin;
  }

  return "";
}

async function readDbPin() {
  const tenantId = await getTenantId();

  const rows = await prisma.setting.findMany({
    where: {
      tenantId,
      key: {
        in: ["settings", "bb_settings_v6", "app:settings"],
      },
    },
    select: {
      key: true,
      value: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: "desc",
    },
  });

  const tries = rows.map((row: any) => {
    const pin = readPinFromSettings(row.value);

    return {
      ok: !!pin,
      source: `db:setting:${row.key}`,
      pinMasked: maskPin(pin),
    };
  });

  const found = rows
    .map((row: any) => ({
      key: row.key,
      pin: readPinFromSettings(row.value),
    }))
    .find((item: any) => item.pin);

  return {
    pin: found?.pin || "",
    source: found?.key ? `db:setting:${found.key}` : "",
    tries,
  };
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        error: "disabled in production",
      },
      { status: 403 }
    );
  }

  const envPin = String(process.env.TV_PIN || "").trim();

  let dbPin = "";
  let dbSource = "";
  let tries: Array<{ ok: boolean; source: string; pinMasked: string }> = [];

  try {
    const db = await readDbPin();
    dbPin = db.pin;
    dbSource = db.source;
    tries = db.tries;
  } catch (error: any) {
    tries = [
      {
        ok: false,
        source: `db:error:${error?.code || error?.name || "unknown"}`,
        pinMasked: "",
      },
    ];
  }

  const chosen = dbPin
    ? { source: dbSource || "db:setting" }
    : envPin
      ? { source: "env:TV_PIN" }
      : { source: "not_configured" };

  return NextResponse.json({
    ok: true,
    using: chosen.source,
    configured: Boolean(dbPin || envPin),
    dbPresent: !!dbPin,
    envPresent: !!envPin,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}