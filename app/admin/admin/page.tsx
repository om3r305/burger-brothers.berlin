// app/admin/page.tsx
"use client";

import Link from "next/link";
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

type Product = {
  id: string;
  sku?: string;
  name: string;
  price: number;
  category: Category;
  imageUrl?: string;
  description?: string;
  extras?: Extra[];
  allergens?: string[];
  active?: boolean;
  activeFrom?: string;
  activeTo?: string;
  order?: number;
  dailyLimit?: number | null;
};

type Variant = {
  id: string;
  name: string;
  price: number;
  active?: boolean;
  stock?: number | null;
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
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? (crypto as any).randomUUID()
    : String(Date.now() + Math.random());

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

function toNum(v: string | number, fallback = 0) {
  const n = Number((v ?? "").toString().replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
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
    return "[]";
  }
}

function slug(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64);
}

function makeSku(category: Category, name: string) {
  const base = slug(name) || "product";
  const short = rid().replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toLowerCase();
  return `${category}-${base}-${short}`.slice(0, 96);
}

function normalizeCategoryForUi(value: any): Category {
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

function dispatchStorageUpdate(key: string, value: any) {
  try {
    const next = safeStringify(value);

    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: next,
        storageArea: window.localStorage,
      }),
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }
}

function writeLocalCache(key: string, value: any) {
  try {
    localStorage.setItem(key, safeStringify(value));
    dispatchStorageUpdate(key, value);
  } catch {}
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

function statusOf(p: Product, now = new Date()) {
  const isActive = p.active !== false;
  const from = p.activeFrom ? new Date(p.activeFrom) : null;
  const to = p.activeTo ? new Date(p.activeTo) : null;

  if (!isActive) {
    return { key: "inactive", label: "Inaktiv", cls: "bg-stone-800 text-stone-200" };
  }

  const afterFrom = !from || now >= from;
  const beforeTo = !to || now <= to;

  if (afterFrom && beforeTo) {
    return { key: "active", label: "Aktiv", cls: "bg-emerald-600 text-black" };
  }

  if (from && now < from) {
    return { key: "scheduled", label: "Geplant", cls: "bg-amber-500 text-black" };
  }

  if (to && now > to) {
    return { key: "inactive", label: "Inaktiv", cls: "bg-stone-800 text-stone-200" };
  }

  return { key: "active", label: "Aktiv", cls: "bg-emerald-600 text-black" };
}

/* =========================
 * DB-FIRST — loader & saver
 * ========================= */
type ProductLoadResult = {
  products: any[];
  source: "db" | "local" | "empty";
  dbOk: boolean;
};

async function dbLoadProducts(): Promise<ProductLoadResult> {
  try {
    const res = await fetch("/api/catalog", {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const j = await res.json().catch(() => ({}));

    if (!res.ok || j?.ok === false) {
      throw new Error(j?.error || `CATALOG_${res.status}`);
    }

    const products = Array.isArray(j.products)
      ? j.products
      : Array.isArray(j.items)
        ? j.items
        : Array.isArray(j.data?.products)
          ? j.data.products
          : [];

    if (products.length > 0) {
      return {
        products,
        source: "db",
        dbOk: true,
      };
    }

    const local = safeJsonParse<any[]>(localStorage.getItem(LS_PRODUCTS), []);

    return {
      products: Array.isArray(local) ? local : [],
      source: local.length ? "local" : "empty",
      dbOk: true,
    };
  } catch {
    const local = safeJsonParse<any[]>(localStorage.getItem(LS_PRODUCTS), []);

    return {
      products: Array.isArray(local) ? local : [],
      source: local.length ? "local" : "empty",
      dbOk: false,
    };
  }
}

async function dbSaveCatalog(payload: {
  products: any[];
  campaigns?: any[];
  replace?: boolean;
}) {
  try {
    const res = await fetch("/api/catalog", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        products: payload.products,
        campaigns: payload.campaigns || [],
        replace: payload.replace === true,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `CATALOG_SAVE_${res.status}`);
    }

    try {
      window.dispatchEvent(new CustomEvent("bb:refresh-catalog"));
    } catch {}

    return true;
  } catch (error) {
    console.error("dbSaveCatalog failed:", error);
    return false;
  }
}

async function dbDeleteProduct(product: Product) {
  const params = new URLSearchParams();

  if (product.sku) {
    params.set("sku", product.sku);
  } else {
    params.set("id", product.id);
  }

  try {
    const res = await fetch(`/api/products?${params.toString()}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
      },
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `PRODUCT_DELETE_${res.status}`);
    }

    try {
      window.dispatchEvent(new CustomEvent("bb:refresh-catalog"));
    } catch {}

    return true;
  } catch (error) {
    console.error("dbDeleteProduct failed:", error);
    return false;
  }
}

/* =========================
 * Order helpers
 * ========================= */
function normalizeOrders(list: Product[]): Product[] {
  const byCat: Record<Category, Product[]> = {
    burger: [],
    extras: [],
    drinks: [],
    sauces: [],
    vegan: [],
    hotdogs: [],
    donuts: [],
    bubbleTea: [],
  };

  for (const p of list) {
    const cat = normalizeCategoryForUi(p.category);
    byCat[cat].push({ ...p, category: cat });
  }

  const next: Product[] = [];

  (Object.keys(byCat) as Category[]).forEach((cat) => {
    const arr = byCat[cat];

    arr.sort((a, b) => {
      const ao = Number.isFinite(a.order as any)
        ? (a.order as number)
        : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(b.order as any)
        ? (b.order as number)
        : Number.MAX_SAFE_INTEGER;

      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });

    arr.forEach((p, i) => next.push({ ...p, order: i }));
  });

  const map = new Map(next.map((p) => [p.id, p]));
  return list.map((p) => map.get(p.id) || { ...p, category: normalizeCategoryForUi(p.category) });
}

function moveProduct(list: Product[], id: string, dir: -1 | 1): Product[] {
  const item = list.find((x) => x.id === id);
  if (!item) return list;

  const cat = normalizeCategoryForUi(item.category);

  const catItems = list
    .filter((x) => normalizeCategoryForUi(x.category) === cat)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const idx = catItems.findIndex((x) => x.id === id);
  const j = idx + dir;

  if (j < 0 || j >= catItems.length) return list;

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

function nextOrderFor(list: Product[], cat: Category) {
  const max = list
    .filter((p) => normalizeCategoryForUi(p.category) === cat)
    .reduce(
      (m, p) => Math.max(m, Number.isFinite(p.order as any) ? (p.order as number) : -1),
      -1,
    );

  return max + 1;
}

function normalizeProductFromDb(p: any): Product {
  const category = normalizeCategoryForUi(p?.category);

  const sku =
    p?.sku != null && String(p.sku).trim()
      ? String(p.sku)
      : p?.code != null && String(p.code).trim()
        ? String(p.code)
        : undefined;

  const id =
    p?.id != null && String(p.id).trim()
      ? String(p.id)
      : sku || rid();

  return {
    id,
    sku,
    name: String(p?.name ?? ""),
    price: Number(p?.price ?? 0),
    category,
    imageUrl: p?.imageUrl || p?.image || p?.cover || undefined,
    description: p?.description || undefined,
    extras: Array.isArray(p?.extrasJson ?? p?.extras)
      ? (p.extrasJson ?? p.extras).map((e: any) => ({
          id: String(e?.id ?? e?.sku ?? rid()),
          name: String(e?.name ?? e?.label ?? ""),
          price: Number(e?.price ?? 0),
        }))
      : undefined,
    allergens: Array.isArray(p?.allergens) ? p.allergens.map((x: any) => String(x)) : undefined,
    active: p?.active !== false,
    activeFrom: p?.activeFrom ? new Date(p.activeFrom).toISOString().slice(0, 16) : undefined,
    activeTo: p?.activeTo ? new Date(p.activeTo).toISOString().slice(0, 16) : undefined,
    order: Number.isFinite(Number(p?.order ?? p?.sortOrder))
      ? Number(p.order ?? p.sortOrder)
      : undefined,
    dailyLimit:
      p?.dailyLimit == null || p.dailyLimit === ""
        ? null
        : Math.max(0, Math.floor(Number(p.dailyLimit) || 0)),
  };
}

function productForDb(p: Product) {
  return {
    ...p,
    sku: p.sku || makeSku(p.category, p.name),
    category: p.category,
    extras: Array.isArray(p.extras) ? p.extras : [],
    extrasJson: Array.isArray(p.extras) ? p.extras : [],
    allergens: Array.isArray(p.allergens) ? p.allergens : [],
  };
}

/* ===== VariantGroup DB helpers ===== */
function normalizeVariantGroups(arr: any[]): VariantGroup[] {
  return (Array.isArray(arr) ? arr : []).map((g: any) => ({
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
          stock: Number.isFinite(Number(v?.stock))
            ? Number(v.stock)
            : v?.stock === 0
              ? 0
              : null,
          image: v?.image ? String(v.image) : undefined,
        }))
      : [],
  }));
}

type VariantGroupsLoadResult = {
  drinkGroups: VariantGroup[];
  extraGroups: VariantGroup[];
  dbOk: boolean;
};

async function dbLoadVariantGroups(): Promise<VariantGroupsLoadResult> {
  try {
    const res = await fetch("/api/groups", {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
    });

    const j = await res.json().catch(() => ({}));

    if (!res.ok || j?.ok === false) {
      throw new Error(j?.error || `GROUPS_${res.status}`);
    }

    return {
      drinkGroups: normalizeVariantGroups(Array.isArray(j.drinkGroups) ? j.drinkGroups : []),
      extraGroups: normalizeVariantGroups(Array.isArray(j.extraGroups) ? j.extraGroups : []),
      dbOk: true,
    };
  } catch {
    return {
      drinkGroups: [],
      extraGroups: [],
      dbOk: false,
    };
  }
}

async function dbSaveVariantGroups(drinkGroups: VariantGroup[], extraGroups: VariantGroup[]) {
  try {
    const res = await fetch("/api/groups", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ drinkGroups, extraGroups }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok || json?.ok === false) {
      throw new Error(json?.error || `GROUPS_SAVE_${res.status}`);
    }

    try {
      window.dispatchEvent(new CustomEvent("bb:refresh-groups"));
    } catch {}

    return true;
  } catch (error) {
    console.error("dbSaveVariantGroups failed:", error);
    return false;
  }
}

/* =========================
 * Component
 * ========================= */
export default function AdminPage() {
  const r = useRouter();

  const [tab, setTab] = useState<"products" | "drinks" | "extras">("products");
  const [globalQ, setGlobalQ] = useState("");

  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<Category | "all">("burger");

  const [name, setName] = useState("");
  const [price, setPrice] = useState<number>(9.9);
  const [category, setCategory] = useState<Category>("burger");
  const [imageUrl, setImageUrl] = useState("");
  const [description, setDescription] = useState("");
  const [exName, setExName] = useState("");
  const [exPrice, setExPrice] = useState<number>(0.5);
  const [draftExtras, setDraftExtras] = useState<Extra[]>([]);
  const [editId, setEditId] = useState<string | null>(null);

  const [allergenInput, setAllergenInput] = useState("");
  const [draftAllergens, setDraftAllergens] = useState<string[]>([]);

  const [active, setActive] = useState(true);
  const [activeFrom, setActiveFrom] = useState<string>("");
  const [activeTo, setActiveTo] = useState<string>("");
  const [dailyLimit, setDailyLimit] = useState<string>("");

  const [drinkGroups, setDrinkGroups] = useState<VariantGroup[]>([]);
  const [dgEditId, setDgEditId] = useState<string | null>(null);
  const [dgSku, setDgSku] = useState("");
  const [dgName, setDgName] = useState("");
  const [dgDesc, setDgDesc] = useState("");
  const [dgImage, setDgImage] = useState("");
  const [dgVarName, setDgVarName] = useState("");
  const [dgVarPrice, setDgVarPrice] = useState<number>(0);
  const [dgVariants, setDgVariants] = useState<Variant[]>([]);

  const [extraGroups, setExtraGroups] = useState<VariantGroup[]>([]);
  const [egEditId, setEgEditId] = useState<string | null>(null);
  const [egSku, setEgSku] = useState("");
  const [egName, setEgName] = useState("");
  const [egDesc, setEgDesc] = useState("");
  const [egImage, setEgImage] = useState("");
  const [egVarName, setEgVarName] = useState("");
  const [egVarPrice, setEgVarPrice] = useState<number>(0);
  const [egVariants, setEgVariants] = useState<Variant[]>([]);

  const [imgPickerOpen, setImgPickerOpen] = useState<null | "product" | "drink" | "extra">(null);
  const [imgDraft, setImgDraft] = useState("");

  const skipNextProductsSaveRef = useRef(false);
  const skipNextGroupsSaveRef = useRef(false);

  /* ====== LOAD (DB-first) ====== */
  useEffect(() => {
    (async () => {
      const productsResult = await dbLoadProducts();

      if (productsResult.products.length > 0) {
        const mapped = normalizeOrders(productsResult.products.map(normalizeProductFromDb));

        if (!productsResult.dbOk) {
          skipNextProductsSaveRef.current = true;
        }

        setItems(mapped);

        if (productsResult.source === "db") {
          writeLocalCache(LS_PRODUCTS, mapped);
        }
      }

      try {
        const groupsResult = await dbLoadVariantGroups();

        if (groupsResult.drinkGroups.length || groupsResult.extraGroups.length) {
          setDrinkGroups(groupsResult.drinkGroups);
          setExtraGroups(groupsResult.extraGroups);

          if (groupsResult.dbOk) {
            writeLocalCache(LS_DRINK_GROUPS, groupsResult.drinkGroups);
            writeLocalCache(LS_EXTRA_GROUPS, groupsResult.extraGroups);
          } else {
            skipNextGroupsSaveRef.current = true;
          }
        } else if (groupsResult.dbOk) {
          const dg = normalizeVariantGroups(
            safeJsonParse<any[]>(localStorage.getItem(LS_DRINK_GROUPS), []),
          );
          const eg = normalizeVariantGroups(
            safeJsonParse<any[]>(localStorage.getItem(LS_EXTRA_GROUPS), []),
          );

          setDrinkGroups(dg);
          setExtraGroups(eg);

          if (dg.length || eg.length) {
            await dbSaveVariantGroups(dg, eg);
          }
        } else {
          const dg = normalizeVariantGroups(
            safeJsonParse<any[]>(localStorage.getItem(LS_DRINK_GROUPS), []),
          );
          const eg = normalizeVariantGroups(
            safeJsonParse<any[]>(localStorage.getItem(LS_EXTRA_GROUPS), []),
          );

          skipNextGroupsSaveRef.current = true;
          setDrinkGroups(dg);
          setExtraGroups(eg);
        }
      } catch {}
    })();
  }, []);

  /* ====== PERSIST (DB + LS cache) ====== */
  useDebouncedEffect(() => {
    if (skipNextProductsSaveRef.current) {
      skipNextProductsSaveRef.current = false;
      return;
    }

    (async () => {
      const normalized = normalizeOrders(items);
      const products = normalized.map(productForDb);
      const ok = await dbSaveCatalog({ products, replace: true });

      if (ok) {
        writeLocalCache(LS_PRODUCTS, normalized);
      }
    })();
  }, [items], 300);

  useDebouncedEffect(() => {
    try {
      localStorage.setItem("bb_products_manual", "1");
      localStorage.setItem("bb_products_v1_version", String(Date.now()));
    } catch {}
  }, [items], 0);

  useDebouncedEffect(() => {
    if (skipNextGroupsSaveRef.current) {
      skipNextGroupsSaveRef.current = false;
      return;
    }

    (async () => {
      const ok = await dbSaveVariantGroups(drinkGroups, extraGroups);

      if (ok) {
        writeLocalCache(LS_DRINK_GROUPS, drinkGroups);
        writeLocalCache(LS_EXTRA_GROUPS, extraGroups);
      }
    })();
  }, [drinkGroups, extraGroups], 400);

  /* ====== FILTERED LIST (PRODUCTS) ====== */
  const list = useMemo(() => {
    const qLocal = search.trim().toLowerCase();
    const qGlobal = globalQ.trim().toLowerCase();
    const q = (qLocal || qGlobal).trim();

    return items
      .filter((p) => (filterCat === "all" ? true : normalizeCategoryForUi(p.category) === filterCat))
      .filter((p) =>
        !q
          ? true
          : (p.name + " " + (p.description || "") + " " + (p.allergens || []).join(" "))
              .toLowerCase()
              .includes(q),
      )
      .sort((a, b) => {
        const ao = Number.isFinite(a.order as any)
          ? (a.order as number)
          : Number.MAX_SAFE_INTEGER;
        const bo = Number.isFinite(b.order as any)
          ? (b.order as number)
          : Number.MAX_SAFE_INTEGER;

        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
  }, [items, search, filterCat, globalQ]);

  const filteredDrinkGroups = useMemo(() => {
    const q = globalQ.trim().toLowerCase();
    if (!q) return drinkGroups;

    return drinkGroups.filter((g) =>
      (
        g.name +
        " " +
        g.sku +
        " " +
        (g.description || "") +
        " " +
        g.variants.map((v) => v.name).join(" ")
      )
        .toLowerCase()
        .includes(q),
    );
  }, [drinkGroups, globalQ]);

  const filteredExtraGroups = useMemo(() => {
    const q = globalQ.trim().toLowerCase();
    if (!q) return extraGroups;

    return extraGroups.filter((g) =>
      (
        g.name +
        " " +
        g.sku +
        " " +
        (g.description || "") +
        " " +
        g.variants.map((v) => v.name).join(" ")
      )
        .toLowerCase()
        .includes(q),
    );
  }, [extraGroups, globalQ]);

  /* ====== CRUD: PRODUCTS ====== */
  const addOrUpdate = () => {
    if (!name.trim()) return;

    const old = editId ? items.find((p) => p.id === editId) : null;

    const limitNum =
      dailyLimit.trim() === "" ? null : Math.max(0, Math.floor(Number(dailyLimit) || 0));

    const prod: Product = {
      id: editId || rid(),
      sku: old?.sku || makeSku(category, name.trim()),
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
      order: editId ? old?.order ?? 0 : nextOrderFor(items, category),
    };

    setItems((prev) =>
      editId
        ? normalizeOrders(prev.map((p) => (p.id === editId ? prod : p)))
        : normalizeOrders([prod, ...prev]),
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

  const del = async (id: string) => {
    const target = items.find((p) => p.id === id);
    if (!target) return;

    const ok = await dbDeleteProduct(target);

    if (!ok) {
      alert("Produkt konnte nicht gelöscht werden.");
      return;
    }

    setItems((prev) => normalizeOrders(prev.filter((p) => p.id !== id)));
  };

  const edit = (p: Product) => {
    setEditId(p.id);
    setName(p.name);
    setPrice(p.price);
    setCategory(normalizeCategoryForUi(p.category));
    setImageUrl(p.imageUrl || "");
    setDescription(p.description || "");
    setDraftExtras([...(p.extras || [])]);
    setDraftAllergens([...(p.allergens || [])]);
    setAllergenInput("");
    setActive(p.active ?? true);
    setActiveFrom(p.activeFrom || "");
    setActiveTo(p.activeTo || "");
    setDailyLimit(
      p.dailyLimit == null ? "" : String(Math.max(0, Math.floor(Number(p.dailyLimit) || 0))),
    );

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
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

  const delExtra = (id: string) => setDraftExtras((prev) => prev.filter((e) => e.id !== id));

  const addAllergen = () => {
    const raw = allergenInput.trim().toUpperCase();
    if (!raw) return;

    const codes = raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setDraftAllergens((prev) => {
      const set = new Set(prev.map((x) => x.toUpperCase()));
      codes.forEach((c) => set.add(c));
      return Array.from(set);
    });

    setAllergenInput("");
  };

  const delAllergen = (code: string) =>
    setDraftAllergens((prev) => prev.filter((c) => c !== code));

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
      {
        id: rid(),
        name: dgVarName.trim(),
        price: Number(dgVarPrice) || 0,
        active: true,
        stock: null,
      },
    ]);

    setDgVarName("");
    setDgVarPrice(0);
  };

  const delDGVar = (id: string) => setDgVariants((prev) => prev.filter((v) => v.id !== id));

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
      variants: dgVariants.map((v) => ({
        ...v,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock))
          ? Number(v.stock)
          : v.stock === 0
            ? 0
            : null,
      })),
    };

    setDrinkGroups((prev) =>
      dgEditId ? prev.map((x) => (x.id === dgEditId ? g : x)) : [g, ...prev],
    );

    resetDGForm();
  };

  const editDG = (g: VariantGroup) => {
    setDgEditId(g.id);
    setDgSku(g.sku);
    setDgName(g.name);
    setDgDesc(g.description || "");
    setDgImage(g.image || "");
    setDgVariants(
      g.variants.map((v) => ({
        id: v.id,
        name: v.name,
        price: v.price,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock))
          ? Number(v.stock)
          : v.stock === 0
            ? 0
            : null,
        image: v.image,
      })),
    );

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  const delDG = (id: string) => setDrinkGroups((prev) => prev.filter((g) => g.id !== id));

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
      {
        id: rid(),
        name: egVarName.trim(),
        price: Number(egVarPrice) || 0,
        active: true,
        stock: null,
      },
    ]);

    setEgVarName("");
    setEgVarPrice(0);
  };

  const delEGVar = (id: string) => setEgVariants((prev) => prev.filter((v) => v.id !== id));

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
      variants: egVariants.map((v) => ({
        ...v,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock))
          ? Number(v.stock)
          : v.stock === 0
            ? 0
            : null,
      })),
    };

    setExtraGroups((prev) =>
      egEditId ? prev.map((x) => (x.id === egEditId ? g : x)) : [g, ...prev],
    );

    resetEGForm();
  };

  const editEG = (g: VariantGroup) => {
    setEgEditId(g.id);
    setEgSku(g.sku);
    setEgName(g.name);
    setEgDesc(g.description || "");
    setEgImage(g.image || "");
    setEgVariants(
      g.variants.map((v) => ({
        id: v.id,
        name: v.name,
        price: v.price,
        active: v.active !== false,
        stock: Number.isFinite(Number(v.stock))
          ? Number(v.stock)
          : v.stock === 0
            ? 0
            : null,
        image: v.image,
      })),
    );

    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {}
  };

  const delEG = (id: string) => setExtraGroups((prev) => prev.filter((g) => g.id !== id));

  /* ====== EXPORT / IMPORT (ALL DATA) ====== */
  const doExportAll = () => {
    try {
      const payload = {
        products: items,
        drinkGroups,
        extraGroups,
        _meta: {
          version: 3,
          note: "products: order & dailyLimit; variants: active/stock/image",
        },
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });

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

        const cat = allowed.includes(normalizeCategoryForUi(p.category) as any)
          ? normalizeCategoryForUi(p.category)
          : "burger";

        const lim =
          p?.dailyLimit == null || p.dailyLimit === ""
            ? null
            : Math.max(0, Math.floor(Number(p.dailyLimit) || 0));

        const id = p.id || rid();

        return {
          id,
          sku: p.sku || p.code || makeSku(cat, String(p.name ?? "")),
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

      const normalizedProducts = normalizeOrders(normProducts);
      const normalizedDrinkGroups = normalizeVariantGroups(json.drinkGroups || []);
      const normalizedExtraGroups = normalizeVariantGroups(json.extraGroups || []);

      const productsOk = await dbSaveCatalog({
        products: normalizedProducts.map(productForDb),
        replace: true,
      });

      const groupsOk = await dbSaveVariantGroups(normalizedDrinkGroups, normalizedExtraGroups);

      if (!productsOk || !groupsOk) {
        throw new Error("Datenbank konnte nicht gespeichert werden.");
      }

      setItems(normalizedProducts);
      setDrinkGroups(normalizedDrinkGroups);
      setExtraGroups(normalizedExtraGroups);
      setFilterCat("burger");
      setTab("products");

      writeLocalCache(LS_PRODUCTS, normalizedProducts);
      writeLocalCache(LS_DRINK_GROUPS, normalizedDrinkGroups);
      writeLocalCache(LS_EXTRA_GROUPS, normalizedExtraGroups);

      ev.target.value = "";

      alert(
        `Import erfolgreich ✅\n` +
          `Produkte: ${normalizedProducts.length}\n` +
          `Getränke-Gruppen: ${normalizedDrinkGroups.length}\n` +
          `Extras-Gruppen: ${normalizedExtraGroups.length}`,
      );
    } catch (e: any) {
      alert("Import-Fehler: Ungültige JSON.\n" + (e?.message || ""));
      ev.target.value = "";
    }
  };

  const logout = async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch {}

    r.replace("/admin/login");
  };

  const openPicker = (kind: "product" | "drink" | "extra") => {
    setImgPickerOpen(kind);

    if (kind === "product") setImgDraft(imageUrl || "");
    else if (kind === "drink") setImgDraft(dgImage || "");
    else setImgDraft(egImage || "");
  };

  const applyPicker = () => {
    const v = (imgDraft || "").trim();

    if (imgPickerOpen === "product") setImageUrl(v);
    if (imgPickerOpen === "drink") setDgImage(v);
    if (imgPickerOpen === "extra") setEgImage(v);

    setImgPickerOpen(null);
  };

  return (
    <main className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Adminbereich</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="btn-ghost" href="/admin/backup">
            Backup & Wartung
          </Link>
          <button className="btn-ghost" onClick={doExportAll}>
            Export (JSON)
          </button>
          <label className="btn-ghost cursor-pointer">
            Import
            <input
              id="file-import"
              type="file"
              accept=".json,application/json"
              onChange={doImportAll}
              hidden
            />
          </label>
          <button className="btn-ghost" onClick={logout}>
            Abmelden
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
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
            <Link className="nav-pill w-full justify-start" href="/admin/backup">
              🧰 Backup & Wartung
            </Link>
            <button
              className={`nav-pill w-full justify-start ${
                tab === "products" ? "nav-pill--active" : ""
              }`}
              onClick={() => setTab("products")}
              aria-current={tab === "products" ? "page" : undefined}
            >
              🍔 Produkte
            </button>
            <button
              className={`nav-pill w-full justify-start ${
                tab === "drinks" ? "nav-pill--active" : ""
              }`}
              onClick={() => setTab("drinks")}
              aria-current={tab === "drinks" ? "page" : undefined}
            >
              🥤 Getränke-Gruppen
            </button>
            <button
              className={`nav-pill w-full justify-start ${
                tab === "extras" ? "nav-pill--active" : ""
              }`}
              onClick={() => setTab("extras")}
              aria-current={tab === "extras" ? "page" : undefined}
            >
              🍟 Extras-Gruppen
            </button>
          </nav>
        </aside>

        <section className="min-w-0">
          {tab === "products" && (
            <>
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
                    <div className="mb-1 text-sm opacity-80">Kategorie *</div>
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

                  <div className="flex items-center gap-2">
                    <input
                      id="p-active"
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />
                    <label htmlFor="p-active" className="text-sm">
                      Aktiv
                    </label>
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

                  <div>
                    <div className="mb-1 text-sm opacity-80">Tageslimit (Anzahl)</div>
                    <input
                      type="number"
                      min={0}
                      placeholder="leer = unbegrenzt"
                      value={dailyLimit}
                      onChange={(e) => setDailyLimit(e.target.value)}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    />
                  </div>
                </div>

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

                <div className="mt-6">
                  <div className="mb-1 text-sm opacity-80">
                    Allergen-/Zusatzstoff-Codes (optional)
                  </div>
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
                    Beispiele: A (Gluten), C (Ei), G (Milch/Laktose), 1 (mit Farbstoff), 2
                    (mit Konservierungsstoff) …
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
                    <option value="all">Alle Kategorien</option>
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
                              <div className="flex items-center gap-1">
                                <button
                                  className="btn-ghost px-2 py-1"
                                  title="Nach oben"
                                  onClick={() => moveUp(p.id)}
                                >
                                  ↑
                                </button>
                                <button
                                  className="btn-ghost px-2 py-1"
                                  title="Nach unten"
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
                              {p.activeFrom
                                ? ` • ab ${new Date(p.activeFrom).toLocaleString()}`
                                : ""}
                              {p.activeTo
                                ? ` • bis ${new Date(p.activeTo).toLocaleString()}`
                                : ""}
                              {p.dailyLimit != null && p.dailyLimit > 0
                                ? ` • Tageslimit: ${p.dailyLimit}`
                                : ""}
                              {Number.isFinite(p.order as any)
                                ? ` • Reihenfolge: ${p.order}`
                                : ""}
                            </div>
                            {p.allergens?.length ? (
                              <div className="mt-1 flex flex-wrap gap-1 text-xs text-stone-300">
                                {p.allergens
                                  .slice()
                                  .sort((a, b) => a.localeCompare(b))
                                  .map((code) => (
                                    <span key={code} className="rounded bg-stone-800 px-2 py-0.5">
                                      {code}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                            <div className="flex items-center gap-2">
                              <span className="text-xs opacity-80">Tageslimit</span>
                              <input
                                type="number"
                                min={0}
                                value={p.dailyLimit ?? ""}
                                placeholder="leer = ∞"
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const lim =
                                    raw === ""
                                      ? null
                                      : Math.max(0, Math.floor(Number(raw) || 0));

                                  setItems((prev) =>
                                    prev.map((x) =>
                                      x.id === p.id ? { ...x, dailyLimit: lim } : x,
                                    ),
                                  );
                                }}
                                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                              />
                            </div>
                            <div className="flex justify-end gap-2">
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

          {tab === "drinks" && (
            <>
              <VariantGroupForm
                title={dgEditId ? "Getränke-Gruppe bearbeiten" : "Neue Getränke-Gruppe"}
                sku={dgSku}
                setSku={setDgSku}
                name={dgName}
                setName={setDgName}
                description={dgDesc}
                setDescription={setDgDesc}
                image={dgImage}
                setImage={setDgImage}
                varName={dgVarName}
                setVarName={setDgVarName}
                varPrice={dgVarPrice}
                setVarPrice={setDgVarPrice}
                variants={dgVariants}
                addVariant={addDGVar}
                updateVariant={updDGVar}
                deleteVariant={delDGVar}
                save={saveDG}
                reset={resetDGForm}
                editing={!!dgEditId}
                openPicker={() => openPicker("drink")}
              />

              <VariantGroupList
                title="Getränke-Gruppen"
                groups={filteredDrinkGroups}
                onEdit={editDG}
                onDelete={delDG}
              />
            </>
          )}

          {tab === "extras" && (
            <>
              <VariantGroupForm
                title={egEditId ? "Extras-Gruppe bearbeiten" : "Neue Extras-Gruppe"}
                sku={egSku}
                setSku={setEgSku}
                name={egName}
                setName={setEgName}
                description={egDesc}
                setDescription={setEgDesc}
                image={egImage}
                setImage={setEgImage}
                varName={egVarName}
                setVarName={setEgVarName}
                varPrice={egVarPrice}
                setVarPrice={setEgVarPrice}
                variants={egVariants}
                addVariant={addEGVar}
                updateVariant={updEGVar}
                deleteVariant={delEGVar}
                save={saveEG}
                reset={resetEGForm}
                editing={!!egEditId}
                openPicker={() => openPicker("extra")}
              />

              <VariantGroupList
                title="Extras-Gruppen"
                groups={filteredExtraGroups}
                onEdit={editEG}
                onDelete={delEG}
              />
            </>
          )}
        </section>
      </div>

      {imgPickerOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
          onClick={() => setImgPickerOpen(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-stone-700/60 bg-stone-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-lg font-semibold">Öffentliche Bilder auswählen</div>
            <div className="mb-2 text-sm text-stone-300">
              Trage einen Pfad unter{" "}
              <code className="rounded bg-stone-800 px-1">/public</code> ein (z. B.{" "}
              <code className="rounded bg-stone-800 px-1">
                /images/burgers/classic.jpeg
              </code>
              ).
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
              <code className="rounded bg-stone-800 px-1">/images/burgers</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/vegan</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/extras</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/sauces</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/drinks</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/hotdogs</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/donuts</code>,{" "}
              <code className="rounded bg-stone-800 px-1">/images/bubble-tea</code>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setImgPickerOpen(null)}>
                Abbrechen
              </button>
              <button className="card-cta" onClick={applyPicker}>
                Übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function VariantGroupForm({
  title,
  sku,
  setSku,
  name,
  setName,
  description,
  setDescription,
  image,
  setImage,
  varName,
  setVarName,
  varPrice,
  setVarPrice,
  variants,
  addVariant,
  updateVariant,
  deleteVariant,
  save,
  reset,
  editing,
  openPicker,
}: {
  title: string;
  sku: string;
  setSku: (value: string) => void;
  name: string;
  setName: (value: string) => void;
  description: string;
  setDescription: (value: string) => void;
  image: string;
  setImage: (value: string) => void;
  varName: string;
  setVarName: (value: string) => void;
  varPrice: number;
  setVarPrice: (value: number) => void;
  variants: Variant[];
  addVariant: () => void;
  updateVariant: (id: string, patch: Partial<Variant>) => void;
  deleteVariant: (id: string) => void;
  save: () => void;
  reset: () => void;
  editing: boolean;
  openPicker: () => void;
}) {
  return (
    <div className="card mb-6">
      <div className="mb-3 text-lg font-medium">{title}</div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="mb-1 text-sm opacity-80">SKU *</div>
          <input
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            placeholder="z. B. coke"
          />
        </div>
        <div>
          <div className="mb-1 text-sm opacity-80">Name *</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            placeholder="Coca-Cola"
          />
        </div>
        <div>
          <div className="mb-1 text-sm opacity-80">Gruppenbild-URL</div>
          <div className="flex gap-2">
            <input
              value={image}
              onChange={(e) => setImage(e.target.value)}
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              placeholder="/images/drinks/coke.jpeg"
            />
            <button type="button" className="btn-ghost" onClick={openPicker}>
              Öffentliche Bilder
            </button>
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="mb-1 text-sm opacity-80">Beschreibung</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            placeholder="Wähle deine Sorte"
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-sm opacity-80">Varianten</div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={varName}
            onChange={(e) => setVarName(e.target.value)}
            placeholder="Classic 0,33 l"
            className="rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
          />
          <input
            type="number"
            step="0.01"
            value={String(varPrice)}
            onChange={(e) => setVarPrice(toNum(e.target.value, 0))}
            className="w-28 rounded border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            placeholder="2,50"
          />
          <button className="card-cta" onClick={addVariant}>
            Variante hinzufügen
          </button>
        </div>

        {variants.length > 0 && (
          <div className="mt-3 grid gap-2">
            {variants.map((v) => (
              <div key={v.id} className="rounded border border-stone-700/60 p-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-5 md:items-center">
                  <div className="md:col-span-2">
                    <input
                      value={v.name}
                      onChange={(e) => updateVariant(v.id, { name: e.target.value })}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs opacity-80">€</span>
                    <input
                      type="number"
                      step="0.01"
                      value={String(v.price)}
                      onChange={(e) => updateVariant(v.id, { price: toNum(e.target.value, 0) })}
                      className="w-28 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`var-act-${v.id}`}
                      checked={v.active !== false}
                      onChange={(e) => updateVariant(v.id, { active: e.target.checked })}
                    />
                    <label htmlFor={`var-act-${v.id}`} className="text-sm">
                      Aktiv
                    </label>
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
                        updateVariant(v.id, {
                          stock:
                            raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)),
                        });
                      }}
                      className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                    />
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <input
                      value={v.image || ""}
                      onChange={(e) =>
                        updateVariant(v.id, {
                          image: e.target.value || undefined,
                        })
                      }
                      placeholder="Variantenbild (optional)"
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1.5 outline-none text-sm"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button className="btn-ghost" onClick={() => deleteVariant(v.id)}>
                      Variante löschen
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 text-xs text-stone-400">
          Hinweis: Deaktivierte Varianten werden im Shop ausgeblendet. Bestand leer =
          unbegrenzt.
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button className="card-cta card-cta--lg" onClick={save}>
          {editing ? "Speichern" : "Hinzufügen"}
        </button>
        {editing && (
          <button className="btn-ghost" onClick={reset}>
            Abbrechen
          </button>
        )}
      </div>
    </div>
  );
}

function VariantGroupList({
  title,
  groups,
  onEdit,
  onDelete,
}: {
  title: string;
  groups: VariantGroup[];
  onEdit: (group: VariantGroup) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="card">
      <div className="mb-3 font-medium">{title}</div>
      {groups.length === 0 ? (
        <div className="text-sm opacity-70">Keine Gruppen gefunden.</div>
      ) : (
        <div className="grid gap-2">
          {groups.map((g) => (
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
                <button className="btn-ghost" onClick={() => onEdit(g)}>
                  Bearbeiten
                </button>
                <button className="btn-ghost" onClick={() => onDelete(g.id)}>
                  Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}