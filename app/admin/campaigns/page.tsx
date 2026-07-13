// app/admin/campaigns/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  freebieCategoryLabel,
  freebieModeLabel,
  normalizeFreebieConfig,
} from "@/lib/freebies";

/* =========================
 * Shared types
 * ========================= */
type Category =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "drinks"
  | "hotdogs"
  | "donuts"
  | "bubbleTea";

type Product = {
  id: string;
  sku?: string;
  name: string;
  price: number;
  category: Category;
  imageUrl?: string;
  description?: string;
};

type DiscountKind = "percent" | "absolute" | "newPrice";
type Scope = "category" | "product";
type Mode = "delivery" | "pickup" | "both";

type CartOffer = {
  id: string;
  name: string;
  enabled: boolean;
  percent: number;
  minNetTotal: number;
  mode: Mode;
  startAt?: string;
  endAt?: string;
  priority?: number;
  customerNotice?: string;
  overrideStandardDiscount?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type CampaignVisualStatus = "active" | "ending" | "upcoming" | "ended" | "inactive";


type Campaign = {
  id: string;
  name: string;
  badge?: string;
  priority?: number;
  enabled: boolean;
  showCountdown?: boolean;
  scope: Scope;
  categories?: Category[];
  productIds?: string[];
  kind: DiscountKind;
  value: number;
  startAt?: string;
  endAt?: string;
  mode: Mode;
  maxQtyPerOrder?: number | null;

};

const CATS: { value: Category; label: string }[] = [
  { value: "burger", label: "Burger" },
  { value: "vegan", label: "Vegan / Vegetarisch" },
  { value: "extras", label: "Extras" },
  { value: "sauces", label: "Soßen" },
  { value: "hotdogs", label: "Hot Dogs" },
  { value: "drinks", label: "Getränke" },
  { value: "donuts", label: "Donuts" },
  { value: "bubbleTea", label: "Bubble Tea" },
];

/* =========================
 * Keys / APIs
 * ========================= */
const LS_PRODUCTS = "bb_products_v1";
const LS_CAMPAIGNS = "bb_campaigns_v1";
const LS_SETTINGS = "bb_settings_v6";

const API_CATALOG = "/api/catalog";
const API_PRODUCTS = "/api/products";
const API_SETTINGS = "/api/settings";

/* === Admin Settings (Freebies) === */
type FreebieTier = { minTotal: number; freeSauces: number };
type FreebieCategory = "sauces" | "drinks" | "donuts" | "bubbletea";

type AdminSettings = {
  cartOffers?: CartOffer[];
  freebies?: {
    enabled?: boolean;
    rules?: any[];
    category?: FreebieCategory;
    tiers?: FreebieTier[];
    banner?: string;
    mode?: "pickup" | "delivery" | "both";
  };
  offers?: {
    freebies?: any;
  };
  [key: string]: any;
};

/* =========================
 * Utils
 * ========================= */
const rid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());

const RESPONSE_META_KEYS = new Set([
  "ok",
  "source",
  "tenant",
  "count",
  "counts",
  "saved",
  "keys",
  "error",
  "message",
  "dbError",
  "fallbackSaved",
  "memoryCached",
  "createdAt",
  "updatedAt",
]);

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

function stripResponseMetadata(raw: any) {
  const source =
    isPlainObject(raw?.settings)
      ? raw.settings
      : isPlainObject(raw?.data)
        ? raw.data
        : raw;

  if (!isPlainObject(source)) return source || {};

  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!isSafeKey(key)) continue;
    if (RESPONSE_META_KEYS.has(key)) continue;
    out[key] = value;
  }

  return out;
}

