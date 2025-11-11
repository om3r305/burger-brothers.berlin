// app/admin/campaigns/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* =========================
 * Shared types (local copy)
 * ========================= */
type Category = "burger" | "vegan" | "extras" | "sauces" | "drinks" | "hotdogs";

type Product = {
  id: string;
  name: string;
  price: number;
  category: Category;
  imageUrl?: string;
  description?: string;
};

type DiscountKind = "percent" | "absolute" | "newPrice";
type Scope = "category" | "product";
type Mode = "delivery" | "pickup" | "both";

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
];

/* =========================
 * LocalStorage keys
 * ========================= */
const LS_PRODUCTS = "bb_products_v1";
const LS_CAMPAIGNS = "bb_campaigns_v1";

/* === Admin Settings (Freebies) === */
const LS_SETTINGS = "bb_settings_v1";
type FreebieTier = { minTotal: number; freeSauces: number };
type FreebieCategory = "sauces" | "drinks";
type AdminSettings = {
  freebies?: {
    enabled?: boolean;
    category?: FreebieCategory;
    tiers?: FreebieTier[];
    banner?: string;
  };
};

/* =========================
 * Utils
 * ========================= */
const rid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : String(Date.now() + Math.random()));

function toNum(v: string, fallback = 0) {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

/* 🔧 Kimlik normalizasyonu — tüketen tarafla aynı anahtar */
const normalizeId = (p: any) =>
  String(p?.id ?? p?.sku ?? p?.code ?? p?.name ?? "");

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

/* =========================
 * Component
 * ========================= */
export default function AdminCampaignsPage() {
  /* ---- source products ---- */
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PRODUCTS);
      const arr = raw ? JSON.parse(raw) : [];
      const safe: Product[] = Array.isArray(arr)
        ? arr
            .filter((p: any) => p && (p.id || p.sku || p.code || p.name))
            .map((p: any) => ({
              id: normalizeId(p), // 👈 kritik düzeltme
              name: String(p?.name ?? ""),
              price: Number(p?.price) || 0,
              category: (String(p?.category ?? "burger") as Category),
              imageUrl: p?.imageUrl,
              description: p?.description,
            }))
        : [];
      setAllProducts(safe);
    } catch {
      setAllProducts([]);
    }
  }, []);

  /* ---- campaigns state ---- */
  const [rows, setRows] = useState<Campaign[]>([]);
  const [search, setSearch] = useState("");

  /* form state */
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [badge, setBadge] = useState("");
  const [priority, setPriority] = useState<number>(100);

  const [scope, setScope] = useState<Scope>("category");
  const [categories, setCategories] = useState<Category[]>(["burger"]);
  const [productIds, setProductIds] = useState<string[]>([]);

  const [kind, setKind] = useState<DiscountKind>("percent");
  const [value, setValue] = useState<number>(10);

  const [mode, setMode] = useState<Mode>("delivery");
  const [enabled, setEnabled] = useState(true);
  const [showCountdown, setShowCountdown] = useState(true);

  const [startAt, setStartAt] = useState<string>("");
  const [endAt, setEndAt] = useState<string>("");

  const [maxQtyPerOrder, setMaxQtyPerOrder] = useState<string>("");

  /* ---- load campaigns ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CAMPAIGNS);
      const arr = raw ? (JSON.parse(raw) as Campaign[]) : [];
      // productIds her ihtimale karşı string’e normalize
      const safe = Array.isArray(arr)
        ? arr.map((c: any) => ({
            ...c,
            productIds: Array.isArray(c?.productIds)
              ? c.productIds.map((x: any) => String(x))
              : undefined,
          }))
        : [];
      setRows(safe);
    } catch {
      setRows([]);
    }
  }, []);

  /* ---- persist campaigns ---- */
  useDebouncedEffect(() => {
    try {
      localStorage.setItem(LS_CAMPAIGNS, JSON.stringify(rows));
    } catch {}
  }, [rows], 300);

  /* ---- list with search ---- */
  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((c) =>
      !q
        ? true
        : [c.name, c.badge || "", c.scope, c.kind, c.mode]
            .join(" ")
            .toLowerCase()
            .includes(q)
    );
    return filtered.sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pb - pa;
      return a.name.localeCompare(b.name);
    });
  }, [rows, search]);

  /* ---- helpers ---- */
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
    setMode("delivery");
    setEnabled(true);
    setShowCountdown(true);
    setStartAt("");
    setEndAt("");
    setMaxQtyPerOrder("");
  };

  const validate = (): string | null => {
    if (!name.trim()) return "Lütfen kampanya adı girin.";
    if (value <= 0) return "İndirim değeri 0’dan büyük olmalı.";
    if (kind === "percent" && (value <= 0 || value >= 100))
      return "Yüzde 0–100 arasında olmalı.";
    if (scope === "category" && (!categories || categories.length === 0))
      return "En az bir kategori seçin.";
    if (scope === "product" && (!productIds || productIds.length === 0))
      return "En az bir ürün seçin.";
    if (startAt && endAt && new Date(startAt) > new Date(endAt))
      return "Başlangıç tarihi bitişten büyük olamaz.";
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
      productIds: scope === "product" ? productIds.map(String) : undefined, // 👈 normalize string
      kind,
      value: Number(value),
      startAt: startAt || undefined,
      endAt: endAt || undefined,
      mode,
      maxQtyPerOrder: maxQtyPerOrder ? Number(maxQtyPerOrder) : null,
    };

    setRows((prev) =>
      editId ? prev.map((r) => (r.id === editId ? payload : r)) : [...prev, payload]
    );
    resetForm();
  };

  const edit = (c: Campaign) => {
    setEditId(c.id);
    setName(c.name);
    setBadge(c.badge || "");
    setPriority(c.priority ?? 100);
    setScope(c.scope);
    setCategories(c.categories ? [...c.categories] : []);
    setProductIds(c.productIds ? c.productIds.map(String) : []); // 👈 normalize
    setKind(c.kind);
    setValue(c.value);
    setMode(c.mode);
    setEnabled(!!c.enabled);
    setShowCountdown(!!c.showCountdown);
    setStartAt(c.startAt || "");
    setEndAt(c.endAt || "");
    setMaxQtyPerOrder(
      typeof c.maxQtyPerOrder === "number" && Number.isFinite(c.maxQtyPerOrder)
        ? String(c.maxQtyPerOrder)
        : ""
    );
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  const del = (id: string) => {
    if (!confirm("Kampanyayı silmek istediğine emin misin?")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    if (editId === id) resetForm();
  };

  const toggle = (id: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  /* ---- product picker ---- */
  const [prodFilterCat, setProdFilterCat] = useState<Category | "all">("burger");
  const [prodSearch, setProdSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    return allProducts
      .filter((p) => (prodFilterCat === "all" ? true : p.category === prodFilterCat))
      .filter((p) =>
        !q ? true : (p.name + " " + (p.description || "")).toLowerCase().includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allProducts, prodFilterCat, prodSearch]);

  const toggleProductInScope = (rawId: string) => {
    const id = String(rawId); // id zaten normalize edilerek geldi
    setProductIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /* ---- export/import ---- */
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
      const arr = JSON.parse(txt) as any[];
      const safe: Campaign[] = Array.isArray(arr)
        ? arr.map((c: any) => ({
            id: c?.id || rid(),
            name: String(c?.name ?? ""),
            badge: c?.badge ? String(c.badge) : undefined,
            priority: Number.isFinite(Number(c?.priority)) ? Number(c.priority) : 0,
            enabled: !!c?.enabled,
            showCountdown: !!c?.showCountdown,
            scope: (c?.scope === "product" ? "product" : "category") as Scope,
            categories: Array.isArray(c?.categories)
              ? c.categories.filter(Boolean)
              : undefined,
            productIds: Array.isArray(c?.productIds)
              ? c.productIds.map((x: any) => String(x)) // 👈 normalize
              : undefined,
            kind: (["percent", "absolute", "newPrice"].includes(c?.kind)
              ? c.kind
              : "percent") as DiscountKind,
            value: Number(c?.value) || 0,
            startAt: c?.startAt ? String(c.startAt) : undefined,
            endAt: c?.endAt ? String(c.endAt) : undefined,
            mode: (["delivery", "pickup", "both"].includes(c?.mode)
              ? c.mode
              : "delivery") as Mode,
            maxQtyPerOrder: Number.isFinite(Number(c?.maxQtyPerOrder))
              ? Number(c.maxQtyPerOrder)
              : null,
          }))
        : [];
      setRows(safe);
      ev.target.value = "";
      alert(`Import OK ✅\nKampanya sayısı: ${safe.length}`);
    } catch (e: any) {
      ev.target.value = "";
      alert("Import hatası. JSON geçersiz.\n" + (e?.message || ""));
    }
  };

  /* =========================
   * 🆕 Admin → Ayarlar: Freebies
   * ========================= */
  const [fbEnabled, setFbEnabled] = useState<boolean>(false);
  const [fbCategory, setFbCategory] = useState<FreebieCategory>("sauces");
  const [fbBanner, setFbBanner] = useState<string>("");
  const [fbTiers, setFbTiers] = useState<FreebieTier[]>([{ minTotal: 15, freeSauces: 1 }]);

  // Load settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      const obj = raw ? (JSON.parse(raw) as AdminSettings) : {};
      const freebies = obj?.freebies ?? {};
      setFbEnabled(!!freebies.enabled);
      setFbCategory(
        freebies.category === "drinks" || freebies.category === "sauces"
          ? freebies.category
          : "sauces"
      );
      setFbBanner(typeof freebies.banner === "string" ? freebies.banner : "");
      const tiers = Array.isArray(freebies.tiers)
        ? freebies.tiers
            .map((t: any) => ({
              minTotal: Number(t?.minTotal) || 0,
              freeSauces: Number(t?.freeSauces) || 0,
            }))
            .filter((t) => t.minTotal > 0 && t.freeSauces >= 0)
            .sort((a, b) => a.minTotal - b.minTotal)
        : [];
      setFbTiers(tiers.length ? tiers : [{ minTotal: 15, freeSauces: 1 }]);
    } catch {}
  }, []);

  // Persist settings (debounced)
  useDebouncedEffect(() => {
    try {
      const payload: AdminSettings = {
        freebies: {
          enabled: fbEnabled,
          category: fbCategory,
          tiers: [...fbTiers].sort((a, b) => a.minTotal - b.minTotal),
          banner: fbBanner || undefined,
        },
      };
      localStorage.setItem(LS_SETTINGS, JSON.stringify(payload));
    } catch {}
  }, [fbEnabled, fbCategory, fbTiers, fbBanner], 300);

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
              minTotal: patch.minTotal != null ? Math.max(0, +patch.minTotal) : t.minTotal,
              freeSauces: patch.freeSauces != null ? Math.max(0, Math.floor(+patch.freeSauces)) : t.freeSauces,
            }
          : t
      )
    );
  };
  const sortedPreview = [...fbTiers].sort((a, b) => a.minTotal - b.minTotal);

  /* =========================
   * Datetime picker buttons
   * ========================= */
  const startRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLInputElement | null>(null);
  const openPicker = (el: HTMLInputElement | null) => {
    if (!el) return;
    // @ts-ignore
    if (typeof el.showPicker === "function") {
      // @ts-ignore
      el.showPicker();
    } else {
      el.focus();
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* HEADER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Kampanyalar</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={doExport}>Export (JSON)</button>
          <label className="btn-ghost cursor-pointer">
            Import
            <input type="file" accept="application/json,.json" hidden onChange={doImport} />
          </label>
        </div>
      </div>

      {/* INFO */}
      <div className="mb-5 rounded-xl border border-stone-700/60 bg-stone-900/60 p-4 text-sm text-stone-300">
        <div className="font-medium mb-1">Nasıl çalışır?</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Kaynak ürünler <code>{LS_PRODUCTS}</code>’tan okunur.</li>
          <li>Kampanya verisi <code>{LS_CAMPAIGNS}</code> anahtarıyla saklanır.</li>
          <li>Sepet promosyon ayarları <code>{LS_SETTINGS}</code> anahtarıyla saklanır.</li>
          <li><b>Kapsam</b>ı kategori veya tekil ürün olarak seç.</li>
          <li>Varsayılan kapsam <b>“sadece teslimat”</b>tır. İstersen “pickup” veya “her ikisi”.</li>
          <li>Başlangıç–bitiş aralığı dışındaysa uygulanmaz. <i>(Zaman yoksa anında geçerli.)</i></li>
          <li><b>Öncelik</b> büyük olan önce gelir. Çakışmada en yüksek öncelik kazanır.</li>
        </ul>
      </div>

      {/* FORM */}
      <div className="card mb-6">
        <div className="mb-3 text-lg font-medium">
          {editId ? "Kampanya Düzenle" : "Yeni Kampanya"}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Kampanya Adı *">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn: Vegan %15"
            />
          </Field>

          <Field label="Rozet (Badge)">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder='Örn: "%15" ya da "Aktion"'
            />
          </Field>

          <Field label="Öncelik">
            <input
              type="number"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={String(priority)}
              onChange={(e) => setPriority(toNum(e.target.value, 0))}
              placeholder="100"
            />
          </Field>

          <Field label="Mod">
            <select
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="delivery">Sadece Lieferung</option>
              <option value="pickup">Sadece Abholung</option>
              <option value="both">Her ikisi</option>
            </select>
          </Field>

          <Field label="İndirim Türü">
            <select
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={kind}
              onChange={(e) => setKind(e.target.value as DiscountKind)}
            >
              <option value="percent">% (yüzde)</option>
              <option value="absolute">€ (sabit indirim)</option>
              <option value="newPrice">Yeni Fiyat (€)</option>
            </select>
          </Field>

          <Field label={kind === "percent" ? "Değer (%) *" : kind === "absolute" ? "Değer (€) *" : "Yeni Fiyat (€) *"}>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={String(value)}
              onChange={(e) => setValue(toNum(e.target.value, 0))}
              placeholder={kind === "percent" ? "10" : "2.50"}
            />
          </Field>

          {/* Başlangıç + Takvim düğmesi */}
          <Field label="Başlangıç">
            <div className="flex items-center gap-2">
              <input
                ref={startRef}
                type="datetime-local"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
              <button type="button" className="pill" onClick={() => openPicker(startRef.current)} title="Tarih seç">
                🗓
              </button>
            </div>
          </Field>

          {/* Bitiş + Takvim düğmesi */}
          <Field label="Bitiş">
            <div className="flex items-center gap-2">
              <input
                ref={endRef}
                type="datetime-local"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
              <button type="button" className="pill" onClick={() => openPicker(endRef.current)} title="Tarih seç">
                🗓
              </button>
            </div>
          </Field>

          <Field label="Sipariş başı maksimum adet (opsiyonel)">
            <input
              type="number"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={maxQtyPerOrder}
              onChange={(e) => setMaxQtyPerOrder(e.target.value)}
              placeholder="boş bırakılabilir"
            />
          </Field>

          <div className="flex items-center gap-6 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              Aktif
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showCountdown}
                onChange={(e) => setShowCountdown(e.target.checked)}
              />
              Sayaç (countdown) göster
            </label>
          </div>

          {/* Scope selector */}
          <div className="md:col-span-2">
            <div className="mb-2 text-sm opacity-80">Kapsam *</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`nav-pill ${scope === "category" ? "nav-pill--active" : ""}`}
                onClick={() => setScope("category")}
              >
                Etageegori
              </button>
              <button
                type="button"
                className={`nav-pill ${scope === "product" ? "nav-pill--active" : ""}`}
                onClick={() => setScope("product")}
              >
                Ürün
              </button>
            </div>

            {/* Category scope */}
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
                          active ? prev.filter((x) => x !== c.value) : [...prev, c.value]
                        )
                      }
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Product scope */}
            {scope === "product" && (
              <div className="mt-3 rounded-lg border border-stone-700/60 p-3">
                <div className="mb-2 flex flex_wrap items-center gap-2">
                  <select
                    className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={prodFilterCat}
                    onChange={(e) => setProdFilterCat(e.target.value as any)}
                  >
                    <option value="all">Tüm Etageegoriler</option>
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
                    placeholder="Ürün ara…"
                  />
                </div>

                <div className="max-h-72 overflow-auto rounded border border-stone-700/60">
                  {filteredProducts.length === 0 ? (
                    <div className="p-3 text-sm opacity-70">Ürün bulunamadı.</div>
                  ) : (
                    <ul className="divide-y divide-stone-700/60">
                      {filteredProducts.map((p) => {
                        const checked = productIds.includes(p.id);
                        return (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-3 p-2"
                          >
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
                              onClick={() => toggleProductInScope(p.id)} // 👈 p.id zaten normalize
                            >
                              {checked ? "Seçildi" : "Seç"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {productIds.length > 0 && (
                  <div className="mt-2 text-xs text-stone-300">
                    Seçili ürün sayısı: <b>{productIds.length}</b>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button className="card-cta card-cta--lg" onClick={save}>
            {editId ? "Kaydet" : "Ekle"}
          </button>
          {editId && (
            <button className="btn-ghost" onClick={resetForm}>
              İptal
            </button>
          )}
        </div>
      </div>

      {/* =========================
          🆕 SEPET KAMPANYASI (FREEBIES)
          ========================= */}
      <div className="card mb-6">
        <div className="mb-3 text-lg font-medium">Sepette Ücretsiz Ürün (Freebie)</div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fbEnabled}
                onChange={(e) => setFbEnabled(e.target.checked)}
              />
              Aktif
            </label>
          </div>

          <Field label="Hedef Etageegori">
            <select
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={fbCategory}
              onChange={(e) => setFbCategory(e.target.value as FreebieCategory)}
            >
              <option value="sauces">Soßen (Soslar)</option>
              <option value="drinks">Getränke (İçecekler)</option>
            </select>
          </Field>

          <Field label="Sepet bandı metni (opsiyonel)">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={fbBanner}
              onChange={(e) => setFbBanner(e.target.value)}
              placeholder="Örn: Bugüne özel 30€ üstü 1 içecek ücretsiz!"
            />
          </Field>

          <div className="md:col-span-2">
            <div className="mb-2 text-sm opacity-80">Kademeler</div>
            <div className="overflow-hidden rounded-lg border border-stone-700/60">
              <table className="w-full text-sm">
                <thead className="bg-stone-900/70 text-stone-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Min. Sepet (€)</th>
                    <th className="px-3 py-2 text-left">
                      Ücretsiz {fbCategory === "sauces" ? "Sos" : "İçecek"} (adet)
                    </th>
                    <th className="px-3 py-2 text-right">İşlem</th>
                  </tr>
                </thead>
                <tbody>
                  {fbTiers.map((t, i) => (
                    <tr key={i} className="border-t border-stone-700/60">
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          step="0.01"
                          className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-1.5 outline-none"
                          value={String(t.minTotal)}
                          onChange={(e) => updateTier(i, { minTotal: toNum(e.target.value, 0) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-1.5 outline-none"
                          value={String(t.freeSauces)}
                          onChange={(e) =>
                            updateTier(i, { freeSauces: Math.max(0, Math.floor(toNum(e.target.value, 0))) })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => removeTier(i)}
                          disabled={fbTiers.length <= 1}
                          title={fbTiers.length <= 1 ? "En az bir kademe olmalı" : "Löschen"}
                        >
                          Löschen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="pill" onClick={addTier}>+ Kademe ekle</button>
              <div className="text-xs text-stone-400">
                Uygulama: Sepetteki <b>ilk uygun</b> {fbCategory === "sauces" ? "sos" : "içecek"} adetleri ücretsiz
                yapılır. (Limit: kademeye göre.)
              </div>
            </div>

            {/* Preview */}
            {sortedPreview.length > 0 && (
              <div className="mt-3 text-xs text-stone-300">
                Kural önizleme:{" "}
                {sortedPreview.map((t) => `${t.minTotal}€ → ${t.freeSauces} adet`).join(" • ")}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* LIST */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="font-medium">Kampanyalar</div>
          <input
            className="ml-auto rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Kampanya ara…"
          />
        </div>

        {list.length === 0 ? (
          <div className="text-sm opacity-70">Kayıt yok.</div>
        ) : (
          <div className="grid gap-2">
            {list.map((c) => {
              const scopeText =
                c.scope === "category"
                  ? (c.categories || [])
                      .map((x) => CATS.find((y) => y.value === x)?.label ?? x)
                      .join(", ")
                  : `${c.productIds?.length ?? 0} ürün`;
              const timeText =
                (c.startAt ? `ab ${new Date(c.startAt).toLocaleString()}` : "sofort") +
                (c.endAt ? ` • bis ${new Date(c.endAt).toLocaleString()}` : "");
              const kindText =
                c.kind === "percent"
                  ? `%${c.value}`
                  : c.kind === "absolute"
                  ? `-${Number(c.value).toFixed(2)} €`
                  : `Neu: ${Number(c.value).toFixed(2)} €`;
              const modeText =
                c.mode === "both" ? "Lieferung+Abholung" : c.mode === "delivery" ? "Lieferung" : "Abholung";

              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded border border-stone-700/60 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{c.name}</div>
                      {c.badge ? (
                        <span className="badge badge--campaign">{c.badge}</span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          c.enabled ? "bg-emerald-600 text-black" : "bg-stone-800 text-stone-200"
                        }`}
                      >
                        {c.enabled ? "Aktiv" : "Inaktiv"}
                      </span>
                    </div>
                    <div className="text-xs text-stone-400">
                      {c.scope === "category" ? "Etageegori" : "Ürün"} • {scopeText}
                      {" • "}
                      {kindText}
                      {" • "}
                      {modeText}
                      {c.maxQtyPerOrder != null ? ` • max ${c.maxQtyPerOrder}/sip.` : ""}
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
                      Düzenle
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}
