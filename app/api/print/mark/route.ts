// app/api/print/mark/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };
type PrintStatus = "printed" | "failed" | "skipped";

function json(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function tokenRequired() {
  return process.env.PRINT_AGENT_TOKEN || process.env.BB_PRINT_AGENT_TOKEN || "";
}

function safeEq(a: string, b: string) {
  try {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function readToken(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const url = new URL(req.url);

  return req.headers.get("x-print-agent-token") || bearer || url.searchParams.get("token") || "";
}

function authorize(req: Request) {
  const expected = tokenRequired();

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return json(
        {
          ok: false,
          source: "print",
          error: "print_agent_token_missing",
          message: "PRINT_AGENT_TOKEN Vercel environment içinde tanımlı değil.",
        },
        503,
      );
    }

    return null;
  }

  const given = readToken(req);

  if (!given || !safeEq(given, expected)) {
    return json(
      {
        ok: false,
        source: "print",
        error: "unauthorized",
        message: "Print agent token geçersiz.",
      },
      401,
    );
  }

  return null;
}

function obj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isDecimal(value: any) {
  return Boolean(value && typeof value === "object" && typeof value.toNumber === "function");
}

function num(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Prisma.Decimal || isDecimal(value)) return value.toNumber();
  if (value == null) return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const n = match ? Number(match[0]) : Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function text(value: any, fallback = "") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function cleanId(value: any) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function sanitize(value: any): any {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  if (value instanceof Prisma.Decimal || isDecimal(value)) return value.toNumber();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;
  if (Array.isArray(value)) return value.map(sanitize);

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") continue;
      if (item === undefined) continue;
      out[key] = sanitize(item);
    }

    return out;
  }

  return value;
}

async function body(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function statusFrom(value: any): PrintStatus {
  const raw = String(value || "").toLowerCase().trim();

  if (value === true || raw === "printed" || raw === "success" || raw === "ok") return "printed";
  if (raw === "skipped" || raw === "skip" || raw === "ignored") return "skipped";

  return "failed";
}

function nextPrintMeta(currentPrint: any, input: any, status: PrintStatus) {
  const nowIso = new Date().toISOString();
  const current = obj(currentPrint);
  const attempts = Math.max(0, num(current.attempts, 0));
  const agent = text(input.agent || current.leasedBy || input.agentName, "print-agent");
  const printer = text(input.printer || current.printer);
  const jobId = text(input.jobId || current.jobId);
  const error = text(input.error || input.message);

  if (status === "printed") {
    return sanitize({
      ...current,
      printed: true,
      skipped: false,
      lastStatus: "printed",
      attempts: Math.max(1, attempts),
      successCount: Math.max(0, num(current.successCount, 0)) + 1,
      printedAt: current.printedAt || nowIso,
      lastPrintedAt: nowIso,
      lastAttemptAt: nowIso,
      lastError: null,
      leaseUntil: null,
      leasedAt: null,
      leasedBy: null,
      agent,
      printer: printer || null,
      jobId: jobId || null,
    });
  }

  if (status === "skipped") {
    return sanitize({
      ...current,
      printed: false,
      skipped: true,
      lastStatus: "skipped",
      skippedAt: nowIso,
      lastAttemptAt: nowIso,
      lastError: error || null,
      leaseUntil: null,
      leasedAt: null,
      leasedBy: null,
      agent,
      printer: printer || null,
      jobId: jobId || null,
    });
  }

  return sanitize({
    ...current,
    printed: false,
    skipped: false,
    lastStatus: "failed",
    attempts: attempts + 1,
    lastAttemptAt: nowIso,
    lastError: error || "print_failed",
    leaseUntil: null,
    leasedAt: null,
    leasedBy: null,
    agent,
    printer: printer || null,
    jobId: jobId || null,
  });
}

export async function POST(req: Request) {
  const authError = authorize(req);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const input = await body(req);

    const url = new URL(req.url);
    const id = cleanId(input.id || input.orderId || url.searchParams.get("id") || url.searchParams.get("orderId"));

    if (!id) {
      return json(
        {
          ok: false,
          source: "db",
          error: "order_id_required",
        },
        400,
      );
    }

    const row = await prisma.order.findFirst({
      where: { tenantId, id },
      select: { id: true, status: true, print: true },
    });

    if (!row?.id) {
      return json(
        {
          ok: false,
          source: "db",
          error: "order_not_found",
        },
        404,
      );
    }

    const status = statusFrom(input.status ?? input.printed);
    const print = nextPrintMeta(row.print, input, status);

    const updated = await prisma.order.update({
      where: { id: row.id },
      data: { print: print as any },
      select: {
        id: true,
        status: true,
        print: true,
        updatedAt: true,
      },
    });

    return json({
      ok: true,
      source: "db",
      status,
      orderId: row.id,
      print: updated.print,
      item: sanitize(updated),
      order: sanitize(updated),
    });
  } catch (error: any) {
    console.error("[print/mark] failed", error);

    return json(
      {
        ok: false,
        source: "db",
        error: error?.message || "PRINT_MARK_FAILED",
      },
      500,
    );
  }
}