function toNum(v: string | number, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function normalizeCategory(value: any): Category {
  const text = String(value || "").toLowerCase().trim();

  if (text === "bubbletea" || text === "bubble-tea" || text === "bubble_tea") {
    return "bubbleTea";
  }

  if (text === "vegan") return "vegan";
  if (text === "extras") return "extras";
  if (text === "drinks") return "drinks";
  if (text === "sauces") return "sauces";
  if (text === "hotdogs" || text === "hotdog" || text === "hot-dogs") return "hotdogs";
  if (text === "donuts") return "donuts";
  if (text === "burger") return "burger";

  return "burger";
}

function normalizeMode(value: any): Mode {
  const text = String(value || "").toLowerCase().trim();

  if (text === "both" || text === "beide" || text === "alle" || text === "her ikisi") {
    return "both";
  }

  if (
    text === "pickup" ||
    text === "abholung" ||
    text === "apollo" ||
    text === "apollon"
  ) {
    return "pickup";
  }

  if (
    text === "delivery" ||
    text === "lieferung" ||
    text === "lifa" ||
    text === "lieferando"
  ) {
    return "delivery";
  }

  return "both";
}

function normalizeId(p: any) {
  return String(p?.id ?? p?.sku ?? p?.code ?? p?.name ?? "").trim();
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function writeLocalCache(key: string, value: any) {
  try {
    localStorage.setItem(key, safeStringify(value));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: safeStringify(value),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function useDebouncedEffect(effect: () => void, deps: any[], delay = 300) {
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }

    const t = setTimeout(effect, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function freebieCategoryPluralLabel(category: FreebieCategory) {
  if (category === "drinks") return "Getränke";
  if (category === "donuts") return "Donuts";
  if (category === "bubbletea") return "Bubble Teas";
  return "Soßen";
}

function toDatetimeLocal(value: any) {
  if (!value) return "";

  try {
    const d = new Date(value);
    if (!Number.isFinite(d.valueOf())) return "";
    return d.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

/* =========================
 * Products
 * ========================= */
function normalizeProductList(value: any): Product[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.products)
        ? value.products
        : Array.isArray(value?.data?.products)
          ? value.data.products
          : [];

  return list
    .filter((p: any) => p && (p.id || p.sku || p.code || p.name))
    .map((p: any) => ({
      id: normalizeId(p),
      sku: p?.sku ? String(p.sku) : p?.code ? String(p.code) : undefined,
      name: String(p?.name ?? ""),
      price: Number(p?.price) || 0,
      category: normalizeCategory(p?.category),
      imageUrl: p?.imageUrl,
      description: p?.description,
    }))
    .filter((p: Product) => p.id && p.name);
}

async function loadProductsFromDb(): Promise<Product[] | null> {
  const urls = [API_CATALOG, API_PRODUCTS];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          accept: "application/json",
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || data?.ok === false) continue;

      const items = normalizeProductList(data);

      if (items.length || url === API_PRODUCTS) {
        return items;
      }
    } catch {}
  }

  return null;
}

function loadProductsFromLocal(): Product[] {
  try {
    return normalizeProductList(safeJsonParse<any[]>(localStorage.getItem(LS_PRODUCTS), []));
  } catch {
    return [];
  }
}

/* =========================
 * Campaigns DB-first via /api/catalog
 * ========================= */
function normalizeDiscountKind(value: any): DiscountKind {
  const text = String(value || "").toLowerCase().trim();

  if (text === "absolute" || text === "fixed" || text === "fixedoffproduct") return "absolute";
  if (text === "newprice" || text === "new_price" || text === "price") return "newPrice";

  return "percent";
}

function normalizeCampaignList(value: any): Campaign[] {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.campaigns)
        ? value.campaigns
        : Array.isArray(value?.data?.campaigns)
          ? value.data.campaigns
          : [];

  return list
    .map((row: any) => {
      const payload =
        row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
          ? row.payload
          : {};

      const merged = {
        ...payload,
        ...row,
      };

      const productIds = Array.from(
        new Set(
          [
            ...(Array.isArray(merged.productIds) ? merged.productIds : []),
            ...(merged.targetProductId ? [merged.targetProductId] : []),
            ...(merged.productId ? [merged.productId] : []),
            ...(merged.sku ? [merged.sku] : []),
          ]
            .map((x) => String(x ?? "").trim())
            .filter(Boolean),
        ),
      );

      const hasProductScope =
        merged.scope === "product" ||
        productIds.length > 0 ||
        String(merged.type || "").toLowerCase().includes("product");

      const targetCategory =
        merged.targetCategory ??
        merged.category ??
        (Array.isArray(merged.categories) ? merged.categories[0] : undefined);

      const categories = Array.isArray(merged.categories)
        ? merged.categories.map(normalizeCategory)
        : targetCategory
          ? [normalizeCategory(targetCategory)]
          : ["burger" as Category];

      const typeText = String(merged.type || "").toLowerCase();

      const kind =
        merged.kind != null
          ? normalizeDiscountKind(merged.kind)
          : typeText.includes("fixed")
            ? "absolute"
            : typeText.includes("newprice")
              ? "newPrice"
              : "percent";

      const rawValue =
        kind === "percent"
          ? Number(merged.percent ?? merged.value ?? merged.amount ?? 0)
          : Number(merged.value ?? merged.amount ?? merged.fixed ?? 0);

      const id = String(row?.id || merged.id || rid());

      return {
        id,
        name: String(merged.name || merged.title || row?.title || "Aktion"),
        badge:
          merged.badge || merged.badgeText || row?.badgeText
            ? String(merged.badge || merged.badgeText || row?.badgeText)
            : undefined,
        priority: Number(merged.priority ?? merged.prio ?? 100),
        enabled: merged.enabled !== false && merged.active !== false,
        showCountdown: merged.showCountdown !== false,
        scope: hasProductScope ? "product" : "category",
        categories: hasProductScope ? undefined : categories,
        productIds: hasProductScope ? productIds : undefined,
        kind,
        value: Number.isFinite(rawValue) ? rawValue : 0,
        startAt: toDatetimeLocal(merged.startAt ?? merged.startsAt),
        endAt: toDatetimeLocal(merged.endAt ?? merged.endsAt),
        mode: normalizeMode(merged.mode),
        maxQtyPerOrder:
          merged.maxQtyPerOrder == null || merged.maxQtyPerOrder === ""
            ? null
            : Number(merged.maxQtyPerOrder),
      } as Campaign;
    })
    .filter((c: Campaign) => c.id && c.name);
}

function campaignForDb(c: Campaign) {
  const isProduct = c.scope === "product";
  const productIds = isProduct ? (c.productIds || []).map(String).filter(Boolean) : [];
  const categories = !isProduct ? (c.categories || ["burger"]).map(normalizeCategory) : [];
  const targetCategory = categories[0] || "burger";

  const type =
    c.kind === "percent"
      ? isProduct
        ? "percentOffProduct"
        : "percentOffCategory"
      : "fixedOffProduct";

  const normalizedMaxQty =
    c.maxQtyPerOrder == null || !Number.isFinite(Number(c.maxQtyPerOrder))
      ? null
      : Number(c.maxQtyPerOrder);

  const payload = {
    id: c.id,
    name: c.name,
    badge: c.badge || undefined,
    badgeText: c.badge || undefined,
    priority: Number(c.priority ?? 100),
    enabled: c.enabled !== false,
    active: c.enabled !== false,
    showCountdown: c.showCountdown !== false,
    scope: c.scope,
    categories,
    productIds,
    targetProductId: productIds[0],
    kind: c.kind,
    value: Number(c.value) || 0,
    percent: c.kind === "percent" ? Number(c.value) || 0 : 0,
    amount: c.kind !== "percent" ? Number(c.value) || 0 : undefined,
    type,
    targetCategory: isProduct ? undefined : targetCategory,
    startAt: c.startAt || undefined,
    endAt: c.endAt || undefined,
    startsAt: c.startAt || undefined,
    endsAt: c.endAt || undefined,
    mode: c.mode || "both",
    maxQtyPerOrder: normalizedMaxQty,
  };

  return {
    id: c.id,
    code: c.id,
    title: c.name,
    name: c.name,
    badgeText: c.badge || null,
    startsAt: c.startAt || null,
    endsAt: c.endAt || null,
    payload,
  };
}

async function loadCampaignsFromDb(): Promise<Campaign[] | null> {
  try {
    const res = await fetch(API_CATALOG, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `CATALOG_${res.status}`);
    }

    return normalizeCampaignList(data);
  } catch {
    return null;
  }
}

function loadCampaignsFromLocal(): Campaign[] {
  try {
    return normalizeCampaignList(safeJsonParse<any[]>(localStorage.getItem(LS_CAMPAIGNS), []));
  } catch {
    return [];
  }
}

async function saveCampaignsToDb(rows: Campaign[]) {
  try {
    const res = await fetch(API_CATALOG, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        campaigns: rows.map(campaignForDb),
        replace: true,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `CAMPAIGNS_SAVE_${res.status}`);
    }

    try {
      window.dispatchEvent(new CustomEvent("bb:refresh-catalog"));
    } catch {}

    return true;
  } catch (error) {
    console.error("saveCampaignsToDb failed:", error);
    return false;
  }
}

