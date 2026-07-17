
// app/api/coupons/validate/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CouponType = "fixed" | "percent" | "free_item" | "bogo";

type BogoRule = {
  matchBy: "sku" | "name" | "category";
  matchValue: string;
  buyQty: number;
  freeQty: number;
  maxFreePerOrder?: number;
};

type CouponDef = {
  id: string;
  code: string;
  title?: string;
  type: CouponType;
  value: number;
  minCartTotal?: number;
  maxUses?: number;
  perCustomerLimit?: number;
  validFrom?: number;
  validUntil?: number;
  createdAt: number;
  meta?: {
    uniquePerIssue?: boolean;
    freeItemName?: string;
    aboutText?: string;
    singlePerCustomer?: boolean;
    issueCapPerWeek?: number;
    issueCooldownDays?: number;
    bogo?: BogoRule;
    [key: string]: any;
  };
};

type IssuedCoupon = {
  id: string;
  couponId: string;
  code: string;
  assignedToPhone?: string | null;
  assignedToEmail?: string | null;
  issuedAt: number;
  expiresAt?: number | null;
  used?: boolean;
  usedAt?: number | null;
  source?: string | null;
  note?: string | null;
  meta?: Record<string, any>;
};

type CartItemForCoupon = {
  sku?: string;
  name?: string;
  category?: string;
  qty: number;
  unitPrice: number;
};

type CouponSnapshot = {
  coupons: CouponDef[];
  issued: IssuedCoupon[];
};

type CheckResult =
  | { ok: true; discountAmount: number; message: string }
  | { ok: false; reason: string; message: string };

const DEFAULT_SNAPSHOT: CouponSnapshot = {
  coupons: [],
  issued: [],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function normalizeCode(input?: string | null) {
  return String(input ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

function displayCode(input?: string | null) {
  return String(input ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePhone(input?: string | null) {
  return String(input ?? "").replace(/[^\d+]/g, "").trim();
}

function toNum(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null) return fallback;

  const text = String(value).trim().replace(/[€\s]/g, "").replace(",", ".");
  const match = text.match(/-?\d+(\.\d+)?/);
  const n = match ? Number(match[0]) : Number(text);

  return Number.isFinite(n) ? n : fallback;
}

function toInt(value: any, fallback?: number) {
  if (value == null || value === "") return fallback;

  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toTs(value: any, fallback = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value instanceof Date && Number.isFinite(value.valueOf())) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;

    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return fallback;
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

function normalizeCouponDef(input: any): CouponDef {
  const now = Date.now();
  const type = String(input?.type || "fixed");

  const safeType: CouponType =
    type === "percent" || type === "free_item" || type === "bogo" || type === "fixed"
      ? type
      : "fixed";

  return {
    id: String(input?.id || ""),
    code: displayCode(input?.code || ""),
    title: input?.title != null ? String(input.title) : "",
    type: safeType,
    value: toNum(input?.value, 0),
    minCartTotal:
      input?.minCartTotal != null ? toNum(input.minCartTotal, 0) : undefined,
    maxUses: toInt(input?.maxUses),
    perCustomerLimit: toInt(input?.perCustomerLimit),
    validFrom: input?.validFrom != null ? toTs(input.validFrom) : now,
    validUntil: input?.validUntil != null ? toTs(input.validUntil) : undefined,
    createdAt: input?.createdAt != null ? toTs(input.createdAt) : now,
    meta: input?.meta && typeof input.meta === "object" ? sanitizeJson(input.meta) : {},
  };
}

function normalizeIssuedCoupon(input: any): IssuedCoupon {
  return {
    id: String(input?.id || ""),
    couponId: String(input?.couponId || ""),
    code: displayCode(input?.code || ""),
    assignedToPhone:
      input?.assignedToPhone != null ? normalizePhone(input.assignedToPhone) || null : null,
    assignedToEmail:
      input?.assignedToEmail != null ? String(input.assignedToEmail) : null,
    issuedAt: input?.issuedAt != null ? toTs(input.issuedAt) : Date.now(),
    expiresAt: input?.expiresAt != null ? toTs(input.expiresAt) : null,
    used: Boolean(input?.used ?? false),
    usedAt: input?.usedAt != null ? toTs(input.usedAt) : null,
    source: input?.source != null ? String(input.source) : null,
    note: input?.note != null ? String(input.note) : null,
    meta: input?.meta && typeof input.meta === "object" ? sanitizeJson(input.meta) : undefined,
  };
}

function couponFromDbRow(row: any): CouponDef {
  const definition =
    row?.definition && typeof row.definition === "object"
      ? row.definition
      : row;

  return normalizeCouponDef({
    ...definition,
    code: row?.code ?? definition?.code,
    createdAt: definition?.createdAt ?? row?.createdAt,
  });
}

function issuedFromDbRow(row: any): IssuedCoupon {
  return normalizeIssuedCoupon({
    id: row?.id,
    couponId: row?.couponId,
    code: row?.code,
    assignedToPhone: row?.assignedToPhone,
    assignedToEmail: row?.assignedToEmail,
    issuedAt: row?.issuedAt,
    expiresAt: row?.expiresAt,
    used: row?.used,
    usedAt: row?.usedAt,
    source: row?.source,
    note: row?.note,
  });
}

async function readCouponSnapshot(): Promise<CouponSnapshot> {
  const tenantId = await getTenantId();

  const [couponRows, issuedRows] = await Promise.all([
    prisma.coupon.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    }),

    prisma.issuedCoupon.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        issuedAt: "desc",
      },
    }),
  ]);

  return {
    coupons: couponRows.map(couponFromDbRow),
    issued: issuedRows.map(issuedFromDbRow),
  };
}

