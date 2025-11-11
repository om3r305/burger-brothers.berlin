"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useRef } from "react";

/* =========================
 * Types
 * ========================= */
type Category =
  | "burger"
  | "extras"
  | "drinks"
  | "sauces"
  | "vegan"
  | "hotdogs"
  | "donuts"
  | "bubbleTea";

type Extra = { id: string; name: string; price: number };

/** Zeitplan + Aktiv/Passiv + Sıralama + Günlük Limit */
type Product = {
  id: string;
  name: string;
  price: number;
  category: Category;
  imageUrl?: string;
  description?: string;
  extras?: Extra[];
  allergens?: string[];
  active?: boolean;
  activeFrom?: string; // ISO / datetime-local value
  activeTo?: string;   // ISO / datetime-local value
  /** Kategori içi sıralama (0..N-1) */
  order?: number;
  /** Günlük stok limiti; 0/undefined/null = sınırsız */
  dailyLimit?: number | null;
};

type Variant = {
  id: string;
  name: string;
  price: number;
  /** Variante im Shop (Menü) ein-/ausblenden */
  active?: boolean;
  /** Optionaler Tagesbestand; leer/undefined = unbegrenzt */
  stock?: number | null;
  /** Optionales Bild (überschreibt Gruppenbild in der Karte) */
  image?: string;
};

type VariantGroup = {
  id: string;
  sku: string;
  name: string;
  description?: string;
  image?: string;
  variants: Variant[];
};

/* =========================
 * LocalStorage Keys
 * ========================= */
const LS_PRODUCTS = "bb_products_v1";
const LS_DRINK_GROUPS = "bb_drink_groups_v1";
const LS_EXTRA_GROUPS = "bb_extra_groups_v1";

/* =========================
 * Utils
 * ========================= */
const rid = () =>
  (typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : String(Date.now() + Math.random()));

const CATS: { value: Category; label: string }[] = [
  { value: "burger",    label: "Burger" },
  { value: "vegan",     label: "Vegan / Vegetarisch" },
  { value: "extras",    label: "Extras" },
  { value: "sauces",    label: "Soßen" },
  { value: "hotdogs",   label: "Hot Dogs" },
  { value: "drinks",    label: "Getränke" },
  { value: "donuts",    label: "Donuts" },
  { value: "bubbleTea", label: "Bubble Tea" },
];

