// app/api/coupons/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

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

type AwardRule =
  | { kind: "nth_order"; n: number; couponId: string; expiresDays?: number }
  | { kind: "spent_total"; minTotal: number; couponId: string; expiresDays?: number }
  | { kind: "manual"; couponId: string };

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
    awardRules?: AwardRule[];
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

type CouponSnapshot = {
  coupons: CouponDef[];
  issued: IssuedCoupon[];
};

type CartItemForCoupon = {
  sku?: string;
  name?: string;
  category?: string;
  qty: number;
  unitPrice: number;
};

type CheckResult =
  | { ok: true; discountAmount: number; message: string }
  | { ok: false; reason: string; message: string };

const DEFAULT_SNAPSHOT: CouponSnapshot = {
  coupons: [],
  issued: [],
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const PUBLIC_POST_ACTIONS = new Set(["validateCoupon"]);

const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

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

function toDate(value: any): Date | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.valueOf()) ? d : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      const byNumber = new Date(asNumber);
      if (Number.isFinite(byNumber.valueOf())) return byNumber;
    }

    const parsed = new Date(text);
    if (Number.isFinite(parsed.valueOf())) return parsed;
  }

  return null;
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
    return {} as Prisma.InputJsonValue;
  }

  return cleaned as Prisma.InputJsonValue;
}

/* Prisma schema uyumu: modelde olmayan alanı runtime'a göndermiyoruz. */
function hasModelField(modelName: string, fieldName: string) {
  try {
    const models = ((Prisma as any).dmmf?.datamodel?.models || []) as Array<{
      name: string;
      fields: Array<{ name: string }>;
    }>;

    const model = models.find((item) => item.name === modelName);
    if (!model) return true;

    return model.fields.some((field) => field.name === fieldName);
  } catch {
    return true;
  }
}

function pickModelData(modelName: string, data: Record<string, any>) {
  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (!hasModelField(modelName, key)) continue;
    out[key] = value;
  }

  return out;
}

function orderByFor(modelName: string, preferred: string, fallback = "code") {
  if (hasModelField(modelName, preferred)) {
    return { [preferred]: "desc" };
  }

  return { [fallback]: "asc" };
}

function generateCode(length = 8, prefix = "", snapshot: CouponSnapshot = DEFAULT_SNAPSHOT) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  const make = () =>
    Array.from({ length })
      .map(() => chars[Math.floor(Math.random() * chars.length)])
      .join("");

  const existing = new Set<string>();

  snapshot.coupons.forEach((coupon) => existing.add(normalizeCode(coupon.code)));
  snapshot.issued.forEach((issued) => existing.add(normalizeCode(issued.code)));

  for (let i = 0; i < 4000; i += 1) {
    const code = (prefix ? `${displayCode(prefix)}-` : "") + make();

    if (!existing.has(normalizeCode(code))) return code;
  }

  return (
    (prefix ? `${displayCode(prefix)}-` : "") +
    make() +
    "-" +
    Math.random().toString(36).slice(2, 4).toUpperCase()
  );
}

function normalizeCouponDef(input: any, snapshot: CouponSnapshot = DEFAULT_SNAPSHOT): CouponDef {
  const now = Date.now();

  const type = String(input?.type || "fixed");
  const safeType: CouponType =
    type === "percent" || type === "free_item" || type === "bogo" || type === "fixed"
      ? type
      : "fixed";

  return {
    id: String(input?.id || rid()),
    code: displayCode(input?.code || generateCode(8, "BB", snapshot)),
    title: input?.title != null ? String(input.title) : "",
    type: safeType,
    value: toNum(input?.value, 0),
    minCartTotal: input?.minCartTotal != null ? toNum(input.minCartTotal, 0) : undefined,
    maxUses: toInt(input?.maxUses),
    perCustomerLimit: toInt(input?.perCustomerLimit),
    validFrom: input?.validFrom != null ? toTs(input.validFrom) : now,
    validUntil: input?.validUntil != null ? toTs(input.validUntil) : undefined,
    createdAt: input?.createdAt != null ? toTs(input.createdAt) : now,
    meta: input?.meta && typeof input.meta === "object" ? sanitizeJson(input.meta) : {},
  };
}

