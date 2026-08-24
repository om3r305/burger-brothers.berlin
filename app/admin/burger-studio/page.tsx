"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createDefaultBurgerStudioConfig,
  normalizeBurgerStudioConfig,
  type BurgerStudioConfig,
  type BurgerStudioGroup,
  type BurgerStudioIngredient,
  type BurgerStudioTemplate,
} from "@/lib/burger-studio";

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
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
}

function slug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function productRef(product: CatalogProduct) {
  return String(product.id ?? product.sku ?? product.code ?? product.name ?? "").trim();
}

function isBurgerProduct(product: CatalogProduct) {
  const category = String(product.category ?? "").toLowerCase();
  return category.includes("burger") || category.includes("vegan") || category.includes("vegetar");
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

export default function BurgerStudioAdminPage() {
  const [config, setConfig] = useState<BurgerStudioConfig>(createDefaultBurgerStudioConfig());
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [openTemplateId, setOpenTemplateId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/settings", { cache: "no-store", credentials: "same-origin" }).then((res) => res.json()),
      fetch("/api/catalog", { cache: "no-store", credentials: "same-origin" }).then((res) => res.json()),
    ])
      .then(([settingsRaw, catalogRaw]) => {
        if (!alive) return;
        const settings = settingsRaw?.settings ?? settingsRaw?.data ?? settingsRaw ?? {};
        setConfig(normalizeBurgerStudioConfig(settings?.menu?.burgerStudio));
        const products = Array.isArray(catalogRaw?.products)
          ? catalogRaw.products
          : Array.isArray(catalogRaw?.data?.products)
            ? catalogRaw.data.products
            : [];
        setCatalog(products);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Daten konnten nicht geladen werden."))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const burgerProducts = useMemo(
    () => catalog.filter((product) => product.active !== false && isBurgerProduct(product)),
    [catalog],
  );

  const ingredientMap = useMemo(
    () => new Map(config.ingredients.map((ingredient) => [ingredient.id, ingredient])),
    [config.ingredients],
  );

  function updateConfig(patch: Partial<BurgerStudioConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  function updateIngredient(id: string, patch: Partial<BurgerStudioIngredient>) {
    setConfig((current) => ({
      ...current,
      ingredients: current.ingredients.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function addIngredient() {
    const index = config.ingredients.length + 1;
    const id = `zutat-${Date.now()}-${index}`;
    updateConfig({
      ingredients: [
        ...config.ingredients,
        {
          id,
          name: "Neue Zutat",
          group: "topping",
          addPrice: 0,
          removeCredit: 0,
          max: 1,
          active: true,
          visual: "topping",
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
      templates: current.templates.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function addTemplate() {
    const template = emptyTemplate(config.templates.length + 1);
    updateConfig({ templates: [...config.templates, template] });
    setOpenTemplateId(template.id);
  }

  function removeTemplate(id: string) {
    updateConfig({ templates: config.templates.filter((item) => item.id !== id) });
    if (openTemplateId === id) setOpenTemplateId(null);
  }

  function setTemplateIngredient(templateId: string, ingredientId: string, qtyValue: number) {
    const ingredient = ingredientMap.get(ingredientId);
    if (!ingredient) return;
    const qty = Math.max(0, Math.min(ingredient.max, Math.round(Number(qtyValue) || 0)));
    const template = config.templates.find((item) => item.id === templateId);
    if (!template) return;
    const recipe = { ...template.recipe };
    if (qty <= 0) delete recipe[ingredientId];
    else recipe[ingredientId] = qty;
    updateTemplate(templateId, { recipe });
  }

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const clean = normalizeBurgerStudioConfig(config);
      const response = await fetch("/api/settings", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: "menu.burgerStudio", value: clean }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        throw new Error(String(body?.message || body?.error || "Burger Studio konnte nicht gespeichert werden."));
      }
      setConfig(clean);
      setMessage("Burger Studio gespeichert ✓");
      try {
        const settingsResponse = await fetch("/api/settings", { cache: "no-store", credentials: "same-origin" });
        const settings = await settingsResponse.json();
        localStorage.setItem("bb_settings_v6", JSON.stringify(settings?.settings ?? settings?.data ?? settings));
        window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: settings?.settings ?? settings?.data ?? settings }));
      } catch {}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-stone-300">Burger Studio wird geladen…</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[.25em] text-amber-300">Burger Brothers Lab</div>
          <h1 className="mt-1 text-3xl font-black text-white">🧪 Burger Studio</h1>
          <p className="mt-2 max-w-3xl text-sm text-stone-400">Buradan Burger Studio’yu açıp kapatabilir, malzeme fiyatlarını, değiştirme kredilerini ve gerçek menü burgerlerinden oluşturulan şablon reçetelerini yönetebilirsin.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/burger-studio?preview=1" target="_blank" className="rounded-xl border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-black text-white">Önizleme ↗</Link>
          <button type="button" onClick={save} disabled={saving} className="rounded-xl bg-amber-400 px-5 py-2 text-sm font-black text-black disabled:opacity-50">{saving ? "Kaydediliyor…" : "Kaydet"}</button>
        </div>
      </div>

      {message ? <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-4 text-sm font-bold text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 p-4 text-sm font-bold text-rose-100">{error}</div> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ToggleCard title="Burger Studio" description="Müşteri menüsünde Burger Studio girişini gösterir." checked={config.enabled} onChange={(enabled) => updateConfig({ enabled })} strong />
        <ToggleCard title="Abholung" description="Gel-al siparişlerinde kullanılabilir." checked={config.pickupEnabled} onChange={(pickupEnabled) => updateConfig({ pickupEnabled })} />
        <ToggleCard title="Lieferung" description="Teslimat siparişlerinde kullanılabilir." checked={config.deliveryEnabled} onChange={(deliveryEnabled) => updateConfig({ deliveryEnabled })} />
        <ToggleCard title="Freestyle" description="Müşteri sıfırdan burger kurabilir." checked={config.scratchEnabled} onChange={(scratchEnabled) => updateConfig({ scratchEnabled })} />
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-black text-white">Genel Kurallar</h2><p className="mt-1 text-sm text-stone-500">Fiyat ve kayıt sınırları.</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label="Freestyle baz fiyatı (€)" value={config.scratchBasePrice} step="0.1" onChange={(value) => updateConfig({ scratchBasePrice: money(value) })} />
          <NumberField label="Maks. toplam malzeme" value={config.maxIngredients} min={1} max={40} onChange={(value) => updateConfig({ maxIngredients: Math.max(1, Math.min(40, Math.round(value))) })} />
          <NumberField label="Maks. kayıtlı burger" value={config.maxSavedBurgers} min={1} max={30} onChange={(value) => updateConfig({ maxSavedBurgers: Math.max(1, Math.min(30, Math.round(value))) })} />
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><label className="flex cursor-pointer items-center justify-between gap-3"><span><span className="block font-black text-white">Burger Kaydetme</span><span className="mt-1 block text-xs text-stone-500">Müşteri kendi burgerini cihazında saklayabilir.</span></span><input type="checkbox" checked={config.savedBurgersEnabled} onChange={(event) => updateConfig({ savedBurgersEnabled: event.target.checked })} className="h-5 w-5 accent-amber-400" /></label></div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-black text-white">Malzemeler & Fiyat Motoru</h2><p className="mt-1 max-w-3xl text-sm text-stone-500">“Ekleme fiyatı” ekstra koyulduğunda alınır. “Değiştirme kredisi”, bir şablondaki malzeme çıkarıldığında baz fiyattan düşülebilecek tutardır. Salata/soğan gibi ürünlerde krediyi 0 bırakabilirsin.</p></div>
          <button type="button" onClick={addIngredient} className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-black text-amber-200">+ Malzeme</button>
        </div>

        <div className="space-y-3">
          {config.ingredients.map((ingredient) => (
            <div key={ingredient.id} className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[auto_minmax(150px,1.3fr)_150px_130px_130px_100px_auto] md:items-end">
              <label className="flex items-center gap-2 pb-2 text-xs font-bold text-stone-400 md:flex-col md:items-start"><span>Aktif</span><input type="checkbox" checked={ingredient.active} onChange={(event) => updateIngredient(ingredient.id, { active: event.target.checked })} className="h-5 w-5 accent-amber-400" /></label>
              <TextField label="Malzeme" value={ingredient.name} onChange={(name) => updateIngredient(ingredient.id, { name, id: ingredient.id || slug(name) })} />
              <label className="text-xs font-bold text-stone-400"><span className="mb-1 block">Grup</span><select value={ingredient.group} onChange={(event) => updateIngredient(ingredient.id, { group: event.target.value as BurgerStudioGroup })} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none">{GROUP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <NumberField label="Ekleme €" value={ingredient.addPrice} step="0.1" onChange={(value) => updateIngredient(ingredient.id, { addPrice: money(value) })} />
              <NumberField label="Kredi €" value={ingredient.removeCredit} step="0.1" onChange={(value) => updateIngredient(ingredient.id, { removeCredit: money(value) })} />
              <NumberField label="Maks." value={ingredient.max} min={1} max={6} onChange={(value) => updateIngredient(ingredient.id, { max: Math.max(1, Math.min(6, Math.round(value))) })} />
              <button type="button" onClick={() => removeIngredient(ingredient.id)} className="h-11 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 text-sm font-black text-rose-300">Sil</button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-black text-white">Burger Şablonları</h2><p className="mt-1 max-w-3xl text-sm text-stone-500">Örn. Farmas veya Italian’ı gerçek menü ürünüyle bağla. Studio başlangıç fiyatını o ürünün güncel katalog fiyatından alır; müşterinin yaptığı değişikliklerin farkını ayrıca hesaplar.</p></div>
          <button type="button" onClick={addTemplate} className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-sm font-black text-amber-200">+ Şablon</button>
        </div>

        {!config.templates.length ? <div className="rounded-2xl border border-dashed border-white/15 p-6 text-center text-sm text-stone-500">Henüz şablon yok. “+ Şablon” ile Farmas, Italian gibi ürünleri bağlayabilirsin.</div> : null}

        <div className="space-y-3">
          {config.templates.map((template) => {
            const open = openTemplateId === template.id;
            const linked = burgerProducts.find((product) => productRef(product) === template.productRef);
            return (
              <div key={template.id} className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                <div className="flex flex-wrap items-center gap-3 p-4">
                  <input type="checkbox" checked={template.active} onChange={(event) => updateTemplate(template.id, { active: event.target.checked })} className="h-5 w-5 accent-amber-400" />
                  <button type="button" onClick={() => setOpenTemplateId(open ? null : template.id)} className="min-w-0 flex-1 text-left"><div className="truncate font-black text-white">{template.name}</div><div className="mt-1 truncate text-xs text-stone-500">{linked ? `${linked.name} · ${money(linked.price).toFixed(2)} € güncel baz` : "⚠ Menü ürünü seçilmedi"}</div></button>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-black text-stone-300">{Object.values(template.recipe).reduce((sum, qty) => sum + Number(qty || 0), 0)} katman</span>
                  <button type="button" onClick={() => removeTemplate(template.id)} className="rounded-lg px-3 py-2 text-xs font-black text-rose-300 hover:bg-rose-400/10">Sil</button>
                </div>

                {open ? (
                  <div className="border-t border-white/10 p-4 sm:p-5">
                    <div className="grid gap-4 lg:grid-cols-3">
                      <TextField label="Şablon adı" value={template.name} onChange={(name) => updateTemplate(template.id, { name })} />
                      <label className="text-xs font-bold text-stone-400 lg:col-span-2"><span className="mb-1 block">Gerçek menü ürünü / baz fiyat</span><select value={template.productRef} onChange={(event) => updateTemplate(template.id, { productRef: event.target.value })} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none"><option value="">Ürün seç…</option>{burgerProducts.map((product) => { const ref = productRef(product); return <option key={ref} value={ref}>{product.name} — {money(product.price).toFixed(2)} €</option>; })}</select></label>
                      <label className="text-xs font-bold text-stone-400 lg:col-span-3"><span className="mb-1 block">Açıklama</span><input value={template.description || ""} onChange={(event) => updateTemplate(template.id, { description: event.target.value.slice(0, 180) })} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none" /></label>
                    </div>

                    <div className="mt-5"><div className="mb-2 text-xs font-black uppercase tracking-widest text-stone-500">Şablon reçetesi</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{config.ingredients.filter((ingredient) => ingredient.active).map((ingredient) => { const qty = Number(template.recipe[ingredient.id] || 0); return <div key={ingredient.id} className={`flex items-center gap-2 rounded-xl border p-2 ${qty > 0 ? "border-amber-400/25 bg-amber-400/[0.06]" : "border-white/10 bg-black/20"}`}><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-white">{ingredient.name}</div><div className="text-[10px] uppercase text-stone-600">{ingredient.group}</div></div><button type="button" onClick={() => setTemplateIngredient(template.id, ingredient.id, qty - 1)} className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] font-black">−</button><span className="w-5 text-center text-sm font-black">{qty}</span><button type="button" onClick={() => setTemplateIngredient(template.id, ingredient.id, qty + 1)} disabled={qty >= ingredient.max} className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 font-black text-black disabled:opacity-30">+</button></div>; })}</div></div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+5.2rem)] z-20 flex justify-end lg:bottom-4"><button type="button" onClick={save} disabled={saving} className="rounded-2xl bg-amber-400 px-6 py-3 font-black text-black shadow-2xl disabled:opacity-50">{saving ? "Kaydediliyor…" : "Burger Studio’yu Kaydet"}</button></div>
    </div>
  );
}

function ToggleCard({ title, description, checked, onChange, strong = false }: { title: string; description: string; checked: boolean; onChange: (value: boolean) => void; strong?: boolean }) {
  return <label className={`flex cursor-pointer items-center gap-4 rounded-2xl border p-4 ${checked && strong ? "border-amber-400/35 bg-amber-400/10" : "border-white/10 bg-white/[0.03]"}`}><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-6 w-6 shrink-0 accent-amber-400" /><span><span className="block font-black text-white">{title}</span><span className="mt-1 block text-xs leading-relaxed text-stone-500">{description}</span></span></label>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-bold text-stone-400"><span className="mb-1 block">{label}</span><input value={value} onChange={(event) => onChange(event.target.value.slice(0, 80))} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none focus:border-amber-400/50" /></label>;
}

function NumberField({ label, value, onChange, min = 0, max = 999, step = "1" }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: string }) {
  return <label className="text-xs font-bold text-stone-400"><span className="mb-1 block">{label}</span><input type="number" value={Number.isFinite(value) ? value : 0} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value) || 0)} className="h-11 w-full rounded-xl border border-white/10 bg-stone-950 px-3 text-sm text-white outline-none focus:border-amber-400/50" /></label>;
}
