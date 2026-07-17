// app/api/print/jobs/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const ACTIVE_STATUSES = ["new", "preparing", "ready", "out_for_delivery"];

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
  return req.headers.get("x-print-agent-token") || bearer || "";
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

function arr(value: any): any[] {
  return Array.isArray(value) ? value : [];
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

function date(value: any): Date | null {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isFinite(value.valueOf()) ? value : null;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    const d = new Date(asNumber);
    return Number.isFinite(d.valueOf()) ? d : null;
  }

  const parsed = new Date(String(value));
  return Number.isFinite(parsed.valueOf()) ? parsed : null;
}

function ms(value: any, fallback = 0) {
  const d = date(value);
  return d ? d.getTime() : fallback;
}

function iso(value: any) {
  const d = date(value);
  return d ? d.toISOString() : null;
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

function normalizeItems(value: any) {
  return arr(value).map((item, index) =>
    sanitize({
      id: item?.id != null ? String(item.id) : undefined,
      sku: item?.sku != null ? String(item.sku) : item?.code != null ? String(item.code) : undefined,
      name: text(item?.name || item?.title, "Artikel"),
      description: text(item?.description ?? item?.desc ?? item?.itemDescription) || undefined,
      category: item?.category != null ? String(item.category) : undefined,
      price: num(item?.price ?? item?.unitPrice, 0),
      qty: Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1)),
      add: arr(item?.add ?? item?.extras).map((extra: any) => ({
        id: extra?.id != null ? String(extra.id) : undefined,
        label: text(extra?.label ?? extra?.name, "Extra"),
        name: text(extra?.name ?? extra?.label, "Extra"),
        price: num(extra?.price, 0),
      })),
      rm: arr(item?.rm ?? item?.remove).map((entry: any) => String(entry)),
      note: text(item?.note) || undefined,
      _idx: index,
    }),
  );
}

function lineTotal(item: any) {
  const qty = Math.max(1, num(item?.qty ?? item?.quantity ?? 1, 1));
  const base = num(item?.price ?? item?.unitPrice, 0);
  const extras = arr(item?.add ?? item?.extras).reduce((sum, extra) => sum + num(extra?.price, 0), 0);
  return (base + extras) * qty;
}

