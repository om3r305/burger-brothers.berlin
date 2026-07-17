// app/api/admin/visitors/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { requireMutationRole, requireSessionRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type VisitorPing = {
  id?: string;
  ts: number;
  path: string;
  sessionId?: string;
  userAgent?: string;
};

const KEY = "visitors";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};


function unauthorized() {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      error: "Nicht angemeldet.",
    },
    {
      status: 401,
      headers: NO_STORE_HEADERS,
    },
  );
}

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
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;
      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function jsonForDb(value: any): Prisma.InputJsonValue {
  const cleaned = sanitizeJson(value);

  if (cleaned === null) {
    return [] as unknown as Prisma.InputJsonValue;
  }

  return cleaned as Prisma.InputJsonValue;
}

function toTimestamp(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

function cleanPath(value: any) {
  const path = String(value || "/").trim();

  if (!path) return "/";
  if (path.startsWith("/")) return path;

  return `/${path}`;
}

function normalizeVisitor(raw: any): VisitorPing | null {
  if (!raw || typeof raw !== "object") return null;

  const ts = toTimestamp(raw.ts ?? raw.createdAt ?? raw.timestamp, 0);
  if (!ts) return null;

  const path = cleanPath(raw.path ?? raw.pathname ?? raw.url ?? "/");

  return {
    id: raw.id ? String(raw.id) : undefined,
    ts,
    path,
    sessionId: raw.sessionId ? String(raw.sessionId) : raw.sid ? String(raw.sid) : undefined,
    userAgent: raw.userAgent ? String(raw.userAgent) : undefined,
  };
}

function normalizeVisitors(input: any): VisitorPing[] {
  const list = Array.isArray(input)
    ? input
    : Array.isArray(input?.visitors)
      ? input.visitors
      : Array.isArray(input?.items)
        ? input.items
        : Array.isArray(input?.data)
          ? input.data
          : [];

  const safe = list.map(normalizeVisitor).filter(Boolean) as VisitorPing[];

  safe.sort((a, b) => a.ts - b.ts);

  return safe;
}

function readIncomingVisitors(body: any) {
  return normalizeVisitors(
    Array.isArray(body?.visitors)
      ? body.visitors
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.data)
          ? body.data
          : body?.visitor
            ? [body.visitor]
            : body?.item
              ? [body.item]
              : [],
  );
}

function trimOldVisitors(visitors: VisitorPing[], maxItems = 50000) {
  if (visitors.length <= maxItems) return visitors;

  return visitors.slice(visitors.length - maxItems);
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function okResponse(payload: Record<string, any>, status = 200) {
  return jsonResponse(
    {
      ok: true,
      source: "db",
      ...payload,
    },
    status,
  );
}

function errorResponse(error: any, fallback: string, status = 500) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    status,
  );
}

async function readVisitors(): Promise<VisitorPing[]> {
  const tenantId = await getTenantId();

  const row = await prisma.setting.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key: KEY,
      },
    },
  });

  const value = row?.value;

  if (Array.isArray(value)) {
    return normalizeVisitors(value);
  }

  if (isPlainObject(value)) {
    return normalizeVisitors(value);
  }

  return [];
}

async function writeVisitors(visitors: VisitorPing[]): Promise<VisitorPing[]> {
  const tenantId = await getTenantId();
  const clean = trimOldVisitors(normalizeVisitors(visitors));

  await prisma.setting.upsert({
    where: {
      tenantId_key: {
        tenantId,
        key: KEY,
      },
    },
    update: {
      value: jsonForDb(clean),
    },
    create: {
      tenantId,
      key: KEY,
      value: jsonForDb(clean),
    },
  });

  return clean;
}

function filterVisitorsByQuery(visitors: VisitorPing[], searchParams: URLSearchParams) {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const path = searchParams.get("path");

  const fromTs = from ? toTimestamp(from, -Infinity) : -Infinity;
  const toTs = to ? toTimestamp(to, Infinity) : Infinity;

  return visitors.filter((visitor) => {
    if (!(visitor.ts >= fromTs && visitor.ts <= toTs)) return false;
    if (path && path !== "all" && visitor.path !== path) return false;
    return true;
  });
}

export async function GET(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const url = new URL(req.url);
    const visitors = await readVisitors();
    const filtered = filterVisitorsByQuery(visitors, url.searchParams);

    return okResponse({
      visitors: filtered,
      items: filtered,
      count: filtered.length,
      total: visitors.length,
    });
  } catch (error: any) {
    return errorResponse(error, "VISITORS_GET_FAILED");
  }
}

export async function POST(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "append");

    let visitors = await readVisitors();

    switch (action) {
      case "import":
      case "replace": {
        const incoming = readIncomingVisitors(body);
        visitors = incoming;
        break;
      }

      case "append":
      case "add":
      case "ping": {
        const incoming = readIncomingVisitors(body);

        if (!incoming.length) {
          const one = normalizeVisitor({
            ts: body?.ts ?? Date.now(),
            path: body?.path ?? body?.pathname ?? "/",
            sessionId: body?.sessionId ?? body?.sid,
            userAgent: body?.userAgent,
          });

          if (one) incoming.push(one);
        }

        visitors = [...visitors, ...incoming];
        break;
      }

      case "clear": {
        visitors = [];
        break;
      }

      default:
        return errorResponse(new Error("unknown_action"), "unknown_action", 400);
    }

    const saved = await writeVisitors(visitors);

    return okResponse({
      visitors: saved,
      items: saved,
      count: saved.length,
    });
  } catch (error: any) {
    return errorResponse(error, "VISITORS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  const authError = req.method === "GET"
    ? await requireSessionRole(req, "admin")
    : await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const saved = await writeVisitors([]);

    return okResponse({
      deleted: true,
      visitors: saved,
      items: saved,
      count: saved.length,
    });
  } catch (error: any) {
    return errorResponse(error, "VISITORS_DELETE_FAILED");
  }
}
