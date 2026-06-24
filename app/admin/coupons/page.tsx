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
  return Number.isFinite(date.valueOf()) ? date.toLocaleString("de-DE") : "—";
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
      freeItemName: type === "free_item" ? freeItemName || "Artikel" : undefined,
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

      alert(`Gutschein wurde erstellt: ${def.code}`);
    } catch (error: any) {
      alert(`Gutschein konnte nicht gespeichert werden: ${error?.message || "DB Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  const bulkRandom = async () => {
    const count = Number(prompt("Wie viele Gutscheine sollen erstellt werden? z. B. 20") || "0");
    if (!count) return;

    setLoading(true);

    try {
      const defs = Array.from({ length: count }).map(() => createDefinition(title || "Kampagne"));

      await saveCouponsToDb(defs, false);
      await loadFromDb();

      alert("Gutscheine wurden erstellt.");
    } catch (error: any) {
      alert(`Gutscheine konnten nicht gespeichert werden: ${error?.message || "DB Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  const scheduleBulk = async () => {
    const id = selectedCouponId || coupons[0]?.id;
    const def = coupons.find((coupon) => coupon.id === id);

    if (!def) {
      alert("Bitte zuerst einen Gutschein auswählen.");
      return;
    }

    const count = Number(prompt("Wie viele Gutscheine sollen verteilt werden? z. B. 20") || "0");
    if (!count) return;

    const days = Number(prompt("Innerhalb von wie vielen Tagen? z. B. 7") || "7");
    if (!days) return;

    const expires = Number(prompt("Wie viele Tage gültig? z. B. 7") || "7");
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

      alert("Verteilung wurde geplant.");
    } catch (error: any) {
      alert(`Verteilung konnte nicht gespeichert werden: ${error?.message || "DB Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  const issueToPhone = async () => {
    const id = selectedCouponId || coupons[0]?.id;
    const def = coupons.find((coupon) => coupon.id === id);

    if (!def) {
      alert("Bitte zuerst einen Gutschein auswählen.");
      return;
    }

    const phone = prompt("Telefonnummer, z. B. 491234567890") || "";
    if (!phone) return;

    const days = Number(prompt("Wie viele Tage gültig? z. B. 14") || "14");
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

      alert("Gutschein wurde zugewiesen.");
    } catch (error: any) {
      alert(`Gutschein konnte nicht vergeben werden: ${error?.message || "DB Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  const delCoupon = async (coupon: Coupons.CouponDef) => {
    if (!confirm("Diesen Gutschein wirklich löschen?")) return;

    setLoading(true);

    try {
      await deleteCouponFromDb(coupon);
      await loadFromDb();
    } catch (error: any) {
      alert(`Gutschein konnte nicht gelöscht werden: ${error?.message || "DB Fehler"}`);
    } finally {
      setLoading(false);
    }
  };

  const delIssued = async (item: Coupons.IssuedCoupon) => {
    if (!confirm("Diesen ausgegebenen Gutschein wirklich löschen?")) return;

    setLoading(true);

    try {
      await deleteIssuedFromDb(item);
      await loadFromDb();
    } catch (error: any) {
      alert(`Ausgegebener Gutschein konnte nicht gelöscht werden: ${error?.message || "DB Fehler"}`);
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
        alert("Import fehlgeschlagen.");
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

      alert("Import erfolgreich.");
    } catch (error: any) {
      alert(`Import fehlgeschlagen: ${error?.message || "DB Fehler"}`);
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
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h1 className="text-2xl font-semibold">Gutscheine</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex items-center gap-2 text-xs text-stone-400">
          <span>Datenquelle: {source === "db" ? "DB" : source === "cache" ? "Cache" : "Leer"}</span>
          {loading && <span>· Lädt…</span>}
          <button className="btn-ghost" onClick={loadFromDb} disabled={loading}>
            Aktualisieren
          </button>
        </div>
      </div>

      {source === "cache" && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          DB ist gerade nicht erreichbar. Die angezeigten Gutscheine stammen nur aus dem lokalen Cache.
          Änderungen werden erst gespeichert, wenn die DB erreichbar ist.
        </div>
      )}

      <div className="card grid gap-4 p-4 md:grid-cols-3">
        <div>
          <div className="mb-2 font-medium">Neuen Gutschein erstellen</div>

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Titel"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <div className="mb-2 flex gap-2">
            <select
              value={type}
              onChange={(event) => setType(event.target.value as Coupons.CouponType)}
              className="rounded-md bg-stone-800/60 p-2"
            >
              <option value="fixed">Festbetrag (€)</option>
              <option value="percent">Prozent (%)</option>
              <option value="free_item">Gratis-Artikel</option>
              <option value="bogo">2 kaufen, 1 gratis</option>
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
              placeholder="Artikelname, z. B. 2x Getränk"
              value={freeItemName}
              onChange={(event) => setFreeItemName(event.target.value)}
            />
          )}

          {type === "bogo" && (
            <div className="mb-2 space-y-2 rounded border border-stone-700/60 p-2">
              <div className="text-sm font-medium">BOGO-Einstellungen</div>

              <div className="flex gap-2">
                <select
                  className="rounded-md bg-stone-800/60 p-2"
                  value={bogoMatchBy}
                  onChange={(event) => setBogoMatchBy(event.target.value as any)}
                >
                  <option value="name">Name</option>
                  <option value="sku">SKU</option>
                  <option value="category">Kategorie</option>
                </select>

                <input
                  className="flex-1 rounded-md bg-stone-800/60 p-2"
                  placeholder="Wert, z. B. Big Daddy"
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

                <span className="self-center text-sm">kaufen →</span>

                <input
                  type="number"
                  className="w-24 rounded-md bg-stone-800/60 p-2"
                  value={bogoFree}
                  onChange={(event) => setBogoFree(Math.max(1, Number(event.target.value) || 1))}
                />

                <span className="self-center text-sm">gratis</span>

                <input
                  type="number"
                  className="w-36 rounded-md bg-stone-800/60 p-2"
                  placeholder="Max. gratis"
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
            placeholder="Mindestwarenwert, z. B. 20"
            value={minCart}
            onChange={(event) => setMinCart(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Gültigkeit in Tagen, z. B. 7"
            value={validDays}
            onChange={(event) => setValidDays(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <input
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            placeholder="Nutzungslimit pro Kunde"
            value={perCust}
            onChange={(event) => setPerCust(event.target.value === "" ? "" : Number(event.target.value))}
          />

          <label className="mb-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={uniquePerIssue}
              onChange={(event) => setUniquePerIssue(event.target.checked)}
            />
            Bei jeder Ausgabe einen <b>einmaligen Code</b> erzeugen
          </label>

          <div className="mb-2 rounded border border-stone-700/60 p-2">
            <div className="mb-1 text-sm font-medium">Missbrauchsschutz</div>

            <label className="mb-1 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={singlePerCustomer}
                onChange={(event) => setSinglePerCustomer(event.target.checked)}
              />
              Diesen Gutschein pro Kunde <b>maximal 1x</b> vergeben
            </label>

            <div className="mb-1 flex gap-2">
              <input
                className="w-40 rounded-md bg-stone-800/60 p-2"
                placeholder="Max. pro 7 Tage"
                value={capPerWeek}
                onChange={(event) => setCapPerWeek(event.target.value === "" ? "" : Number(event.target.value))}
              />

              <input
                className="w-48 rounded-md bg-stone-800/60 p-2"
                placeholder="Abkühlzeit in Tagen"
                value={cooldownDays}
                onChange={(event) => setCooldownDays(event.target.value === "" ? "" : Number(event.target.value))}
              />
            </div>

            <div className="text-xs opacity-70">
              Beispiel: maximal 2 Gutscheine pro Woche und mindestens 3 Tage Abstand.
            </div>
          </div>

          <textarea
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            rows={2}
            placeholder="Beschreibung oder Kundentext"
            value={aboutText}
            onChange={(event) => setAboutText(event.target.value)}
          />

          <div className="mb-2 flex flex-wrap gap-2">
            <input
              className="rounded-md bg-stone-800/60 p-2"
              placeholder="Code-Präfix, z. B. BB"
              value={codePrefix}
              onChange={(event) => setCodePrefix(event.target.value)}
            />

            <button className="card-cta" onClick={create} disabled={loading}>
              Erstellen
            </button>

            <button className="btn-ghost" onClick={bulkRandom} disabled={loading}>
              Mehrere erstellen
            </button>
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium">Automatische Prämienregeln</div>

          <div className="mb-2 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => addRule("nth_order")}>
              + Bei N. Bestellung
            </button>

            <button className="btn-ghost" onClick={() => addRule("spent_total")}>
              + Warenwert ≥ X €
            </button>
          </div>

          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded border border-stone-700/60 p-2">
                {rule.kind === "nth_order" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">N. Bestellung:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.n || 10}
                      onChange={(event) => updRule(rule.id, { n: Number(event.target.value) })}
                    />

                    <span className="text-sm">Gültigkeit:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.expiresDays || 7}
                      onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                    />

                    <button className="btn-ghost ml-auto" onClick={() => rmRule(rule.id)}>
                      Löschen
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">Mindestwert (€):</span>

                    <input
                      type="number"
                      className="w-24 rounded-md bg-stone-800/60 p-1"
                      value={rule.minTotal || 20}
                      onChange={(event) => updRule(rule.id, { minTotal: Number(event.target.value) })}
                    />

                    <span className="text-sm">Gültigkeit:</span>

                    <input
                      type="number"
                      className="w-20 rounded-md bg-stone-800/60 p-1"
                      value={rule.expiresDays || 7}
                      onChange={(event) => updRule(rule.id, { expiresDays: Number(event.target.value) })}
                    />

                    <button className="btn-ghost ml-auto" onClick={() => rmRule(rule.id)}>
                      Löschen
                    </button>
                  </div>
                )}
              </div>
            ))}

            {rules.length === 0 && (
              <div className="text-sm opacity-70">
                Ohne Regel wird keine automatische Verteilung erstellt.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium">Schnellaktionen</div>

          <select
            className="mb-2 w-full rounded-md bg-stone-800/60 p-2"
            value={selectedCouponId}
            onChange={(event) => setSelectedCouponId(event.target.value)}
          >
            <option value="">— Gutschein auswählen —</option>
            {coupons.map((coupon) => (
              <option key={coupon.id} value={coupon.id}>
                {coupon.code} — {coupon.title}
              </option>
            ))}
          </select>

          <div className="mb-2 flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={issueToPhone} disabled={!coupons.length || loading}>
              An Telefon vergeben
            </button>

            <button className="btn-ghost" onClick={scheduleBulk} disabled={!coupons.length || loading}>
              Über 7 Tage verteilen
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-1 text-xs opacity-70">Import / Export</div>

            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={exportAll}>
                JSON exportieren
              </button>

              <label className="btn-ghost cursor-pointer">
                Importieren
                <input type="file" accept="application/json" hidden onChange={importAll} />
              </label>
            </div>
          </div>

          <div className="mt-4">
            <input
              className="w-full rounded-md bg-stone-800/60 p-2"
              placeholder="Gutschein suchen..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-3">
          <div className="mb-2 font-medium">Gutschein-Definitionen</div>

          <div className="space-y-2">
            {filteredCoupons.map((coupon) => (
              <div key={coupon.id} className="rounded border border-stone-700/60 p-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {coupon.code} <span className="opacity-70">— {coupon.title || "—"}</span>
                    </div>

                    <div className="text-xs opacity-80">
                      Typ: {coupon.type}
                      {" • "}Wert:{" "}
                      {coupon.type === "percent" ? `${coupon.value}%` : `€${coupon.value.toFixed(2)}`}
                      {" • "}Mindestwert: {coupon.minCartTotal ?? "—"}
                      {" • "}Einmalcode: {coupon.meta?.uniquePerIssue ? "✓" : "—"}
                    </div>

                    {!!(
                      coupon.meta?.singlePerCustomer ||
                      coupon.meta?.issueCapPerWeek ||
                      coupon.meta?.issueCooldownDays
                    ) && (
                      <div className="mt-1 text-xs opacity-80">
                        Schutz: {coupon.meta?.singlePerCustomer ? "1x/Kunde" : ""}
                        {coupon.meta?.issueCapPerWeek ? `, 7T≤${coupon.meta.issueCapPerWeek}` : ""}
                        {coupon.meta?.issueCooldownDays ? `, ${coupon.meta.issueCooldownDays}T Pause` : ""}
                      </div>
                    )}

                    <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">
                      {Coupons.describeCoupon(coupon)}
                    </pre>

                    <div className="mt-1 text-xs opacity-60">
                      Gültigkeit: {fmtDT(coupon.validFrom)} → {fmtDT(coupon.validUntil)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(coupon.code);
                        alert("Code wurde kopiert.");
                      }}
                    >
                      Code kopieren
                    </button>

                    <button className="btn-ghost" type="button" onClick={() => delCoupon(coupon)}>
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!filteredCoupons.length && (
              <div className="text-sm opacity-70">Keine Einträge vorhanden.</div>
            )}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-2 font-medium">Ausgegebene Gutscheine</div>

          <div className="max-h-96 space-y-2 overflow-auto pr-1">
            {issued.map((item) => (
              <div key={item.id} className="rounded border border-stone-700/60 p-2">
                <div className="flex justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {item.code} <span className="opacity-70">— {item.source || "—"}</span>
                    </div>

                    <div className="text-xs opacity-70">
                      {item.assignedToPhone ? `Telefon: ${item.assignedToPhone}` : "Allgemein"} • Status:{" "}
                      {item.note === "scheduled"
                        ? "Geplant"
                        : item.note === "cancelled"
                          ? "Storniert"
                          : "Bereit"}
                    </div>

                    <div className="text-xs opacity-70">
                      Ausgegeben: {fmtDT(item.issuedAt)} • Gültig bis: {fmtDT(item.expiresAt)}
                    </div>

                    <div className="text-xs opacity-70">
                      Genutzt: {item.used ? fmtDT(item.usedAt) : "Nein"}
                    </div>

                    {(() => {
                      const def = coupons.find((coupon) => coupon.id === item.couponId);
                      if (!def) return null;

                      return (
                        <pre className="mt-1 whitespace-pre-wrap text-xs opacity-70">
                          {Coupons.describeCoupon(def, item)}
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
                        alert("Code wurde kopiert.");
                      }}
                    >
                      Code kopieren
                    </button>

                    <button className="btn-ghost" type="button" onClick={() => delIssued(item)}>
                      Löschen
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!issued.length && (
              <div className="text-sm opacity-70">Keine Einträge vorhanden.</div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}