function findIssuedByCode(snapshot: CouponSnapshot, code: string) {
  const wanted = normalizeCode(code);
  if (!wanted) return null;

  return snapshot.issued.find((issued) => normalizeCode(issued.code) === wanted) || null;
}

function findCouponDefByCode(snapshot: CouponSnapshot, code: string) {
  const wanted = normalizeCode(code);
  if (!wanted) return null;

  return snapshot.coupons.find((coupon) => normalizeCode(coupon.code) === wanted) || null;
}

function findCouponByAnyCode(snapshot: CouponSnapshot, code: string) {
  const issued = findIssuedByCode(snapshot, code);

  if (issued) {
    const def = snapshot.coupons.find((coupon) => coupon.id === issued.couponId) || null;
    return { def, issued };
  }

  const def = findCouponDefByCode(snapshot, code);
  return { def, issued: null };
}

function getUsageStats(snapshot: CouponSnapshot, couponId: string, phone?: string | null) {
  const issued = snapshot.issued.filter((item) => item.couponId === couponId);
  const globalUsed = issued.filter((item) => item.used).length;
  const globalTotal = issued.length;

  let customerUsed = 0;
  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    customerUsed = issued.filter(
      (item) =>
        normalizePhone(item.assignedToPhone) === normalizedPhone && item.used
    ).length;
  }

  return { globalUsed, globalTotal, customerUsed };
}

function checkHardLimits(
  snapshot: CouponSnapshot,
  def: CouponDef,
  phone?: string | null
): { ok: true } | { ok: false; reason: string; message: string } {
  const { globalUsed, customerUsed } = getUsageStats(snapshot, def.id, phone);

  if (typeof def.maxUses === "number" && globalUsed >= def.maxUses) {
    return {
      ok: false,
      reason: "max_uses_reached",
      message: "Dieser Gutschein wurde bereits zu oft verwendet.",
    };
  }

  if (
    typeof def.perCustomerLimit === "number" &&
    normalizePhone(phone) &&
    customerUsed >= def.perCustomerLimit
  ) {
    return {
      ok: false,
      reason: "per_customer_limit",
      message: "Dieser Gutschein wurde für diese Telefonnummer bereits verwendet.",
    };
  }

  return { ok: true };
}