function merchandise(items: any[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function selectOrder() {
  return {
    id: true,
    tenantId: true,
    mode: true,
    channel: true,
    status: true,
    merchandise: true,
    discount: true,
    surcharges: true,
    total: true,
    coupon: true,
    couponDiscount: true,
    customer: true,
    items: true,
    meta: true,
    ts: true,
    planned: true,
    etaMin: true,
    etaAdjustMin: true,
    print: true,
    createdAt: true,
    updatedAt: true,
    archivedAt: true,
    anonymizedAt: true,
  };
}

function locked(print: Record<string, any>, nowMs: number) {
  if (print.printed === true || print.skipped === true) return true;
  return ms(print.leaseUntil, 0) > nowMs;
}

function customerFrom(row: any) {
  const c = obj(row?.customer);
  const addressLine = text(
    c?.addressLine ||
      c?.address ||
      [c?.street, c?.house ?? c?.houseNo].map((part) => text(part)).filter(Boolean).join(" "),
  );

  return sanitize({
    ...c,
    name: text(c?.name ?? c?.customerName),
    phone: text(c?.phone ?? c?.telephone),
    email: text(c?.email),
    address: text(c?.address || addressLine),
    addressLine,
    street: text(c?.street),
    house: text(c?.house ?? c?.houseNo),
    plz: text(c?.plz ?? c?.zip ?? c?.postalCode) || null,
    zip: text(c?.zip ?? c?.plz ?? c?.postalCode) || null,
    city: text(c?.city),
    floor: text(c?.floor),
    entrance: text(c?.entrance),
    deliveryHint: text(c?.deliveryHint ?? c?.hint ?? c?.deliveryNote),
    note: text(c?.note ?? c?.customerNote ?? c?.deliveryHint),
  });
}

function serializeJob(row: any, jobId: string) {
  const items = normalizeItems(row?.items);
  const customer = customerFrom(row);
  const meta = obj(row?.meta);

  const merchandise = num(row?.merchandise, merchandiseFromItems(items));
  const discount = num(row?.discount, 0);
  const surcharges = num(row?.surcharges, 0);
  const couponDiscount = num(row?.couponDiscount, meta?.couponDiscount ?? 0);
  const total = num(row?.total, Math.max(0, merchandise + surcharges - discount - couponDiscount));

  return sanitize({
    id: String(row?.id ?? ""),
    orderId: String(row?.id ?? ""),
    jobId,
    mode: String(row?.mode || "delivery"),
    channel: row?.channel ?? "web",
    status: row?.status ?? "new",
    ts: ms(row?.ts ?? row?.createdAt, Date.now()),
    createdAt: iso(row?.createdAt ?? row?.ts),
    updatedAt: iso(row?.updatedAt),
    planned: row?.planned ?? null,
    etaMin: row?.etaMin ?? null,
    etaAdjustMin: row?.etaAdjustMin ?? meta?.etaAdjustMin ?? 0,
    customer,
    items,
    totals: {
      merchandise,
      discount,
      coupon: row?.coupon ?? meta?.coupon ?? null,
      couponDiscount,
      surcharges,
      total,
    },
    payment: {
      method: meta?.paymentMethod ?? meta?.payment?.method ?? null,
      status: meta?.paymentStatus ?? meta?.payment?.status ?? null,
    },
    note: text(meta?.note ?? meta?.orderNote ?? customer?.deliveryHint ?? customer?.note),
    meta: {
      source: meta?.source ?? row?.channel ?? "web",
      paymentMethod: meta?.paymentMethod ?? meta?.payment?.method ?? null,
      paymentStatus: meta?.paymentStatus ?? meta?.payment?.status ?? null,
    },
  });
}

function merchandiseFromItems(items: any[]) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function isPrintable(row: any, nowMs: number, maxAttempts: number) {
  if (!ACTIVE_STATUSES.includes(String(row?.status || ""))) return false;
  if (row?.archivedAt || row?.anonymizedAt) return false;

  const print = obj(row?.print);
  if (locked(print, nowMs)) return false;
  if (num(print?.attempts, 0) >= maxAttempts) return false;

  return true;
}

export async function GET(req: Request) {
  const authError = authorize(req);
  if (authError) return authError;

  try {
    const tenantId = await getTenantId();
    const url = new URL(req.url);

    const max = Math.min(10, Math.max(1, Number(url.searchParams.get("max") || 3)));
    const lookbackMinutes = Math.min(1440, Math.max(5, Number(url.searchParams.get("lookbackMinutes") || 720)));
    const maxAttempts = Math.min(20, Math.max(1, Number(url.searchParams.get("maxAttempts") || 5)));
    const leaseSeconds = Math.min(900, Math.max(30, Number(url.searchParams.get("leaseSeconds") || 180)));

    const agent = text(url.searchParams.get("agent") || req.headers.get("x-print-agent-name"), "print-agent");
    const printer = text(url.searchParams.get("printer") || req.headers.get("x-printer-name"));

    const nowMs = Date.now();
    const since = new Date(nowMs - lookbackMinutes * 60_000);

    const rows = await prisma.order.findMany({
      where: {
        tenantId,
        status: { in: ACTIVE_STATUSES },
        archivedAt: null,
        anonymizedAt: null,
        ts: { gte: since },
      },
      select: selectOrder(),
      orderBy: { ts: "asc" },
      take: Math.max(20, max * 8),
    });

    const jobs: any[] = [];

    for (const row of rows) {
      if (jobs.length >= max) break;
      if (!isPrintable(row, nowMs, maxAttempts)) continue;

      const currentPrint = obj((row as any).print);
      const jobId = `print-${row.id}-${nowMs.toString(36)}`;

      const print = sanitize({
        ...currentPrint,
        printed: currentPrint.printed === true,
        attempts: num(currentPrint.attempts, 0),
        lastStatus: "leased",
        leasedAt: new Date(nowMs).toISOString(),
        leaseUntil: new Date(nowMs + leaseSeconds * 1000).toISOString(),
        leasedBy: agent,
        printer: printer || currentPrint.printer || null,
        jobId,
      });

      const updated = await prisma.order.update({
        where: { id: row.id },
        data: { print: print as any },
        select: selectOrder(),
      });

      jobs.push(serializeJob(updated, jobId));
    }

    return json({
      ok: true,
      source: "db",
      jobs,
      count: jobs.length,
      meta: {
        agent,
        printer: printer || null,
        lookbackMinutes,
        leaseSeconds,
        maxAttempts,
      },
    });
  } catch (error: any) {
    console.error("[print/jobs] failed", error);

    return json(
      {
        ok: false,
        source: "db",
        error: error?.message || "PRINT_JOBS_FAILED",
      },
      500,
    );
  }
}