/* =========================
 * Settings / Freebies
 * ========================= */
function normalizeSettingsPayload(data: any): AdminSettings {
  const stripped = stripResponseMetadata(data);

  if (stripped?.item?.value && typeof stripped.item.value === "object") {
    return stripped.item.value;
  }

  if (stripped?.value && typeof stripped.value === "object") {
    return stripped.value;
  }

  if (stripped && typeof stripped === "object") return stripped;

  return {};
}

async function loadSettingsFromDb(): Promise<AdminSettings | null> {
  try {
    const res = await fetch(API_SETTINGS, {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `SETTINGS_${res.status}`);
    }

    return normalizeSettingsPayload(data);
  } catch {
    return null;
  }
}

function loadSettingsFromLocal(): AdminSettings {
  try {
    return normalizeSettingsPayload(
      safeJsonParse<Record<string, any>>(localStorage.getItem(LS_SETTINGS), {}),
    );
  } catch {
    return {};
  }
}

async function saveSettingsToDb(settings: AdminSettings): Promise<AdminSettings | null> {
  try {
    /*
     * Tam Admin ayarı olarak POST ediyoruz.
     * Settings API bu yolu tek DB kaydıyla ve memory-cache yenilemesiyle işler.
     */
    const res = await fetch(API_SETTINGS, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        settings,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `SETTINGS_SAVE_${res.status}`);
    }

    const saved = normalizeSettingsPayload(json);

    try {
      window.dispatchEvent(
        new CustomEvent("bb:settings-sync", {
          detail: saved,
        }),
      );
      window.dispatchEvent(
        new CustomEvent("bb_settings_changed", {
          detail: saved,
        }),
      );
    } catch {}

    return saved;
  } catch (error) {
    console.error("saveSettingsToDb failed:", error);
    return null;
  }
}

/* =========================
 * Component
 * ========================= */