function normalizeIssuedCoupon(
  input: any,
  snapshot: CouponSnapshot = DEFAULT_SNAPSHOT,
): IssuedCoupon {
  return {
    id: String(input?.id || rid()),
    couponId: String(input?.couponId || ""),
    code: displayCode(input?.code || generateCode(8, "BB", snapshot)),
    assignedToPhone:
      input?.assignedToPhone != null ? normalizePhone(input.assignedToPhone) || null : null,
    assignedToEmail: input?.assignedToEmail != null ? String(input.assignedToEmail) : null,
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
    row?.definition && typeof row.definition === "object" ? row.definition : row;

  return normalizeCouponDef({
    ...definition,
    id: definition?.id ?? row?.id,
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
    meta: row?.meta,
  });
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
      headers: NO_STORE_HEADERS,
    },
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
      headers: NO_STORE_HEADERS,
    },
  );
}

function readCookie(req: Request, name: string) {
  const header = req.headers.get("cookie") || "";
  const wanted = `${name}=`;

  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(wanted))
    ?.slice(wanted.length) || "";
}

function hasAdminSession(req: Request) {
  const value = readCookie(req, ADMIN_COOKIE);
  return value.startsWith("ok:");
}

function requireAdmin(req: Request) {
  if (hasAdminSession(req)) return null;
  return errorJson("not_authenticated", 401, {
    message: "Nicht angemeldet.",
  });
}

function isPublicPostAction(action: string) {
  return PUBLIC_POST_ACTIONS.has(action);
}

async function readCouponSnapshot(): Promise<CouponSnapshot> {
  const tenantId = await getTenantId();

  const [couponRows, issuedRows] = await Promise.all([
    prisma.coupon.findMany({
      where: { tenantId },
      orderBy: orderByFor("Coupon", "createdAt") as any,
    }),
    prisma.issuedCoupon.findMany({
      where: { tenantId },
      orderBy: orderByFor("IssuedCoupon", "issuedAt") as any,
    }),
  ]);

  return {
    coupons: couponRows.map(couponFromDbRow),
    issued: issuedRows.map(issuedFromDbRow),
  };
}

function couponFindWhere(tenantId: string, coupon: CouponDef, code: string) {
  const or: Array<Record<string, string>> = [];

  if (code && hasModelField("Coupon", "code")) or.push({ code });
  if (coupon.id && hasModelField("Coupon", "id")) or.push({ id: coupon.id });

  return {
    tenantId,
    OR: or.length ? or : [{ code }],
  };
}

function issuedFindWhere(tenantId: string, issued: IssuedCoupon, code: string) {
  const or: Array<Record<string, string>> = [];

  if (code && hasModelField("IssuedCoupon", "code")) or.push({ code });
  if (issued.id && hasModelField("IssuedCoupon", "id")) or.push({ id: issued.id });

  return {
    tenantId,
    OR: or.length ? or : [{ code }],
  };
}

