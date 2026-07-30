import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  requireSessionRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const CONSENT_VERSION = "analytics-v1";
const headers = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};
const PUBLIC_EVENTS = new Set([
  "page_view",
  "view",
  "visit",
  "screen_view",
]);
const ALLOWED_PROP_KEYS = new Set([
  "pathname",
  "source",
  "campaign",
  "category",
  "action",
  "label",
  "value",
]);

function cleanEventName(value: unknown) {
  const event = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, "_")
    .slice(0, 60);
  return PUBLIC_EVENTS.has(event) ? event : "";
}

function cleanPath(value: unknown) {
  const raw = String(value || "/").trim().split(/[?#]/, 1)[0].slice(0, 180);
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

function cleanProps(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string | number | boolean> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_PROP_KEYS.has(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof item)) continue;
    if (typeof item === "string") {
      output[key] =
        key === "pathname" ? cleanPath(item) : item.trim().slice(0, 80);
    } else if (typeof item === "number") {
      if (Number.isFinite(item)) output[key] = item;
    } else {
      output[key] = item as boolean;
    }
  }

  return output;
}

function sessionHash(value: unknown) {
  const sessionId = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  const secret = String(process.env.ANALYTICS_IP_SECRET || "").trim();
  if (!sessionId || secret.length < 32) return null;

  // Günlük salt, uzun süreli davranış profili oluşmasını engeller.
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", `${secret}:${day}`)
    .update(sessionId)
    .digest("base64url")
    .slice(0, 32);
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rateError = await enforceRateLimit(req, "analytics:collect", 30, 60_000);
  if (rateError) return rateError;

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > 8192) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large" },
      { status: 413, headers },
    );
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    if (body?.consentVersion !== CONSENT_VERSION) {
      return NextResponse.json(
        { ok: false, error: "analytics_consent_required" },
        { status: 403, headers },
      );
    }

    const event = cleanEventName(body?.event);
    if (!event) {
      return NextResponse.json(
        { ok: false, error: "analytics_event_not_allowed" },
        { status: 400, headers },
      );
    }

    const tenantId = await getTenantId();
    await prisma.analyticsEvent.create({
      data: {
        tenantId,
        event,
        path: cleanPath(body?.path),
        sessionHash: sessionHash(body?.sessionId),
        props: cleanProps(body?.props),
        consentVersion: CONSENT_VERSION,
      },
    });

    return NextResponse.json(
      { ok: true, source: "db", saved: 1 },
      { headers },
    );
  } catch (error) {
    console.error("[analytics/collect] POST failed", error);
    return NextResponse.json(
      { ok: false, source: "db", error: "ANALYTICS_POST_FAILED" },
      { status: 500, headers },
    );
  }
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const [count, visitors] = await Promise.all([
      prisma.analyticsEvent.count({ where: { tenantId } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT "sessionHash") AS "count"
        FROM "AnalyticsEvent"
        WHERE "tenantId" = ${tenantId}
          AND "sessionHash" IS NOT NULL
      `,
    ]);

    return NextResponse.json(
      {
        ok: true,
        source: "db",
        count,
        visitors: Number(visitors[0]?.count || 0),
      },
      { headers },
    );
  } catch (error) {
    console.error("[analytics/collect] GET failed", error);
    return NextResponse.json(
      { ok: false, source: "db", error: "ANALYTICS_GET_FAILED" },
      { status: 500, headers },
    );
  }
}