function canApply(params: {
  snapshot: CouponSnapshot;
  def: CouponDef;
  issued?: IssuedCoupon | null;
  cartTotal: number;
  cartItems?: CartItemForCoupon[];
  customerPhone?: string | null;
  now?: number;
}): CheckResult {
  const { snapshot, def, issued, cartTotal } = params;
  const now = params.now ?? Date.now();
  const customerPhone = normalizePhone(params.customerPhone);

  if (def.validFrom && now < def.validFrom) {
    return {
      ok: false,
      reason: "not_started",
      message: "Dieser Gutschein ist noch nicht aktiv.",
    };
  }

  if (def.validUntil && now > def.validUntil) {
    return {
      ok: false,
      reason: "expired",
      message: "Dieser Gutschein ist abgelaufen.",
    };
  }

  if (issued) {
    if (issued.used) {
      return {
        ok: false,
        reason: "used",
        message: "Dieser Gutschein wurde bereits verwendet.",
      };
    }

    if (issued.expiresAt && now > issued.expiresAt) {
      return {
        ok: false,
        reason: "issued_expired",
        message: "Dieser Gutschein ist abgelaufen.",
      };
    }

    if (
      issued.assignedToPhone &&
      customerPhone &&
      normalizePhone(issued.assignedToPhone) !== customerPhone
    ) {
      return {
        ok: false,
        reason: "assigned_other",
        message: "Dieser Gutschein ist einer anderen Telefonnummer zugeordnet.",
      };
    }

    if (issued.note === "scheduled" && issued.issuedAt > now) {
      return {
        ok: false,
        reason: "not_available_yet",
        message: "Dieser Gutschein ist noch nicht verfügbar.",
      };
    }

    if (issued.note === "cancelled") {
      return {
        ok: false,
        reason: "cancelled",
        message: "Dieser Gutschein wurde storniert.",
      };
    }
  }

  const limitCheck = checkHardLimits(snapshot, def, customerPhone || null);
  if (limitCheck.ok === false) return limitCheck;

  if (def.minCartTotal && cartTotal < def.minCartTotal) {
    return {
      ok: false,
      reason: "below_min",
      message: `Mindestbestellwert: ${def.minCartTotal.toFixed(2)}€.`,
    };
  }

  if (def.type === "fixed") {
    const discount = round2(Math.min(def.value, Math.max(0, cartTotal)));

    return {
      ok: true,
      discountAmount: discount,
      message: `${def.value.toFixed(2)}€ Rabatt angewendet.`,
    };
  }

  if (def.type === "percent") {
    const discount = round2(Math.max(0, cartTotal) * (def.value / 100));

    return {
      ok: true,
      discountAmount: discount,
      message: `${def.value}% Rabatt angewendet.`,
    };
  }

  if (def.type === "free_item") {
    return {
      ok: true,
      discountAmount: 0,
      message: `Gratis: ${def.meta?.freeItemName || "Artikel"}.`,
    };
  }

  if (def.type === "bogo") {
    const rule = def.meta?.bogo;
    const items = params.cartItems || [];

    if (!rule) {
      return {
        ok: false,
        reason: "bogo_misconfig",
        message: "BOGO-Regel ist nicht korrekt konfiguriert.",
      };
    }

    const match = (item: CartItemForCoupon) => {
      const value =
        rule.matchBy === "sku"
          ? item.sku || ""
          : rule.matchBy === "category"
            ? item.category || ""
            : item.name || "";

      return value.toLowerCase().includes((rule.matchValue || "").toLowerCase());
    };

    const pool = items
      .filter(match)
      .flatMap((item) =>
        Array.from({ length: Math.max(0, Number(item.qty || 0)) }).map(
          () => Number(item.unitPrice || 0)
        )
      )
      .sort((a, b) => a - b);

    if (!pool.length) {
      return {
        ok: false,
        reason: "bogo_no_match",
        message: "Der passende Artikel befindet sich nicht im Warenkorb.",
      };
    }

    let free = 0;

    if (rule.buyQty > 0) {
      const possibleFree = Math.floor(pool.length / rule.buyQty) * rule.freeQty;
      free = rule.maxFreePerOrder
        ? Math.min(possibleFree, rule.maxFreePerOrder)
        : possibleFree;
    }

    const discount = round2(pool.slice(0, free).reduce((a, b) => a + b, 0));

    if (discount <= 0) {
      return {
        ok: false,
        reason: "bogo_zero",
        message: "BOGO-Rabatt konnte nicht berechnet werden.",
      };
    }

    return {
      ok: true,
      discountAmount: discount,
      message: `BOGO angewendet: ${rule.buyQty} kaufen, ${rule.freeQty} gratis.`,
    };
  }

  return {
    ok: false,
    reason: "unknown_type",
    message: "Dieser Gutscheintyp wird nicht unterstützt.",
  };
}


