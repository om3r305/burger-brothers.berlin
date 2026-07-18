"use client";

import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Coupons from "@/lib/coupons";

const API_COUPONS = "/api/coupons";
const LS_COUPONS = "bb_coupons_v1";
const LS_ISSUED = "bb_issued_coupons_v1";

type GUIRule = {
  id: string;
  kind: "nth_order" | "spent_total";
  n?: number;
  minTotal?: number;
  expiresDays?: number;
};

type Source = "db" | "cache" | "empty";

const fmtDT = (ts?: number | string | null) => {
  if (!ts) return "—";
  const date = new Date(ts);
  return Number.isFinite(date.valueOf()) ? date.toLocaleString("tr-TR") : "—";
};

const uuid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  throw new Error("SECURE_RANDOM_UNAVAILABLE");
};

function safeJson(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

function parseJson(text: string | null) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeCode(value: any) {
  return String(value ?? "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePhone(value: any) {
  return String(value ?? "").replace(/[^\d+]/g, "").trim();
}

function toNumber(value: any, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value == null || value === "") return fallback;

  const text = String(value).replace(/[€\s]/g, "").replace(",", ".").trim();
  const number = Number(text);

  return Number.isFinite(number) ? number : fallback;
}

function toOptionalNumber(value: any) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function toTs(value: any, fallback = Date.now()) {
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

function fmtMoney(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function couponTypeLabel(type: Coupons.CouponType) {
  switch (type) {
    case "fixed":
      return "Sabit tutar";
    case "percent":
      return "Yüzde";
    case "free_item":
      return "Bedava ürün";
    case "bogo":
      return "2 al 1 bedava";
    default:
      return type;
  }
}

function describeCouponTr(def: Coupons.CouponDef, issued?: Coupons.IssuedCoupon) {
  const lines: string[] = [];

  if (def.type === "fixed") {
    lines.push(`${fmtMoney(def.value)} indirim kuponu`);
  } else if (def.type === "percent") {
    lines.push(`%${def.value} sepet indirimi`);
  } else if (def.type === "bogo") {
    const bogo = def.meta?.bogo;

    if (bogo) {
      lines.push(`2 al 1 bedava kuralı: ${bogo.buyQty} al, ${bogo.freeQty} bedava`);
      lines.push(`• Eşleşme: ${bogo.matchBy} = ${bogo.matchValue}`);

      if (bogo.maxFreePerOrder) {
        lines.push(`• Sipariş başına en fazla ${bogo.maxFreePerOrder} bedava ürün`);
      }
    } else {
      lines.push("2 al 1 bedava kuponu");
    }
  } else {
    lines.push(`Bedava: ${def.meta?.freeItemName || "Ürün"}`);
  }

  if (def.minCartTotal) {
    lines.push(`• Sepet en az ${fmtMoney(def.minCartTotal)} olmalı`);
  }

  if (def.validUntil) {
    lines.push(`• Geçerli son tarih: ${fmtDT(def.validUntil)}`);
  }

  if (def.perCustomerLimit) {
    lines.push(`• Müşteri başı en fazla ${def.perCustomerLimit} kullanım`);
  }

  if (def.meta?.aboutText) {
    lines.push(`• ${def.meta.aboutText}`);
  }

  if (issued?.assignedToPhone) {
    lines.push(`• Sadece ${issued.assignedToPhone} telefonuna atanmış`);
  }

  return lines.join("\n");
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeCouponType(value: any): Coupons.CouponType {
  const text = String(value || "").trim();

  if (text === "percent" || text === "free_item" || text === "bogo" || text === "fixed") {
    return text as Coupons.CouponType;
  }

  return "fixed";
}

function mapDbCoupon(row: any): Coupons.CouponDef | null {
  const raw = isPlainObject(row?.definition) ? row.definition : row;
  if (!isPlainObject(raw)) return null;

  const code = normalizeCode(row?.code ?? raw?.code);
  if (!code) return null;

  const now = Date.now();
  const meta = isPlainObject(raw.meta) ? raw.meta : {};

  return {
    id: String(raw.id ?? row?.id ?? uuid()),
    code,
    title: raw.title != null ? String(raw.title) : "",
    type: normalizeCouponType(raw.type),
    value: toNumber(raw.value, 0),
    minCartTotal:
      raw.minCartTotal === null || raw.minCartTotal === undefined || raw.minCartTotal === ""
        ? undefined
        : toNumber(raw.minCartTotal, 0),
    maxUses:
      raw.maxUses === null || raw.maxUses === undefined || raw.maxUses === ""
        ? undefined
        : Math.max(0, Math.floor(toNumber(raw.maxUses, 0))),
    perCustomerLimit:
      raw.perCustomerLimit === null ||
      raw.perCustomerLimit === undefined ||
      raw.perCustomerLimit === ""
        ? undefined
        : Math.max(0, Math.floor(toNumber(raw.perCustomerLimit, 0))),
    validFrom: raw.validFrom != null ? toTs(raw.validFrom, now) : now,
    validUntil: raw.validUntil != null ? toTs(raw.validUntil, now) : undefined,
    createdAt: raw.createdAt != null ? toTs(raw.createdAt, now) : now,
    meta,
  } as Coupons.CouponDef;
}

function mapDbIssued(row: any): Coupons.IssuedCoupon | null {
  if (!isPlainObject(row)) return null;

  const code = normalizeCode(row.code);
  if (!code) return null;

  return {
    id: String(row.id || uuid()),
    couponId: String(row.couponId || ""),
    code,
    assignedToPhone: row.assignedToPhone ? normalizePhone(row.assignedToPhone) : undefined,
    assignedToEmail: row.assignedToEmail ? String(row.assignedToEmail) : undefined,
    issuedAt: row.issuedAt ? toTs(row.issuedAt) : Date.now(),
    expiresAt: row.expiresAt ? toTs(row.expiresAt) : undefined,
    used: row.used === true,
    usedAt: row.usedAt ? toTs(row.usedAt) : undefined,
    source: row.source || undefined,
    note: row.note || undefined,
    meta: isPlainObject(row.meta) ? row.meta : undefined,
  } as Coupons.IssuedCoupon;
}

function writeLocalCoupons(defs: Coupons.CouponDef[]) {
  try {
    localStorage.setItem(LS_COUPONS, safeJson(defs));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_COUPONS,
        newValue: safeJson(defs),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function writeLocalIssued(items: Coupons.IssuedCoupon[]) {
  try {
    localStorage.setItem(LS_ISSUED, safeJson(items));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_ISSUED,
        newValue: safeJson(items),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function readLocalCoupons() {
  try {
    const parsed = parseJson(localStorage.getItem(LS_COUPONS));
    return Array.isArray(parsed)
      ? (parsed.map(mapDbCoupon).filter(Boolean) as Coupons.CouponDef[])
      : [];
  } catch {
    return [];
  }
}

function readLocalIssued() {
  try {
    const parsed = parseJson(localStorage.getItem(LS_ISSUED));
    return Array.isArray(parsed)
      ? (parsed.map(mapDbIssued).filter(Boolean) as Coupons.IssuedCoupon[])
      : [];
  } catch {
    return [];
  }
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: safeJson(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `HTTP_${res.status}`);
  }

  return json;
}

async function saveCouponsToDb(
  defs: Coupons.CouponDef[],
  replace = false,
  options?: {
    serverGenerateCodes?: boolean;
    codePrefix?: string;
    manualCode?: boolean;
  },
) {
  const serverGenerateCodes = options?.serverGenerateCodes === true;
  const prefix = normalizeCode(options?.codePrefix || "BB").slice(0, 8) || "BB";

  return postJson(API_COUPONS, {
    kind: "coupons",
    replace,
    items: defs.map((def) => ({
      id: def.id,
      manualCode: options?.manualCode === true,
      serverGeneratedCode: serverGenerateCodes,
      codePrefix: prefix,
      ...(serverGenerateCodes ? {} : { code: normalizeCode(def.code) }),
      definition: {
        ...def,
        code: serverGenerateCodes ? undefined : normalizeCode(def.code),
        serverGeneratedCode: serverGenerateCodes,
        codePrefix: prefix,
      },
    })),
  });
}

async function saveIssuedToDb(
  issued: Coupons.IssuedCoupon[],
  defs: Coupons.CouponDef[],
  replace = false,
) {
  return postJson(API_COUPONS, {
    kind: "issued",
    replace,
    items: issued.map((item) => ({
      id: item.id,
      couponId: item.couponId,
      couponCode: defs.find((def) => def.id === item.couponId)?.code || "",
      code: normalizeCode(item.code),
      manualCode: true,
      assignedToPhone: item.assignedToPhone || null,
      assignedToEmail: item.assignedToEmail || null,
      issuedAt: item.issuedAt,
      expiresAt: item.expiresAt || null,
      used: item.used === true,
      usedAt: item.usedAt || null,
      source: item.source || null,
      note: item.note || null,
      meta: item.meta || {},
    })),
  });
}

async function issueCouponOnServer(input: {
  couponId: string;
  phone?: string;
  email?: string;
  issuedAt?: number;
  expiresAt?: number;
  expiresAfterDays?: number;
  source?: string;
  note?: string;
}) {
  return postJson(API_COUPONS, {
    action: "issueCoupon",
    ...input,
  });
}

async function deleteCouponFromDb(coupon: Coupons.CouponDef) {
  const code = normalizeCode(coupon.code);
  const params = new URLSearchParams();

  if (code) params.set("code", code);
  if (coupon.id) params.set("id", coupon.id);

  const res = await fetch(`${API_COUPONS}?${params.toString()}`, {
    method: "DELETE",
    headers: {
      accept: "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `HTTP_${res.status}`);
  }
}

async function deleteIssuedFromDb(item: Coupons.IssuedCoupon) {
  const code = normalizeCode(item.code);
  const params = new URLSearchParams();

  params.set("kind", "issued");
  if (code) params.set("code", code);
  if (item.id) params.set("id", item.id);

  const res = await fetch(`${API_COUPONS}?${params.toString()}`, {
    method: "DELETE",
    headers: {
      accept: "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `HTTP_${res.status}`);
  }
}

function isIssuedExpired(item: Coupons.IssuedCoupon, now = Date.now()) {
  return Boolean(item.expiresAt && item.expiresAt < now);
}

function isIssuedScheduled(item: Coupons.IssuedCoupon, now = Date.now()) {
  return item.note === "scheduled" && Boolean(item.issuedAt && item.issuedAt > now);
}

function getIssuedStatus(item: Coupons.IssuedCoupon) {
  const now = Date.now();

  if (item.used) {
    return {
      label: "Kullanıldı",
      helper: item.usedAt ? `Kullanım: ${fmtDT(item.usedAt)}` : "Bu kupon siparişte kullanıldı.",
      className: "border-emerald-400/50 bg-emerald-500/15 text-emerald-100",
    };
  }

  if (item.note === "cancelled") {
    return {
      label: "İptal edildi",
      helper: "Bu atanmış kupon iptal edilmiş.",
      className: "border-rose-400/50 bg-rose-500/15 text-rose-100",
    };
  }

  if (isIssuedExpired(item, now)) {
    return {
      label: "Süresi doldu",
      helper: `Son tarih: ${fmtDT(item.expiresAt)}`,
      className: "border-stone-400/40 bg-stone-500/10 text-stone-200",
    };
  }

  if (isIssuedScheduled(item, now)) {
    return {
      label: "Planlandı",
      helper: `Açılacağı zaman: ${fmtDT(item.issuedAt)}`,
      className: "border-sky-400/50 bg-sky-500/15 text-sky-100",
    };
  }

  return {
    label: "Hazır",
    helper: "Müşteri bu kuponu kullanabilir.",
    className: "border-amber-400/50 bg-amber-500/15 text-amber-100",
  };
}

function getCouponUsageStats(coupon: Coupons.CouponDef, issuedList: Coupons.IssuedCoupon[]) {
  const now = Date.now();
  const related = issuedList.filter((item) => item.couponId === coupon.id);

  const totalAssigned = related.length;
  const used = related.filter((item) => item.used).length;
  const cancelled = related.filter((item) => item.note === "cancelled").length;
  const expired = related.filter(
    (item) => !item.used && item.note !== "cancelled" && isIssuedExpired(item, now),
  ).length;
  const scheduled = related.filter(
    (item) => !item.used && item.note !== "cancelled" && isIssuedScheduled(item, now),
  ).length;
  const ready = related.filter((item) => {
    if (item.used) return false;
    if (item.note === "cancelled") return false;
    if (isIssuedExpired(item, now)) return false;
    if (isIssuedScheduled(item, now)) return false;
    return true;
  }).length;

  const maxUses =
    typeof coupon.maxUses === "number" && Number.isFinite(coupon.maxUses)
      ? Math.max(0, Math.floor(coupon.maxUses))
      : null;

  const remainingByMax = maxUses != null ? Math.max(0, maxUses - used) : null;

  return {
    totalAssigned,
    used,
    ready,
    scheduled,
    expired,
    cancelled,
    maxUses,
    remainingByMax,
  };
}

function sourceLabel(value?: string | null) {
  switch (value) {
    case "manual":
      return "Manuel atama";
    case "bulk_campaign":
      return "Toplu kampanya";
    case "auto":
      return "Otomatik";
    default:
      return value || "—";
  }
}

function smallLabel(text: string) {
  return <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{text}</span>;
}

function InfoLine({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-xl border border-stone-700/60 bg-stone-950/35 p-2">
      {smallLabel(label)}
      <div className="mt-0.5 text-sm font-semibold text-stone-100">{value}</div>
    </div>
  );
}

function FieldBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-stone-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-stone-500">{hint}</span>}
    </label>
  );
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupons.CouponDef[]>([]);
  const [issued, setIssued] = useState<Coupons.IssuedCoupon[]>([]);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState<Source>("empty");
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<Coupons.CouponType>("fixed");
  const [value, setValue] = useState(5);
  const [minCart, setMinCart] = useState<number | "">("");
  const [validDays, setValidDays] = useState<number | "">(7);
  const [perCust, setPerCust] = useState<number | "">("");

  const [uniquePerIssue, setUniquePerIssue] = useState(true);
  const [aboutText, setAboutText] = useState("");
  const [freeItemName, setFreeItemName] = useState("");

  const [singlePerCustomer, setSinglePerCustomer] = useState(false);
  const [capPerWeek, setCapPerWeek] = useState<number | "">("");
  const [cooldownDays, setCooldownDays] = useState<number | "">("");

  const [codePrefix, setCodePrefix] = useState("BB");

  const [bogoMatchBy, setBogoMatchBy] = useState<"sku" | "name" | "category">("name");
  const [bogoMatchValue, setBogoMatchValue] = useState("");
  const [bogoBuy, setBogoBuy] = useState(2);
  const [bogoFree, setBogoFree] = useState(1);
  const [bogoMaxFree, setBogoMaxFree] = useState<number | "">("");

  const [rules, setRules] = useState<GUIRule[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState<string>("");

  const loadFromLocal = () => {
    const defs = readLocalCoupons();
    const iss = readLocalIssued();

    setCoupons(defs);
    setIssued(iss);
    setSource(defs.length || iss.length ? "cache" : "empty");
  };

  const loadFromDb = async () => {
    setLoading(true);

    try {
      const res = await fetch(`${API_COUPONS}?includeIssued=1`, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const json = await res.json().catch(() => ({} as any));

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }

      const dbCoupons = Array.isArray(json?.coupons)
        ? (json.coupons.map(mapDbCoupon).filter(Boolean) as Coupons.CouponDef[])
        : [];

      const dbIssued = Array.isArray(json?.issued)
        ? (json.issued.map(mapDbIssued).filter(Boolean) as Coupons.IssuedCoupon[])
        : [];

      setCoupons(dbCoupons);
      setIssued(dbIssued);
      setSource("db");

      writeLocalCoupons(dbCoupons);
      writeLocalIssued(dbIssued);
    } catch {
      loadFromLocal();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetCreateForm = () => {
    setTitle("");
    setAboutText("");
    setFreeItemName("");
    setMinCart("");
    setPerCust("");
    setValidDays(7);
    setRules([]);
    setSinglePerCustomer(false);
    setCapPerWeek("");
    setCooldownDays("");
    setBogoMatchValue("");
    setBogoBuy(2);
    setBogoFree(1);
    setBogoMaxFree("");
  };

  const createDefinition = (customTitle?: string): Coupons.CouponDef => {
    const now = Date.now();

    const meta: Coupons.CouponDef["meta"] = {
      uniquePerIssue,
      aboutText: aboutText || undefined,
      freeItemName: type === "free_item" ? freeItemName || "Ürün" : undefined,
      singlePerCustomer: singlePerCustomer || undefined,
      issueCapPerWeek: typeof capPerWeek === "number" ? capPerWeek : undefined,
      issueCooldownDays: typeof cooldownDays === "number" ? cooldownDays : undefined,
      awardRules: (rules || []).map((rule) =>
        rule.kind === "nth_order"
          ? ({
              kind: "nth_order",
              n: rule.n || 10,
              couponId: "__SELF__",
              expiresDays: rule.expiresDays,
            } as any)
          : ({
              kind: "spent_total",
              minTotal: rule.minTotal || 20,
              couponId: "__SELF__",
              expiresDays: rule.expiresDays,
            } as any),
      ),
      bogo:
        type === "bogo"
          ? {
              matchBy: bogoMatchBy,
              matchValue: bogoMatchValue.trim(),
              buyQty: Math.max(1, Math.floor(bogoBuy || 1)),
              freeQty: Math.max(1, Math.floor(bogoFree || 1)),
              maxFreePerOrder:
                typeof bogoMaxFree === "number"
                  ? Math.max(0, Math.floor(bogoMaxFree))
                  : undefined,
            }
          : undefined,
    };

    const def: Coupons.CouponDef = {
      id: uuid(),
      code: "",
      title: customTitle ?? title,
      type,
      value: toNumber(value, 0),
      minCartTotal: typeof minCart === "number" ? minCart : undefined,
      perCustomerLimit: typeof perCust === "number" ? perCust : undefined,
      validFrom: now,
      validUntil:
        typeof validDays === "number"
          ? now + validDays * 24 * 3600 * 1000
          : undefined,
      createdAt: now,
      meta,
    };

    if (def.meta?.awardRules?.length) {
      def.meta.awardRules = def.meta.awardRules.map((rule: any) => ({
        ...rule,
        couponId: def.id,
      }));
    }

    return def;
  };

  const create = async () => {
    setLoading(true);

    try {
      const def = createDefinition();

      const saved = await saveCouponsToDb([def], false, {
        serverGenerateCodes: true,
        codePrefix,
      });
      resetCreateForm();
      await loadFromDb();

      const createdCode = Array.isArray(saved?.codes) ? saved.codes[0] : "";
      alert(`Kupon oluşturuldu${createdCode ? `: ${createdCode}` : "."}`);
    } catch (error: any) {
      alert(`Kupon kaydedilemedi: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const bulkRandom = async () => {
    const count = Number(prompt("Kaç kupon oluşturulsun? Örn. 20") || "0");
    if (!count) return;

    setLoading(true);

    try {
      const defs = Array.from({ length: count }).map(() => createDefinition(title || "Kampanya"));

      await saveCouponsToDb(defs, false, {
        serverGenerateCodes: true,
        codePrefix,
      });
      await loadFromDb();

      alert("Kuponlar oluşturuldu.");
    } catch (error: any) {
      alert(`Kuponlar kaydedilemedi: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const scheduleBulk = async () => {
    const id = selectedCouponId || coupons[0]?.id;
    const def = coupons.find((coupon) => coupon.id === id);

    if (!def) {
      alert("Lütfen önce bir kupon seç.");
      return;
    }

    const count = Number(prompt("Kaç kupon dağıtılsın? Örn. 20") || "0");
    if (!count) return;

    const days = Number(prompt("Kaç gün içine dağıtılsın? Örn. 7") || "7");
    if (!days) return;

    const expires = Number(prompt("Kaç gün geçerli olsun? Örn. 7") || "7");
    const now = Date.now();
    const step = Math.max(1, Math.floor((days * 24 * 3600 * 1000) / count));

    setLoading(true);

    try {
      for (let i = 0; i < count; i += 1) {
        const issuedAt = now + i * step;
        await issueCouponOnServer({
          couponId: def.id,
          issuedAt,
          expiresAt: issuedAt + expires * 24 * 3600 * 1000,
          source: "bulk_campaign",
          note: "scheduled",
        });
      }
      await loadFromDb();

      alert("Dağıtım planlandı.");
    } catch (error: any) {
      alert(`Dağıtım kaydedilemedi: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const issueToPhone = async () => {
    const id = selectedCouponId || coupons[0]?.id;
    const def = coupons.find((coupon) => coupon.id === id);

    if (!def) {
      alert("Lütfen önce bir kupon seç.");
      return;
    }

    const phone = prompt("Telefon numarası, örn. 491234567890") || "";
    if (!phone) return;

    const days = Number(prompt("Kaç gün geçerli olsun? Örn. 14") || "14");
    const now = Date.now();

    setLoading(true);

    try {
      await issueCouponOnServer({
        couponId: def.id,
        phone: normalizePhone(phone),
        issuedAt: now,
        expiresAt: now + days * 24 * 3600 * 1000,
        source: "manual",
      });
      await loadFromDb();

      alert("Kupon telefona atandı.");
    } catch (error: any) {
      alert(`Kupon atanamadı: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const delCoupon = async (coupon: Coupons.CouponDef) => {
    if (!confirm("Bu kuponu gerçekten silmek istiyor musun?")) return;

    setLoading(true);

    try {
      await deleteCouponFromDb(coupon);
      await loadFromDb();
    } catch (error: any) {
      alert(`Kupon silinemedi: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const delIssued = async (item: Coupons.IssuedCoupon) => {
    if (!confirm("Bu atanmış kuponu gerçekten silmek istiyor musun?")) return;

    setLoading(true);

    try {
      await deleteIssuedFromDb(item);
      await loadFromDb();
    } catch (error: any) {
      alert(`Atanmış kupon silinemedi: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
    }
  };

  const exportAll = () => {
    const text = JSON.stringify(
      {
        coupons,
        issued,
      },
      null,
      2,
    );

    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "coupons_export.json";
    a.click();

    URL.revokeObjectURL(url);
  };

  const importAll = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = parseJson(text);

      const defsRaw = Array.isArray(parsed?.coupons)
        ? parsed.coupons
        : Array.isArray(parsed?.items)
          ? parsed.items
          : [];

      const issuedRaw = Array.isArray(parsed?.issued) ? parsed.issued : [];

      const defs = defsRaw.map(mapDbCoupon).filter(Boolean) as Coupons.CouponDef[];
      const iss = issuedRaw.map(mapDbIssued).filter(Boolean) as Coupons.IssuedCoupon[];

      if (!defs.length && !iss.length) {
        alert("İçe aktarma başarısız.");
        event.target.value = "";
        return;
      }

      setLoading(true);

      if (defs.length) {
        await saveCouponsToDb(defs, true, { manualCode: true });
      }

      if (iss.length) {
        await saveIssuedToDb(iss, defs.length ? defs : coupons, true);
      }

      await loadFromDb();

      alert("İçe aktarma başarılı.");
    } catch (error: any) {
      alert(`İçe aktarma başarısız: ${error?.message || "DB hatası"}`);
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const filteredCoupons = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return coupons;

    return coupons.filter((coupon) =>
      `${coupon.code} ${coupon.title || ""}`.toLowerCase().includes(text),
    );
  }, [coupons, filter]);

  const filteredIssued = useMemo(() => {
    const text = filter.trim().toLowerCase();
    if (!text) return issued;

    return issued.filter((item) => {
      const def = coupons.find((coupon) => coupon.id === item.couponId);
      const haystack = [
        item.code,
        item.assignedToPhone,
        item.assignedToEmail,
        item.source,
        item.note,
        def?.code,
        def?.title,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(text);
    });
  }, [issued, coupons, filter]);

  const overallStats = useMemo(() => {
    const used = issued.filter((item) => item.used).length;
    const ready = issued.filter((item) => getIssuedStatus(item).label === "Hazır").length;
    const scheduled = issued.filter((item) => getIssuedStatus(item).label === "Planlandı").length;
    const expired = issued.filter((item) => getIssuedStatus(item).label === "Süresi doldu").length;
    const cancelled = issued.filter((item) => getIssuedStatus(item).label === "İptal edildi").length;

    return {
      definitions: coupons.length,
      assigned: issued.length,
      used,
      ready,
      scheduled,
      expired,
      cancelled,
    };
  }, [coupons.length, issued]);

  const addRule = (kind: GUIRule["kind"]) =>
    setRules((current) => [
      {
        id: uuid(),
        kind,
        n: 10,
        minTotal: 20,
        expiresDays: 7,
      },
      ...current,
    ]);

  const updRule = (id: string, patch: Partial<GUIRule>) =>
    setRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );

  const rmRule = (id: string) =>
    setRules((current) => current.filter((rule) => rule.id !== id));

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-semibold">Kuponlar</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex items-center gap-2 text-xs text-stone-400">
          <span>Veri kaynağı: {source === "db" ? "DB" : source === "cache" ? "Önbellek" : "Boş"}</span>
          {loading && <span>· Yükleniyor…</span>}
          <button className="btn-ghost" onClick={loadFromDb} disabled={loading}>
            Yenile
          </button>
        </div>
      </div>

      {source === "cache" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          DB şu anda erişilebilir değil. Gösterilen kuponlar sadece bu cihazdaki önbellekten geliyor.
          Değişiklikler DB tekrar erişilebilir olduğunda kaydedilebilir.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <InfoLine label="Kupon tanımı" value={overallStats.definitions} />
        <InfoLine label="Atanmış kod" value={overallStats.assigned} />
        <InfoLine label="Hazır" value={overallStats.ready} />
        <InfoLine label="Kullanıldı" value={overallStats.used} />
        <InfoLine label="Planlandı" value={overallStats.scheduled} />
        <InfoLine label="Süresi doldu / iptal" value={overallStats.expired + overallStats.cancelled} />
      </div>

      <div className="card grid gap-4 p-3 sm:p-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,0.95fr)]">
        <section className="space-y-4 rounded-2xl border border-stone-700/60 bg-stone-950/25 p-3">
          <div>
            <div className="text-lg font-semibold">Yeni kupon oluştur</div>
            <p className="mt-1 text-xs leading-relaxed text-stone-400">
              Burada kuponun ana kuralını oluşturuyorsun. Müşteriye atayınca sağdaki
              “Atanmış kuponlar” bölümünde ayrı kod olarak görünür.
            </p>
          </div>

          <FieldBlock label="Kupon başlığı" hint="Admin ekranında ve açıklamalarda görünür. Boş kalırsa sadece kod görünür.">
            <input
              className="w-full rounded-md bg-stone-800/60 p-2"
              placeholder="Örn. Haftalık 10% indirim"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FieldBlock>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldBlock label="Kupon tipi">
              <select
                value={type}
                onChange={(event) => setType(event.target.value as Coupons.CouponType)}
                className="w-full rounded-md bg-stone-800/60 p-2"
              >
                <option value="fixed">Sabit tutar (€)</option>
                <option value="percent">Yüzde (%)</option>
                <option value="free_item">Bedava ürün</option>
                <option value="bogo">2 al, 1 bedava</option>
              </select>
            </FieldBlock>

            <FieldBlock
              label={type === "percent" ? "İndirim yüzdesi" : type === "fixed" ? "İndirim tutarı (€)" : "Değer"}
              hint={type === "percent" ? "Örn. 10 = %10 indirim." : type === "fixed" ? "Örn. 5 = 5€ indirim." : undefined}
            >
              <input
                type="number"
                className="w-full rounded-md bg-stone-800/60 p-2"
                value={value}
                onChange={(event) => setValue(toNumber(event.target.value, 0))}
              />
            </FieldBlock>
          </div>

          {type === "free_item" && (
            <FieldBlock label="Bedava ürün adı" hint="Müşteriye gösterilecek ücretsiz ürün açıklaması.">
              <input
                className="w-full rounded-md bg-stone-800/60 p-2"
                placeholder="Örn. 1x içecek"
                value={freeItemName}
                onChange={(event) => setFreeItemName(event.target.value)}
              />
            </FieldBlock>
          )}

          {type === "bogo" && (
            <div className="space-y-3 rounded-2xl border border-stone-700/60 bg-stone-950/35 p-3">
              <div>
                <div className="text-sm font-semibold">2 al 1 bedava ayarları</div>
                <p className="mt-1 text-xs text-stone-400">
                  Hangi ürün/kategori eşleşirse bedava kuralı çalışacağını seçiyorsun.
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-[130px_1fr]">
                <FieldBlock label="Eşleşme tipi">
                  <select
                    className="w-full rounded-md bg-stone-800/60 p-2"
                    value={bogoMatchBy}
                    onChange={(event) => setBogoMatchBy(event.target.value as any)}
                  >
                    <option value="name">Ad</option>
                    <option value="sku">SKU</option>
                    <option value="category">Kategori</option>
                  </select>
                </FieldBlock>

                <FieldBlock label="Eşleşme değeri" hint="Örn. Big Daddy, burger, drinks gibi.">
                  <input
                    className="w-full rounded-md bg-stone-800/60 p-2"
                    placeholder="Örn. Big Daddy"
                    value={bogoMatchValue}
                    onChange={(event) => setBogoMatchValue(event.target.value)}
                  />
                </FieldBlock>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <FieldBlock label="Kaç adet alınacak?">
                  <input
                    type="number"
                    className="w-full rounded-md bg-stone-800/60 p-2"
                    value={bogoBuy}
                    onChange={(event) => setBogoBuy(Math.max(1, Number(event.target.value) || 1))}
                  />
                </FieldBlock>

                <FieldBlock label="Kaç adet bedava?">
                  <input
                    type="number"
                    className="w-full rounded-md bg-stone-800/60 p-2"
                    value={bogoFree}
                    onChange={(event) => setBogoFree(Math.max(1, Number(event.target.value) || 1))}
                  />
                </FieldBlock>

                <FieldBlock label="Maks. bedava">
                  <input
                    type="number"
                    className="w-full rounded-md bg-stone-800/60 p-2"
                    placeholder="Opsiyonel"
                    value={bogoMaxFree}
                    onChange={(event) =>
                      setBogoMaxFree(event.target.value === "" ? "" : Number(event.target.value))
                    }
                  />
                </FieldBlock>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <FieldBlock label="Minimum sepet (€)" hint="Boşsa minimum şart aranmaz.">
              <input
                className="w-full rounded-md bg-stone-800/60 p-2"
                placeholder="Örn. 20"
                value={minCart}
                onChange={(event) => setMinCart(event.target.value === "" ? "" : Number(event.target.value))}
              />
            </FieldBlock>

            <FieldBlock label="Geçerlilik (gün)" hint="Buradaki 7 = kupon 7 gün geçerli olur.">
              <input
                className="w-full rounded-md bg-stone-800/60 p-2"
                placeholder="Örn. 7"
                value={validDays}
                onChange={(event) => setValidDays(event.target.value === "" ? "" : Number(event.target.value))}
              />
            </FieldBlock>

            <FieldBlock label="Müşteri kullanım limiti" hint="Örn. 1 yazarsan müşteri bu kuponu 1 kez kullanır.">
              <input
                className="w-full rounded-md bg-stone-800/60 p-2"
                placeholder="Opsiyonel"
                value={perCust}
                onChange={(event) => setPerCust(event.target.value === "" ? "" : Number(event.target.value))}
              />
            </FieldBlock>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={uniquePerIssue}
              onChange={(event) => setUniquePerIssue(event.target.checked)}
            />
            <span>
              <b>Her atamada tek kullanımlık kod üret</b>
              <span className="mt-1 block text-xs text-stone-400">
                Önerilen ayar budur. Her müşteriye ayrı kod verir; biri kullandıysa tekrar kullanamaz.
              </span>
            </span>
          </label>

          <div className="space-y-3 rounded-2xl border border-stone-700/60 bg-stone-950/35 p-3">
            <div>
              <div className="text-sm font-semibold">Kötüye kullanım koruması</div>
              <p className="mt-1 text-xs text-stone-400">
                Aynı müşteriye çok sık kupon atanmasını engellemek için kullanılır.
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={singlePerCustomer}
                onChange={(event) => setSinglePerCustomer(event.target.checked)}
              />
              <span>
                Bu kuponu müşteri başına <b>en fazla 1 kez</b> ata
              </span>
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <FieldBlock label="7 günde maksimum atama" hint="Örn. 2 = aynı müşteriye haftada en fazla 2 kupon.">
                <input
                  className="w-full rounded-md bg-stone-800/60 p-2"
                  placeholder="Opsiyonel"
                  value={capPerWeek}
                  onChange={(event) => setCapPerWeek(event.target.value === "" ? "" : Number(event.target.value))}
                />
              </FieldBlock>

              <FieldBlock label="Bekleme süresi (gün)" hint="Örn. 3 = aynı müşteriye tekrar atamadan önce 3 gün bekler.">
                <input
                  className="w-full rounded-md bg-stone-800/60 p-2"
                  placeholder="Opsiyonel"
                  value={cooldownDays}
                  onChange={(event) => setCooldownDays(event.target.value === "" ? "" : Number(event.target.value))}
                />
              </FieldBlock>
            </div>
          </div>

          <FieldBlock label="Müşteriye gösterilecek açıklama">
            <textarea
              className="w-full rounded-md bg-stone-800/60 p-2"
              rows={3}
              placeholder="Örn. Bu hafta sana özel %10 indirim!"
              value={aboutText}
              onChange={(event) => setAboutText(event.target.value)}
            />
          </FieldBlock>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            <FieldBlock label="Kod ön eki" hint="Örn. BB yazarsan kod BB-XXXX şeklinde oluşur.">
              <input
                className="w-full rounded-md bg-stone-800/60 p-2"
                placeholder="BB"
                value={codePrefix}
                onChange={(event) => setCodePrefix(event.target.value)}
              />
            </FieldBlock>

            <button className="card-cta self-end" onClick={create} disabled={loading}>
              Oluştur
            </button>

            <button className="btn-ghost self-end" onClick={bulkRandom} disabled={loading}>
              Toplu oluştur
            </button>
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-stone-700/60 bg-stone-950/25 p-3">
          <div>
            <div className="text-lg font-semibold">Otomatik ödül kuralları</div>
            <p className="mt-1 text-xs leading-relaxed text-stone-400">
              Bu bölüm ileride müşteri sipariş sayısına veya sepet tutarına göre otomatik
              kupon dağıtımı için. Kural yoksa otomatik dağıtım yapılmaz.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button className="btn-ghost" onClick={() => addRule("nth_order")}>
              + N. siparişte kupon ver
            </button>

            <button className="btn-ghost" onClick={() => addRule("spent_total")}>
              + Sepet tutarı ≥ X € olunca ver
            </button>
          </div>

          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-stone-700/60 bg-stone-900/40 p-3">
                {rule.kind === "nth_order" ? (
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <FieldBlock label="Kaçıncı siparişte?">
                      <input
                        type="number"
                        className="w-full rounded-md bg-stone-800/60 p-2"
                        value={rule.n || 10}
                        onChange={(event) => updRule(rule.id, { n: Number(event.target.value) })}
                      />
                    </FieldBlock>

                    <FieldBlock label="Kaç gün geçerli?">
                      <input
                        type="number"
                        className="w-full rounded-md bg-stone-800/60 p-2"
                        value={rule.expiresDays || 7}
                        onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                      />
                    </FieldBlock>

                    <button className="btn-ghost self-end" onClick={() => rmRule(rule.id)}>
                      Sil
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <FieldBlock label="Minimum sepet tutarı (€)">
                      <input
                        type="number"
                        className="w-full rounded-md bg-stone-800/60 p-2"
                        value={rule.minTotal || 20}
                        onChange={(event) => updRule(rule.id, { minTotal: Number(event.target.value) })}
                      />
                    </FieldBlock>

                    <FieldBlock label="Kaç gün geçerli?">
                      <input
                        type="number"
                        className="w-full rounded-md bg-stone-800/60 p-2"
                        value={rule.expiresDays || 7}
                        onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                      />
                    </FieldBlock>

                    <button className="btn-ghost self-end" onClick={() => rmRule(rule.id)}>
                      Sil
                    </button>
                  </div>
                )}
              </div>
            ))}

            {rules.length === 0 && (
              <div className="rounded-2xl border border-stone-700/60 bg-stone-900/40 p-3 text-sm text-stone-400">
                Şu an otomatik kural yok. Kuponlar sadece manuel veya toplu işlemle atanır.
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-stone-700/60 bg-stone-950/25 p-3">
          <div>
            <div className="text-lg font-semibold">Hızlı işlemler</div>
            <p className="mt-1 text-xs leading-relaxed text-stone-400">
              Oluşturduğun kuponu seçip telefona atayabilir veya toplu dağıtım planı yapabilirsin.
            </p>
          </div>

          <FieldBlock label="İşlem yapılacak kupon">
            <select
              className="w-full rounded-md bg-stone-800/60 p-2"
              value={selectedCouponId}
              onChange={(event) => setSelectedCouponId(event.target.value)}
            >
              <option value="">— Kupon seç —</option>
              {coupons.map((coupon) => {
                const stats = getCouponUsageStats(coupon, issued);

                return (
                  <option key={coupon.id} value={coupon.id}>
                    {coupon.code} — {coupon.title || "Başlıksız"} · Atanmış {stats.totalAssigned} / Kullanıldı {stats.used}
                  </option>
                );
              })}
            </select>
          </FieldBlock>

          <div className="grid gap-2 sm:grid-cols-2">
            <button className="btn-ghost" onClick={issueToPhone} disabled={!coupons.length || loading}>
              Telefona kupon ata
            </button>

            <button className="btn-ghost" onClick={scheduleBulk} disabled={!coupons.length || loading}>
              Toplu dağıtımı planla
            </button>
          </div>

          <div className="rounded-2xl border border-sky-400/25 bg-sky-500/10 p-3 text-xs leading-relaxed text-sky-100">
            <b>Toplu dağıtımı planla</b>: Seçili kupondan istediğin sayıda kod üretir ve
            belirlediğin gün aralığına yayar. Örneğin “20 kuponu 7 güne yay” dersen sistem
            kodları 7 gün içine planlar.
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              İçe / dışa aktarma
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button className="btn-ghost" onClick={exportAll}>
                JSON dışa aktar
              </button>

              <label className="btn-ghost cursor-pointer text-center">
                JSON içe aktar
                <input type="file" accept="application/json" hidden onChange={importAll} />
              </label>
            </div>
          </div>

          <FieldBlock label="Kupon / telefon / kod ara">
            <input
              className="w-full rounded-md bg-stone-800/60 p-2"
              placeholder="Kod, başlık veya telefon yaz..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </FieldBlock>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="card p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-lg font-semibold">Kupon tanımları</div>
              <p className="text-xs text-stone-400">
                Sol taraf ana kupon kurallarıdır. Altında bu kupondan kaç kod atandığı ve kaçının kullanıldığı görünür.
              </p>
            </div>

            <div className="text-xs text-stone-500">{filteredCoupons.length} kayıt</div>
          </div>

          <div className="space-y-3">
            {filteredCoupons.map((coupon) => {
              const stats = getCouponUsageStats(coupon, issued);

              return (
                <div key={coupon.id} className="rounded-2xl border border-stone-700/60 bg-stone-950/25 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="break-all text-base font-bold text-stone-100">{coupon.code}</div>
                        <span className="rounded-full border border-stone-600/70 bg-stone-800/70 px-2 py-0.5 text-[11px] text-stone-300">
                          {couponTypeLabel(coupon.type)}
                        </span>
                        {coupon.meta?.uniquePerIssue && (
                          <span className="rounded-full border border-amber-400/50 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100">
                            Tek kullanımlık kod
                          </span>
                        )}
                      </div>

                      <div className="mt-1 text-sm text-stone-300">
                        {coupon.title || "Başlıksız kupon"}
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        <InfoLine label="Atanmış" value={stats.totalAssigned} />
                        <InfoLine label="Hazır" value={stats.ready} />
                        <InfoLine label="Kullanıldı" value={stats.used} />
                        <InfoLine label="Planlı" value={stats.scheduled} />
                        <InfoLine
                          label={stats.maxUses != null ? "Kalan limit" : "Süresi doldu / iptal"}
                          value={
                            stats.maxUses != null
                              ? stats.remainingByMax
                              : stats.expired + stats.cancelled
                          }
                        />
                      </div>

                      <div className="mt-3 text-xs leading-relaxed text-stone-300">
                        <div>
                          <b>Değer:</b>{" "}
                          {coupon.type === "percent" ? `%${coupon.value}` : `€${coupon.value.toFixed(2)}`}
                          {" · "}
                          <b>Minimum:</b> {coupon.minCartTotal ? fmtMoney(coupon.minCartTotal) : "Yok"}
                          {" · "}
                          <b>Müşteri limiti:</b> {coupon.perCustomerLimit || "Yok"}
                        </div>

                        {!!(
                          coupon.meta?.singlePerCustomer ||
                          coupon.meta?.issueCapPerWeek ||
                          coupon.meta?.issueCooldownDays
                        ) && (
                          <div className="mt-1">
                            <b>Koruma:</b>{" "}
                            {coupon.meta?.singlePerCustomer ? "1x/müşteri" : "—"}
                            {coupon.meta?.issueCapPerWeek ? ` · 7 günde en fazla ${coupon.meta.issueCapPerWeek}` : ""}
                            {coupon.meta?.issueCooldownDays ? ` · ${coupon.meta.issueCooldownDays} gün bekleme` : ""}
                          </div>
                        )}

                        <div className="mt-1">
                          <b>Geçerlilik:</b> {fmtDT(coupon.validFrom)} → {fmtDT(coupon.validUntil)}
                        </div>
                      </div>

                      <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-stone-800/70 bg-black/20 p-2 text-xs leading-relaxed text-stone-400">
                        {describeCouponTr(coupon)}
                      </pre>
                    </div>

                    <div className="flex shrink-0 flex-row gap-2 lg:flex-col">
                      <button
                        className="btn-ghost flex-1 lg:flex-none"
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(coupon.code);
                          alert("Kod kopyalandı.");
                        }}
                      >
                        Kodu kopyala
                      </button>

                      <button className="btn-ghost flex-1 lg:flex-none" type="button" onClick={() => delCoupon(coupon)}>
                        Sil
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredCoupons.length && (
              <div className="rounded-2xl border border-stone-700/60 bg-stone-950/25 p-4 text-sm text-stone-400">
                Kayıt yok.
              </div>
            )}
          </div>
        </section>

        <section className="card p-3 sm:p-4">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-lg font-semibold">Atanmış kuponlar</div>
              <p className="text-xs text-stone-400">
                Sağ taraf müşteriye veya kampanyaya dağıtılan gerçek kodlardır. Kullanıldıysa durum burada görünür.
              </p>
            </div>

            <div className="text-xs text-stone-500">{filteredIssued.length} kayıt</div>
          </div>

          <div className="max-h-[32rem] space-y-3 overflow-auto pr-1">
            {filteredIssued.map((item) => {
              const def = coupons.find((coupon) => coupon.id === item.couponId);
              const status = getIssuedStatus(item);

              return (
                <div key={item.id} className="rounded-2xl border border-stone-700/60 bg-stone-950/25 p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="break-all text-base font-bold text-stone-100">{item.code}</div>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </div>

                      <div className="mt-1 text-sm text-stone-300">
                        {def?.title || def?.code || "Kupon tanımı bulunamadı"}{" "}
                        <span className="text-stone-500">— {sourceLabel(item.source)}</span>
                      </div>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <InfoLine
                          label="Müşteri telefonu"
                          value={item.assignedToPhone || "Genel / telefona bağlı değil"}
                        />
                        <InfoLine label="Durum açıklaması" value={status.helper} />
                        <InfoLine label="Atanma zamanı" value={fmtDT(item.issuedAt)} />
                        <InfoLine label="Son geçerlilik" value={fmtDT(item.expiresAt)} />
                      </div>

                      {item.used && (
                        <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-2 text-xs text-emerald-100">
                          Bu kupon kullanıldı. Tekrar kullanılmamalı; checkout ve backend bunu engeller.
                        </div>
                      )}

                      {def && (
                        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-stone-800/70 bg-black/20 p-2 text-xs leading-relaxed text-stone-400">
                          {describeCouponTr(def, item)}
                        </pre>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-row gap-2 lg:flex-col">
                      <button
                        className="btn-ghost flex-1 lg:flex-none"
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(item.code);
                          alert("Kod kopyalandı.");
                        }}
                      >
                        Kodu kopyala
                      </button>

                      <button className="btn-ghost flex-1 lg:flex-none" type="button" onClick={() => delIssued(item)}>
                        Sil
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {!filteredIssued.length && (
              <div className="rounded-2xl border border-stone-700/60 bg-stone-950/25 p-4 text-sm text-stone-400">
                Kayıt yok.
              </div>
            )}
          </div>
        </section>
      </div>

    </main>
  );
}