"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  BurgerStudioGroup,
  BurgerStudioIngredient,
  BurgerStudioTemplate,
} from "@/lib/burger-studio";
import {
  BURGER_STUDIO_SCRATCH_SKU,
  createDefaultBurgerStudioV2Config,
  normalizeBurgerStudioV2Config,
  type BurgerStudioV2Config,
} from "@/lib/burger-studio-v2";

type CatalogProduct = {
  id?: string;
  sku?: string;
  code?: string;
  name?: string;
  category?: string;
  price?: number;
  active?: boolean;
};

const GROUP_OPTIONS: Array<{ value: BurgerStudioGroup; label: string }> = [
  { value: "bun", label: "Bun" },
  { value: "protein", label: "Protein" },
  { value: "cheese", label: "Käse" },
  { value: "topping", label: "Topping" },
  { value: "sauce", label: "Soße" },
];

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number * 100) / 100)
    : 0;
}

function productRef(product: CatalogProduct) {
  return String(product.id ?? product.sku ?? product.code ?? product.name ?? "").trim();
}

function isBurgerProduct(product: CatalogProduct) {
  const sku = String(product.sku ?? product.code ?? "").trim();
  if (sku === BURGER_STUDIO_SCRATCH_SKU) return false;
  const category = String(product.category ?? "").toLowerCase();
  return (
    category.includes("burger") ||
    category.includes("vegan") ||
    category.includes("vegetar")
  );
}

function emptyTemplate(index: number): BurgerStudioTemplate {
  return {
    id: `template-${Date.now()}-${index}`,
    name: "Neue Vorlage",
    productRef: "",
    description: "",
    active: true,
    recipe: {},
  };
}

function visualForGroup(group: BurgerStudioGroup) {
  if (group === "bun") return "bun-classic";
  if (group === "protein") return "beef";
  if (group === "cheese") return "cheddar";
  if (group === "sauce") return "sauce";
  return "topping";
}