function publicCouponDefinition(def: CouponDef | null) {
  if (!def) return null;

  return {
    id: def.id,
    code: displayCode(def.code),
    title: def.title || "",
    type: def.type,
    value: def.value,
    minCartTotal: def.minCartTotal ?? 0,
    validFrom: def.validFrom ?? null,
    validUntil: def.validUntil ?? null,
    meta: {
      freeItemName: def.meta?.freeItemName || null,
      aboutText: def.meta?.aboutText || null,
      bogo: def.meta?.bogo || null,
    },
  };
}

function publicIssuedCoupon(issued: IssuedCoupon | null) {
  if (!issued) return null;

  return {
    id: issued.id,
    couponId: issued.couponId,
    code: displayCode(issued.code),
    issuedAt: issued.issuedAt,
    expiresAt: issued.expiresAt ?? null,
    used: issued.used === true,
    note: issued.note || null,
  };
}

function responseJson(payload: Record<string, any>, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      source: "db",
      ...payload,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

function errorJson(error: string, status = 500, extra?: Record<string, any>) {
  return NextResponse.json(
    {
      ok: false,
      source: "db",
      error,
      ...(extra || {}),
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

async function validateFromRequest(req: Request) {
  const url = new URL(req.url);
  const body = req.method === "GET" ? {} : await readBody(req);

  const code =
    body?.code ??
    body?.couponCode ??
    url.searchParams.get("code") ??
    url.searchParams.get("couponCode") ??
    "";

  const cartTotal = toNum(
    body?.cartTotal ??
      body?.subtotal ??
      body?.total ??
      url.searchParams.get("cartTotal") ??
      url.searchParams.get("subtotal") ??
      url.searchParams.get("total"),
    0
  );

  const customerPhone =
    body?.customerPhone ??
    body?.phone ??
    url.searchParams.get("customerPhone") ??
    url.searchParams.get("phone") ??
    null;

  const cartItems = Array.isArray(body?.cartItems)
    ? body.cartItems
    : Array.isArray(body?.items)
      ? body.items
      : [];

  const snapshot = await readCouponSnapshot();
  const found = findCouponByAnyCode(snapshot, code);

  if (!found.def) {
    return responseJson({
      valid: false,
      result: {
        ok: false,
        reason: "not_found",
        message: "Gutschein wurde nicht gefunden.",
      },
      def: null,
      issued: null,
      discountAmount: 0,
      message: "Gutschein wurde nicht gefunden.",
    });
  }

  const result = canApply({
    snapshot,
    def: found.def,
    issued: found.issued,
    cartTotal,
    cartItems,
    customerPhone,
  });

  return responseJson({
    valid: result.ok,
    result,
    def: publicCouponDefinition(found.def),
    issued: publicIssuedCoupon(found.issued),
    discountAmount: result.ok ? result.discountAmount : 0,
    message: result.message,
    reason: result.ok ? null : result.reason,
  });
}

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "coupons:validate", 30, 60_000);
  if (rateError) return rateError;

  try {
    return await validateFromRequest(req);
  } catch (error: any) {
    console.error("GET /api/coupons/validate failed:", error);
    return errorJson(error?.message || "COUPON_VALIDATE_GET_FAILED", 500);
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");

  const rateError = await enforceRateLimit(req, "coupons:validate", 30, 60_000);
  if (rateError) return rateError;

  try {
    return await validateFromRequest(req);
  } catch (error: any) {
    console.error("POST /api/coupons/validate failed:", error);
    return errorJson(error?.message || "COUPON_VALIDATE_POST_FAILED", 500);
  }
}