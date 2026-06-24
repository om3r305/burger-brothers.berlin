// lib/coupons.ts
// Coupon core.
// DB is the long-term source of truth, localStorage is a client cache/fallback.
// Existing synchronous helpers are kept for UI compatibility.
// Async helpers at the bottom sync with /api/admin/coupons.

export type CouponType = "fixed" | "percent" | "free_item" | "bogo";

export type BogoRule = {
  matchBy: "sku" | "name" | "category";
  matchValue: string;
  buyQty: number;
  freeQty: number;
  maxFreePerOrder?: number;
};

export type AwardRule =
  | { kind: "nth_order"; n: number; couponId: string; expiresDays?: number }
  | { kind: "spent_total"; minTotal: number; couponId: string; expiresDays?: number }
  | { kind: "manual"; couponId: string };

export type CouponDef = {
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

export type IssuedCoupon = {
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

export type CartItemForCoupon = {
  sku?: string;
  name?: string;
  category?: string;
  qty: number;
  unitPrice: number;
};

export type CouponSnapshot = {
  coupons: CouponDef[];
  issued: IssuedCoupon[];
};

export type CheckResult =
  | { ok: true; discountAmount: number; message: string }
  | { ok: false; reason: string; message: string };

export type RedeemResult =
  | { ok: true; item: IssuedCoupon }
  | { ok: false; reason: string; message?: string };

export const LS_COUPONS = "bb_coupons_v1";
export const LS_ISSUED = "bb_issued_coupons_v1";

const API_PATH = "/api/admin/coupons";

const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function normalizeCode(input?: string | null) {
  return String(input ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toLowerCase();
}

export function displayCode(input?: string | null) {
  return String(input ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

export function normalizePhone(input?: string | null) {
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

function cleanJson<T>(value: T): T {
  if (value === undefined || value === null) return value as T;

  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function sanitizeObject(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;
      out[key] = sanitizeObject(item);
    }

    return out;
  }

  return value;
}

function load<T>(key: string): T | null {
  if (!hasWindow()) return null;

  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: any) {
  if (!hasWindow()) return;

  try {
    localStorage.setItem(key, JSON.stringify(value));
    dispatchCouponsChanged(key, value);
  } catch {}
}

function dispatchCouponsChanged(key?: string, value?: any) {
  if (!hasWindow()) return;

  try {
    if (key) {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: JSON.stringify(value ?? null),
          storageArea: window.localStorage,
        }),
      );
    } else {
      window.dispatchEvent(new Event("storage"));
    }
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_coupons_changed"));
    window.dispatchEvent(new CustomEvent("bb:coupons-sync"));
  } catch {}
}

function normalizeCouponType(value: any): CouponType {
  const text = String(value || "").trim();

  if (text === "fixed" || text === "percent" || text === "free_item" || text === "bogo") {
    return text as CouponType;
  }

  return "fixed";
}

function normalizeCouponDef(input: any): CouponDef {
  const now = Date.now();

  return {
    id: String(input?.id || rid()),
    code: displayCode(input?.code || generateCode(8, "BB")),
    title: input?.title != null ? String(input.title) : "",
    type: normalizeCouponType(input?.type),
    value: toNum(input?.value, 0),
    minCartTotal: input?.minCartTotal != null ? toNum(input.minCartTotal, 0) : undefined,
    maxUses: toInt(input?.maxUses),
    perCustomerLimit: toInt(input?.perCustomerLimit),
    validFrom: input?.validFrom != null ? toTs(input.validFrom) : now,
    validUntil: input?.validUntil != null ? toTs(input.validUntil) : undefined,
    createdAt: input?.createdAt != null ? toTs(input.createdAt) : now,
    meta: input?.meta && typeof input.meta === "object" ? sanitizeObject(input.meta) : {},
  };
}

function normalizeIssuedCoupon(input: any): IssuedCoupon {
  return {
    id: String(input?.id || rid()),
    couponId: String(input?.couponId || ""),
    code: displayCode(input?.code || generateCode(8, "BB")),
    assignedToPhone:
      input?.assignedToPhone != null ? normalizePhone(input.assignedToPhone) || null : null,
    assignedToEmail: input?.assignedToEmail != null ? String(input.assignedToEmail) : null,
    issuedAt: input?.issuedAt != null ? toTs(input.issuedAt) : Date.now(),
    expiresAt: input?.expiresAt != null ? toTs(input.expiresAt) : null,
    used: Boolean(input?.used ?? false),
    usedAt: input?.usedAt != null ? toTs(input.usedAt) : null,
    source: input?.source != null ? String(input.source) : null,
    note: input?.note != null ? String(input.note) : null,
    meta: input?.meta && typeof input.meta === "object" ? sanitizeObject(input.meta) : undefined,
  };
}

export function generateCode(length = 8, prefix = "") {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  const make = () =>
    Array.from({ length })
      .map(() => chars[Math.floor(Math.random() * chars.length)])
      .join("");

  const existing = new Set<string>();

  getAllCoupons().forEach((coupon) => existing.add(normalizeCode(coupon.code)));
  getAllIssued().forEach((issued) => existing.add(normalizeCode(issued.code)));

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

export function getAllCoupons(): CouponDef[] {
  const arr = load<CouponDef[]>(LS_COUPONS) || [];
  return Array.isArray(arr) ? arr.map(normalizeCouponDef) : [];
}

export function persistCoupons(list: CouponDef[]) {
  save(LS_COUPONS, list.map(normalizeCouponDef));
}

export function saveCoupon(def: CouponDef) {
  const normalized = normalizeCouponDef(def);
  const all = getAllCoupons();
  const index = all.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    all[index] = normalized;
  } else {
    all.unshift(normalized);
  }

  persistCoupons(all);
  return normalized;
}

export function createCoupon(partial: Partial<CouponDef>): CouponDef {
  const now = Date.now();
  const baseCode = partial.code ? displayCode(partial.code) : generateCode(8, "BB");

  const def: CouponDef = {
    id: partial.id || rid(),
    code: displayCode(baseCode),
    title: partial.title || "",
    type: partial.type || "fixed",
    value: typeof partial.value === "number" ? partial.value : 0,
    minCartTotal: partial.minCartTotal,
    maxUses: partial.maxUses,
    perCustomerLimit: partial.perCustomerLimit,
    validFrom: partial.validFrom ?? now,
    validUntil: partial.validUntil,
    createdAt: partial.createdAt ?? now,
    meta: partial.meta || {},
  };

  return saveCoupon(def);
}

export function deleteCoupon(id: string) {
  const left = getAllCoupons().filter((coupon) => coupon.id !== id);
  persistCoupons(left);
}

export function findCouponDefByCode(code: string): CouponDef | null {
  const want = normalizeCode(code);
  if (!want) return null;

  return getAllCoupons().find((coupon) => normalizeCode(coupon.code) === want) || null;
}

export function getAllIssued(): IssuedCoupon[] {
  const arr = load<IssuedCoupon[]>(LS_ISSUED) || [];
  return Array.isArray(arr) ? arr.map(normalizeIssuedCoupon) : [];
}

export function persistIssued(list: IssuedCoupon[]) {
  save(LS_ISSUED, list.map(normalizeIssuedCoupon));
}

function pickIssueCodeFromDef(def: CouponDef) {
  if (def.meta?.uniquePerIssue) {
    const prefix = (def.code.split("-")[0] || "CP").slice(0, 6).toUpperCase();
    return generateCode(8, prefix);
  }

  return displayCode(def.code);
}

function issuesOfPhoneForCoupon(phone: string | null | undefined, couponId: string) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return [];

  return getAllIssued().filter(
    (issued) =>
      issued.couponId === couponId &&
      normalizePhone(issued.assignedToPhone) === normalizedPhone,
  );
}

function canIssueToPhone(def: CouponDef, phone?: string | null, now = Date.now()) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return true;

  const meta = def.meta || {};
  const history = issuesOfPhoneForCoupon(normalizedPhone, def.id).sort(
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

export function getUsageStats(couponId: string, phone?: string | null) {
  const issued = getAllIssued().filter((item) => item.couponId === couponId);
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

export function issueCoupon(opts: {
  couponId: string;
  phone?: string | null;
  email?: string | null;
  expiresAfterDays?: number | null;
  source?: string | null;
  note?: string | null;
}): IssuedCoupon | null {
  const def = getAllCoupons().find((coupon) => coupon.id === opts.couponId);
  if (!def) return null;

  const now = Date.now();
  const phone = normalizePhone(opts.phone) || null;

  if (!canIssueToPhone(def, phone, now)) return null;

  const issued: IssuedCoupon = {
    id: rid(),
    couponId: def.id,
    code: pickIssueCodeFromDef(def),
    assignedToPhone: phone,
    assignedToEmail: opts.email ?? null,
    issuedAt: now,
    expiresAt:
      opts.expiresAfterDays != null
        ? now + opts.expiresAfterDays * 24 * 3600 * 1000
        : def.validUntil ?? null,
    used: false,
    usedAt: null,
    source: opts.source || "manual",
    note: opts.note ?? null,
  };

  const all = getAllIssued();
  all.unshift(issued);
  persistIssued(all);

  return issued;
}

export function issueBulkToPhones(
  couponId: string,
  phones: string[],
  expiresAfterDays?: number | null,
  source?: string | null,
) {
  const out: IssuedCoupon[] = [];

  for (const phone of phones) {
    const issued = issueCoupon({
      couponId,
      phone,
      expiresAfterDays,
      source,
    });

    if (issued) out.push(issued);
  }

  return out;
}

export function scheduleBulkDistribution(params: {
  couponId: string;
  count: number;
  days: number;
  phonePool?: string[];
  expiresAfterDays?: number | null;
  source?: string | null;
}) {
  const def = getAllCoupons().find((coupon) => coupon.id === params.couponId);
  if (!def) return 0;

  const now = Date.now();
  const all = getAllIssued();

  for (let i = 0; i < params.count; i += 1) {
    const day = Math.floor(Math.random() * Math.max(1, params.days));
    const withinDayMs = Math.floor(Math.random() * 24 * 3600 * 1000);
    const ts = now + day * 24 * 3600 * 1000 + withinDayMs;

    const phone = params.phonePool?.length
      ? normalizePhone(params.phonePool[i % params.phonePool.length])
      : null;

    const expiresAt =
      params.expiresAfterDays != null
        ? ts + params.expiresAfterDays * 24 * 3600 * 1000
        : def.validUntil ?? null;

    const item: IssuedCoupon = {
      id: rid(),
      couponId: def.id,
      code: pickIssueCodeFromDef(def),
      assignedToPhone: phone || null,
      assignedToEmail: null,
      issuedAt: ts,
      expiresAt,
      used: false,
      usedAt: null,
      source: params.source || "bulk_schedule",
      note: "scheduled",
    };

    all.unshift(item);
  }

  persistIssued(all);

  return params.count;
}

export function deliverScheduled(now = Date.now()) {
  const defs = getAllCoupons();
  const all = getAllIssued();

  let changed = false;

  for (const item of all) {
    if (item.note === "scheduled" && item.issuedAt <= now) {
      const def = defs.find((coupon) => coupon.id === item.couponId);

      if (def && !canIssueToPhone(def, item.assignedToPhone, now)) {
        item.note = "cancelled";
        changed = true;
        continue;
      }

      item.note = "available";
      changed = true;
    }
  }

  if (changed) persistIssued(all);

  return changed;
}

export function describeCoupon(def: CouponDef, issued?: IssuedCoupon) {
  const lines: string[] = [];

  if (def.type === "fixed") {
    lines.push(`${def.value.toFixed(2)}€ Rabatt-Gutschein`);
  } else if (def.type === "percent") {
    lines.push(`${def.value}% Rabatt auf den Warenkorb`);
  } else if (def.type === "bogo") {
    const bogo = def.meta?.bogo;

    if (bogo) {
      lines.push(`BOGO: ${bogo.buyQty} kaufen, ${bogo.freeQty} gratis`);
      lines.push(`• Bereich: ${bogo.matchBy} = ${bogo.matchValue}`);

      if (bogo.maxFreePerOrder) {
        lines.push(`• Maximal ${bogo.maxFreePerOrder} Gratis-Artikel pro Bestellung`);
      }
    } else {
      lines.push("BOGO-Gutschein");
    }
  } else {
    lines.push(`Gratis: ${def.meta?.freeItemName || "Artikel"}`);
  }

  if (def.minCartTotal) {
    lines.push(`• Gültig ab ${def.minCartTotal.toFixed(2)}€ Warenkorb`);
  }

  if (def.validUntil) {
    lines.push(`• Gültig bis: ${new Date(def.validUntil).toLocaleDateString("de-DE")}`);
  }

  if (def.perCustomerLimit) {
    lines.push(`• Maximal ${def.perCustomerLimit} Nutzung(en) pro Kunde`);
  }

  if (def.meta?.aboutText) {
    lines.push(`• ${def.meta.aboutText}`);
  }

  if (issued?.assignedToPhone) {
    lines.push(`• Nur für ${issued.assignedToPhone} zugewiesen`);
  }

  return lines.join("\n");
}

function checkHardLimits(
  def: CouponDef,
  phone?: string | null,
): { ok: true } | { ok: false; reason: string; message: string } {
  const { globalUsed, customerUsed } = getUsageStats(def.id, phone);

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

export function canApply(params: {
  def: CouponDef;
  issued?: IssuedCoupon | null;
  cartTotal: number;
  cartItems?: CartItemForCoupon[];
  customerPhone?: string | null;
  now?: number;
}): CheckResult {
  const { def, issued, cartTotal } = params;
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

  const limitCheck = checkHardLimits(def, customerPhone || null);
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
      .flatMap((item) => {
        const qty = Math.max(0, Math.trunc(toNum(item.qty, 0)));
        const unitPrice = toNum(item.unitPrice, 0);

        return Array.from({ length: qty }).map(() => unitPrice);
      })
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

export function findIssuedByCode(code: string) {
  const want = normalizeCode(code);
  if (!want) return null;

  return getAllIssued().find((issued) => normalizeCode(issued.code) === want) || null;
}

export function findCouponByAnyCode(code: string): {
  def: CouponDef | null;
  issued: IssuedCoupon | null;
} {
  const issued = findIssuedByCode(code);

  if (issued) {
    const def = getAllCoupons().find((coupon) => coupon.id === issued.couponId) || null;
    return { def, issued };
  }

  const def = findCouponDefByCode(code);
  return { def, issued: null };
}

export function redeemIssued(id: string, customerPhone?: string, now = Date.now()): RedeemResult {
  const list = getAllIssued();
  const index = list.findIndex((issued) => issued.id === id);

  if (index === -1) return { ok: false, reason: "not_found" };

  const item = list[index];

  if (!item) return { ok: false, reason: "not_found" };

  if (item.used) return { ok: false, reason: "already_used" };

  if (item.expiresAt && item.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }

  const normalizedPhone = normalizePhone(customerPhone);

  if (
    item.assignedToPhone &&
    normalizedPhone &&
    normalizePhone(item.assignedToPhone) !== normalizedPhone
  ) {
    return { ok: false, reason: "assigned_to_other" };
  }

  const def = getAllCoupons().find((coupon) => coupon.id === item.couponId);

  if (def) {
    const limitCheck = checkHardLimits(
      def,
      normalizedPhone || normalizePhone(item.assignedToPhone) || null,
    );

    if (limitCheck.ok === false) return limitCheck;
  }

  const redeemed: IssuedCoupon = {
    ...item,
    used: true,
    usedAt: now,
  };

  list[index] = redeemed;
  persistIssued(list);

  return { ok: true, item: redeemed };
}

export function restoreIssued(id: string) {
  const list = getAllIssued();
  const index = list.findIndex((issued) => issued.id === id);

  if (index === -1) return false;

  const item = list[index];
  if (!item) return false;

  list[index] = {
    ...item,
    used: false,
    usedAt: null,
  };

  persistIssued(list);

  return true;
}

export function evaluateAutoAwardsForCustomer(params: {
  phone?: string | null;
  email?: string | null;
  customerName?: string | null;
  lastOrderTs?: number;
  orderTotal?: number;
  orders?: any[];
}) {
  const phone = normalizePhone(params.phone) || null;
  const orders = params.orders || [];
  const orderTotal = params.orderTotal || 0;
  const results: IssuedCoupon[] = [];

  for (const coupon of getAllCoupons()) {
    const rules = (coupon.meta?.awardRules || []) as AwardRule[];

    for (const rule of rules) {
      if (phone && !canIssueToPhone(coupon, phone)) continue;

      if (rule.kind === "nth_order") {
        const count = orders.filter((order) => {
          const orderPhone = normalizePhone(order?.customer?.phone);

          if (phone && orderPhone) {
            return orderPhone === phone;
          }

          if (!phone && params.customerName && order?.customer?.name) {
            return order.customer.name === params.customerName;
          }

          return false;
        }).length;

        if (count > 0 && count % rule.n === 0) {
          const issued = issueCoupon({
            couponId: rule.couponId,
            phone,
            email: params.email,
            expiresAfterDays: rule.expiresDays,
            source: `auto:nth_order:${rule.n}`,
          });

          if (issued) results.push(issued);
        }
      }

      if (rule.kind === "spent_total" && orderTotal >= rule.minTotal) {
        const issued = issueCoupon({
          couponId: rule.couponId,
          phone,
          email: params.email,
          expiresAfterDays: rule.expiresDays,
          source: `auto:spent_total:${rule.minTotal}`,
        });

        if (issued) results.push(issued);
      }
    }
  }

  return results;
}

export function exportAll() {
  return JSON.stringify(
    {
      coupons: getAllCoupons(),
      issued: getAllIssued(),
    },
    null,
    2,
  );
}

export function importAll(text: string) {
  try {
    const obj = JSON.parse(text);

    if (Array.isArray(obj?.coupons)) {
      persistCoupons(obj.coupons);
    }

    if (Array.isArray(obj?.issued)) {
      persistIssued(obj.issued);
    }

    return true;
  } catch {
    return false;
  }
}

export function replaceLocalCouponSnapshot(snapshot: Partial<CouponSnapshot>) {
  if (Array.isArray(snapshot.coupons)) {
    persistCoupons(snapshot.coupons);
  }

  if (Array.isArray(snapshot.issued)) {
    persistIssued(snapshot.issued);
  }

  return {
    coupons: getAllCoupons(),
    issued: getAllIssued(),
  };
}

export function couponFromRow(row: any): CouponDef {
  return normalizeCouponDef({
    id: row.id,
    code: row.code,
    title: row.title,
    type: row.type,
    value: row.value,
    minCartTotal: row.minCartTotal,
    maxUses: row.maxUses,
    perCustomerLimit: row.perCustomerLimit,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    createdAt: row.createdAt,
    meta: row.metaJson ?? row.meta,
  });
}

export function couponToRow(def: CouponDef): any {
  const normalized = normalizeCouponDef(def);

  return {
    id: normalized.id,
    code: normalized.code,
    title: normalized.title ?? null,
    type: normalized.type,
    value: normalized.value,
    minCartTotal: normalized.minCartTotal ?? null,
    maxUses: normalized.maxUses ?? null,
    perCustomerLimit: normalized.perCustomerLimit ?? null,
    validFrom: normalized.validFrom ?? null,
    validUntil: normalized.validUntil ?? null,
    createdAt: normalized.createdAt,
    metaJson: normalized.meta ?? null,
  };
}

export function issuedFromRow(row: any): IssuedCoupon {
  return normalizeIssuedCoupon({
    id: row.id,
    couponId: row.couponId,
    code: row.code,
    assignedToPhone: row.assignedToPhone,
    assignedToEmail: row.assignedToEmail,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    used: row.used,
    usedAt: row.usedAt,
    source: row.source,
    note: row.note,
    meta: row.metaJson ?? row.meta,
  });
}

export function issuedToRow(issued: IssuedCoupon): any {
  const normalized = normalizeIssuedCoupon(issued);

  return {
    id: normalized.id,
    couponId: normalized.couponId,
    code: normalized.code,
    assignedToPhone: normalized.assignedToPhone ?? null,
    assignedToEmail: normalized.assignedToEmail ?? null,
    issuedAt: normalized.issuedAt,
    expiresAt: normalized.expiresAt ?? null,
    used: normalized.used ?? false,
    usedAt: normalized.usedAt ?? null,
    source: normalized.source ?? null,
    note: normalized.note ?? null,
    metaJson: normalized.meta ?? null,
  };
}

function couponFromApiRow(row: any): CouponDef {
  const source =
    row?.definition && typeof row.definition === "object"
      ? {
          ...row.definition,
          id: row.definition.id ?? row.id,
          code: row.code ?? row.definition.code,
          createdAt: row.definition.createdAt ?? row.createdAt,
        }
      : row;

  return normalizeCouponDef(source);
}

function issuedFromApiRow(row: any): IssuedCoupon {
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

function normalizeSnapshot(data: any): CouponSnapshot {
  const source =
    data?.snapshot && typeof data.snapshot === "object"
      ? data.snapshot
      : data || {};

  const coupons = Array.isArray(source?.coupons)
    ? source.coupons.map(couponFromApiRow)
    : Array.isArray(data?.coupons)
      ? data.coupons.map(couponFromApiRow)
      : [];

  const issued = Array.isArray(source?.issued)
    ? source.issued.map(issuedFromApiRow)
    : Array.isArray(data?.issued)
      ? data.issued.map(issuedFromApiRow)
      : Array.isArray(data?.issuedList)
        ? data.issuedList.map(issuedFromApiRow)
        : [];

  return {
    coupons,
    issued,
  };
}

async function postToCouponsApi(body: any) {
  const res = await fetch(API_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return data;
}

async function getCouponsApiSnapshot(): Promise<CouponSnapshot> {
  const res = await fetch(`${API_PATH}?includeIssued=1&t=${Date.now()}`, {
    method: "GET",
    cache: "no-store",
    headers: {
      accept: "application/json",
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `HTTP ${res.status}`);
  }

  return normalizeSnapshot(data);
}

function couponApiItem(def: CouponDef) {
  const normalized = normalizeCouponDef(def);

  return {
    id: normalized.id,
    code: normalized.code,
    definition: sanitizeObject(normalized),
  };
}

function issuedApiItem(item: IssuedCoupon, defs: CouponDef[]) {
  const normalized = normalizeIssuedCoupon(item);
  const def = defs.find((coupon) => coupon.id === normalized.couponId) || null;

  return {
    id: normalized.id,
    couponId: normalized.couponId,
    couponCode: def?.code || "",
    code: normalized.code,
    assignedToPhone: normalized.assignedToPhone || null,
    assignedToEmail: normalized.assignedToEmail || null,
    issuedAt: normalized.issuedAt,
    expiresAt: normalized.expiresAt || null,
    used: normalized.used === true,
    usedAt: normalized.usedAt || null,
    source: normalized.source || null,
    note: normalized.note || null,
    meta: normalized.meta || {},
  };
}

export async function fetchCouponsFromDb(): Promise<CouponSnapshot> {
  if (!hasWindow()) {
    return {
      coupons: [],
      issued: [],
    };
  }

  try {
    const snapshot = await getCouponsApiSnapshot();
    replaceLocalCouponSnapshot(snapshot);
    return snapshot;
  } catch {
    return {
      coupons: getAllCoupons(),
      issued: getAllIssued(),
    };
  }
}

export async function syncCouponsFromServer(): Promise<CouponSnapshot> {
  return fetchCouponsFromDb();
}

export async function saveCouponRemote(def: CouponDef): Promise<CouponDef> {
  const normalized = normalizeCouponDef(def);

  if (!hasWindow()) return normalized;

  await postToCouponsApi({
    kind: "coupons",
    items: [couponApiItem(normalized)],
  });

  const snapshot = await getCouponsApiSnapshot();
  replaceLocalCouponSnapshot(snapshot);

  return normalized;
}

export async function deleteCouponRemote(id: string): Promise<boolean> {
  const found = getAllCoupons().find((coupon) => coupon.id === id);

  if (!hasWindow()) return true;
  if (!found) return true;

  const params = new URLSearchParams();

  if (found.code) params.set("code", found.code);
  if (found.id) params.set("id", found.id);

  try {
    const res = await fetch(`${API_PATH}?${params.toString()}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    const snapshot = await getCouponsApiSnapshot();
    replaceLocalCouponSnapshot(snapshot);

    return true;
  } catch {
    return false;
  }
}

export async function issueCouponRemote(opts: {
  couponId: string;
  phone?: string | null;
  email?: string | null;
  expiresAfterDays?: number | null;
  source?: string | null;
  note?: string | null;
}): Promise<IssuedCoupon | null> {
  const def = getAllCoupons().find((coupon) => coupon.id === opts.couponId);
  if (!def) return null;

  const now = Date.now();
  const phone = normalizePhone(opts.phone) || null;

  if (!canIssueToPhone(def, phone, now)) return null;

  const item: IssuedCoupon = {
    id: rid(),
    couponId: def.id,
    code: pickIssueCodeFromDef(def),
    assignedToPhone: phone,
    assignedToEmail: opts.email ?? null,
    issuedAt: now,
    expiresAt:
      opts.expiresAfterDays != null
        ? now + opts.expiresAfterDays * 24 * 3600 * 1000
        : def.validUntil ?? null,
    used: false,
    usedAt: null,
    source: opts.source || "manual",
    note: opts.note ?? null,
  };

  if (!hasWindow()) return item;

  try {
    await postToCouponsApi({
      kind: "issued",
      items: [issuedApiItem(item, getAllCoupons())],
    });

    const snapshot = await getCouponsApiSnapshot();
    replaceLocalCouponSnapshot(snapshot);

    return item;
  } catch {
    return null;
  }
}

export async function redeemIssuedRemote(
  id: string,
  customerPhone?: string,
): Promise<RedeemResult> {
  const list = getAllIssued();
  const before = list.find((item) => item.id === id) || null;

  if (!before) {
    return { ok: false, reason: "not_found" };
  }

  const now = Date.now();
  const def = getAllCoupons().find((coupon) => coupon.id === before.couponId) || null;

  if (def) {
    const check = canApply({
      def,
      issued: before,
      cartTotal: Number.MAX_SAFE_INTEGER,
      customerPhone,
      now,
    });

    if (check.ok === false) {
      return {
        ok: false,
        reason: check.reason,
        message: check.message,
      };
    }
  } else if (before.used) {
    return { ok: false, reason: "already_used" };
  }

  const normalizedPhone = normalizePhone(customerPhone);

  if (
    before.assignedToPhone &&
    normalizedPhone &&
    normalizePhone(before.assignedToPhone) !== normalizedPhone
  ) {
    return { ok: false, reason: "assigned_to_other" };
  }

  const redeemed: IssuedCoupon = {
    ...before,
    used: true,
    usedAt: now,
  };

  if (!hasWindow()) {
    return { ok: true, item: redeemed };
  }

  try {
    await postToCouponsApi({
      kind: "issued",
      items: [issuedApiItem(redeemed, getAllCoupons())],
    });

    const snapshot = await getCouponsApiSnapshot();
    replaceLocalCouponSnapshot(snapshot);

    return { ok: true, item: redeemed };
  } catch {
    return {
      ok: false,
      reason: "db_save_failed",
      message: "Gutschein konnte nicht in der Datenbank eingelöst werden.",
    };
  }
}

export async function restoreIssuedRemote(id: string): Promise<boolean> {
  const list = getAllIssued();
  const item = list.find((issued) => issued.id === id) || null;

  if (!item) return false;

  const restored: IssuedCoupon = {
    ...item,
    used: false,
    usedAt: null,
  };

  if (!hasWindow()) return true;

  try {
    await postToCouponsApi({
      kind: "issued",
      items: [issuedApiItem(restored, getAllCoupons())],
    });

    const snapshot = await getCouponsApiSnapshot();
    replaceLocalCouponSnapshot(snapshot);

    return true;
  } catch {
    return false;
  }
}

export async function validateCouponRemote(params: {
  code: string;
  cartTotal: number;
  cartItems?: CartItemForCoupon[];
  customerPhone?: string | null;
}): Promise<CheckResult & { def?: CouponDef | null; issued?: IssuedCoupon | null }> {
  if (hasWindow()) {
    try {
      await syncCouponsFromServer();
    } catch {}
  }

  const found = findCouponByAnyCode(params.code);

  if (!found.def) {
    return {
      ok: false,
      reason: "not_found",
      message: "Gutschein wurde nicht gefunden.",
      def: null,
      issued: null,
    };
  }

  const check = canApply({
    def: found.def,
    issued: found.issued,
    cartTotal: params.cartTotal,
    cartItems: params.cartItems,
    customerPhone: params.customerPhone,
  });

  return {
    ...check,
    def: found.def,
    issued: found.issued,
  };
}