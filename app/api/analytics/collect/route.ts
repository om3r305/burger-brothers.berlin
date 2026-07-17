// app/api/analytics/collect/route.ts
import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, forbiddenResponse, hasTrustedMutationOrigin, requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY_EVENTS = "analytics_events";
const KEY_VISITORS = "visitors";

const MAX_EVENTS = 5000;
const MAX_VISITORS = 50000;

const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const PUBLIC_VISITOR_EVENTS = new Set([
  "page_view",
  "view",
  "visit",
  "ping",
  "screen_view",
]);

const BLOCKED_PROP_KEYS = new Set([
  "phone",
  "telefon",
  "telephone",
  "email",
  "eMail",
  "mail",
  "name",
  "customerName",
  "address",
  "adresse",
  "addressLine",
  "street",
  "straße",
  "strasse",
  "house",
  "hausnummer",
  "note",
  "notes",
]);

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      if (BLOCKED_PROP_KEYS.has(key) || BLOCKED_PROP_KEYS.has(normalizedKey)) continue;
      if (/(phone|telefon|email|mail|name|address|adresse|street|strasse|house|note)/i.test(normalizedKey)) continue;
      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  if (typeof value === "string") return value.slice(0, 500);

  return value;
}

function jsonForDb(value: any): Prisma.InputJsonValue {
  const cleaned = sanitizeJson(value);
  return (cleaned ?? []) as Prisma.InputJsonValue;
}

function cleanEventName(value: any) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "_")
    .slice(0, 100);
}

function cleanPath(value: any) {
  const raw = String(value || "/").trim().slice(0, 240);
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function cleanSessionId(value: any) {
  const text = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);

  return text || undefined;
}

function getIpHashSource(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for") || "";
  const realIp = req.headers.get("x-real-ip") || "";
  const ip = (forwarded.split(",")[0] || realIp || "").trim().slice(0, 80);
  const secret = String(
    process.env.ANALYTICS_IP_SECRET || process.env.SESSION_SECRET || "",
  ).trim();

  // Secret yoksa ham IP saklamak yerine alanı boş bırak.
  if (!ip || secret.length < 32) return "";

  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", `${secret}:${day}`)
    .update(ip)
    .digest("base64url")
    .slice(0, 32);
}

async function readSettingArray(tenantId: string, key: string) {
  const row = await prisma.setting.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
    select: {
      value: true,
    },
  });

  return Array.isArray(row?.value) ? row.value : [];
}

async function writeSettingArray(
  tenantId: string,
  key: string,
  list: any[],
  maxItems: number,
) {
  const safe = list.slice(-maxItems).map((item) => sanitizeJson(item));

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
    update: {
      value: jsonForDb(safe),
    },
    create: {
      tenantId,
      key,
      value: jsonForDb(safe),
    },
  });

  return safe;
}

function buildVisitorFromEvent(req: Request, body: any, event: string) {
  const props = isPlainObject(body?.props) ? body.props : {};
  const path = cleanPath(body?.path ?? props.path ?? props.pathname ?? props.url ?? "/");

  return {
    ts: Date.now(),
    path,
    sessionId: cleanSessionId(body?.sessionId ?? props.sessionId ?? props.sid),
    userAgent: (req.headers.get("user-agent") || "").slice(0, 180),
  };
}

/**
 * Public telemetry collector.
 * Nimmt nur unkritische Events an und speichert keine offensichtlichen PII-Felder.
 */
export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");

  const rateError = enforceRateLimit(req, "analytics:collect", 60, 60_000);
  if (rateError) return rateError;

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 32_768) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413, headers });
  }

  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));

    const eventName = cleanEventName(body?.event);
    const props = sanitizeJson(body?.props || {});

    const event = {
      ts: Date.now(),
      event: eventName,
      path: cleanPath(body?.path ?? props?.path ?? props?.pathname ?? "/"),
      sessionId: cleanSessionId(body?.sessionId ?? props?.sessionId ?? props?.sid),
      ua: (req.headers.get("user-agent") || "").slice(0, 180),
      ip: getIpHashSource(req),
      props,
    };

    const currentEvents = await readSettingArray(tenantId, KEY_EVENTS);
    const savedEvents = await writeSettingArray(
      tenantId,
      KEY_EVENTS,
      [...currentEvents, event],
      MAX_EVENTS,
    );

    let visitorCount: number | null = null;

    if (PUBLIC_VISITOR_EVENTS.has(eventName)) {
      const visitor = buildVisitorFromEvent(req, body, eventName);
      const currentVisitors = await readSettingArray(tenantId, KEY_VISITORS);
      const savedVisitors = await writeSettingArray(
        tenantId,
        KEY_VISITORS,
        [...currentVisitors, visitor],
        MAX_VISITORS,
      );

      visitorCount = savedVisitors.length;
    }

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        saved: 1,
        count: savedEvents.length,
        visitorCount,
      },
      { headers },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: error?.message || "ANALYTICS_POST_FAILED",
      },
      { status: 500, headers },
    );
  }
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();

    const [events, visitors] = await Promise.all([
      readSettingArray(tenantId, KEY_EVENTS),
      readSettingArray(tenantId, KEY_VISITORS),
    ]);

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        message: "analytics ok",
        count: events.length,
        visitors: visitors.length,
      },
      { headers },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        source: "db",
        error: error?.message || "ANALYTICS_GET_FAILED",
      },
      { status: 500, headers },
    );
  }
}