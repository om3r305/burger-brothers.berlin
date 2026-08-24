"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import BurgerStack from "@/components/burger-studio/BurgerStack";
import { useCart } from "@/components/store";
import {
  calculateBurgerStudioQuote,
  createDefaultBurgerStudioConfig,
  normalizeBurgerStudioConfig,
  normalizeBurgerStudioRecipe,
  type BurgerStudioConfig,
  type BurgerStudioGroup,
  type BurgerStudioRecipe,
} from "@/lib/burger-studio";

const SAVED_KEY = "bb_burger_studio_saved_v1";

const GROUPS: Array<{ key: BurgerStudioGroup; label: string; icon: string }> = [
  { key: "bun", label: "Bun", icon: "🥯" },
  { key: "protein", label: "Protein", icon: "🥩" },
  { key: "cheese", label: "Käse", icon: "🧀" },
  { key: "topping", label: "Toppings", icon: "🥬" },
  { key: "sauce", label: "Soßen", icon: "🥫" },
];

type CatalogProduct = {
  id?: string;
  sku?: string;
  name?: string;
  category?: string;
  price?: number;
};

type SavedBurger = {
  id: string;
  name: string;
  recipe: BurgerStudioRecipe;
  savedAt: number;
};

function fmt(value: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value || 0);
}

