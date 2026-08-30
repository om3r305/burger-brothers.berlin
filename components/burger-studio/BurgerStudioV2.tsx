"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import NavBar from "@/components/NavBar";
import { useCart } from "@/components/store";
import BurgerStackV2 from "@/components/burger-studio/BurgerStackV2";
import type {
  BurgerStudioGroup,
  BurgerStudioRecipe,
  BurgerStudioTemplate,
} from "@/lib/burger-studio";
import {
  BURGER_STUDIO_SCRATCH_NAME,
  BURGER_STUDIO_SCRATCH_SKU,
  burgerStudioRecipeCompletion,
  createDefaultBurgerStudioV2Config,
  normalizeBurgerStudioV2Config,
  normalizeBurgerStudioV2Recipe,
  setExclusiveBurgerStudioBun,
  type BurgerStudioV2Config,
} from "@/lib/burger-studio-v2";
import {
  planBurgerStudioV2Order,
  type BurgerStudioV2Plan,
} from "@/lib/burger-studio-v2-order-plan";

const SAVED_KEY = "bb_burger_studio_saved_v2";

const GROUPS: Array<{
  key: BurgerStudioGroup;
  label: string;
  icon: string;
  helper: string;
}> = [
  { key: "bun", label: "Bun", icon: "🥯", helper: "Wähle genau ein Bun" },
  { key: "protein", label: "Protein", icon: "🥩", helper: "Beef, Crispy oder Vegan" },
  { key: "cheese", label: "Käse", icon: "🧀", helper: "Cheddar, Gouda & mehr" },
  { key: "topping", label: "Toppings", icon: "🥬", helper: "Salat, Bacon, Zwiebeln …" },
  { key: "sauce", label: "Soßen", icon: "🥫", helper: "Italian, BBQ, Avocado …" },
];

type CatalogProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name?: string;
  description?: string;
  imageUrl?: string;
  image?: string;
  category?: string;
  price?: number;
  active?: boolean;
};

type SavedBurger = {
  id: string;
  name: string;
  recipe: BurgerStudioRecipe;
  savedAt: number;
};

function fmt(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(Number(value) || 0);
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

function emptyRecipe(): BurgerStudioRecipe {
  return { version: 1, templateId: null, ingredients: {} };
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
        recipe: normalizeBurgerStudioV2Recipe(item.recipe),
        savedAt: Number(item.savedAt) || Date.now(),
      }));
  } catch {
    return [];
  }
}

function writeSaved(items: SavedBurger[]) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(items));
  } catch {}
}

function productRefMatches(product: CatalogProduct, ref: string) {
  const target = normalizeKey(ref);
  return [product.id, product.sku, product.code, product.name].some(
    (value) => normalizeKey(value) === target,
  );
}

function emptyPlan(config: BurgerStudioV2Config): BurgerStudioV2Plan {
  return {
    mode: "freestyle",
    canonicalSku: BURGER_STUDIO_SCRATCH_SKU,
    basePrice: config.scratchBasePrice,
    delta: 0,
    total: config.scratchBasePrice,
    add: [],
    rm: [],
    selected: [],
    removed: [],
    lines: [],
  };
}