function toNum(v: string, fallback = 0) {
  const n = Number((v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
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

/** Status-Badge des Produkts */
function statusOf(p: Product, now = new Date()) {
  const isActive = p.active !== false;
  const from = p.activeFrom ? new Date(p.activeFrom) : null;
  const to   = p.activeTo ? new Date(p.activeTo) : null;

  if (!isActive) return { key: "inactive", label: "Inaktiv", cls: "bg-stone-800 text-stone-200" };

  const afterFrom = !from || now >= from;
  const beforeTo  = !to   || now <= to;

  if (afterFrom && beforeTo) return { key: "active", label: "Aktiv", cls: "bg-emerald-600 text-black" };
  if (from && now < from)    return { key: "scheduled", label: "Geplant", cls: "bg-amber-500 text-black" };
  if (to && now > to) return { key: "inactive", label: "Inaktiv", cls: "bg-stone-800 text-stone-200" };

  return { key: "active", label: "Aktiv", cls: "bg-emerald-600 text-black" };
}

/* =========================
 * Order helpers (Pro seviye)
 * ========================= */

/** Kategori içi order alanlarını 0..N-1 olacak şekilde normalize eder */
function normalizeOrders(list: Product[]): Product[] {
  const byCat: Record<Category, Product[]> = {
    burger: [], extras: [], drinks: [], sauces: [], vegan: [],
    hotdogs: [], donuts: [], bubbleTea: []
  };
  for (const p of list) byCat[p.category]?.push(p);

  const next: Product[] = [];
  (Object.keys(byCat) as Category[]).forEach((cat) => {
    const arr = byCat[cat];
    // Var olan order’a göre, yoksa ada göre
    arr.sort((a, b) => {
      const ao = Number.isFinite(a.order as any) ? (a.order as number) : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order as any) ? (b.order as number) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
    arr.forEach((p, i) => next.push({ ...p, order: i }));
  });
  // orijin liste sırasını koruyarak merge
  const map = new Map(next.map((p) => [p.id, p]));
  return list.map((p) => map.get(p.id) || p);
}

/** Aynı kategoride bir ürünü yukarı/aşağı taşır (swap + reindex) */
function moveProduct(list: Product[], id: string, dir: -1 | 1): Product[] {
  const item = list.find((x) => x.id === id);
  if (!item) return list;
  const cat = item.category;
  const catItems = list.filter((x) => x.category === cat).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = catItems.findIndex((x) => x.id === id);
  const j = idx + dir;
  if (j < 0 || j >= catItems.length) return list;

  // swap
  const a = catItems[idx];
  const b = catItems[j];
  const aOrder = a.order ?? idx;
  const bOrder = b.order ?? j;

  const out = list.map((p) => {
    if (p.id === a.id) return { ...p, order: bOrder };
    if (p.id === b.id) return { ...p, order: aOrder };
    return p;
  });
  return normalizeOrders(out);
}

/** Yeni ürüne verilecek order (kategorideki max+1) */
function nextOrderFor(list: Product[], cat: Category) {
  const max = list
    .filter(p => p.category === cat)
    .reduce((m, p) => Math.max(m, Number.isFinite(p.order as any) ? (p.order as number) : -1), -1);
  return max + 1;
}

/* =========================
 * Component
 * ========================= */
export default function AdminPage() {
  const r = useRouter();

  // Tabs: products | drinks | extras
  const [tab, setTab] = useState<"products" | "drinks" | "extras">("products");

  // ---------- GLOBAL SEARCH ----------
  const [globalQ, setGlobalQ] = useState("");

  // ---------- PRODUCTS ----------
  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<Category | "all">("burger");

  // form state – product
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number>(9.9);
  const [category, setCategory] = useState<Category>("burger");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [exName, setExName] = useState("");
  const [exPrice, setExPrice] = useState<number>(0.5);
  const [draftExtras, setDraftExtras] = useState<Extra[]>([]);
  const [editId, setEditId] = useState<string | null>(null);

  // Allergene
  const [allergenInput, setAllergenInput] = useState("");
  const [draftAllergens, setDraftAllergens] = useState<string[]>([]);

  // Aktiv/Plan
  const [active, setActive] = useState(true);
  const [activeFrom, setActiveFrom] = useState<string>("");
  const [activeTo, setActiveTo] = useState<string>("");

  // Günlük Limit (form)
  const [dailyLimit, setDailyLimit] = useState<string>(""); // boş = sınırsız

  // ---------- DRINK GROUPS ----------
  const [drinkGroups, setDrinkGroups] = useState<VariantGroup[]>([]);
  const [dgEditId, setDgEditId] = useState<string | null>(null);
  const [dgSku, setDgSku] = useState("");
  const [dgName, setDgName] = useState("");
  const [dgDesc, setDgDesc] = useState("");
  const [dgImage, setDgImage] = useState("");
  const [dgVarName, setDgVarName] = useState("");
  const [dgVarPrice, setDgVarPrice] = useState<number>(0);
  const [dgVariants, setDgVariants] = useState<Variant[]>([]);

  // ---------- EXTRA GROUPS ----------
  const [extraGroups, setExtraGroups] = useState<VariantGroup[]>([]);
  const [egEditId, setEgEditId] = useState<string | null>(null);
  const [egSku, setEgSku] = useState("");
  const [egName, setEgName] = useState("");
  const [egDesc, setEgDesc] = useState("");
  const [egImage, setEgImage] = useState("");
  const [egVarName, setEgVarName] = useState("");
  const [egVarPrice, setEgVarPrice] = useState<number>(0);
  const [egVariants, setEgVariants] = useState<Variant[]>([]);

  // -------- Öffentlicher Bildwähler --------
  const [imgPickerOpen, setImgPickerOpen] = useState<null | "product" | "drink" | "extra">(null);
  const [imgDraft, setImgDraft] = useState("");

  /* ====== LOAD ====== */
  useEffect(() => {
    try {
      const rawP = localStorage.getItem(LS_PRODUCTS);
      if (rawP) {
        const parsed = JSON.parse(rawP) as Product[];
        const base = Array.isArray(parsed) ? parsed : [];
        setItems(normalizeOrders(base));
      }
    } catch {}

    try {
      const rawD = localStorage.getItem(LS_DRINK_GROUPS);
      if (rawD) {
        const parsed = JSON.parse(rawD) as VariantGroup[];
        const safe = (Array.isArray(parsed) ? parsed : []).map((g) => ({
          ...g,
          id: g?.id || rid(),
          variants: (g?.variants || []).map((v: any) => ({
            id: v?.id || rid(),
            name: String(v?.name ?? ""),
            price: Number(v?.price) || 0,
            active: typeof v?.active === "boolean" ? v.active : true,
            stock: Number.isFinite(Number(v?.stock)) ? Number(v.stock) : null,
            image: v?.image ? String(v.image) : undefined,
          })),
        }));
        setDrinkGroups(safe);
      }
    } catch {}

    try {
      const rawE = localStorage.getItem(LS_EXTRA_GROUPS);
      if (rawE) {
        const parsed = JSON.parse(rawE) as VariantGroup[];
        const safe = (Array.isArray(parsed) ? parsed : []).map((g) => ({
          ...g,
          id: g?.id || rid(),
          variants: (g?.variants || []).map((v: any) => ({
            id: v?.id || rid(),
            name: String(v?.name ?? ""),
            price: Number(v?.price) || 0,
            active: typeof v?.active === "boolean" ? v.active : true,
            stock: Number.isFinite(Number(v?.stock)) ? Number(v.stock) : null,
            image: v?.image ? String(v.image) : undefined,
          })),
        }));
        setExtraGroups(safe);
      }
    } catch {}
  }, []);

  /* ====== PERSIST ====== */
  useDebouncedEffect(() => {
    try { localStorage.setItem(LS_PRODUCTS, JSON.stringify(items)); } catch {}
  }, [items], 300);

  
  // Mark as manually edited so sync/pull won't override
  useDebouncedEffect(() => {
    try { 
      localStorage.setItem("bb_products_manual", "1");
      localStorage.setItem("bb_products_v1_version", String(Date.now()));
    } catch {}
  }, [items], 0);
useDebouncedEffect(() => {
    try { localStorage.setItem(LS_DRINK_GROUPS, JSON.stringify(drinkGroups)); } catch {}
  }, [drinkGroups], 300);

  useDebouncedEffect(() => {
    try { localStorage.setItem(LS_EXTRA_GROUPS, JSON.stringify(extraGroups)); } catch {}
  }, [extraGroups], 300);

  /* ====== FILTERED LIST (PRODUCTS) ====== */
  const list = useMemo(() => {
    const qLocal = search.trim().toLowerCase();
    const qGlobal = globalQ.trim().toLowerCase();
    const q = (qLocal || qGlobal).trim();

    return items
      .filter((p) => (filterCat === "all" ? true : p.category === filterCat))
      .filter((p) =>
        !q
          ? true
          : (p.name + " " + (p.description || "") + " " + (p.allergens || []).join(" "))
              .toLowerCase()
              .includes(q)
      )
      // Önce order, sonra isim
      .sort((a, b) => {
        const ao = Number.isFinite(a.order as any) ? (a.order as number) : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order as any) ? (b.order as number) : Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
  }, [items, search, filterCat, globalQ]);

  /* ====== DRINK/EXTRA LIST FILTER (GLOBAL SEARCH) ====== */
  const filteredDrinkGroups = useMemo(() => {
    const q = globalQ.trim().toLowerCase();
    if (!q) return drinkGroups;
    return drinkGroups.filter((g) =>
      (g.name + " " + g.sku + " " + (g.description || "") + " " + g.variants.map(v => v.name).join(" "))
        .toLowerCase()
        .includes(q)
    );
  }, [drinkGroups, globalQ]);

  const filteredExtraGroups = useMemo(() => {
    const q = globalQ.trim().toLowerCase();
    if (!q) return extraGroups;
    return extraGroups.filter((g) =>
      (g.name + " " + g.sku + " " + (g.description || "") + " " + g.variants.map(v => v.name).join(" "))
        .toLowerCase()
        .includes(q)
    );
  }, [extraGroups, globalQ]);

  /* ====== CRUD: PRODUCTS ====== */
  const addOrUpdate = () => {
    if (!name.trim()) return;
    const limitNum =
      dailyLimit.trim() === "" ? null : Math.max(0, Math.floor(Number(dailyLimit) || 0));

    const prod: Product = {
      id: editId || rid(),
      name: name.trim(),
      price: Number.isFinite(price) ? price : 0,
      category,
      imageUrl: imageUrl.trim() || undefined,
      description: description.trim() || undefined,
      extras: draftExtras.length ? draftExtras : undefined,
      allergens: draftAllergens.length ? draftAllergens : undefined,
      active,
      activeFrom: activeFrom || undefined,
      activeTo: activeTo || undefined,
      dailyLimit: limitNum,
      order: editId
        ? items.find((p) => p.id === editId)?.order ?? 0
        : nextOrderFor(items, category),
    };

    setItems((prev) =>
      editId ? normalizeOrders(prev.map((p) => (p.id === editId ? prod : p))) : normalizeOrders([prod, ...prev])
    );
    resetForm();
  };

  const resetForm = () => {
    setEditId(null);
    setName("");
    setPrice(9.9);
    setCategory("burger");
    setImageUrl("");
    setDescription("");
    setDraftExtras([]);
    setExName("");
    setExPrice(0.5);
    setDraftAllergens([]);
    setAllergenInput("");
    setActive(true);
    setActiveFrom("");
    setActiveTo("");
    setDailyLimit("");
  };

  const del = (id: string) => setItems((prev) => normalizeOrders(prev.filter((p) => p.id !== id)));

  const edit = (p: Product) => {
    setEditId(p.id);
    setName(p.name);
    setPrice(p.price);
    setCategory(p.category);
    setImageUrl(p.imageUrl || "");
    setDescription(p.description || "");
    setDraftExtras([...(p.extras || [])]);
    setDraftAllergens([...(p.allergens || [])]);
    setAllergenInput("");
    setActive(p.active ?? true);
    setActiveFrom(p.activeFrom || "");
    setActiveTo(p.activeTo || "");
    setDailyLimit(
      p.dailyLimit == null ? "" : String(Math.max(0, Math.floor(Number(p.dailyLimit) || 0)))
    );
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
  };

  const addExtra = () => {
    if (!exName.trim()) return;
    setDraftExtras((prev) => [
      ...prev,
      { id: rid(), name: exName.trim(), price: Number.isFinite(exPrice) ? exPrice : 0 },
    ]);
    setExName("");
    setExPrice(0.5);
  };
  const delExtra = (id: string) =>
    setDraftExtras((prev) => prev.filter((e) => e.id !== id));

  // Allergene
  const addAllergen = () => {
    const raw = allergenInput.trim().toUpperCase();
    if (!raw) return;
    const codes = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    setDraftAllergens((prev) => {
      const set = new Set(prev.map((x) => x.toUpperCase()));
      codes.forEach((c) => set.add(c));
      return Array.from(set);
    });
    setAllergenInput("");
  };
  const delAllergen = (code: string) =>
    setDraftAllergens((prev) => prev.filter((c) => c !== code));

  // Sıralama okları
  const moveUp = (id: string) => setItems((prev) => moveProduct(prev, id, -1));
  const moveDown = (id: string) => setItems((prev) => moveProduct(prev, id, +1));

  /* ====== CRUD: DRINK GROUPS ====== */
  const resetDGForm = () => {
    setDgEditId(null);
    setDgSku("");
    setDgName("");
    setDgDesc("");
    setDgImage("");
    setDgVariants([]);
    setDgVarName("");
    setDgVarPrice(0);
  };

  const addDGVar = () => {
    if (!dgVarName.trim()) return;
    setDgVariants((prev) => [
      ...prev,
      { id: rid(), name: dgVarName.trim(), price: Number(dgVarPrice) || 0, active: true, stock: null }
    ]);
    setDgVarName("");
    setDgVarPrice(0);
  };
  const delDGVar = (id: string) =>
    setDgVariants((prev) => prev.filter((v) => v.id !== id));

  const updDGVar = (id: string, patch: Partial<Variant>) =>
    setDgVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const saveDG = () => {
    if (!dgSku.trim() || !dgName.trim()) return;
    const g: VariantGroup = {
      id: dgEditId || rid(),
      sku: dgSku.trim(),
      name: dgName.trim(),
      description: dgDesc.trim() || undefined,
      image: dgImage.trim() || undefined,
      variants: dgVariants.map(v => ({
        ...v,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock)) ? Number(v.stock) : (v.stock === 0 ? 0 : null),
      })),
    };
    setDrinkGroups((prev) => (dgEditId ? prev.map((x) => (x.id === dgEditId ? g : x)) : [g, ...prev]));
    resetDGForm();
  };
  const editDG = (g: VariantGroup) => {
    setDgEditId(g.id);
    setDgSku(g.sku);
    setDgName(g.name);
    setDgDesc(g.description || "");
    setDgImage(g.image || "");
    setDgVariants(g.variants.map(v => ({
      id: v.id, name: v.name, price: v.price,
      active: v.active !== false, stock: Number.isFinite(Number(v.stock)) ? Number(v.stock) : (v.stock === 0 ? 0 : null),
      image: v.image
    })));
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
  };
  const delDG = (id: string) =>
    setDrinkGroups((prev) => prev.filter((g) => g.id !== id));

  /* ====== CRUD: EXTRA GROUPS ====== */
  const resetEGForm = () => {
    setEgEditId(null);
    setEgSku("");
    setEgName("");
    setEgDesc("");
    setEgImage("");
    setEgVariants([]);
    setEgVarName("");
    setEgVarPrice(0);
  };

  const addEGVar = () => {
    if (!egVarName.trim()) return;
    setEgVariants((prev) => [
      ...prev,
      { id: rid(), name: egVarName.trim(), price: Number(egVarPrice) || 0, active: true, stock: null }
    ]);
    setEgVarName("");
    setEgVarPrice(0);
  };
  const delEGVar = (id: string) =>
    setEgVariants((prev) => prev.filter((v) => v.id !== id));

  const updEGVar = (id: string, patch: Partial<Variant>) =>
    setEgVariants((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));

  const saveEG = () => {
    if (!egSku.trim() || !egName.trim()) return;
    const g: VariantGroup = {
      id: egEditId || rid(),
      sku: egSku.trim(),
      name: egName.trim(),
      description: egDesc.trim() || undefined,
      image: egImage.trim() || undefined,
      variants: egVariants.map(v => ({
        ...v,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock)) ? Number(v.stock) : (v.stock === 0 ? 0 : null),
      })),
    };
    setExtraGroups((prev) => (egEditId ? prev.map((x) => (x.id === egEditId ? g : x)) : [g, ...prev]));
    resetEGForm();
  };
  const editEG = (g: VariantGroup) => {
    setEgEditId(g.id);
    setEgSku(g.sku);
    setEgName(g.name);
    setEgDesc(g.description || "");
    setEgImage(g.image || "");
    setEgVariants(g.variants.map(v => ({
      id: v.id, name: v.name, price: v.price,
      active: v.active !== false, stock: Number.isFinite(Number(v.stock)) ? Number(v.stock) : (v.stock === 0 ? 0 : null),
      image: v.image
    })));
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
  };
  const delEG = (id: string) =>
    setExtraGroups((prev) => prev.filter((g) => g.id !== id));

  /* ====== EXPORT / IMPORT (ALL DATA) ====== */
  const doExportAll = () => {
    try {
      const payload = {
        products: items,               // order & dailyLimit dahil
        drinkGroups,
        extraGroups,
        _meta: { version: 3, note: "products: order & dailyLimit; variants: active/stock/image" },
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "menu-data.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  const doImportAll = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      const json = JSON.parse(txt) as {
        products?: Product[];
        drinkGroups?: VariantGroup[];
        extraGroups?: VariantGroup[];
      };

      const allowed = [
        "burger",
        "extras",
        "drinks",
        "sauces",
        "vegan",
        "hotdogs",
        "donuts",
        "bubbleTea",
      ] as const;

      const normProducts = (Array.isArray(json.products) ? json.products : []).map((p: any) => {
        const allergens: string[] = Array.isArray(p?.allergens)
          ? p.allergens.map((c: any) => String(c).toUpperCase().trim()).filter(Boolean)
          : [];
        const uniqAll = Array.from(new Set(allergens));
        const cat = (allowed.includes(p.category as any) ? (p.category as Category) : "burger");
        const lim =
          p?.dailyLimit == null || p.dailyLimit === ""
            ? null
            : Math.max(0, Math.floor(Number(p.dailyLimit) || 0));
        return {
          id: p.id || rid(),
          name: String(p.name ?? ""),
          price: Number(p.price) || 0,
          category: cat,
          imageUrl: p.imageUrl || undefined,
          description: p.description || undefined,
          extras: Array.isArray(p.extras)
            ? p.extras.map((e: any) => ({
                id: e?.id || rid(),
                name: String(e?.name ?? ""),
                price: Number(e?.price) || 0,
              }))
            : undefined,
          allergens: uniqAll.length ? uniqAll : undefined,
          active: typeof p.active === "boolean" ? p.active : true,
          activeFrom: p.activeFrom || undefined,
          activeTo: p.activeTo || undefined,
          order: Number.isFinite(Number(p?.order)) ? Number(p.order) : undefined,
          dailyLimit: lim,
        } as Product;
      });

      const normVG = (arr: any[]) =>
        (Array.isArray(arr) ? arr : []).map((g: any) => ({
          id: g?.id || rid(),
          sku: String(g?.sku ?? ""),
          name: String(g?.name ?? ""),
          description: g?.description ? String(g.description) : undefined,
          image: g?.image ? String(g.image) : undefined,
          variants: Array.isArray(g?.variants)
            ? g.variants.map((v: any) => ({
                id: v?.id || rid(),
                name: String(v?.name ?? ""),
                price: Number(v?.price) || 0,
                active: typeof v?.active === "boolean" ? v.active : true,
                stock: Number.isFinite(Number(v?.stock)) ? Number(v.stock) : (v?.stock === 0 ? 0 : null),
                image: v?.image ? String(v.image) : undefined,
              }))
            : [],
        })) as VariantGroup[];

      // order normalizasyonu
      const normalized = normalizeOrders(normProducts);

      setItems(normalized);
      setDrinkGroups(normVG(json.drinkGroups || []));
      setExtraGroups(normVG(json.extraGroups || []));
      setFilterCat("burger");
      setTab("products");
      ev.target.value = "";
      alert(
        `Import erfolgreich ✅\n` +
        `Produkte: ${normalized.length}\n` +
        `Getränke-Gruppen: ${(json.drinkGroups?.length ?? 0)}\n` +
        `Extras-Gruppen: ${(json.extraGroups?.length ?? 0)}`
      );
    } catch (e: any) {
      alert("Import-Fehler: Ungültige JSON.\n" + (e?.message || ""));
      ev.target.value = "";
    }
  };

  // Logout (Cookie-basiert)
  const logout = async () => {
    try { await fetch("/api/admin/logout", { method: "POST" }); } catch {}
    r.replace("/admin/login");
  };

  /* =========================
   * Öffentlicher Bildwähler (leichtes Modal)
   * ========================= */
  const openPicker = (kind: "product" | "drink" | "extra") => {
    setImgDraft("");
    setImgPickerOpen(kind);
  };
  const applyPicker = () => {
    if (!imgDraft.trim()) { setImgPickerOpen(null); return; }
    if (imgPickerOpen === "product") setImageUrl(imgDraft.trim());
    if (imgPickerOpen === "drink") setDgImage(imgDraft.trim());
    if (imgPickerOpen === "extra") setEgImage(imgDraft.trim());
    setImgPickerOpen(null);
  };

  /* =========================
   * UI (mit linker, vertikaler Navigation)
   * ========================= */
  return (
    <main className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Adminbereich</h1>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={doExportAll}>Export (JSON)</button>
          <label className="btn-ghost cursor-pointer">
            Import
            <input id="file-import" type="file" accept=".json,application/json" onChange={doImportAll} hidden />
          </label>
          <button className="btn-ghost" onClick={logout}>Abmelden</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Linke, vertikale Navigation */}
        <aside className="h-full rounded-xl border border-stone-700/60 bg-stone-900/60 p-3 lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3">
            <input
              value={globalQ}
              onChange={(e) => setGlobalQ(e.target.value)}
              placeholder="Global suchen…"
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 text-sm outline-none"
              aria-label="Global suchen"
            />
          </div>
          <nav className="flex flex-col gap-2">
            <button
              className={`nav-pill w-full justify-start ${tab === "products" ? "nav-pill--active" : ""}`}
              onClick={() => setTab("products")}
              aria-current={tab === "products" ? "page" : undefined}
            >
              🍔 Produkte
            </button>
            <button
              className={`nav-pill w-full justify-start ${tab === "drinks" ? "nav-pill--active" : ""}`}
              onClick={() => setTab("drinks")}
              aria-current={tab === "drinks" ? "page" : undefined}
            >
              🥤 Getränke-Gruppen
            </button>
            <button
              className={`nav-pill w-full justify-start ${tab === "extras" ? "nav-pill--active" : ""}`}
              onClick={() => setTab("extras")}
              aria-current={tab === "extras" ? "page" : undefined}
            >
              🍟 Extras-Gruppen
            </button>
          </nav>
        </aside>

        {/* Rechte Inhaltsfläche */}
        <section className="min-w-0">
          {/* ===== PRODUCTS TAB ===== */}
          {tab === "products" && (
            <>
              {/* Formular */}
              <div className="card mb-6">
                <div className="mb-3 text-lg font-medium">
                  {editId ? "Produkt bearbeiten" : "Neues Produkt"}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm opacity-80">Name *</div>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Produktname"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Preis (€) *</div>
                    <input
                      type="number"
                      step="0.01"
                      value={String(price)}
                      onChange={(e) => setPrice(toNum(e.target.value, 0))}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="z. B. 9,90"
                    />
                  </div>

                  <div>
                    <div className="mb-1 text-sm opacity-80">Etageegorie *</div>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as Category)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    >
                      {CATS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div className="mb-1 text-sm opacity-80">Bild-URL (optional)</div>
                    <div className="flex gap-2">
                      <input
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        placeholder="/images/burgers/classic.jpeg"
                      />
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => openPicker("product")}
                        title="Öffentliche Bilder auswählen"
                      >
                        Öffentliche Bilder
                      </button>
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <div className="mb-1 text-sm opacity-80">Beschreibung</div>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Kurzbeschreibung"
                    />
                  </div>

                  {/* Aktiv / Zeitplan */}
                  <div className="flex items-center gap-2">
                    <input
                      id="p-active"
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <label htmlFor="p-active" className="text-sm">Aktiv</label>
                  </div>

                  <div>
                    <div className="mb-1 text-sm opacity-80">Aktiv von</div>
                    <input
                      type="datetime-local"
                      value={activeFrom}
                      onChange={(e) => setActiveFrom(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Aktiv bis</div>
                    <input
                      type="datetime-local"
                      value={activeTo}
                      onChange={(e) => setActiveTo(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                  </div>

                  {/* Günlük Limit */}
                  <div>
                    <div className="mb-1 text-sm opacity-80">Günlük Limit (adet)</div>
                    <input
                      type="number"
                      min={0}
                      placeholder="boş = sınırsız"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                  </div>
                </div>

                {/* Extras */}
                <div className="mt-4">
                  <div className="mb-1 text-sm opacity-80">Extras (optional)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={exName}
                      onChange={(e) => setExName(e.target.value)}
                      placeholder="Extra-Name"
                      className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={String(exPrice)}
                      onChange={(e) => setExPrice(toNum(e.target.value, 0))}
                      className="w-28 rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="0,50"
                    />
                    <button className="card-cta" onClick={addExtra}>
                      Extra hinzufügen
                    </button>
                  </div>

                  {draftExtras.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draftExtras.map((e) => (
                        <span key={e.id} className="pill">
                          {e.name} (+{e.price.toFixed(2)} €)
                          <button
                            className="ml-2 text-stone-400 hover:text-stone-100"
                            onClick={() => delExtra(e.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Allergene */}
                <div className="mt-6">
                  <div className="mb-1 text-sm opacity-80">Allergen-/Zusatzstoff-Codes (optional)</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={allergenInput}
                      onChange={(e) => setAllergenInput(e.target.value)}
                      placeholder='z. B. "A G 2" oder "A, G, 2"'
                      className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                    <button className="card-cta" onClick={addAllergen}>
                      Code(s) hinzufügen
                    </button>
                  </div>

                  {draftAllergens.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {draftAllergens
                        .slice()
                        .sort((a, b) => a.localeCompare(b))
                        .map((code) => (
                          <span key={code} className="pill">
                            {code}
                            <button
                              className="ml-2 text-stone-400 hover:text-stone-100"
                              onClick={() => delAllergen(code)}
                              aria-label={`${code} entfernen`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-stone-400">
                    Beispiele: A (Gluten), C (Ei), G (Milch/Laktose), 1 (mit Farbstoff), 2 (mit Konservierungsstoff) …
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2">
                  <button className="card-cta card-cta--lg" onClick={addOrUpdate}>
                    {editId ? "Speichern" : "Hinzufügen"}
                  </button>
                  {editId && (
                    <button className="btn-ghost" onClick={resetForm}>
                      Abbrechen
                    </button>
                  )}
                </div>
              </div>

              {/* Liste + Filter */}
              <div className="card">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="font-medium">Produkte</div>
                  <select
                    value={filterCat}
                    onChange={(e) => setFilterCat(e.target.value as any)}
                    className="ml-auto rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  >
                    {[
                      "burger",
                      "vegan",
                      "extras",
                      "sauces",
                      "hotdogs",
                      "drinks",
                      "donuts",
                      "bubbleTea",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {CATS.find((x) => x.value === (c as Category))?.label ?? c}
                      </option>
                    ))}
                    <option value="all">Alle Etageegorien</option>
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Nur Produkte durchsuchen…"
                    className="rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  />
                </div>

                {list.length === 0 ? (
                  <div className="text-sm opacity-70">Keine Produkte gefunden.</div>
                ) : (
                  <div className="grid gap-2">
                    {list.map((p) => {
                      const st = statusOf(p);
                      return (
                        <div
                          key={p.id}
                          className="flex flex-col gap-2 rounded border border-stone-700/60 p-3 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {/* Row Controls */}
                              <div className="flex items-center gap-1">
                                <button
                                  className="btn-ghost px-2 py-1"
                                  title="Yukarı taşı"
                                  onClick={() => moveUp(p.id)}
                                >
                                  ↑
                                </button>
                                <button
                                  className="btn-ghost px-2 py-1"
                                  title="Aşağı taşı"
                                  onClick={() => moveDown(p.id)}
                                >
                                  ↓
                                </button>
                              </div>

                              <div className="font-medium">
                                {p.name} — {p.price.toFixed(2)} €
                              </div>
                              <span className={`rounded-full px-2 py-0.5 text-[11px] ${st.cls}`}>
                                {st.label}
                              </span>
                            </div>
                            <div className="text-xs text-stone-400">
                              {CATS.find((x) => x.value === p.category)?.label ?? p.category}
                              {p.extras?.length ? ` • ${p.extras.length} Extra` : ""}
                              {p.allergens?.length ? ` • ${p.allergens.length} Allergen` : ""}
                              {p.activeFrom ? ` • ab ${new Date(p.activeFrom).toLocaleString()}` : ""}
                              {p.activeTo ? ` • bis ${new Date(p.activeTo).toLocaleString()}` : ""}
                              {p.dailyLimit != null && p.dailyLimit > 0 ? ` • Günlük Limit: ${p.dailyLimit}` : ""}
                              {Number.isFinite(p.order as any) ? ` • Sıra: ${p.order}` : ""}
                            </div>
                            {p.allergens?.length ? (
                              <div className="mt-1 flex flex-wrap gap-1 text-xs text-stone-300">
                                {p.allergens
                                  .slice()
                                  .sort((a, b) => a.localeCompare(b))
                                  .map((code) => (
                                    <span key={code} className="rounded bg-stone-800 px-2 py-0.5">{code}</span>
                                  ))}
                              </div>
                            ) : null}
                          </div>

                          {/* Sağdaki aksiyonlar + inline günlük limit düzenleme */}
                          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">Günlük Limit</span>
                              <input
                                type="number"
                                min={0}
                                value={p.dailyLimit ?? ""}
                                placeholder="boş = ∞"
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const lim = raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0));
                                  setItems((prev) =>
                                    prev.map((x) => (x.id === p.id ? { ...x, dailyLimit: lim } : x))
                                  );
                                }}
                                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex gap-2 justify-end">
                              <button className="btn-ghost" onClick={() => edit(p)}>
                                Bearbeiten
                              </button>
                              <button className="btn-ghost" onClick={() => del(p.id)}>
                                Löschen
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== DRINK GROUPS TAB ===== */}
          {tab === "drinks" && (
            <>
              <div className="card mb-6">
                <div className="mb-3 text-lg font-medium">
                  {dgEditId ? "Getränke-Gruppe bearbeiten" : "Neue Getränke-Gruppe"}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm opacity-80">SKU *</div>
                    <input
                      value={dgSku}
                      onChange={(e) => setDgSku(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="z. B. coke"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Name *</div>
                    <input
                      value={dgName}
                      onChange={(e) => setDgName(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Coca-Cola"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Gruppenbild-URL</div>
                    <div className="flex gap-2">
                      <input
                        value={dgImage}
                        onChange={(e) => setDgImage(e.target.value)}
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        placeholder="/images/drinks/coke.jpeg"
                      />
                      <button type="button" className="btn-ghost" onClick={() => openPicker("drink")}>
                        Öffentliche Bilder
                      </button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="mb-1 text-sm opacity-80">Beschreibung</div>
                    <textarea
                      value={dgDesc}
                      onChange={(e) => setDgDesc(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Wähle deine Sorte"
                    />
                  </div>
                </div>

                {/* Varianten */}
                <div className="mt-3">
                  <div className="mb-1 text-sm opacity-80">Varianten</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={dgVarName}
                      onChange={(e) => setDgVarName(e.target.value)}
                      placeholder="Classic 0,33 l"
                      className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={String(dgVarPrice)}
                      onChange={(e) => setDgVarPrice(toNum(e.target.value, 0))}
                      className="w-28 rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="2,50"
                    />
                    <button className="card-cta" onClick={addDGVar}>
                      Variante hinzufügen
                    </button>
                  </div>

                  {dgVariants.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {dgVariants.map((v) => (
                        <div key={v.id} className="rounded border border-stone-700/60 p-2">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-5 md:items-center">
                            <div className="md:col-span-2">
                              <input
                                value={v.name}
                                onChange={(e) => updDGVar(v.id, { name: e.target.value })}
                                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">€</span>
                              <input
                                type="number"
                                step="0.01"
                                value={String(v.price)}
                                onChange={(e) => updDGVar(v.id, { price: toNum(e.target.value, 0) })}
                                className="w-28 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`dg-act-${v.id}`}
                                checked={v.active !== false}
                                onChange={(e) => updDGVar(v.id, { active: e.target.checked })}
                              />
                              <label htmlFor={`dg-act-${v.id}`} className="text-sm">Aktiv</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">Bestand</span>
                              <input
                                type="number"
                                min={0}
                                placeholder="leer = ∞"
                                value={v.stock ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updDGVar(v.id, { stock: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
                                }}
                                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div className="md:col-span-2">
                              <input
                                value={v.image || ""}
                                onChange={(e) => updDGVar(v.id, { image: e.target.value || undefined })}
                                placeholder="Variantenbild (optional)"
                                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex justify-end">
                              <button className="btn-ghost" onClick={() => delDGVar(v.id)}>Variante löschen</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-stone-400">
                    Hinweis: Deaktivierte Varianten werden im Shop ausgeblendet. Bestand leer = unbegrenzt.
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button className="card-cta card-cta--lg" onClick={saveDG}>
                    {dgEditId ? "Speichern" : "Hinzufügen"}
                  </button>
                  {dgEditId && (
                    <button className="btn-ghost" onClick={resetDGForm}>
                      Abbrechen
                    </button>
                  )}
                </div>
              </div>

              {/* Liste */}
              <div className="card">
                <div className="mb-3 font-medium">Getränke-Gruppen</div>
                {filteredDrinkGroups.length === 0 ? (
                  <div className="text-sm opacity-70">Keine Gruppen gefunden.</div>
                ) : (
                  <div className="grid gap-2">
                    {filteredDrinkGroups.map((g) => (
                      <div
                        key={g.id}
                        className="flex flex-col gap-2 rounded border border-stone-700/60 p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {g.name} <span className="text-xs opacity-70">({g.sku})</span>
                          </div>
                          <div className="text-xs text-stone-400">
                            {g.variants.length} Variante
                            {g.description ? ` • ${g.description}` : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-ghost" onClick={() => editDG(g)}>Bearbeiten</button>
                          <button className="btn-ghost" onClick={() => delDG(g.id)}>Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ===== EXTRA GROUPS TAB ===== */}
          {tab === "extras" && (
            <>
              <div className="card mb-6">
                <div className="mb-3 text-lg font-medium">
                  {egEditId ? "Extras-Gruppe bearbeiten" : "Neue Extras-Gruppe"}
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-sm opacity-80">SKU *</div>
                    <input
                      value={egSku}
                      onChange={(e) => setEgSku(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="z. B. fries"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Name *</div>
                    <input
                      value={egName}
                      onChange={(e) => setEgName(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Pommes"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-sm opacity-80">Gruppenbild-URL</div>
                    <div className="flex gap-2">
                      <input
                        value={egImage}
                        onChange={(e) => setEgImage(e.target.value)}
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        placeholder="/images/extras/fries.jpeg"
                      />
                      <button type="button" className="btn-ghost" onClick={() => openPicker("extra")}>
                        Öffentliche Bilder
                      </button>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="mb-1 text-sm opacity-80">Beschreibung</div>
                    <textarea
                      value={egDesc}
                      onChange={(e) => setEgDesc(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="Wähle deine Sorte"
                    />
                  </div>
                </div>

                {/* Varianten */}
                <div className="mt-3">
                  <div className="mb-1 text-sm opacity-80">Varianten</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={egVarName}
                      onChange={(e) => setEgVarName(e.target.value)}
                      placeholder="Classic Fries"
                      className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                    <input
                      type="number"
                      step="0.01"
                      value={String(egVarPrice)}
                      onChange={(e) => setEgVarPrice(toNum(e.target.value, 0))}
                      className="w-28 rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      placeholder="3,50"
                    />
                    <button className="card-cta" onClick={addEGVar}>
                      Variante hinzufügen
                    </button>
                  </div>

                  {egVariants.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {egVariants.map((v) => (
                        <div key={v.id} className="rounded border border-stone-700/60 p-2">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-5 md:items-center">
                            <div className="md:col-span-2">
                              <input
                                value={v.name}
                                onChange={(e) => updEGVar(v.id, { name: e.target.value })}
                                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">€</span>
                              <input
                                type="number"
                                step="0.01"
                                value={String(v.price)}
                                onChange={(e) => updEGVar(v.id, { price: toNum(e.target.value, 0) })}
                                className="w-28 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`eg-act-${v.id}`}
                                checked={v.active !== false}
                                onChange={(e) => updEGVar(v.id, { active: e.target.checked })}
                              />
                              <label htmlFor={`eg-act-${v.id}`} className="text-sm">Aktiv</label>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">Bestand</span>
                              <input
                                type="number"
                                min={0}
                                placeholder="leer = ∞"
                                value={v.stock ?? ""}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  updEGVar(v.id, { stock: raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)) });
                                }}
                                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                          </div>

                          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                            <div className="md:col-span-2">
                              <input
                                value={v.image || ""}
                                onChange={(e) => updEGVar(v.id, { image: e.target.value || undefined })}
                                placeholder="Variantenbild (optional)"
                                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex justify-end">
                              <button className="btn-ghost" onClick={() => delEGVar(v.id)}>Variante löschen</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-stone-400">
                    Hinweis: Deaktivierte Varianten werden im Shop ausgeblendet. Bestand leer = unbegrenzt.
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <button className="card-cta card-cta--lg" onClick={saveEG}>
                    {egEditId ? "Speichern" : "Hinzufügen"}
                  </button>
                  {egEditId && (
                    <button className="btn-ghost" onClick={resetEGForm}>
                      Abbrechen
                    </button>
                  )}
                </div>
              </div>

              {/* Liste */}
              <div className="card">
                <div className="mb-3 font-medium">Extras-Gruppen</div>
                {filteredExtraGroups.length === 0 ? (
                  <div className="text-sm opacity-70">Keine Gruppen gefunden.</div>
                ) : (
                  <div className="grid gap-2">
                    {filteredExtraGroups.map((g) => (
                      <div
                        key={g.id}
                        className="flex flex-col gap-2 rounded border border-stone-700/60 p-3 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="font-medium">
                            {g.name} <span className="text-xs opacity-70">({g.sku})</span>
                          </div>
                          <div className="text-xs text-stone-400">
                            {g.variants.length} Variante
                            {g.description ? ` • ${g.description}` : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-ghost" onClick={() => editEG(g)}>Bearbeiten</button>
                          <button className="btn-ghost" onClick={() => delEG(g.id)}>Löschen</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* — Öffentlicher Bildwähler (leichtes Modal) — */}
      {imgPickerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setImgPickerOpen(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-stone-700/60 bg-stone-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-lg font-semibold">Öffentliche Bilder auswählen</div>
            <div className="text-sm text-stone-300 mb-2">
              Trage einen Pfad unter <code className="bg-stone-800 px-1 rounded">/public</code> ein
              (z. B. <code className="bg-stone-800 px-1 rounded">/images/burgers/classic.jpeg</code>).
            </div>
            <div className="mb-2">
              <input
                value={imgDraft}
                onChange={(e) => setImgDraft(e.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                placeholder={
                  imgPickerOpen === "product"
                    ? "/images/burgers/classic.jpeg"
                    : imgPickerOpen === "drink"
                    ? "/images/drinks/coke.jpeg"
                    : "/images/extras/fries.jpeg"
                }
              />
            </div>
            <div className="mb-3 text-xs text-stone-400">
              Ordner-Ideen:&nbsp;
              <code className="bg-stone-800 px-1 rounded">/images/burgers</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/vegan</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/extras</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/sauces</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/drinks</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/hotdogs</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/donuts</code>,{" "}
              <code className="bg-stone-800 px-1 rounded">/images/bubble-tea</code>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setImgPickerOpen(null)}>Abbrechen</button>
              <button className="card-cta" onClick={applyPicker}>Übernehmen</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