function normalizeKey(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readSaved(): SavedBurger[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(Boolean)
      .map((item: any) => ({
        id: String(item.id || `${Date.now()}`),
        name: String(item.name || "Mein Burger").slice(0, 50),
        recipe: normalizeBurgerStudioRecipe(item.recipe),
        savedAt: Number(item.savedAt) || Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveSaved(items: SavedBurger[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  } catch {}
}

function initialScratchRecipe(config: BurgerStudioConfig): BurgerStudioRecipe {
  const ingredients: Record<string, number> = {};
  const bun = config.ingredients.find((item) => item.active && item.group === "bun");
  const beef = config.ingredients.find((item) => item.active && item.id === "beef") || config.ingredients.find((item) => item.active && item.group === "protein");
  if (bun) ingredients[bun.id] = 1;
  if (beef) ingredients[beef.id] = 1;
  return { version: 1, templateId: null, ingredients };
}

export default function BurgerStudioPage() {
  const searchParams = useSearchParams();
  const preview = searchParams?.get("preview") === "1";
  const orderMode = useCart((state: any) => state.orderMode) as "pickup" | "delivery";
  const addToCart = useCart((state: any) => state.addToCart);
  const [config, setConfig] = useState<BurgerStudioConfig>(createDefaultBurgerStudioConfig());
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<BurgerStudioGroup>("protein");
  const [recipe, setRecipe] = useState<BurgerStudioRecipe>(() => initialScratchRecipe(createDefaultBurgerStudioConfig()));
  const [creationName, setCreationName] = useState("Mein Burger");
  const [saved, setSaved] = useState<SavedBurger[]>([]);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/settings", { cache: "no-store", credentials: "same-origin" }).then((res) => res.json()),
      fetch("/api/catalog", { cache: "no-store", credentials: "same-origin" }).then((res) => res.json()),
    ])
      .then(([settingsRaw, catalogRaw]) => {
        if (!alive) return;
        const settings = settingsRaw?.settings ?? settingsRaw?.data ?? settingsRaw ?? {};
        const nextConfig = normalizeBurgerStudioConfig(settings?.menu?.burgerStudio);
        const products = Array.isArray(catalogRaw?.products)
          ? catalogRaw.products
          : Array.isArray(catalogRaw?.data?.products)
            ? catalogRaw.data.products
            : [];
        setConfig(nextConfig);
        setCatalog(products);
        const firstTemplate = nextConfig.templates.find((item) => item.active);
        setRecipe(firstTemplate
          ? { version: 1, templateId: firstTemplate.id, ingredients: { ...firstTemplate.recipe } }
          : initialScratchRecipe(nextConfig));
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    setSaved(readSaved());
    return () => { alive = false; };
  }, []);

  const template = useMemo(
    () => (recipe.templateId ? config.templates.find((item) => item.id === recipe.templateId) || null : null),
    [config.templates, recipe.templateId],
  );

  const templateBasePrice = useMemo(() => {
    if (!template) return 0;
    const target = normalizeKey(template.productRef);
    const product = catalog.find((item) =>
      [item.id, item.sku, item.name].some((value) => normalizeKey(value) === target),
    );
    return Number(product?.price) || 0;
  }, [catalog, template]);

  const quote = useMemo(() => {
    try {
      return calculateBurgerStudioQuote({ config, recipe, templateBasePrice });
    } catch {
      return { basePrice: 0, delta: 0, total: 0, selected: [], removed: [], lines: [] };
    }
  }, [config, recipe, templateBasePrice]);

  const modeAllowed = orderMode === "pickup" ? config.pickupEnabled : config.deliveryEnabled;
  const canOrder = config.enabled && modeAllowed && quote.selected.some((entry) => entry.ingredient.group === "protein");

  const visibleIngredients = useMemo(
    () => config.ingredients.filter((item) => item.active && item.group === group),
    [config.ingredients, group],
  );

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function chooseTemplate(templateId: string | null) {
    if (!templateId) {
      setRecipe(initialScratchRecipe(config));
      return;
    }
    const next = config.templates.find((item) => item.id === templateId && item.active);
    if (!next) return;
    setRecipe({ version: 1, templateId: next.id, ingredients: { ...next.recipe } });
    setCreationName(next.name);
  }

  function setIngredientQty(id: string, nextQty: number) {
    const ingredient = config.ingredients.find((item) => item.id === id);
    if (!ingredient) return;
    const qty = Math.max(0, Math.min(ingredient.max, Math.round(nextQty)));
    setRecipe((current) => {
      const ingredients = { ...current.ingredients };
      if (qty <= 0) delete ingredients[id];
      else ingredients[id] = qty;
      return { ...current, ingredients };
    });
  }

  function saveCurrentBurger() {
    if (!config.savedBurgersEnabled) return;
    const item: SavedBurger = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: creationName.trim().slice(0, 50) || "Mein Burger",
      recipe: normalizeBurgerStudioRecipe(recipe),
      savedAt: Date.now(),
    };
    const next = [item, ...saved].slice(0, config.maxSavedBurgers);
    setSaved(next);
    saveSaved(next);
    flash("Burger gespeichert ✓");
  }

  function loadSavedBurger(item: SavedBurger) {
    setCreationName(item.name);
    setRecipe(normalizeBurgerStudioRecipe(item.recipe));
    flash("Gespeicherter Burger geladen");
  }

  function removeSavedBurger(id: string) {
    const next = saved.filter((item) => item.id !== id);
    setSaved(next);
    saveSaved(next);
  }

  function addBurgerToCart() {
    if (!canOrder) return;
    const cleanName = creationName.trim().slice(0, 50) || template?.name || "Mein Burger";
    const summary = quote.selected
      .map(({ ingredient, qty }) => `${ingredient.name}${qty > 1 ? ` ×${qty}` : ""}`)
      .join(", ")
      .slice(0, 450);

    (addToCart as any)({
      category: "burger",
      item: {
        id: `burger-studio:${recipe.templateId || "scratch"}`,
        sku: `burger-studio:${recipe.templateId || "scratch"}`,
        name: `🔥 Eigene Kreation – ${cleanName}`,
        price: quote.total,
        category: "burger",
        description: summary,
      },
      qty: 1,
      burgerStudio: {
        version: 1,
        name: cleanName,
        recipe: normalizeBurgerStudioRecipe(recipe),
        estimatedPrice: quote.total,
      },
    });
    flash("Dein Burger ist im Warenkorb 🔥");
  }

  if (loading) {
    return <main className="min-h-dvh bg-[#070707] p-6 text-white"><div className="mx-auto max-w-6xl animate-pulse rounded-3xl border border-white/10 bg-white/[0.04] p-10">Burger Studio wird geladen…</div></main>;
  }

  if (!config.enabled && !preview) {
    return (
      <main className="min-h-dvh bg-[#070707] p-6 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <div className="text-5xl">🍔</div>
          <h1 className="mt-4 text-3xl font-black">Burger Studio</h1>
          <p className="mt-3 text-stone-400">Das Burger Studio ist gerade geschlossen.</p>
          <Link href="/menu" className="mt-6 inline-flex rounded-2xl bg-amber-400 px-5 py-3 font-black text-black">Zurück zum Menü</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#070707] pb-32 text-white">
      <div className="sticky top-0 z-40 border-b border-white/10 bg-[#070707]/92 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto max-w-7xl"><NavBar variant="plain" showLocationCaption={false} /></div>
      </div>

      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[.25em] text-amber-300">Burger Brothers Lab</div>
            <h1 className="mt-1 text-3xl font-black sm:text-5xl">🔥 Burger Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-400 sm:text-base">Baue deinen Burger Schicht für Schicht. Der Endpreis wird beim Bestellen noch einmal mit den aktuellen Zutatenpreisen geprüft.</p>
          </div>
          <Link href="/menu" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-stone-300">← Menü</Link>
        </div>

        {!config.enabled && preview ? (
          <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">Vorschau-Modus: Das Studio ist im Admin noch deaktiviert. Du kannst alles ansehen, aber erst nach dem Aktivieren bestellen.</div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]">
          <section className="space-y-5">
            <BurgerStack config={config} recipe={recipe} />

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-stone-500">Startpunkt</div>
                  <div className="font-black">Vorlage oder von Null</div>
                </div>
                <div className="rounded-full bg-amber-400 px-3 py-1 text-sm font-black text-black">{fmt(quote.total)}</div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {config.scratchEnabled ? (
                  <button type="button" onClick={() => chooseTemplate(null)} className={`min-w-36 rounded-2xl border p-3 text-left ${recipe.templateId === null ? "border-amber-400 bg-amber-400/12" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="font-black">Freestyle</div><div className="mt-1 text-xs text-stone-400">Von Grund auf</div>
                  </button>
                ) : null}
                {config.templates.filter((item) => item.active).map((item) => (
                  <button key={item.id} type="button" onClick={() => chooseTemplate(item.id)} className={`min-w-40 rounded-2xl border p-3 text-left ${recipe.templateId === item.id ? "border-amber-400 bg-amber-400/12" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="font-black">{item.name}</div><div className="mt-1 line-clamp-2 text-xs text-stone-400">{item.description || "Als Basis verwenden"}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <div className="grid grid-cols-5 gap-1 rounded-2xl bg-black/30 p-1">
                {GROUPS.map((entry) => (
                  <button key={entry.key} type="button" onClick={() => setGroup(entry.key)} className={`rounded-xl px-1 py-2 text-center text-[10px] font-black sm:text-xs ${group === entry.key ? "bg-amber-400 text-black" : "text-stone-400"}`}>
                    <span className="block text-base">{entry.icon}</span>{entry.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-2">
                {visibleIngredients.map((ingredient) => {
                  const qty = Number(recipe.ingredients[ingredient.id] || 0);
                  const baseQty = Number(template?.recipe?.[ingredient.id] || 0);
                  const delta = qty - baseQty;
                  const deltaText = recipe.templateId
                    ? delta > 0 ? `+${fmt(delta * ingredient.addPrice)}` : delta < 0 && ingredient.removeCredit > 0 ? `−${fmt(Math.abs(delta) * ingredient.removeCredit)}` : "inklusive"
                    : ingredient.addPrice > 0 ? `+${fmt(ingredient.addPrice)}` : "inklusive";
                  return (
                    <div key={ingredient.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${qty > 0 ? "border-amber-400/30 bg-amber-400/[0.06]" : "border-white/8 bg-black/20"}`}>
                      <div className="min-w-0 flex-1"><div className="truncate font-bold">{ingredient.name}</div><div className="text-xs text-stone-500">{deltaText} · max. {ingredient.max}</div></div>
                      <div className="flex items-center gap-2 rounded-xl bg-black/40 p-1">
                        <button type="button" onClick={() => setIngredientQty(ingredient.id, qty - 1)} className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-lg font-black">−</button>
                        <span className="w-6 text-center font-black">{qty}</span>
                        <button type="button" onClick={() => setIngredientQty(ingredient.id, qty + 1)} disabled={qty >= ingredient.max} className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400 text-lg font-black text-black disabled:opacity-30">+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <label className="text-xs font-black uppercase tracking-widest text-stone-500">Deine Kreation</label>
              <input value={creationName} onChange={(event) => setCreationName(event.target.value.slice(0, 50))} placeholder="z.B. Ömer Special" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-bold outline-none focus:border-amber-400/60" />

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between text-stone-400"><span>{template ? `${template.name} Basis` : "Freestyle Basis"}</span><span>{fmt(quote.basePrice)}</span></div>
                {quote.lines.filter((line) => Math.abs(line.amount) > 0.001).map((line) => (
                  <div key={line.ingredient.id} className="flex justify-between gap-3 text-stone-400"><span>{line.ingredient.name} {line.deltaQty > 0 ? `+${line.deltaQty}` : line.deltaQty}</span><span>{line.amount >= 0 ? "+" : "−"}{fmt(Math.abs(line.amount))}</span></div>
                ))}
                <div className="flex justify-between border-t border-white/10 pt-3 text-xl font-black"><span>Dein Burger</span><span className="text-amber-300">{fmt(quote.total)}</span></div>
              </div>

              {!modeAllowed ? <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">Für {orderMode === "delivery" ? "Lieferung" : "Abholung"} ist das Burger Studio aktuell deaktiviert.</div> : null}
              {!quote.selected.some((entry) => entry.ingredient.group === "protein") ? <div className="mt-3 text-xs font-bold text-amber-300">Bitte mindestens ein Protein wählen.</div> : null}

              <div className="mt-4 grid grid-cols-2 gap-2">
                {config.savedBurgersEnabled ? <button type="button" onClick={saveCurrentBurger} className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 font-black">♡ Speichern</button> : null}
                <button type="button" onClick={addBurgerToCart} disabled={!canOrder} className="rounded-2xl bg-amber-400 px-4 py-3 font-black text-black shadow-[0_12px_35px_rgba(245,158,11,.2)] disabled:cursor-not-allowed disabled:opacity-35">In den Warenkorb</button>
              </div>
            </div>

            {config.savedBurgersEnabled && saved.length ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-3 font-black">Meine Burger</div>
                <div className="space-y-2">
                  {saved.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-2xl border border-white/8 bg-black/20 p-3">
                      <button type="button" onClick={() => loadSavedBurger(item)} className="min-w-0 flex-1 text-left"><div className="truncate font-bold">{item.name}</div><div className="text-xs text-stone-500">Erneut bauen</div></button>
                      <button type="button" onClick={() => removeSavedBurger(item.id)} className="rounded-lg px-2 py-1 text-stone-500 hover:bg-white/10 hover:text-white">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {toast ? <div className="fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-amber-300/30 bg-stone-950 px-5 py-3 text-sm font-black shadow-2xl">{toast}</div> : null}
    </main>
  );
}
