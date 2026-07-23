"use client";

import type { ShowcaseProduct, ShowcaseScene } from "@/lib/showcase/types";

type Props = {
  scene: ShowcaseScene;
  allProducts: ShowcaseProduct[];
  selectedProducts: ShowcaseProduct[];
  sceneDuration: number;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>, structural?: boolean) => void;
  onAdd: (productId: string) => void;
  onRemove: (productId: string) => void;
  onMove: (productId: string, direction: -1 | 1) => void;
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-stone-200">{label}</span>{children}{hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}</label>;
}

export default function ProductSceneEditor({ scene, allProducts, selectedProducts, sceneDuration, inputClass, onChange, onAdd, onRemove, onMove }: Props) {
  if (scene.type !== "product") return null;
  const limit = Math.max(1, Math.min(20, Number(scene.productLimit || 8)));
  return (
    <section className="rounded-2xl border border-orange-700/40 bg-orange-950/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-xs font-black uppercase tracking-[.16em] text-orange-300">Çoklu ürün akışı</div><h3 className="mt-1 font-black text-white">Ürünleri seç ve gösterim sırasını belirle</h3><p className="mt-1 max-w-3xl text-sm leading-relaxed text-stone-300">Her ürün tek kartta gösterilir. Ürün sayısı ve toplam süre sınırı diğer sahnelerin zamanında oynatılmasını korur.</p></div>
        <div className="rounded-xl border border-orange-700/40 bg-black/25 px-3 py-2 text-xs text-orange-100">{selectedProducts.length}/{limit} ürün · toplam {sceneDuration} saniye</div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Ürün ekle"><select className={inputClass} value="" onChange={(event) => { onAdd(event.target.value); event.target.value = ""; }}><option value="">Listeden ürün seç…</option>{allProducts.filter((product) => !selectedProducts.some((selected) => selected.id === product.id)).map((product) => <option key={product.id} value={product.id}>{product.groupLabel && product.groupLabel !== product.categoryLabel ? `${product.groupLabel} · ` : ""}{product.name} · {(product.displayPrice ?? product.price).toFixed(2)} €</option>)}</select></Field>
        <Field label="Ürün başına süre"><input type="number" min={6} max={120} className={inputClass} value={scene.productSeconds || 12} onChange={(event) => onChange({ productSeconds: Number(event.target.value) })} /></Field>
        <Field label="En fazla ürün" hint="Maksimum 20"><input type="number" min={1} max={20} className={inputClass} value={limit} onChange={(event) => { const next = Math.max(1, Math.min(20, Number(event.target.value) || 1)); onChange({ productLimit: next, productIds: (scene.productIds || []).slice(0, next) }, true); }} /></Field>
        <Field label="Maksimum toplam süre" hint="Önerilen: 90 saniye"><input type="number" min={15} max={300} className={inputClass} value={scene.productMaxTotalSeconds || 90} onChange={(event) => onChange({ productMaxTotalSeconds: Number(event.target.value) }, true)} /></Field>
      </div>

      <div className="mt-4 rounded-2xl border border-stone-800 bg-stone-950/55 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-black text-white">Ürün görseli yerleşimi</h4><p className="text-xs text-stone-400">Görsel boyutunu ve merkezini ayarla.</p></div><button type="button" onClick={() => onChange({ productImageFit: "contain", productImageScale: 82, productImageX: 0, productImageY: 0 }, true)} className="rounded-lg border border-stone-700 px-3 py-1.5 text-xs font-bold text-stone-200 hover:bg-stone-800">Varsayılana dön</button></div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Görsel biçimi"><select className={inputClass} value={scene.productImageFit || "contain"} onChange={(event) => onChange({ productImageFit: event.target.value as "contain" | "cover" })}><option value="contain">Görselin tamamını göster</option><option value="cover">Alanı doldur ve kırp</option></select></Field>
          <Field label={`Görsel boyutu: ${Math.round(scene.productImageScale || 82)}%`}><input type="range" min={35} max={130} className="w-full accent-orange-500" value={scene.productImageScale || 82} onChange={(event) => onChange({ productImageScale: Number(event.target.value) })} /></Field>
          <Field label={`Yatay konum: ${Math.round(scene.productImageX || 0)}%`}><input type="range" min={-40} max={40} className="w-full accent-orange-500" value={scene.productImageX || 0} onChange={(event) => onChange({ productImageX: Number(event.target.value) })} /></Field>
          <Field label={`Dikey konum: ${Math.round(scene.productImageY || 0)}%`}><input type="range" min={-40} max={40} className="w-full accent-orange-500" value={scene.productImageY || 0} onChange={(event) => onChange({ productImageY: Number(event.target.value) })} /></Field>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {selectedProducts.length ? selectedProducts.map((product, index) => <div key={product.id} className="flex items-center gap-3 rounded-xl border border-stone-800 bg-stone-950/70 p-3">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black">{product.imageUrl ? <img src={product.imageUrl} alt="" className="h-full w-full object-contain" /> : <div className="grid h-full place-items-center text-2xl">🍔</div>}</div>
          <div className="min-w-0 flex-1"><strong className="truncate text-sm text-white">{index + 1}. {product.name}</strong><div className="mt-1 text-xs text-stone-400"><span className="font-bold text-orange-200">{(product.displayPrice ?? product.price).toFixed(2)} €</span>{product.campaignBadge ? ` · ${product.campaignBadge}` : ""}</div></div>
          <div className="flex shrink-0 gap-1"><button type="button" onClick={() => onMove(product.id, -1)} disabled={index === 0} className="rounded-lg bg-stone-800 px-2 py-1.5 text-xs disabled:opacity-30">↑</button><button type="button" onClick={() => onMove(product.id, 1)} disabled={index === selectedProducts.length - 1} className="rounded-lg bg-stone-800 px-2 py-1.5 text-xs disabled:opacity-30">↓</button><button type="button" onClick={() => onRemove(product.id)} className="rounded-lg bg-red-950 px-2 py-1.5 text-xs text-red-300">Sil</button></div>
        </div>) : <div className="rounded-xl border border-dashed border-stone-700 p-5 text-center text-sm text-stone-400">Henüz ürün seçilmedi.</div>}
      </div>
    </section>
  );
}