export default function BurgerStudioAdminV2() {
  const [config, setConfig] = useState<BurgerStudioV2Config>(
    createDefaultBurgerStudioV2Config(),
  );
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);

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
        setConfig(normalizeBurgerStudioV2Config(settings?.menu?.burgerStudio));
        const products = Array.isArray(catalogRaw?.products)
          ? catalogRaw.products
          : Array.isArray(catalogRaw?.data?.products)
            ? catalogRaw.data.products
            : [];
        setCatalog(products);
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Daten konnten nicht geladen werden.",
        ),
      )
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const burgerProducts = useMemo(
    () =>
      catalog.filter(
        (product) => product.active !== false && isBurgerProduct(product),
      ),
    [catalog],
  );

  const ingredientMap = useMemo(
    () => new Map(config.ingredients.map((item) => [item.id, item])),
    [config.ingredients],
  );

  const bunCount = config.ingredients.filter(
    (item) => item.active && item.group === "bun",
  ).length;
  const proteinCount = config.ingredients.filter(
    (item) => item.active && item.group === "protein",
  ).length;

  function updateConfig(patch: Partial<BurgerStudioV2Config>) {
    setConfig((current) => ({ ...current, ...patch, version: 2 }));
  }

  function updateIngredient(
    id: string,
    patch: Partial<BurgerStudioIngredient>,
  ) {
    setConfig((current) => ({
      ...current,
      ingredients: current.ingredients.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function addIngredient(group: BurgerStudioGroup = "topping") {
    const index = config.ingredients.length + 1;
    const id = `zutat-${Date.now()}-${index}`;
    updateConfig({
      ingredients: [
        ...config.ingredients,
        {
          id,
          name: group === "bun" ? "Neues Bun" : "Neue Zutat",
          group,
          addPrice: 0,
          removeCredit: 0,
          max: group === "bun" ? 1 : 2,
          active: true,
          visual: visualForGroup(group),
        },
      ],
    });
  }

  function removeIngredient(id: string) {
    updateConfig({
      ingredients: config.ingredients.filter((item) => item.id !== id),
      templates: config.templates.map((template) => {
        const recipe = { ...template.recipe };
        delete recipe[id];
        return { ...template, recipe };
      }),
    });
  }

  function updateTemplate(id: string, patch: Partial<BurgerStudioTemplate>) {
    setConfig((current) => ({
      ...current,
      templates: current.templates.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  }

  function addTemplate() {
    const template = emptyTemplate(config.templates.length + 1);
    updateConfig({ templates: [...config.templates, template] });
    setOpenTemplateId(template.id);
  }

  function removeTemplate(id: string) {
    updateConfig({
      templates: config.templates.filter((item) => item.id !== id),
    });
    if (openTemplateId === id) setOpenTemplateId(null);
  }

  function setTemplateIngredient(
    templateId: string,
    ingredientId: string,
    rawQty: number,
  ) {
    const ingredient = ingredientMap.get(ingredientId);
    const template = config.templates.find((item) => item.id === templateId);
    if (!ingredient || !template) return;

    const qty = Math.max(
      0,
      Math.min(ingredient.max, Math.round(Number(rawQty) || 0)),
    );
    const recipe = { ...template.recipe };

    if (ingredient.group === "bun" && qty > 0) {
      for (const bun of config.ingredients) {
        if (bun.group === "bun") delete recipe[bun.id];
      }
      recipe[ingredientId] = 1;
    } else if (qty <= 0) {
      delete recipe[ingredientId];
    } else {
      recipe[ingredientId] = qty;
    }

    updateTemplate(templateId, { recipe });
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const clean = normalizeBurgerStudioV2Config(config);
      const activeTemplates = clean.templates.filter((item) => item.active);

      if (clean.enabled && !clean.scratchEnabled && activeTemplates.length === 0) {
        throw new Error(
          "Studio açıkken Freestyle veya en az bir aktif burger şablonu gerekli.",
        );
      }

      if (clean.scratchEnabled) {
        if (!clean.ingredients.some((item) => item.active && item.group === "bun")) {
          throw new Error("Freestyle için en az bir aktif Bun gerekli.");
        }
        if (!clean.ingredients.some((item) => item.active && item.group === "protein")) {
          throw new Error("Freestyle için en az bir aktif Protein gerekli.");
        }
      }

      for (const template of activeTemplates) {
        if (!template.productRef) {
          throw new Error(`${template.name}: gerçek menü ürünü seçilmedi.`);
        }
        const proteinQty = Object.entries(template.recipe).reduce(
          (sum, [ingredientId, qty]) =>
            ingredientMap.get(ingredientId)?.group === "protein"
              ? sum + Number(qty || 0)
              : sum,
          0,
        );
        if (proteinQty <= 0) {
          throw new Error(`${template.name}: reçetede en az bir protein olmalı.`);
        }
      }

      const syncResponse = await fetch("/api/admin/burger-studio/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ config: clean }),
      });
      const syncBody = await syncResponse.json().catch(() => ({}));
      if (!syncResponse.ok || syncBody?.ok === false) {
        throw new Error(
          String(
            syncBody?.message ||
              syncBody?.error ||
              "Burger Studio canonical fiyatları senkronlanamadı.",
          ),
        );
      }

      const response = await fetch("/api/settings", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ key: "menu.burgerStudio", value: clean }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(
          String(body?.message || body?.error || "Burger Studio kaydedilemedi."),
        );
      }

      setConfig(clean);
      setMessage(
        `Burger Studio V2 kaydedildi ✓ · ${syncBody?.updated ?? 0} ürün senkronlandı${syncBody?.scratchReady ? " · Freestyle hazır" : ""}.`,
      );

      try {
        const settingsResponse = await fetch("/api/settings", {
          cache: "no-store",
          credentials: "same-origin",
        });
        const settings = await settingsResponse.json();
        const next = settings?.settings ?? settings?.data ?? settings;
        localStorage.setItem("bb_settings_v6", JSON.stringify(next));
        window.dispatchEvent(
          new CustomEvent("bb_settings_changed", { detail: next }),
        );
        window.dispatchEvent(
          new CustomEvent("bb:settings-sync", { detail: next }),
        );
      } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-stone-300">
        Burger Studio V2 wird geladen…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[.25em] text-amber-300">
            Burger Brothers Lab · V2
          </div>
          <h1 className="mt-1 text-3xl font-black text-white">🧪 Burger Studio</h1>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-stone-400">
            Freestyle müşteriyi hazır bir burger seçmeye zorlamaz. Önce Bun, sonra istediği Beef/Crispy, peynir, topping ve sosları seçer. Hazır burger şablonları sadece opsiyonel ilham noktalarıdır.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/burger-studio?preview=1"
            target="_blank"
            className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white"
          >
            Oyun Önizleme ↗
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-amber-400 px-5 py-2 text-sm font-black text-black disabled:opacity-50"
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </header>

      {message ? (
        <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{message}</div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ToggleCard
          title="Burger Studio"
          description="Müşteri menüsünde Studio girişini gösterir."
          checked={config.enabled}
          onChange={(enabled) => updateConfig({ enabled })}
          strong
        />
        <ToggleCard
          title="Freestyle"
          description="Hazır burger seçmeden sıfırdan burger kurma."
          checked={config.scratchEnabled}
          onChange={(scratchEnabled) => updateConfig({ scratchEnabled })}
          strong
        />
        <ToggleCard
          title="Abholung"
          description="Gel-al siparişlerinde Studio kullanılabilir."
          checked={config.pickupEnabled}
          onChange={(pickupEnabled) => updateConfig({ pickupEnabled })}
        />
        <ToggleCard
          title="Lieferung"
          description="Teslimatta Studio kullanılabilir."
          checked={config.deliveryEnabled}
          onChange={(deliveryEnabled) => updateConfig({ deliveryEnabled })}
        />
      </section>

      <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.045] p-4 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1.3fr_.7fr] lg:items-end">
          <div>
            <h2 className="text-xl font-black text-white">🔥 Freestyle Fiyat Başlangıcı</h2>
            <p className="mt-1 text-sm text-stone-400">
              Bu tutar hazırlama/baz fiyatıdır. Seçilen Bun, Beef, Crispy, peynir ve diğer malzemelerin “Ekleme €” fiyatları bunun üstüne gelir. İstersen 0 € yapabilirsin.
            </p>
          </div>
          <NumberField
            label="Freestyle baz €"
            value={config.scratchBasePrice}
            min={0}
            max={50}
            step="0.1"
            onChange={(scratchBasePrice) => updateConfig({ scratchBasePrice: money(scratchBasePrice) })}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Kurallar & Kayıt</h2>
            <p className="mt-1 text-sm text-stone-500">
              Freestyle siparişte tam bir Bun ve en az bir Protein gerektirir. Kayıtlı burger güncel fiyatlarla yeniden hesaplanır.
            </p>
          </div>
          <div className="flex gap-2 text-xs font-black">
            <span className={`rounded-full px-3 py-1 ${bunCount ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>🥯 {bunCount} Bun</span>
            <span className={`rounded-full px-3 py-1 ${proteinCount ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>🥩 {proteinCount} Protein</span>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Maks. toplam malzeme"
            value={config.maxIngredients}
            min={2}
            max={40}
            onChange={(maxIngredients) =>
              updateConfig({ maxIngredients: Math.max(2, Math.min(40, Math.round(maxIngredients))) })
            }
          />
          <NumberField
            label="Maks. kayıtlı burger"
            value={config.maxSavedBurgers}
            min={1}
            max={30}
            onChange={(maxSavedBurgers) =>
              updateConfig({ maxSavedBurgers: Math.max(1, Math.min(30, Math.round(maxSavedBurgers))) })
            }
          />
          <ToggleCard
            title="Burger Kaydetme"
            description="Müşteri aynı cihazda kendi tariflerini saklar."
            checked={config.savedBurgersEnabled}
            onChange={(savedBurgersEnabled) => updateConfig({ savedBurgersEnabled })}
          />
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Malzemeler & Fiyat Motoru</h2>
            <p className="mt-1 max-w-4xl text-sm text-stone-500">
              Bun grubu tek seçimlidir. Protein/peynir/topping/sos adetleri “Maks.” değerine kadar artırılabilir. Çıkarma fiyat iadesi yapmaz.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => addIngredient("bun")} className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-200">+ Bun</button>
            <button type="button" onClick={() => addIngredient("topping")} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-black text-white">+ Malzeme</button>
          </div>
        </div>

        <div className="space-y-3">
          {config.ingredients.map((ingredient) => (
            <div
              key={ingredient.id}
              className={`grid gap-3 rounded-2xl border p-3 md:grid-cols-[auto_minmax(150px,1.3fr)_150px_130px_100px_auto] md:items-end ${ingredient.group === "bun" ? "border-amber-400/18 bg-amber-400/[0.035]" : "border-white/10 bg-black/20"}`}
            >
              <label className="flex items-center gap-2 pb-2 text-xs font-bold text-stone-400 md:flex-col md:items-start">
                <span>Aktif</span>
                <input type="checkbox" checked={ingredient.active} onChange={(event) => updateIngredient(ingredient.id, { active: event.target.checked })} className="h-5 w-5 accent-amber-400" />
              </label>
              <TextField label="Malzeme" value={ingredient.name} onChange={(name) => updateIngredient(ingredient.id, { name })} />
              <label className="text-xs font-bold text-stone-400">
                <span className="mb-1 block">Grup</span>
                <select
                  value={ingredient.group}
                  onChange={(event) => {
                    const group = event.target.value as BurgerStudioGroup;
                    updateIngredient(ingredient.id, {
                      group,
                      max: group === "bun" ? 1 : ingredient.max,
                      visual: ingredient.visual || visualForGroup(group),
                    });
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none"
                >
                  {GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <NumberField label="Ekleme €" value={ingredient.addPrice} step="0.1" onChange={(addPrice) => updateIngredient(ingredient.id, { addPrice: money(addPrice) })} />
              <NumberField label="Maks." value={ingredient.group === "bun" ? 1 : ingredient.max} min={1} max={6} onChange={(max) => updateIngredient(ingredient.id, { max: ingredient.group === "bun" ? 1 : Math.max(1, Math.min(6, Math.round(max))) })} />
              <button type="button" onClick={() => removeIngredient(ingredient.id)} className="h-11 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 text-sm font-black text-rose-300">Sil</button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-white">Hazır Burger Şablonları <span className="text-sm font-bold text-stone-500">(Opsiyonel)</span></h2>
            <p className="mt-1 max-w-4xl text-sm text-stone-500">
              Farmas, Italian, Hit Burger gibi gerçek ürünleri istersen “hazırdan başla” seçeneği olarak sun. Freestyle için bunlardan hiçbiri zorunlu değil.
            </p>
          </div>
          <button type="button" onClick={addTemplate} className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-black text-amber-200">+ Şablon</button>
        </div>

        {!config.templates.length ? (
          <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-stone-500">Şablon yok; Freestyle tek başına çalışabilir.</div>
        ) : null}

        <div className="space-y-3">
          {config.templates.map((template) => {
            const open = openTemplateId === template.id;
            const linked = burgerProducts.find((product) => productRef(product) === template.productRef);
            return (
              <div key={template.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <input type="checkbox" checked={template.active} onChange={(event) => updateTemplate(template.id, { active: event.target.checked })} className="h-5 w-5 accent-amber-400" />
                  <button type="button" onClick={() => setOpenTemplateId(open ? null : template.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate font-black text-white">{template.name}</div>
                    <div className="mt-1 truncate text-xs text-stone-500">{linked ? `${linked.name} · ${money(linked.price).toFixed(2)} € baz` : "⚠ Menü ürünü seçilmedi"}</div>
                  </button>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-black text-stone-300">{Object.values(template.recipe).reduce((sum, qty) => sum + Number(qty || 0), 0)} katman</span>
                  <button type="button" onClick={() => removeTemplate(template.id)} className="rounded-lg px-3 py-2 text-xs font-black text-rose-300 hover:bg-rose-400/10">Sil</button>
                </div>

                {open ? (
                  <div className="border-t border-white/10 p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <TextField label="Şablon adı" value={template.name} onChange={(name) => updateTemplate(template.id, { name })} />
                      <label className="text-xs font-bold text-stone-400 lg:col-span-2">
                        <span className="mb-1 block">Gerçek menü ürünü / baz fiyat</span>
                        <select value={template.productRef} onChange={(event) => updateTemplate(template.id, { productRef: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none">
                          <option value="">Ürün seç…</option>
                          {burgerProducts.map((product) => {
                            const ref = productRef(product);
                            return <option key={ref} value={ref}>{product.name} — {money(product.price).toFixed(2)} €</option>;
                          })}
                        </select>
                      </label>
                      <label className="text-xs font-bold text-stone-400 lg:col-span-3">
                        <span className="mb-1 block">Açıklama</span>
                        <input value={template.description || ""} onChange={(event) => updateTemplate(template.id, { description: event.target.value.slice(0, 180) })} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none" />
                      </label>
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 text-xs font-black uppercase tracking-widest text-stone-500">Normal ürün reçetesi</div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {config.ingredients.filter((ingredient) => ingredient.active).map((ingredient) => {
                          const qty = Number(template.recipe[ingredient.id] || 0);
                          return (
                            <div key={ingredient.id} className={`flex items-center gap-2 rounded-xl border p-2 ${qty > 0 ? "border-amber-400/25 bg-amber-400/[0.06]" : "border-white/10 bg-black/20"}`}>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-bold text-white">{ingredient.name}</div>
                                <div className="text-[10px] uppercase text-stone-600">{ingredient.group}</div>
                              </div>
                              <button type="button" onClick={() => setTemplateIngredient(template.id, ingredient.id, qty - 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] font-black">−</button>
                              <span className="w-5 text-center text-sm font-black">{qty}</span>
                              <button type="button" onClick={() => setTemplateIngredient(template.id, ingredient.id, qty + 1)} disabled={qty >= ingredient.max || (ingredient.group === "bun" && qty >= 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 font-black text-black disabled:opacity-30">+</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.2rem)] z-20 flex justify-end lg:bottom-4">
        <button type="button" onClick={save} disabled={saving} className="rounded-2xl bg-amber-400 px-6 py-3 font-black text-black shadow-2xl disabled:opacity-50">
          {saving ? "Kaydediliyor…" : "Burger Studio V2’yi Kaydet"}
        </button>
      </div>
    </div>
  );
}

function ToggleCard({
  title,
  description,
  checked,
  onChange,
  strong = false,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  strong?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 ${checked && strong ? "border-amber-400/35 bg-amber-400/10" : "border-white/10 bg-white/[0.03]"}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-6 w-6 shrink-0 accent-amber-400" />
      <span>
        <span className="block font-black text-white">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-stone-500">{description}</span>
      </span>
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-xs font-bold text-stone-400">
      <span className="mb-1 block">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value.slice(0, 80))} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none focus:border-amber-400/50" />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  max = 999,
  step = "1",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: string;
}) {
  return (
    <label className="text-xs font-bold text-stone-400">
      <span className="mb-1 block">{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none focus:border-amber-400/50" />
    </label>
  );
}