export default function BurgerStudioV2() {
  const searchParams = useSearchParams();
  const preview = searchParams?.get("preview") === "1";
  const orderMode = useCart((state: any) => state.orderMode) as
    | "pickup"
    | "delivery";
  const addToCart = useCart((state: any) => state.addToCart);

  const [config, setConfig] = useState<BurgerStudioV2Config>(
    createDefaultBurgerStudioV2Config(),
  );
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [recipe, setRecipe] = useState<BurgerStudioRecipe>(emptyRecipe());
  const [group, setGroup] = useState<BurgerStudioGroup>("bun");
  const [creationName, setCreationName] = useState("Mein Burger");
  const [saved, setSaved] = useState<SavedBurger[]>([]);
  const [assembled, setAssembled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/settings", {
        cache: "no-store",
        credentials: "same-origin",
      }).then((res) => res.json()),
      fetch("/api/catalog", {
        cache: "no-store",
        credentials: "same-origin",
      }).then((res) => res.json()),
    ])
      .then(([settingsRaw, catalogRaw]) => {
        if (!alive) return;
        const settings =
          settingsRaw?.settings ?? settingsRaw?.data ?? settingsRaw ?? {};
        const nextConfig = normalizeBurgerStudioV2Config(
          settings?.menu?.burgerStudio,
        );
        const products = Array.isArray(catalogRaw?.products)
          ? catalogRaw.products
          : Array.isArray(catalogRaw?.data?.products)
            ? catalogRaw.data.products
            : [];

        setConfig(nextConfig);
        setCatalog(products);

        if (nextConfig.scratchEnabled) {
          setRecipe(emptyRecipe());
          setCreationName("Mein Burger");
          setGroup("bun");
        } else {
          const firstTemplate = nextConfig.templates.find((item) => item.active);
          if (firstTemplate) {
            setRecipe({
              version: 1,
              templateId: firstTemplate.id,
              ingredients: { ...firstTemplate.recipe },
            });
            setCreationName(firstTemplate.name);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });

    setSaved(readSaved());
    return () => {
      alive = false;
    };
  }, []);

  const template = useMemo<BurgerStudioTemplate | null>(() => {
    if (!recipe.templateId) return null;
    return (
      config.templates.find(
        (item) => item.id === recipe.templateId && item.active,
      ) || null
    );
  }, [config.templates, recipe.templateId]);

  const linkedProduct = useMemo(() => {
    if (!template) return null;
    return catalog.find((item) => productRefMatches(item, template.productRef)) || null;
  }, [catalog, template]);

  const plan = useMemo(() => {
    try {
      return planBurgerStudioV2Order({
        config,
        recipe,
        template,
        templateBasePrice: Number(linkedProduct?.price) || 0,
        templateSku: String(
          linkedProduct?.sku || linkedProduct?.code || linkedProduct?.id || "",
        ),
      });
    } catch {
      return emptyPlan(config);
    }
  }, [config, linkedProduct, recipe, template]);

  const completion = useMemo(
    () => burgerStudioRecipeCompletion(config, recipe),
    [config, recipe],
  );

  const modeAllowed =
    orderMode === "pickup" ? config.pickupEnabled : config.deliveryEnabled;
  const sourceAllowed = recipe.templateId
    ? Boolean(template && linkedProduct && linkedProduct.active !== false)
    : config.scratchEnabled;
  const canFinish = completion.complete && sourceAllowed;
  const canOrder = Boolean(
    config.enabled && modeAllowed && canFinish && assembled,
  );

  const visibleIngredients = useMemo(
    () =>
      config.ingredients.filter(
        (ingredient) => ingredient.active && ingredient.group === group,
      ),
    [config.ingredients, group],
  );

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function resetAssembly() {
    if (assembled) setAssembled(false);
  }

  function chooseFreestyle() {
    setRecipe(emptyRecipe());
    setCreationName("Mein Burger");
    setGroup("bun");
    setAssembled(false);
  }

  function chooseTemplate(templateId: string) {
    const next = config.templates.find(
      (item) => item.id === templateId && item.active,
    );
    if (!next) return;
    setRecipe({
      version: 1,
      templateId: next.id,
      ingredients: { ...next.recipe },
    });
    setCreationName(next.name);
    setGroup("protein");
    setAssembled(false);
  }

  function setIngredientQty(id: string, nextQty: number) {
    const ingredient = config.ingredients.find((item) => item.id === id);
    if (!ingredient) return;
    const qty = Math.max(0, Math.min(ingredient.max, Math.round(nextQty)));
    setRecipe((current) =>
      setExclusiveBurgerStudioBun(config, current, id, qty),
    );
    resetAssembly();
  }

  function finishBurger() {
    if (!completion.hasExactlyOneBun) {
      setGroup("bun");
      flash("Bitte genau ein Bun wählen 🥯");
      return;
    }
    if (!completion.hasProtein) {
      setGroup("protein");
      flash("Mindestens ein Protein fehlt 🥩");
      return;
    }
    if (!completion.withinLimit) {
      flash("Zu viele Zutaten für einen Burger.");
      return;
    }
    setAssembled(true);
    flash("Fertig! 🔥 Alles fällt zusammen.");
  }

  function saveCurrentBurger() {
    if (!config.savedBurgersEnabled || !completion.complete) return;
    const item: SavedBurger = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: creationName.trim().slice(0, 50) || "Mein Burger",
      recipe: normalizeBurgerStudioV2Recipe(recipe),
      savedAt: Date.now(),
    };
    const next = [item, ...saved].slice(0, config.maxSavedBurgers);
    setSaved(next);
    writeSaved(next);
    flash("Burger gespeichert ✓");
  }

  function loadSavedBurger(item: SavedBurger) {
    const nextRecipe = normalizeBurgerStudioV2Recipe(item.recipe);
    if (
      nextRecipe.templateId &&
      !config.templates.some(
        (entry) => entry.id === nextRecipe.templateId && entry.active,
      )
    ) {
      flash("Diese Burger-Basis ist aktuell nicht verfügbar.");
      return;
    }
    if (!nextRecipe.templateId && !config.scratchEnabled) {
      flash("Freestyle ist aktuell deaktiviert.");
      return;
    }
    setRecipe(nextRecipe);
    setCreationName(item.name);
    setAssembled(false);
    flash("Gespeicherter Burger geladen");
  }

  function removeSavedBurger(id: string) {
    const next = saved.filter((item) => item.id !== id);
    setSaved(next);
    writeSaved(next);
  }

  function addBurgerToCart() {
    if (!canOrder) return;
    const cleanName = creationName.trim().slice(0, 50) || "Mein Burger";
    const freestyle = !recipe.templateId;
    const itemId = freestyle
      ? BURGER_STUDIO_SCRATCH_SKU
      : String(linkedProduct?.id || linkedProduct?.sku || linkedProduct?.code || "");
    const sku = freestyle
      ? BURGER_STUDIO_SCRATCH_SKU
      : String(linkedProduct?.sku || linkedProduct?.code || linkedProduct?.id || "");

    if (!itemId || !sku) {
      flash("Die Burger-Basis ist gerade nicht bestellbar.");
      return;
    }

    const selectedSummary = plan.selected
      .map(({ ingredient, qty }) => `${ingredient.name}${qty > 1 ? ` ×${qty}` : ""}`)
      .join(", ")
      .slice(0, 450);

    addToCart({
      category: "burger",
      item: {
        id: itemId,
        sku,
        name: `🔥 Eigene Kreation – ${cleanName}`,
        price: freestyle
          ? config.scratchBasePrice
          : Number(linkedProduct?.price) || 0,
        category: "burger",
        description: freestyle
          ? `Freestyle · ${selectedSummary}`
          : `Basis: ${template?.name || "Burger"} · ${selectedSummary}`,
        imageUrl: freestyle
          ? undefined
          : linkedProduct?.imageUrl || linkedProduct?.image,
      },
      qty: 1,
      add: plan.add,
      rm: plan.rm,
      note: `🔥 BURGER STUDIO: ${cleanName}\nZutaten: ${selectedSummary}`,
    });

    flash("Dein Burger ist im Warenkorb 🔥");
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-[#070707] p-6 text-white">
        <div className="mx-auto max-w-6xl animate-pulse rounded-3xl border border-white/10 bg-white/[0.04] p-10">
          Burger Studio wird geladen…
        </div>
      </main>
    );
  }

  if (!config.enabled && !preview) {
    return (
      <main className="min-h-dvh bg-[#070707] p-6 text-white">
        <div className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
          <div className="text-5xl">🍔</div>
          <h1 className="mt-4 text-3xl font-black">Burger Studio</h1>
          <p className="mt-3 text-stone-400">Das Burger Studio ist gerade geschlossen.</p>
          <Link href="/menu" className="mt-6 inline-flex rounded-2xl bg-amber-400 px-5 py-3 font-black text-black">
            Zurück zum Menü
          </Link>
        </div>
      </main>
    );
  }

  const sourceName = recipe.templateId ? template?.name || "Burger-Basis" : "Freestyle";

  return (
    <main className="min-h-dvh bg-[#070707] pb-32 text-white">
      <div className="sticky top-0 z-40 border-b border-white/10 bg-[#070707]/92 px-3 py-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto max-w-7xl">
          <NavBar variant="plain" showLocationCaption={false} />
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[.25em] text-amber-300">Burger Brothers Lab · V2</div>
            <h1 className="mt-1 text-3xl font-black sm:text-5xl">🔥 Burger Studio</h1>
            <p className="mt-2 max-w-2xl text-sm text-stone-400 sm:text-base">
              Kein fertiger Burger nötig: Bun wählen, Zutaten stapeln und am Ende alles mit einem Klick zusammenfallen lassen.
            </p>
          </div>
          <Link href="/menu" className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-bold text-stone-300">← Menü</Link>
        </div>

        {!config.enabled && preview ? (
          <div className="mb-5 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
            Vorschau-Modus: Du kannst bauen und die Animation testen; Bestellen bleibt bis zur Aktivierung gesperrt.
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(380px,.95fr)]">
          <section className="space-y-5">
            <BurgerStackV2 config={config} recipe={recipe} assembled={assembled} />

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={finishBurger}
                disabled={!canFinish}
                className={`rounded-2xl px-5 py-4 text-left transition ${assembled ? "border border-emerald-400/30 bg-emerald-400/10" : "bg-amber-400 text-black"} disabled:cursor-not-allowed disabled:opacity-35`}
              >
                <div className="text-xs font-black uppercase tracking-[.16em] opacity-70">Finale</div>
                <div className="mt-1 text-lg font-black">{assembled ? "✓ Burger ist fertig" : "🔥 Fertig – alles fallen lassen"}</div>
              </button>
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <div className="text-xs font-black uppercase tracking-[.16em] text-stone-500">Check</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                  <span className={`rounded-full px-2 py-1 ${completion.hasExactlyOneBun ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-stone-500"}`}>🥯 1 Bun</span>
                  <span className={`rounded-full px-2 py-1 ${completion.hasProtein ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-stone-500"}`}>🥩 Protein</span>
                  <span className={`rounded-full px-2 py-1 ${completion.withinLimit ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>{completion.totalIngredients}/{config.maxIngredients} Zutaten</span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-widest text-stone-500">Start</div>
                  <div className="font-black">Freestyle oder fertigen Burger als Inspiration</div>
                </div>
                <div className="rounded-full bg-amber-400 px-3 py-1 text-sm font-black text-black">{fmt(plan.total)}</div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {config.scratchEnabled ? (
                  <button
                    type="button"
                    onClick={chooseFreestyle}
                    className={`min-w-44 rounded-2xl border p-3 text-left ${!recipe.templateId ? "border-amber-400 bg-amber-400/12" : "border-white/10 bg-white/[0.03]"}`}
                  >
                    <div className="text-xs font-black uppercase tracking-widest text-amber-300">FREESTYLE</div>
                    <div className="mt-1 font-black">Von null bauen</div>
                    <div className="mt-1 text-xs text-stone-500">Kein Burger muss gewählt werden</div>
                  </button>
                ) : null}
                {config.templates.filter((item) => item.active).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseTemplate(item.id)}
                    className={`min-w-44 rounded-2xl border p-3 text-left ${recipe.templateId === item.id ? "border-amber-400 bg-amber-400/12" : "border-white/10 bg-white/[0.03]"}`}
                  >
                    <div className="text-xs font-black uppercase tracking-widest text-stone-500">VORLAGE</div>
                    <div className="mt-1 font-black">{item.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-stone-500">{item.description || "Als Inspiration verwenden"}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <div className="grid grid-cols-5 gap-1 rounded-2xl bg-black/30 p-1">
                {GROUPS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setGroup(entry.key)}
                    className={`rounded-xl px-1 py-2 text-center text-[10px] font-black sm:text-xs ${group === entry.key ? "bg-amber-400 text-black" : "text-stone-400"}`}
                  >
                    <span className="block text-base">{entry.icon}</span>
                    {entry.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-xs text-stone-500">
                {GROUPS.find((entry) => entry.key === group)?.helper}
              </div>

              <div className="mt-3 space-y-2">
                {visibleIngredients.map((ingredient) => {
                  const qty = Number(recipe.ingredients[ingredient.id] || 0);
                  const baseQty = Number(template?.recipe?.[ingredient.id] || 0);
                  const deltaQty = qty - baseQty;
                  const line = plan.lines.find((entry) => entry.ingredient.id === ingredient.id);
                  const detail = !recipe.templateId
                    ? `${fmt(ingredient.addPrice)} · max. ${ingredient.max}`
                    : deltaQty > 0
                      ? `+${fmt(line?.amount || 0)} gegenüber Basis`
                      : deltaQty < 0
                        ? "Entfernt · ohne Preisabzug"
                        : baseQty > 0
                          ? "In der Basis enthalten"
                          : `${fmt(ingredient.addPrice)} · max. ${ingredient.max}`;

                  return (
                    <div
                      key={ingredient.id}
                      className={`flex items-center gap-3 rounded-2xl border p-3 ${qty > 0 ? "border-amber-400/30 bg-amber-400/[0.06]" : "border-white/10 bg-black/20"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold">{ingredient.name}</div>
                        <div className="text-xs text-stone-500">{detail}</div>
                      </div>
                      <div className="flex items-center gap-2 rounded-xl bg-black/40 p-1">
                        <button type="button" onClick={() => setIngredientQty(ingredient.id, qty - 1)} className="grid h-9 w-9 place-items-center rounded-lg bg-white/[0.07] text-lg font-black">−</button>
                        <span className="w-6 text-center font-black">{qty}</span>
                        <button
                          type="button"
                          onClick={() => setIngredientQty(ingredient.id, qty + 1)}
                          disabled={qty >= ingredient.max || (ingredient.group === "bun" && qty >= 1)}
                          className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400 text-lg font-black text-black disabled:opacity-30"
                        >+
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
              <label className="text-xs font-black uppercase tracking-widest text-stone-500">Deine Kreation</label>
              <input
                value={creationName}
                onChange={(event) => setCreationName(event.target.value.slice(0, 50))}
                placeholder="z.B. Ömer Special"
                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-bold outline-none focus:border-amber-400/60"
              />

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between text-stone-400">
                  <span>{sourceName} Basis</span>
                  <span>{fmt(plan.basePrice)}</span>
                </div>
                {plan.lines.filter((line) => line.amount > 0).map((line) => (
                  <div key={line.ingredient.id} className="flex justify-between gap-3 text-stone-400">
                    <span>{line.ingredient.name} {line.deltaQty > 0 ? `+${line.deltaQty}` : `×${line.qty}`}</span>
                    <span>+{fmt(line.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-white/10 pt-3 text-xl font-black">
                  <span>Dein Burger</span>
                  <span className="text-amber-300">{fmt(plan.total)}</span>
                </div>
              </div>

              {!modeAllowed ? (
                <div className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">
                  Für {orderMode === "delivery" ? "Lieferung" : "Abholung"} ist das Burger Studio aktuell deaktiviert.
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-2 gap-2">
                {config.savedBurgersEnabled ? (
                  <button type="button" onClick={saveCurrentBurger} disabled={!completion.complete} className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 font-black disabled:opacity-35">♡ Speichern</button>
                ) : <span />}
                <button
                  type="button"
                  onClick={addBurgerToCart}
                  disabled={!canOrder}
                  className="rounded-2xl bg-amber-400 px-4 py-3 font-black text-black shadow-[0_12px_35px_rgba(245,158,11,.2)] disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {assembled ? "In den Warenkorb" : "Erst Burger fertig machen"}
                </button>
              </div>
              <div className="mt-2 text-[11px] text-stone-600">
                Preise werden beim Bestellen serverseitig erneut aus der aktuellen Studio-Konfiguration geprüft.
              </div>
            </div>

            {config.savedBurgersEnabled && saved.length ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-5">
                <div className="mb-3 font-black">Meine Burger</div>
                <div className="space-y-2">
                  {saved.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <button type="button" onClick={() => loadSavedBurger(item)} className="min-w-0 flex-1 text-left">
                        <div className="truncate font-bold">{item.name}</div>
                        <div className="text-xs text-stone-500">Mit aktuellen Preisen neu bauen</div>
                      </button>
                      <button type="button" onClick={() => removeSavedBurger(item.id)} className="rounded-lg px-2 py-1 text-stone-500 hover:bg-white/10 hover:text-white">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[100] -translate-x-1/2 rounded-full border border-amber-300/30 bg-stone-950 px-5 py-3 text-sm font-black shadow-2xl">{toast}</div>
      ) : null}
    </main>
  );
}