export default function AdminCampaignsPage() {
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [productSource, setProductSource] = useState<"server" | "cache" | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      const fromDb = await loadProductsFromDb();

      if (!alive) return;

      if (fromDb) {
        setAllProducts(fromDb);
        setProductSource("server");
        writeLocalCache(LS_PRODUCTS, fromDb);
        return;
      }

      setAllProducts(loadProductsFromLocal());
      setProductSource("cache");
    }

    load();

    return () => {
      alive = false;
    };
  }, []);

  const [rows, setRows] = useState<Campaign[]>([]);
  const [search, setSearch] = useState("");
  const [campaignSource, setCampaignSource] = useState<"server" | "cache" | null>(null);
  const skipNextCampaignSaveRef = useRef(false);
  const [campaignsDirty, setCampaignsDirty] = useState(false);
  const [savingCampaigns, setSavingCampaigns] = useState(false);
  const [campaignSaveMessage, setCampaignSaveMessage] = useState("");

  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
  const [priority, setPriority] = useState<number>(100);

  const [scope, setScope] = useState<Scope>("category");
  const [categories, setCategories] = useState<Category[]>(["burger"]);
  const [productIds, setProductIds] = useState<string[]>([]);

  const [kind, setKind] = useState<DiscountKind>("percent");
  const [value, setValue] = useState<number>(10);

  const [mode, setMode] = useState<Mode>("both");
  const [enabled, setEnabled] = useState(true);
  const [showCountdown, setShowCountdown] = useState(true);

  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");

  const [maxQtyPerOrder, setMaxQtyPerOrder] = useState<string>("");


  useEffect(() => {
    let alive = true;

    async function load() {
      const fromDb = await loadCampaignsFromDb();

      if (!alive) return;

      if (fromDb) {
        setRows(fromDb);
        setCampaignSource("server");
        writeLocalCache(LS_CAMPAIGNS, fromDb);
        return;
      }

      const cached = loadCampaignsFromLocal();
      skipNextCampaignSaveRef.current = true;
      setRows(cached);
      setCampaignSource("cache");
    }

    load();

    return () => {
      alive = false;
    };
  }, []);


  const list = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = rows.filter((c) =>
      !q
        ? true
        : [c.name, c.badge || "", c.scope, c.kind, c.mode]
            .join(" ")
            .toLowerCase()
            .includes(q),
    );

    return filtered.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;

      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;

      if (pa !== pb) return pb - pa;

      return a.name.localeCompare(b.name);
    });
  }, [rows, search]);

  const resetForm = () => {
    setEditId(null);
    setName("");
    setBadge("");
    setPriority(100);
    setScope("category");
    setCategories(["burger"]);
    setProductIds([]);
    setKind("percent");
    setValue(10);
    setMode("both");
    setEnabled(true);
    setShowCountdown(true);
    setStartAt("");
    setEndAt("");
    setMaxQtyPerOrder("");
  };

  const validate = (): string | null => {
    if (!name.trim()) return "Bitte Kampagnenname eingeben.";
    if (value <= 0) return "Der Rabattwert muss größer als 0 sein.";
    if (kind === "percent" && (value <= 0 || value >= 100)) {
      return "Prozentwert muss zwischen 0 und 100 liegen.";
    }
    if (scope === "category" && (!categories || categories.length === 0)) {
      return "Bitte mindestens eine Kategorie auswählen.";
    }
    if (scope === "product" && (!productIds || productIds.length === 0)) {
      return "Bitte mindestens ein Produkt auswählen.";
    }
    if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
      return "Startdatum darf nicht nach dem Enddatum liegen.";
    }
    return null;
  };

  const save = () => {
    const err = validate();

    if (err) {
      alert(err);
      return;
    }

    const payload: Campaign = {
      id: editId || rid(),
      name: name.trim(),
      badge: badge.trim() || undefined,
      priority: Number(priority) || 0,
      enabled,
      showCountdown,
      scope,
      categories: scope === "category" ? [...categories] : undefined,
      productIds: scope === "product" ? productIds.map(String) : undefined,
      kind,
      value: Number(value),
      startAt: startAt || undefined,
      endAt: endAt || undefined,
      mode,
      maxQtyPerOrder: maxQtyPerOrder ? Number(maxQtyPerOrder) : null,
    };

    setRows((prev) =>
      editId ? prev.map((r) => (r.id === editId ? payload : r)) : [...prev, payload],
    );
    setCampaignsDirty(true);
    setCampaignSaveMessage("Nicht gespeicherte Änderungen");

    resetForm();
  };

  const edit = (c: Campaign) => {
    setEditId(c.id);
    setName(c.name);
    setBadge(c.badge || "");
    setPriority(c.priority ?? 100);
    setScope(c.scope);
    setCategories(c.categories ? [...c.categories] : []);
    setProductIds(c.productIds ? c.productIds.map(String) : []);
    setKind(c.kind);
    setValue(c.value);
    setMode(c.mode || "both");
    setEnabled(!!c.enabled);
    setShowCountdown(c.showCountdown !== false);
    setStartAt(c.startAt || "");
    setEndAt(c.endAt || "");
    setMaxQtyPerOrder(
      typeof c.maxQtyPerOrder === "number" && Number.isFinite(c.maxQtyPerOrder)
        ? String(c.maxQtyPerOrder)
        : "",
    );

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  const del = (id: string) => {
    if (!confirm("Diese Kampagne wirklich löschen?")) return;

    setRows((prev) => prev.filter((r) => r.id !== id));
    setCampaignsDirty(true);
    setCampaignSaveMessage("Nicht gespeicherte Änderungen");

    if (editId === id) resetForm();
  };

  const toggle = (id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
    setCampaignsDirty(true);
    setCampaignSaveMessage("Nicht gespeicherte Änderungen");
  };

  const saveCampaignChanges = async () => {
    if (savingCampaigns) return;
    setSavingCampaigns(true);
    setCampaignSaveMessage("Wird gespeichert…");
    const ok = await saveCampaignsToDb(rows);
    if (ok) {
      setCampaignSource("server");
      writeLocalCache(LS_CAMPAIGNS, rows);
      setCampaignsDirty(false);
      setCampaignSaveMessage("Gespeichert ✅");
    } else {
      setCampaignSource("cache");
      setCampaignSaveMessage("Speichern fehlgeschlagen");
    }
    setSavingCampaigns(false);
  };

  const [prodFilterCat, setProdFilterCat] = useState<Category | "all">("burger");
  const [prodSearch, setProdSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();

    return allProducts
      .filter((p) => (prodFilterCat === "all" ? true : p.category === prodFilterCat))
      .filter((p) =>
        !q ? true : (p.name + " " + (p.description || "")).toLowerCase().includes(q),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, prodFilterCat, prodSearch]);

  const toggleProductInScope = (rawId: string) => {
    const id = String(rawId);
    setProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const doExport = () => {
    try {
      const blob = new Blob([JSON.stringify(rows, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");

      a.href = url;
      a.download = "campaigns.json";
      a.click();

      URL.revokeObjectURL(url);
    } catch {}
  };

  const doImport = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;

    try {
      const txt = await f.text();
      const arr = JSON.parse(txt);
      const safe = normalizeCampaignList(arr);

      const ok = await saveCampaignsToDb(safe);

      if (!ok) {
        throw new Error("Datenbank konnte nicht gespeichert werden.");
      }

      setRows(safe);
      setCampaignSource("server");
      writeLocalCache(LS_CAMPAIGNS, safe);

      ev.target.value = "";

      alert(`Import OK ✅\nAnzahl Kampagnen: ${safe.length}`);
    } catch (e: any) {
      ev.target.value = "";
      alert("Import fehlgeschlagen. JSON ist ungültig.\n" + (e?.message || ""));
    }
  };

  const [settingsBase, setSettingsBase] = useState<AdminSettings>({});
  const [fbEnabled, setFbEnabled] = useState<boolean>(false);
  const [fbCategory, setFbCategory] = useState<FreebieCategory>("sauces");
  const [fbBanner, setFbBanner] = useState<string>("");
  const [fbTiers, setFbTiers] = useState<FreebieTier[]>([
    { minTotal: 15, freeSauces: 1 },
  ]);
  const [settingsSource, setSettingsSource] = useState<"server" | "cache" | null>(null);
  const skipNextSettingsSaveRef = useRef(false);
  const [cartOffers, setCartOffers] = useState<CartOffer[]>([]);

  /*
   * React state güncellemeleri asenkron olduğu için, formda "Übernehmen"
   * dedikten hemen sonra "Angebote speichern" basıldığında eski liste
   * gönderilebiliyordu. Ref her zaman en güncel listeyi taşır.
   */
  const cartOffersRef = useRef<CartOffer[]>([]);

  const [cartOfferEditId, setCartOfferEditId] = useState<string | null>(null);
  const [cartOfferName, setCartOfferName] = useState("");
  const [cartOfferPercent, setCartOfferPercent] = useState("30");
  const [cartOfferMinNet, setCartOfferMinNet] = useState("25");
  const [cartOfferMode, setCartOfferMode] = useState<Mode>("both");
  const [cartOfferStart, setCartOfferStart] = useState("");
  const [cartOfferEnd, setCartOfferEnd] = useState("");
  const [cartOfferEnabled, setCartOfferEnabled] = useState(true);
  const [cartOfferNotice, setCartOfferNotice] = useState("Nur für Onlinebestellungen");
  const [cartOffersDirty, setCartOffersDirty] = useState(false);
  const [savingCartOffers, setSavingCartOffers] = useState(false);
  const [cartOfferSaveMessage, setCartOfferSaveMessage] = useState("");

  useEffect(() => {
    cartOffersRef.current = cartOffers;
  }, [cartOffers]);


  useEffect(() => {
    let alive = true;

    async function load() {
      const fromDb = await loadSettingsFromDb();
      const obj = fromDb || loadSettingsFromLocal();

      if (!alive) return;

      if (!fromDb) {
        skipNextSettingsSaveRef.current = true;
      }

      setSettingsSource(fromDb ? "server" : "cache");
      setSettingsBase(obj);

      const loadedCartOffers = Array.isArray(obj?.cartOffers)
        ? obj.cartOffers
        : [];

      cartOffersRef.current = loadedCartOffers;
      setCartOffers(loadedCartOffers);

      const freebies = obj?.freebies ?? obj?.offers?.freebies ?? {};

      setFbEnabled(!!freebies.enabled);
      setFbCategory(
        ["drinks", "sauces", "donuts", "bubbletea", "bubbleTea"].includes(String(freebies.category))
          ? (String(freebies.category).toLowerCase() === "bubbletea" ? "bubbletea" : freebies.category as FreebieCategory)
          : "sauces",
      );
      setFbBanner(typeof freebies.banner === "string" ? freebies.banner : "");

      const tiers = Array.isArray(freebies.tiers)
        ? freebies.tiers
            .map((t: any) => ({
              minTotal: Number(t?.minTotal) || 0,
              freeSauces: Number(t?.freeSauces ?? t?.freeItems) || 0,
            }))
            .filter((t: FreebieTier) => t.minTotal > 0 && t.freeSauces >= 0)
            .sort((a: FreebieTier, b: FreebieTier) => a.minTotal - b.minTotal)
        : [];

      setFbTiers(tiers.length ? tiers : [{ minTotal: 15, freeSauces: 1 }]);
    }

    load();

    return () => {
      alive = false;
    };
  }, []);


  const resetCartOfferForm = () => {
    setCartOfferEditId(null);
    setCartOfferName("");
    setCartOfferPercent("30");
    setCartOfferMinNet("25");
    setCartOfferMode("both");
    setCartOfferStart("");
    setCartOfferEnd("");
    setCartOfferEnabled(true);
    setCartOfferNotice("Nur für Onlinebestellungen");
  };

  const addOrUpdateCartOffer = () => {
    const percent = toNum(cartOfferPercent, 0);
    const minNetTotal = toNum(cartOfferMinNet, 0);

    if (!cartOfferName.trim()) {
      return alert("Bitte Angebotsname eingeben.");
    }

    if (percent <= 0 || percent >= 100) {
      return alert("Rabatt muss zwischen 0 und 100 liegen.");
    }

    if (minNetTotal <= 0) {
      return alert("Bitte Mindest-Warenwert eingeben.");
    }

    if (
      cartOfferStart &&
      cartOfferEnd &&
      new Date(cartOfferStart) > new Date(cartOfferEnd)
    ) {
      return alert("Startdatum darf nicht nach dem Enddatum liegen.");
    }

    const now = new Date().toISOString();
    const current = cartOffersRef.current;
    const existing = cartOfferEditId
      ? current.find((item) => item.id === cartOfferEditId)
      : undefined;

    const offer: CartOffer = {
      id: existing?.id || cartOfferEditId || rid(),
      name: cartOfferName.trim(),
      enabled: cartOfferEnabled,
      percent,
      minNetTotal,
      mode: cartOfferMode,
      startAt: cartOfferStart || undefined,
      endAt: cartOfferEnd || undefined,
      customerNotice: cartOfferNotice.trim() || undefined,
      overrideStandardDiscount: true,
      priority: existing?.priority ?? 100,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const next = existing
      ? current.map((item) => (item.id === existing.id ? offer : item))
      : [...current, offer];

    /*
     * Ref önce güncellenir. Böylece kullanıcı hemen kayıt butonuna bassa bile
     * DB'ye eski değil, yeni düzenlenen obje gider.
     */
    cartOffersRef.current = next;
    setCartOffers(next);
    setCartOffersDirty(true);
    setCartOfferSaveMessage(
      existing
        ? "Änderung übernommen – bitte Angebote speichern"
        : "Angebot hinzugefügt – bitte Angebote speichern",
    );

    resetCartOfferForm();
  };

  const editCartOffer = (offer: CartOffer) => {
    setCartOfferEditId(offer.id);
    setCartOfferName(offer.name);
    setCartOfferPercent(String(offer.percent));
    setCartOfferMinNet(String(offer.minNetTotal));
    setCartOfferMode(offer.mode || "both");
    setCartOfferStart(toDatetimeLocal(offer.startAt));
    setCartOfferEnd(toDatetimeLocal(offer.endAt));
    setCartOfferEnabled(offer.enabled !== false);
    setCartOfferNotice(offer.customerNotice || "");
  };

  const deleteCartOffer = (id: string) => {
    if (!confirm("Dieses Warenkorb-Angebot wirklich löschen?")) return;

    const next = cartOffersRef.current.filter((item) => item.id !== id);
    cartOffersRef.current = next;
    setCartOffers(next);
    setCartOffersDirty(true);
    setCartOfferSaveMessage("Nicht gespeicherte Änderungen");

    if (cartOfferEditId === id) {
      resetCartOfferForm();
    }
  };

  const toggleCartOffer = (id: string) => {
    const next = cartOffersRef.current.map((item) =>
      item.id === id
        ? {
            ...item,
            enabled: !item.enabled,
            updatedAt: new Date().toISOString(),
          }
        : item,
    );

    cartOffersRef.current = next;
    setCartOffers(next);
    setCartOffersDirty(true);
    setCartOfferSaveMessage("Nicht gespeicherte Änderungen");
  };

  const saveCartOffers = async () => {
    if (savingCartOffers) return;

    setSavingCartOffers(true);
    setCartOfferSaveMessage("Wird gespeichert…");

    try {
      const latestOffers = cartOffersRef.current.map((offer) => ({
        ...offer,
        id: String(offer.id),
        name: String(offer.name).trim(),
        percent: Math.max(0, toNum(offer.percent, 0)),
        minNetTotal: Math.max(0, toNum(offer.minNetTotal, 0)),
        mode: normalizeMode(offer.mode),
        updatedAt: offer.updatedAt || new Date().toISOString(),
      }));

      const nextSettings: AdminSettings = {
        ...settingsBase,
        cartOffers: latestOffers,
      };

      const savedSettings = await saveSettingsToDb(nextSettings);

      if (!savedSettings) {
        throw new Error("SETTINGS_SAVE_FAILED");
      }

      /*
       * API cevabındaki cartOffers listesini tekrar kullanıyoruz.
       * Böylece DB'nin kabul ettiği gerçek değer ekran ve local cache ile aynı olur.
       */
      const savedOffers = Array.isArray(savedSettings.cartOffers)
        ? savedSettings.cartOffers
        : latestOffers;

      cartOffersRef.current = savedOffers;
      setCartOffers(savedOffers);

      const normalizedSavedSettings: AdminSettings = {
        ...nextSettings,
        ...savedSettings,
        cartOffers: savedOffers,
      };

      setSettingsBase(normalizedSavedSettings);
      writeLocalCache(LS_SETTINGS, normalizedSavedSettings);
      setSettingsSource("server");
      setCartOffersDirty(false);
      setCartOfferSaveMessage("Gespeichert und aktualisiert ✅");
    } catch (error) {
      console.error("saveCartOffers failed:", error);
      setCartOfferSaveMessage(
        "Speichern fehlgeschlagen – Änderung wurde nicht verworfen",
      );
    } finally {
      setSavingCartOffers(false);
    }
  };

  const campaignStatus = (item: { enabled: boolean; startAt?: string; endAt?: string }): CampaignVisualStatus => {
    if (!item.enabled) return "inactive";
    const now = Date.now();
    const start = item.startAt ? Date.parse(item.startAt) : -Infinity;
    const end = item.endAt ? Date.parse(item.endAt) : Infinity;
    if (Number.isFinite(start) && now < start) return "upcoming";
    if (Number.isFinite(end) && now > end) return "ended";
    if (Number.isFinite(end) && end - now <= 48 * 60 * 60 * 1000) return "ending";
    return "active";
  };

  const statusUi = (status: CampaignVisualStatus) => ({
    active: { label: "Läuft", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
    ending: { label: "Endet bald", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
    upcoming: { label: "Geplant", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
    ended: { label: "Beendet", cls: "border-rose-500/40 bg-rose-500/10 text-rose-300" },
    inactive: { label: "Inaktiv", cls: "border-stone-600 bg-stone-800 text-stone-300" },
  }[status]);

  const addTier = () => {
    setFbTiers((prev) => [...prev, { minTotal: 30, freeSauces: 1 }]);
  };

  const removeTier = (idx: number) => {
    setFbTiers((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateTier = (idx: number, patch: Partial<FreebieTier>) => {
    setFbTiers((prev) =>
      prev.map((t, i) =>
        i === idx
          ? {
              minTotal:
                patch.minTotal != null ? Math.max(0, +patch.minTotal) : t.minTotal,
              freeSauces:
                patch.freeSauces != null
                  ? Math.max(0, Math.floor(+patch.freeSauces))
                  : t.freeSauces,
            }
          : t,
      ),
    );
  };

  const sortedPreview = [...fbTiers].sort((a, b) => a.minTotal - b.minTotal);
  const freebieSummary = normalizeFreebieConfig(
    settingsBase?.freebies ?? settingsBase?.offers?.freebies ?? {},
  );

  const startRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLInputElement | null>(null);

  const openPicker = (el: HTMLInputElement | null) => {
    if (!el) return;

    if (typeof el.showPicker === "function") {
      el.showPicker();
    } else {
      el.focus();
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Kampagnen</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="card-cta"
            onClick={saveCampaignChanges}
            disabled={!campaignsDirty || savingCampaigns}
          >
            {savingCampaigns ? "Speichert…" : "Kampagnen speichern"}
          </button>
          {campaignSaveMessage ? <span className="text-xs text-stone-400">{campaignSaveMessage}</span> : null}
          <button className="btn-ghost" onClick={doExport}>
            Export (JSON)
          </button>
          <label className="btn-ghost cursor-pointer">
            Import
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
        </div>
      </div>

      <div className="mb-5 rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
        <div className="mb-1 font-medium">Datenstatus</div>
        <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
          <div>
            Produkte:{" "}
            <b className={productSource === "server" ? "text-emerald-400" : "text-amber-400"}>
              {productSource === "server" ? "DB" : productSource === "cache" ? "Cache" : "…"}
            </b>
          </div>
          <div>
            Kampagnen:{" "}
            <b className={campaignSource === "server" ? "text-emerald-400" : "text-amber-400"}>
              {campaignSource === "server" ? "DB" : campaignSource === "cache" ? "Cache" : "…"}
            </b>
          </div>
          <div>
            Freebies:{" "}
            <b className={settingsSource === "server" ? "text-emerald-400" : "text-amber-400"}>
              {settingsSource === "server" ? "DB" : settingsSource === "cache" ? "Cache" : "…"}
            </b>
          </div>
        </div>
      </div>

      <div className="card mb-6">
        <div className="mb-3 text-lg font-medium">
          {editId ? "Kampagne bearbeiten" : "Neue Kampagne"}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Kampagnenname *">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Vegan -15%"
            />
          </Field>

          <Field label="Badge">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder='z. B. "-15%" oder "Aktion"'
            />
          </Field>

          <Field label="Priorität">
            <input
              type="number"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={String(priority)}
              onChange={(e) => setPriority(toNum(e.target.value, 0))}
              placeholder="100"
            />
          </Field>

          <Field label="Modus">
            <select
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="delivery">Nur Lieferung</option>
              <option value="pickup">Nur Abholung</option>
              <option value="both">Beides</option>
            </select>
          </Field>

          <Field label="Rabattart">
            <select
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={kind}
              onChange={(e) => setKind(e.target.value as DiscountKind)}
            >
              <option value="percent">% Rabatt</option>
              <option value="absolute">€ Rabatt</option>
              <option value="newPrice">Neuer Preis (€)</option>
            </select>
          </Field>

          <Field
            label={
              kind === "percent"
                ? "Wert (%) *"
                : kind === "absolute"
                  ? "Wert (€) *"
                  : "Neuer Preis (€) *"
            }
          >
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={String(value)}
              onChange={(e) => setValue(toNum(e.target.value, 0))}
              placeholder={kind === "percent" ? "10" : "2.50"}
            />
          </Field>

          <Field label="Start">
            <div className="flex items-center gap-2">
              <input
                ref={startRef}
                type="datetime-local"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
              <button
                type="button"
                className="pill"
                onClick={() => openPicker(startRef.current)}
                title="Datum wählen"
              >
                🗓
              </button>
            </div>
          </Field>

          <Field label="Ende">
            <div className="flex items-center gap-2">
              <input
                ref={endRef}
                type="datetime-local"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
              <button
                type="button"
                className="pill"
                onClick={() => openPicker(endRef.current)}
                title="Datum wählen"
              >
                🗓
              </button>
            </div>
          </Field>

          <Field label="Max. Menge pro Bestellung (optional)">
            <input
              type="number"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={maxQtyPerOrder}
              onChange={(e) => setMaxQtyPerOrder(e.target.value)}
              placeholder="leer lassen"
            />
          </Field>

          <div className="flex items-center gap-6 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Aktiv
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCountdown}
                onChange={(e) => setShowCountdown(e.target.checked)}
              />
              Countdown anzeigen
            </label>
          </div>

          <div className="md:col-span-2">
            <div className="mb-2 text-sm opacity-80">Geltungsbereich *</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`nav-pill ${scope === "category" ? "nav-pill--active" : ""}`}
                onClick={() => setScope("category")}
              >
                Kategorie
              </button>
              <button
                type="button"
                className={`nav-pill ${scope === "product" ? "nav-pill--active" : ""}`}
                onClick={() => setScope("product")}
              >
                Produkt
              </button>
            </div>

            {scope === "category" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {CATS.map((c) => {
                  const active = categories.includes(c.value);
                  return (
                    <button
                      key={c.value}
                      type="button"
                      className={`pill ${active ? "active" : ""}`}
                      onClick={() =>
                        setCategories((prev) =>
                          active ? prev.filter((x) => x !== c.value) : [...prev, c.value],
                        )
                      }
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}

            {scope === "product" && (
              <div className="mt-3 rounded-lg border border-stone-700/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={prodFilterCat}
                    onChange={(e) => setProdFilterCat(e.target.value as any)}
                  >
                    <option value="all">Alle Kategorien</option>
                    {CATS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="Produkt suchen…"
                  />
                </div>

                <div className="max-h-72 overflow-auto rounded border border-stone-700/60">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-sm opacity-70">Keine Produkte gefunden.</div>
                  ) : (
                    <ul className="divide-y divide-stone-700/60">
                      {filteredProducts.map((p) => {
                        const checked = productIds.includes(p.id);

                        return (
                          <li key={p.id} className="flex items-center justify-between gap-3 p-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{p.name}</div>
                              <div className="text-xs text-stone-400">
                                {CATS.find((x) => x.value === p.category)?.label ?? p.category} •{" "}
                                {p.price.toFixed(2)} €
                              </div>
                            </div>
                            <button
                              type="button"
                              className={`pill ${checked ? "active" : ""}`}
                              onClick={() => toggleProductInScope(p.id)}
                            >
                              {checked ? "Ausgewählt" : "Auswählen"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {productIds.length > 0 && (
                  <div className="mt-2 text-xs text-stone-300">
                    Ausgewählte Produkte: <b>{productIds.length}</b>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button className="card-cta card-cta--lg" onClick={save}>
            {editId ? "Speichern" : "Hinzufügen"}
          </button>
          {editId && (
            <button className="btn-ghost" onClick={resetForm}>
              Abbrechen
            </button>
          )}
        </div>
      </div>

      <div className="card mb-6 border border-amber-500/20">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xl font-semibold">Warenkorb-Angebote</div>
            <div className="mt-1 text-sm text-stone-400">
              Unabhängig von Produkt- und Kategorie-Kampagnen. Unterhalb der Grenze gilt der Standardrabatt; ab der Grenze ersetzt dieses Angebot ihn.
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cartOfferSaveMessage ? <span className="text-xs text-stone-400">{cartOfferSaveMessage}</span> : null}
            <button className="card-cta" onClick={saveCartOffers} disabled={!cartOffersDirty || savingCartOffers}>
              {savingCartOffers ? "Speichert…" : "Angebote speichern"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-xl border border-stone-700/60 bg-stone-950/40 p-4 md:grid-cols-2">
          <Field label="Angebotsname *"><input className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferName} onChange={(e) => setCartOfferName(e.target.value)} placeholder="z. B. 30% Online-Aktion" /></Field>
          <Field label="Modus"><select className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferMode} onChange={(e) => setCartOfferMode(e.target.value as Mode)}><option value="both">Beides</option><option value="pickup">Nur Abholung</option><option value="delivery">Nur Lieferung</option></select></Field>
          <Field label="Rabatt (%) *"><input type="number" step="0.01" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferPercent} onChange={(e) => setCartOfferPercent(e.target.value)} /></Field>
          <Field label="Mindest-Warenwert vor Rabatt (€) *"><input type="number" step="0.01" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferMinNet} onChange={(e) => setCartOfferMinNet(e.target.value)} /></Field>
          <Field label="Start"><input type="datetime-local" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferStart} onChange={(e) => setCartOfferStart(e.target.value)} /></Field>
          <Field label="Ende"><input type="datetime-local" className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferEnd} onChange={(e) => setCartOfferEnd(e.target.value)} /></Field>
          <Field label="Kundenhinweis"><input className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2" value={cartOfferNotice} onChange={(e) => setCartOfferNotice(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cartOfferEnabled} onChange={(e) => setCartOfferEnabled(e.target.checked)} /> Aktiv</label>
          <div className="flex gap-2 md:col-span-2"><button className="card-cta" onClick={addOrUpdateCartOffer}>{cartOfferEditId ? "Änderung übernehmen" : "Angebot hinzufügen"}</button>{cartOfferEditId ? <button className="btn-ghost" onClick={resetCartOfferForm}>Abbrechen</button> : null}</div>
        </div>

        <div className="mt-4 grid gap-3">
          {cartOffers.length === 0 ? <div className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-400">Noch kein Warenkorb-Angebot angelegt.</div> : cartOffers.map((offer) => { const st = campaignStatus(offer); const ui = statusUi(st); return (
            <div key={offer.id} className={`rounded-xl border p-4 ${ui.cls}`}>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div><div className="flex flex-wrap items-center gap-2"><b>{offer.name}</b><span className="rounded-full border px-2 py-0.5 text-xs">{ui.label}</span></div><div className="mt-1 text-xs opacity-85">{offer.percent}% · {offer.minNetTotal.toFixed(2)} € netto · {offer.mode === "both" ? "Lieferung + Abholung" : offer.mode === "delivery" ? "Lieferung" : "Abholung"}</div><div className="mt-1 text-xs opacity-75">{offer.startAt ? `Start: ${new Date(offer.startAt).toLocaleString("de-DE")}` : "Start: sofort"} · {offer.endAt ? `Ende: ${new Date(offer.endAt).toLocaleString("de-DE")}` : "Ende: offen"}</div></div>
                <div className="flex flex-wrap gap-2"><button className="btn-ghost" onClick={() => toggleCartOffer(offer.id)}>{offer.enabled ? "Deaktivieren" : "Aktivieren"}</button><button className="btn-ghost" onClick={() => editCartOffer(offer)}>Bearbeiten</button><button className="btn-ghost" onClick={() => deleteCartOffer(offer.id)}>Löschen</button></div>
              </div>
            </div>
          ); })}
        </div>
      </div>

      <div className="card mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-medium">Gratis-Artikel Regeln</div>
            <div className="mt-1 text-xs text-stone-400">
              Diese Regeln werden zentral unter Einstellungen verwaltet. Dadurch
              überschreiben sich Kampagnen- und Einstellungsseite nicht mehr.
            </div>
          </div>

          <Link className="card-cta" href="/admin/settings">
            Regeln bearbeiten
          </Link>
        </div>

        {!freebieSummary.enabled ? (
          <div className="rounded-xl border border-stone-700/60 bg-stone-950/40 p-3 text-sm text-stone-400">
            Gratis-Artikel Regeln sind derzeit deaktiviert.
          </div>
        ) : freebieSummary.rules.length === 0 ? (
          <div className="rounded-xl border border-stone-700/60 bg-stone-950/40 p-3 text-sm text-stone-400">
            Noch keine Gratis-Regel vorhanden.
          </div>
        ) : (
          <div className="space-y-2">
            {freebieSummary.rules.map((rule: any) => (
              <div
                key={rule.id}
                className="rounded-xl border border-stone-700/60 bg-stone-950/50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {rule.enabled !== false ? "✅" : "⏸️"}{" "}
                    {freebieModeLabel(rule.mode)}
                    {" · ab "}
                    {Number(rule.minTotal || 0).toFixed(2)} €
                    {" · "}
                    {Number(rule.quantity || 0)}×{" "}
                    {freebieCategoryLabel(
                      rule.category,
                      Number(rule.quantity || 0) !== 1,
                    )}
                  </div>

                  <div className="text-xs text-stone-400">
                    {rule.maxProductPrice != null
                      ? `Max. Artikelpreis: ${Number(rule.maxProductPrice).toFixed(2)} €`
                      : "Kein Preislimit"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div><div className="font-medium">Kampagnenübersicht</div><div className="text-xs text-stone-400">Mehrere Kampagnen können gleichzeitig geplant und gespeichert werden.</div></div>
          <input
            className="ml-auto rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kampagne suchen…"
          />
        </div>

        {list.length === 0 ? (
          <div className="text-sm opacity-70">Keine Einträge.</div>
        ) : (
          <div className="grid gap-2">
            {list.map((c) => {
              const scopeText =
                c.scope === "category"
                  ? (c.categories || [])
                      .map((x) => CATS.find((y) => y.value === x)?.label ?? x)
                      .join(", ")
                  : `${c.productIds?.length ?? 0} Produkte`;

              const timeText =
                (c.startAt ? `ab ${new Date(c.startAt).toLocaleString()}` : "sofort") +
                (c.endAt ? ` • bis ${new Date(c.endAt).toLocaleString()}` : "");

              const kindText =
                c.kind === "percent"
                  ? `${c.value}%`
                  : c.kind === "absolute"
                    ? `-${Number(c.value).toFixed(2)} €`
                    : `Neu: ${Number(c.value).toFixed(2)} €`;

              const modeText =
                c.mode === "both"
                  ? "Lieferung + Abholung"
                  : c.mode === "delivery"
                    ? "Lieferung"
                    : "Abholung";
              const visualStatus = campaignStatus(c);
              const visualUi = statusUi(visualStatus);

              return (
                <div
                  key={c.id}
                  className={`flex flex-col gap-2 rounded-xl border p-4 md:flex-row md:items-center md:justify-between ${visualUi.cls}`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{c.name}</div>
                      {c.badge ? <span className="badge badge--campaign">{c.badge}</span> : null}
                      <span className="rounded-full border px-2 py-0.5 text-[11px]">{visualUi.label}</span>
                    </div>
                    <div className="text-xs text-stone-400">
                      {c.scope === "category" ? "Kategorie" : "Produkt"} • {scopeText}
                      {" • "}
                      {kindText}
                      {" • "}
                      {modeText}
                      {c.maxQtyPerOrder != null ? ` • max. ${c.maxQtyPerOrder}/Bestellung` : ""}
                      {" • "}
                      Priorität {c.priority ?? 0}
                      {" • "}
                      {timeText}
                      {c.showCountdown ? " • Countdown" : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-ghost" onClick={() => toggle(c.id)}>
                      {c.enabled ? "Deaktivieren" : "Aktivieren"}
                    </button>
                    <button className="btn-ghost" onClick={() => edit(c)}>
                      Bearbeiten
                    </button>
                    <button className="btn-ghost" onClick={() => del(c.id)}>
                      Löschen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}