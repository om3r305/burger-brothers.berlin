"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Coupons from "@/lib/coupons";

const API_COUPONS = "/api/admin/coupons";
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

const uuid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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

function makeCouponCode(prefix: string) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const cleanPrefix = normalizeCode(prefix || "BB").slice(0, 8) || "BB";

  const body = Array.from({ length: 8 })
    .map(() => chars[Math.floor(Math.random() * chars.length)])
    .join("");

  return `${cleanPrefix}-${body}`;
}

function makeIssuedCode(def: Coupons.CouponDef, existing: Coupons.IssuedCoupon[]) {
  if (!def.meta?.uniquePerIssue) return normalizeCode(def.code);

  const prefix = (normalizeCode(def.code).split("-")[0] || "BB").slice(0, 8);
  const used = new Set(existing.map((item) => normalizeCode(item.code)));

  for (let i = 0; i < 250; i += 1) {
    const code = makeCouponCode(prefix);
    if (!used.has(code)) return code;
  }

  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
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

async function saveCouponsToDb(defs: Coupons.CouponDef[], replace = false) {
  return postJson(API_COUPONS, {
    kind: "coupons",
    replace,
    items: defs.map((def) => ({
      id: def.id,
      code: normalizeCode(def.code),
      definition: {
        ...def,
        code: normalizeCode(def.code),
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
      code: makeCouponCode(codePrefix),
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

      await saveCouponsToDb([def], false);
      resetCreateForm();
      await loadFromDb();

      alert(`Kupon oluşturuldu: ${def.code}`);
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

      await saveCouponsToDb(defs, false);
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

    const nextIssued: Coupons.IssuedCoupon[] = [];

    for (let i = 0; i < count; i += 1) {
      const issuedAt = now + i * step;

      nextIssued.push({
        id: uuid(),
        couponId: def.id,
        code: makeIssuedCode(def, [...issued, ...nextIssued]),
        assignedToPhone: undefined,
        assignedToEmail: undefined,
        issuedAt,
        expiresAt: issuedAt + expires * 24 * 3600 * 1000,
        used: false,
        usedAt: undefined,
        source: "bulk_campaign",
        note: "scheduled",
      });
    }

    setLoading(true);

    try {
      await saveIssuedToDb(nextIssued, coupons, false);
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

    const item: Coupons.IssuedCoupon = {
      id: uuid(),
      couponId: def.id,
      code: makeIssuedCode(def, issued),
      assignedToPhone: normalizePhone(phone),
      assignedToEmail: undefined,
      issuedAt: now,
      expiresAt: now + days * 24 * 3600 * 1000,
      used: false,
      usedAt: undefined,
      source: "manual",
      note: undefined,
    };

    setLoading(true);

    try {
      await saveIssuedToDb([item], coupons, false);
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
        await saveCouponsToDb(defs, true);
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

      <div className="card grid gap-4 p-3 sm:p-4 lg:grid-cols-3">
        <div>
          <div className="mb-2 font-medium">Yeni kupon oluştur</div>

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Başlık"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="mb-2 flex gap-2">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as Coupons.CouponType)}
              className="rounded-md bg-stone-800/60 p-2"
            >
              <option value="fixed">Sabit tutar (€)</option>
              <option value="percent">Yüzde (%)</option>
              <option value="free_item">Bedava ürün</option>
              <option value="bogo">2 al, 1 bedava</option>
            </select>

            <input
              type="number"
              className="w-28 rounded-md bg-stone-800/60 p-2"
              value={value}
              onChange={(event) => setValue(toNumber(event.target.value, 0))}
            />
          </div>

          {type === "free_item" && (
            <input
              className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
              placeholder="Ürün adı, örn. 2x içecek"
              value={freeItemName}
              onChange={(event) => setFreeItemName(event.target.value)}
            />
          )}

          {type === "bogo" && (
            <div className="mb-2 space-y-2 rounded border border-stone-700/60 p-2">
              <div className="text-sm font-medium">2 al 1 bedava ayarları</div>

              <div className="flex gap-2">
                <select
                  className="rounded-md bg-stone-800/60 p-2"
                  value={bogoMatchBy}
                  onChange={(event) => setBogoMatchBy(event.target.value as any)}
                >
                  <option value="name">Ad</option>
                  <option value="sku">SKU</option>
                  <option value="category">Kategori</option>
                </select>

                <input
                  className="flex-1 rounded-md bg-stone-800/60 p-2"
                  placeholder="Değer, örn. Big Daddy"
                  value={bogoMatchValue}
                  onChange={(event) => setBogoMatchValue(event.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <input
                  type="number"
                  className="w-24 rounded-md bg-stone-800/60 p-2"
                  value={bogoBuy}
                  onChange={(event) => setBogoBuy(Math.max(1, Number(event.target.value) || 1))}
                />

                <span className="self-center text-sm">al →</span>

                <input
                  type="number"
                  className="w-24 rounded-md bg-stone-800/60 p-2"
                  value={bogoFree}
                  onChange={(event) => setBogoFree(Math.max(1, Number(event.target.value) || 1))}
                />

                <span className="self-center text-sm">bedava</span>

                <input
                  type="number"
                  className="w-36 rounded-md bg-stone-800/60 p-2"
                  placeholder="Maks. bedava"
                  value={bogoMaxFree}
                  onChange={(event) =>
                    setBogoMaxFree(event.target.value === "" ? "" : Number(event.target.value))
                  }
                />
              </div>
            </div>
          )}

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Minimum sepet tutarı, örn. 20"
            value={minCart}
            onChange={(event) => setMinCart(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Geçerlilik süresi (gün), örn. 7"
            value={validDays}
            onChange={(event) => setValidDays(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Müşteri başı kullanım limiti"
            value={perCust}
            onChange={(event) => setPerCust(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={uniquePerIssue}
              onChange={(event) => setUniquePerIssue(event.target.checked)}
            />
            Her atamada <b>tek kullanımlık kod</b> üret
          </label>

          <div className="mb-2 rounded border border-stone-700/60 p-2">
            <div className="mb-1 text-sm font-medium">Kötüye kullanım koruması</div>

            <label className="mb-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={singlePerCustomer}
                onChange={(event) => setSinglePerCustomer(event.target.checked)}
              />
              Bu kuponu müşteri başına <b>en fazla 1 kez</b> ata
            </label>

            <div className="mb-1 flex gap-2">
              <input
                className="w-40 rounded-md bg-stone-800/60 p-2"
                placeholder="7 günde maks."
                value={capPerWeek}
                onChange={(event) => setCapPerWeek(event.target.value === "" ? "" : Number(event.target.value))}
              />

              <input
                className="w-48 rounded-md bg-stone-800/60 p-2"
                placeholder="Bekleme süresi (gün)"
                value={cooldownDays}
                onChange={(event) => setCooldownDays(event.target.value === "" ? "" : Number(event.target.value))}
              />
            </div>

            <div className="text-xs opacity-70">
              Örnek: haftada en fazla 2 kupon ve arada en az 3 gün bekleme.
            </div>
          </div>

          <textarea
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            rows={2}
            placeholder="Açıklama veya müşteriye gösterilecek metin"
            value={aboutText}
            onChange={(event) => setAboutText(event.target.value)}
          />

          <div className="mb-2 flex flex-wrap gap-2">
            <input
              className="rounded-md bg-stone-800/60 p-2"
              placeholder="Kod ön eki, örn. BB"
              value={codePrefix}
              onChange={(event) => setCodePrefix(event.target.value)}
            />

            <button className="card-cta" onClick={create} disabled={loading}>
              Oluştur
            </button>

            <button className="btn-ghost" onClick={bulkRandom} disabled={loading}>
              Toplu oluştur
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium">Otomatik ödül kuralları</div>

          <div className="mb-2 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => addRule("nth_order")}>
              + N. siparişte
            </button>

            <button className="btn-ghost" onClick={() => addRule("spent_total")}>
              + Sepet tutarı ≥ X €
            </button>
          </div>

          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded border border-stone-700/60 p-2">
                {rule.kind === "nth_order" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">N. sipariş:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.n || 10}
                      onChange={(event) => updRule(rule.id, { n: Number(event.target.value) })}
                    />

                    <span className="text-sm">Geçerlilik:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.expiresDays || 7}
                      onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                    />

                    <button className="btn-ghost ml-auto" onClick={() => rmRule(rule.id)}>
                      Sil
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Minimum tutar (€):</span>

                    <input
                      type="number"
                      className="w-24 rounded-md bg-stone-800/60 p-1"
                      value={rule.minTotal || 20}
                      onChange={(event) => updRule(rule.id, { minTotal: Number(event.target.value) })}
                    />

                    <span className="text-sm">Geçerlilik:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.expiresDays || 7}
                      onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                    />

                    <button className="btn-ghost ml-auto" onClick={() => rmRule(rule.id)}>
                      Sil
                    </button>
                  </div>
                )}
              </div>
            ))}

            {rules.length === 0 && (
              <div className="text-sm opacity-70">
                Kural yoksa otomatik dağıtım yapılmaz.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium">Hızlı işlemler</div>

          <select
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            value={selectedCouponId}
            onChange={(event) => setSelectedCouponId(event.target.value)}
          >
            <option value="">— Kupon seç —</option>
            {coupons.map((coupon) => (
              <option key={coupon.id} value={coupon.id}>
                {coupon.code} — {coupon.title}
              </option>
            ))}
          </select>

          <div className="mb-2 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={issueToPhone} disabled={!coupons.length || loading}>
              Telefona ata
            </button>

            <button className="btn-ghost" onClick={scheduleBulk} disabled={!coupons.length || loading}>
              7 güne yay
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1 text-xs opacity-70">İçe / dışa aktarma</div>

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={exportAll}>
                JSON exportieren
              </button>

              <label className="btn-ghost cursor-pointer">
                İçe aktar
                <input type="file" accept="application/json" hidden onChange={importAll} />
              </label>
            </div>
          </div>

          <div className="mt-4">
            <input
              className="w-full rounded-md bg-stone-800/60 p-2"
              placeholder="Kupon ara..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 font-medium">Kupon tanımları</div>

          <div className="space-y-2">
            {filteredCoupons.map((coupon) => (
              <div key={coupon.id} className="rounded border border-stone-700/60 p-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {coupon.code} <span className="opacity-70">— {coupon.title || "—"}</span>
                    </div>

                    <div className="text-xs opacity-80">
                      Tür: {couponTypeLabel(coupon.type)}
                      {" • "}Değer:{" "}
                      {coupon.type === "percent" ? `${coupon.value}%` : `€${coupon.value.toFixed(2)}`}
                      {" • "}Minimum: {coupon.minCartTotal ?? "—"}
                      {" • "}Tekil kod: {coupon.meta?.uniquePerIssue ? "✓" : "—"}
                    </div>

                    {!!(
                      coupon.meta?.singlePerCustomer ||
                      coupon.meta?.issueCapPerWeek ||
                      coupon.meta?.issueCooldownDays
                    ) && (
                      <div className="mt-1 text-xs opacity-80">
                        Koruma: {coupon.meta?.singlePerCustomer ? "1x/müşteri" : ""}
                        {coupon.meta?.issueCapPerWeek ? `, 7T≤${coupon.meta.issueCapPerWeek}` : ""}
                        {coupon.meta?.issueCooldownDays ? `, ${coupon.meta.issueCooldownDays}T Pause` : ""}
                      </div>
                    )}

                    <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">
                      {describeCouponTr(coupon)}
                    </pre>

                    <div className="mt-1 text-xs opacity-60">
                      Geçerlilik: {fmtDT(coupon.validFrom)} → {fmtDT(coupon.validUntil)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(coupon.code);
                        alert("Kod kopyalandı.");
                      }}
                    >
                      Code kopieren
                    </button>

                    <button className="btn-ghost" type="button" onClick={() => delCoupon(coupon)}>
                      Sil
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!filteredCoupons.length && (
              <div className="text-sm opacity-70">Kayıt yok.</div>
            )}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 font-medium">Atanmış kuponlar</div>

          <div className="max-h-96 space-y-2 overflow-auto pr-1">
            {issued.map((item) => (
              <div key={item.id} className="rounded border border-stone-700/60 p-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {item.code} <span className="opacity-70">— {item.source || "—"}</span>
                    </div>

                    <div className="text-xs opacity-70">
                      {item.assignedToPhone ? `Telefon: ${item.assignedToPhone}` : "Genel"} • Durum:{" "}
                      {item.note === "scheduled"
                        ? "Planlandı"
                        : item.note === "cancelled"
                          ? "İptal edildi"
                          : "Hazır"}
                    </div>

                    <div className="text-xs opacity-70">
                      Atanma: {fmtDT(item.issuedAt)} • Geçerli son tarih: {fmtDT(item.expiresAt)}
                    </div>

                    <div className="text-xs opacity-70">
                      Kullanıldı: {item.used ? fmtDT(item.usedAt) : "Hayır"}
                    </div>

                    {(() => {
                      const def = coupons.find((coupon) => coupon.id === item.couponId);
                      if (!def) return null;

                      return (
                        <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">
                          {describeCouponTr(def, item)}
                        </pre>
                      );
                    })()}
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(item.code);
                        alert("Kod kopyalandı.");
                      }}
                    >
                      Code kopieren
                    </button>

                    <button className="btn-ghost" type="button" onClick={() => delIssued(item)}>
                      Sil
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!issued.length && (
              <div className="text-sm opacity-70">Kayıt yok.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}