async function saveCouponToDb(
  tx: any,
  tenantId: string,
  raw: any,
  snapshot: CouponSnapshot,
): Promise<CouponDef | null> {
  const coupon = normalizeCouponDef(raw?.definition ?? raw, snapshot);
  const code = displayCode(raw?.code ?? coupon.code);

  if (!code) return null;

  const finalCoupon = {
    ...coupon,
    code,
  };

  const existing = await tx.coupon.findFirst({
    where: couponFindWhere(tenantId, finalCoupon, code),
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.coupon.update({
      where: {
        id: existing.id,
      },
      data: pickModelData("Coupon", {
        code,
        definition: jsonForDb(finalCoupon),
      }),
    });

    await tx.coupon.deleteMany({
      where: {
        tenantId,
        code,
        id: {
          not: existing.id,
        },
      },
    });

    return finalCoupon;
  }

  await tx.coupon.create({
    data: pickModelData("Coupon", {
      id: finalCoupon.id,
      tenantId,
      code,
      definition: jsonForDb(finalCoupon),
    }),
  });

  return finalCoupon;
}

async function saveIssuedToDb(
  tx: any,
  tenantId: string,
  raw: any,
  snapshot: CouponSnapshot,
): Promise<IssuedCoupon | null> {
  const issued = normalizeIssuedCoupon(raw, snapshot);
  const code = displayCode(raw?.code ?? issued.code);

  if (!code) return null;

  const couponId = String(raw?.couponId ?? issued.couponId ?? "");
  const couponCode = displayCode(raw?.couponCode ?? raw?.baseCode ?? "");

  const data = {
    couponId,
    couponCode,
    assignedToPhone: raw?.assignedToPhone ? normalizePhone(raw.assignedToPhone) : null,
    assignedToEmail: raw?.assignedToEmail ? String(raw.assignedToEmail) : null,
    issuedAt: toDate(raw?.issuedAt ?? issued.issuedAt) || new Date(),
    expiresAt: toDate(raw?.expiresAt ?? issued.expiresAt),
    used: raw?.used === true || issued.used === true,
    usedAt: toDate(raw?.usedAt ?? issued.usedAt),
    source: raw?.source ? String(raw.source) : issued.source ?? null,
    note: raw?.note ? String(raw.note) : issued.note ?? null,
    meta: jsonForDb(raw?.meta ?? issued.meta ?? {}),
  };

  const existing = await tx.issuedCoupon.findFirst({
    where: issuedFindWhere(tenantId, issued, code),
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.issuedCoupon.update({
      where: {
        id: existing.id,
      },
      data: pickModelData("IssuedCoupon", data),
    });

    await tx.issuedCoupon.deleteMany({
      where: {
        tenantId,
        code,
        id: {
          not: existing.id,
        },
      },
    });

    return {
      ...issued,
      id: existing.id,
      code,
      couponId: data.couponId,
      assignedToPhone: data.assignedToPhone,
      assignedToEmail: data.assignedToEmail,
      issuedAt: data.issuedAt.getTime(),
      expiresAt: data.expiresAt ? data.expiresAt.getTime() : null,
      used: data.used,
      usedAt: data.usedAt ? data.usedAt.getTime() : null,
      source: data.source,
      note: data.note,
      meta: raw?.meta ?? issued.meta,
    };
  }

  const created = await tx.issuedCoupon.create({
    data: pickModelData("IssuedCoupon", {
      id: issued.id,
      tenantId,
      code,
      ...data,
    }),
    select: {
      id: true,
    },
  });

  return {
    ...issued,
    id: created.id,
    code,
    couponId: data.couponId,
    assignedToPhone: data.assignedToPhone,
    assignedToEmail: data.assignedToEmail,
    issuedAt: data.issuedAt.getTime(),
    expiresAt: data.expiresAt ? data.expiresAt.getTime() : null,
    used: data.used,
    usedAt: data.usedAt ? data.usedAt.getTime() : null,
    source: data.source,
    note: data.note,
    meta: raw?.meta ?? issued.meta,
  };
}

async function replaceSnapshotInDb(snapshot: CouponSnapshot): Promise<CouponSnapshot> {
  const tenantId = await getTenantId();
  const normalized: CouponSnapshot = {
    coupons: Array.isArray(snapshot.coupons)
      ? snapshot.coupons.map((coupon) => normalizeCouponDef(coupon))
      : [],
    issued: Array.isArray(snapshot.issued)
      ? snapshot.issued.map((issued) => normalizeIssuedCoupon(issued))
      : [],
  };

  await prisma.$transaction(async (tx) => {
    const seenCouponCodes: string[] = [];

    for (const coupon of normalized.coupons) {
      const saved = await saveCouponToDb(tx, tenantId, coupon, normalized);
      if (saved?.code) seenCouponCodes.push(saved.code);
    }

    if (normalized.coupons.length > 0 && seenCouponCodes.length > 0) {
      await tx.coupon.deleteMany({
        where: {
          tenantId,
          code: {
            notIn: seenCouponCodes,
          },
        },
      });
    }

    const seenIssuedCodes: string[] = [];

    for (const issued of normalized.issued) {
      const saved = await saveIssuedToDb(tx, tenantId, issued, normalized);
      if (saved?.code) seenIssuedCodes.push(saved.code);
    }

    if (normalized.issued.length > 0 && seenIssuedCodes.length > 0) {
      await tx.issuedCoupon.deleteMany({
        where: {
          tenantId,
          code: {
            notIn: seenIssuedCodes,
          },
        },
      });
    }
  });

  return readCouponSnapshot();
}

function pickIssueCodeFromDef(def: CouponDef, snapshot: CouponSnapshot) {
  if (def.meta?.uniquePerIssue) {
    const prefix = (def.code.split("-")[0] || "CP").slice(0, 6).toUpperCase();
    return generateCode(8, prefix, snapshot);
  }

  return displayCode(def.code);
}

function issuesOfPhoneForCoupon(
  snapshot: CouponSnapshot,
  phone: string | null | undefined,
  couponId: string,
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return [];

  return snapshot.issued.filter(
    (issued) =>
      issued.couponId === couponId &&
      normalizePhone(issued.assignedToPhone) === normalizedPhone,
  );
}

function canIssueToPhone(
  snapshot: CouponSnapshot,
  def: CouponDef,
  phone?: string | null,
  now = Date.now(),
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return true;

  const meta = def.meta || {};
  const history = issuesOfPhoneForCoupon(snapshot, normalizedPhone, def.id).sort(
    (a, b) => (b.issuedAt || 0) - (a.issuedAt || 0),
  );

  if (meta.singlePerCustomer && history.length > 0) return false;

  if (typeof meta.issueCapPerWeek === "number") {
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const lastWeekCount = history.filter((item) => item.issuedAt >= weekAgo).length;

    if (lastWeekCount >= meta.issueCapPerWeek) return false;
  }

  if (typeof meta.issueCooldownDays === "number" && history.length > 0) {
    const last = history[0];
    const gap = now - (last.issuedAt || 0);

    if (gap < meta.issueCooldownDays * 24 * 3600 * 1000) return false;
  }

  return true;
}

function getUsageStats(snapshot: CouponSnapshot, couponId: string, phone?: string | null) {
  const issued = snapshot.issued.filter((item) => item.couponId === couponId);
  const globalUsed = issued.filter((item) => item.used).length;
  const globalTotal = issued.length;

  let customerUsed = 0;
  const normalizedPhone = normalizePhone(phone);

  if (normalizedPhone) {
    customerUsed = issued.filter(
      (item) => normalizePhone(item.assignedToPhone) === normalizedPhone && item.used,
    ).length;
  }

  return { globalUsed, globalTotal, customerUsed };
}

function checkHardLimits(
  snapshot: CouponSnapshot,
  def: CouponDef,
  phone?: string | null,
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
        Array.from({ length: Math.max(0, Number(item.qty || 0)) }).map(() =>
          Number(item.unitPrice || 0),
        ),
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

function issueCoupon(snapshot: CouponSnapshot, opts: any) {
  const couponId = String(opts?.couponId || "");
  const def = snapshot.coupons.find((coupon) => coupon.id === couponId);

  if (!def) {
    return {
      snapshot,
      issued: null,
      error: "coupon_not_found",
    };
  }

  const now = Date.now();
  const phone = normalizePhone(opts?.phone) || null;

  if (!canIssueToPhone(snapshot, def, phone, now)) {
    return {
      snapshot,
      issued: null,
      error: "issue_limit_reached",
    };
  }

  const issued: IssuedCoupon = {
    id: rid(),
    couponId: def.id,
    code: pickIssueCodeFromDef(def, snapshot),
    assignedToPhone: phone,
    assignedToEmail: opts?.email ?? null,
    issuedAt: now,
    expiresAt:
      opts?.expiresAfterDays != null
        ? now + Number(opts.expiresAfterDays) * 24 * 3600 * 1000
        : def.validUntil ?? null,
    used: false,
    usedAt: null,
    source: opts?.source || "manual",
    note: opts?.note ?? null,
  };

  return {
    snapshot: {
      ...snapshot,
      issued: [issued, ...snapshot.issued],
    },
    issued,
    error: null,
  };
}

function redeemIssued(snapshot: CouponSnapshot, opts: any) {
  const id = String(opts?.id || "");
  const code = String(opts?.code || "");
  const customerPhone = normalizePhone(opts?.customerPhone);
  const now = Date.now();

  const index = snapshot.issued.findIndex((issued) => {
    if (id && issued.id === id) return true;
    if (code && normalizeCode(issued.code) === normalizeCode(code)) return true;
    return false;
  });

  if (index === -1) {
    return {
      snapshot,
      issued: null,
      error: "issued_not_found",
    };
  }

  const issued = { ...snapshot.issued[index] };

  if (issued.used) {
    return {
      snapshot,
      issued,
      error: "already_used",
    };
  }

  if (issued.expiresAt && issued.expiresAt < now) {
    return {
      snapshot,
      issued,
      error: "expired",
    };
  }

  if (
    issued.assignedToPhone &&
    customerPhone &&
    normalizePhone(issued.assignedToPhone) !== customerPhone
  ) {
    return {
      snapshot,
      issued,
      error: "assigned_to_other",
    };
  }

  const def = snapshot.coupons.find((coupon) => coupon.id === issued.couponId);

  if (def) {
    const limitCheck = checkHardLimits(
      snapshot,
      def,
      customerPhone || normalizePhone(issued.assignedToPhone) || null,
    );

    if (limitCheck.ok === false) {
      return {
        snapshot,
        issued,
        error: limitCheck.reason,
      };
    }
  }

  issued.used = true;
  issued.usedAt = now;

  const issuedList = [...snapshot.issued];
  issuedList[index] = issued;

  return {
    snapshot: {
      ...snapshot,
      issued: issuedList,
    },
    issued,
    error: null,
  };
}

function restoreIssued(snapshot: CouponSnapshot, opts: any) {
  const id = String(opts?.id || "");
  const code = String(opts?.code || "");

  const index = snapshot.issued.findIndex((issued) => {
    if (id && issued.id === id) return true;
    if (code && normalizeCode(issued.code) === normalizeCode(code)) return true;
    return false;
  });

  if (index === -1) {
    return {
      snapshot,
      issued: null,
      error: "issued_not_found",
    };
  }

  const issued = {
    ...snapshot.issued[index],
    used: false,
    usedAt: null,
  };

  const issuedList = [...snapshot.issued];
  issuedList[index] = issued;

  return {
    snapshot: {
      ...snapshot,
      issued: issuedList,
    },
    issued,
    error: null,
  };
}

function readItems(body: any) {
  return Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.coupons)
      ? body.coupons
      : Array.isArray(body?.issued)
        ? body.issued
        : body?.item
          ? [body.item]
          : [];
}

function buildDeleteWhere(tenantId: string, code: string, id: string) {
  const or: Array<{ code?: string; id?: string }> = [];

  if (code) or.push({ code });
  if (id) or.push({ id });

  return {
    tenantId,
    OR: or,
  };
}

export async function GET(req: Request) {
  try {
    const unauthorized = requireAdmin(req);
    if (unauthorized) return unauthorized;

    const url = new URL(req.url);
    const includeIssued = url.searchParams.get("includeIssued") !== "0";
    const snapshot = await readCouponSnapshot();

    return responseJson({
      coupons: snapshot.coupons,
      issued: includeIssued ? snapshot.issued : [],
      items: snapshot.coupons,
      snapshot: {
        coupons: snapshot.coupons,
        issued: includeIssued ? snapshot.issued : [],
      },
      counts: {
        coupons: snapshot.coupons.length,
        issued: includeIssued ? snapshot.issued.length : 0,
      },
    });
  } catch (error: any) {
    console.error("GET /api/coupons failed:", error);
    return errorJson(error?.message || "COUPONS_GET_FAILED", 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const action = String(body?.action || "");

    if (!isPublicPostAction(action)) {
      const unauthorized = requireAdmin(req);
      if (unauthorized) return unauthorized;
    }

    const tenantId = await getTenantId();
    const current = await readCouponSnapshot();

    if (body?.kind === "coupons") {
      const items = readItems(body);
      const savedCodes: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const raw of items) {
          const saved = await saveCouponToDb(tx, tenantId, raw, current);
          if (saved?.code) savedCodes.push(saved.code);
        }

        if (body?.replace === true && items.length > 0 && savedCodes.length > 0) {
          await tx.coupon.deleteMany({
            where: {
              tenantId,
              code: {
                notIn: savedCodes,
              },
            },
          });
        }
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        saved: savedCodes.length,
        codes: savedCodes,
        coupons: saved.coupons,
        issued: saved.issued,
        snapshot: saved,
      });
    }

    if (body?.kind === "issued") {
      const items = readItems(body);
      const savedCodes: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const raw of items) {
          const saved = await saveIssuedToDb(tx, tenantId, raw, current);
          if (saved?.code) savedCodes.push(saved.code);
        }

        if (body?.replace === true && items.length > 0 && savedCodes.length > 0) {
          await tx.issuedCoupon.deleteMany({
            where: {
              tenantId,
              code: {
                notIn: savedCodes,
              },
            },
          });
        }
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        saved: savedCodes.length,
        codes: savedCodes,
        coupons: saved.coupons,
        issued: saved.issued,
        issuedList: saved.issued,
        snapshot: saved,
      });
    }

    if (action === "saveCoupon") {
      const rawCoupon = body?.coupon ?? body;
      let savedCoupon: CouponDef | null = null;

      await prisma.$transaction(async (tx) => {
        savedCoupon = await saveCouponToDb(tx, tenantId, rawCoupon, current);
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        coupon: savedCoupon,
        coupons: saved.coupons,
        issued: saved.issued,
        snapshot: saved,
      });
    }

    if (action === "deleteCoupon") {
      const id = String(body?.id || "");
      const code = displayCode(body?.code || "");
      const found = current.coupons.find(
        (coupon) => coupon.id === id || normalizeCode(coupon.code) === normalizeCode(code),
      );

      if (!found) {
        return errorJson("coupon_not_found", 404, {
          coupons: current.coupons,
          issued: current.issued,
          snapshot: current,
        });
      }

      await prisma.coupon.deleteMany({
        where: {
          tenantId,
          code: found.code,
        },
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        deleted: found.id,
        code: found.code,
        coupons: saved.coupons,
        issued: saved.issued,
        snapshot: saved,
      });
    }

    if (action === "issueCoupon") {
      const result = issueCoupon(current, body);

      if (result.error || !result.issued) {
        return errorJson(result.error || "issue_failed", 400, {
          coupons: current.coupons,
          issued: current.issued,
          snapshot: current,
        });
      }

      let savedIssued: IssuedCoupon | null = null;

      await prisma.$transaction(async (tx) => {
        savedIssued = await saveIssuedToDb(tx, tenantId, result.issued, current);
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        issued: savedIssued || result.issued,
        issuedList: saved.issued,
        coupons: saved.coupons,
        snapshot: saved,
      });
    }

    if (action === "redeemIssued") {
      const result = redeemIssued(current, body);

      if (result.error || !result.issued) {
        return errorJson(result.error || "redeem_failed", 400, {
          coupons: current.coupons,
          issued: current.issued,
          snapshot: current,
        });
      }

      const def = current.coupons.find((coupon) => coupon.id === result.issued?.couponId);

      await prisma.$transaction(async (tx) => {
        await saveIssuedToDb(
          tx,
          tenantId,
          {
            ...result.issued,
            couponCode: def?.code || "",
          },
          current,
        );
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        issued: result.issued,
        issuedList: saved.issued,
        coupons: saved.coupons,
        snapshot: saved,
      });
    }

    if (action === "restoreIssued") {
      const result = restoreIssued(current, body);

      if (result.error || !result.issued) {
        return errorJson(result.error || "restore_failed", 400, {
          coupons: current.coupons,
          issued: current.issued,
          snapshot: current,
        });
      }

      const def = current.coupons.find((coupon) => coupon.id === result.issued?.couponId);

      await prisma.$transaction(async (tx) => {
        await saveIssuedToDb(
          tx,
          tenantId,
          {
            ...result.issued,
            couponCode: def?.code || "",
          },
          current,
        );
      });

      const saved = await readCouponSnapshot();

      return responseJson({
        issued: result.issued,
        issuedList: saved.issued,
        coupons: saved.coupons,
        snapshot: saved,
      });
    }

    if (action === "validateCoupon") {
      const found = findCouponByAnyCode(current, body?.code || "");

      if (!found.def) {
        return responseJson({
          result: {
            ok: false,
            reason: "not_found",
            message: "Gutschein wurde nicht gefunden.",
          },
          def: null,
          issued: null,
          coupons: current.coupons,
          issuedList: current.issued,
          snapshot: current,
        });
      }

      const result = canApply({
        snapshot: current,
        def: found.def,
        issued: found.issued,
        cartTotal: toNum(body?.cartTotal, 0),
        cartItems: Array.isArray(body?.cartItems) ? body.cartItems : [],
        customerPhone: body?.customerPhone ?? null,
      });

      return responseJson({
        result,
        def: found.def,
        issued: found.issued,
        coupons: current.coupons,
        issuedList: current.issued,
        snapshot: current,
      });
    }

    if (action === "replaceSnapshot" || action === "importAll") {
      const next: CouponSnapshot = {
        coupons: Array.isArray(body?.coupons)
          ? body.coupons.map((coupon: any) => normalizeCouponDef(coupon))
          : [],
        issued: Array.isArray(body?.issued)
          ? body.issued.map((issued: any) => normalizeIssuedCoupon(issued))
          : [],
      };

      const saved = await replaceSnapshotInDb(next);

      return responseJson({
        coupons: saved.coupons,
        issued: saved.issued,
        snapshot: saved,
      });
    }

    return errorJson("unknown_action", 400);
  } catch (error: any) {
    console.error("POST /api/coupons failed:", error);
    return errorJson(error?.message || "COUPONS_POST_FAILED", 500);
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  try {
    const unauthorized = requireAdmin(req);
    if (unauthorized) return unauthorized;

    const tenantId = await getTenantId();
    const { searchParams } = new URL(req.url);

    const kind = searchParams.get("kind");
    const code = displayCode(searchParams.get("code"));
    const id = String(searchParams.get("id") || "");

    if (!code && !id) {
      return errorJson("missing_code_or_id", 400);
    }

    if (kind === "issued") {
      await prisma.issuedCoupon.deleteMany({
        where: buildDeleteWhere(tenantId, code, id) as any,
      });
    } else {
      const snapshot = await readCouponSnapshot();
      const found = snapshot.coupons.find(
        (coupon) => coupon.id === id || normalizeCode(coupon.code) === normalizeCode(code),
      );

      if (!found) {
        return errorJson("coupon_not_found", 404);
      }

      await prisma.coupon.deleteMany({
        where: {
          tenantId,
          code: found.code,
        },
      });
    }

    const saved = await readCouponSnapshot();

    return responseJson({
      deleted: true,
      coupons: saved.coupons,
      issued: saved.issued,
      snapshot: saved,
    });
  } catch (error: any) {
    console.error("DELETE /api/coupons failed:", error);
    return errorJson(error?.message || "COUPONS_DELETE_FAILED", 500);
  }
}